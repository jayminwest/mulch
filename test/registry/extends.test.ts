import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCustomTypeDefinition, validateCustomTypeConfig } from "../../src/registry/custom.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { getRegistry, resetRegistry } from "../../src/registry/type-registry.ts";
import type { CustomTypeConfig } from "../../src/schemas/config.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { initMulchDir, writeConfig } from "../../src/utils/config.ts";

describe("validateCustomTypeConfig — extends", () => {
	it("accepts extends: <builtin> with no other fields", () => {
		expect(() => validateCustomTypeConfig("adr", { extends: "decision" })).not.toThrow();
	});

	it("accepts extends + additive required fields", () => {
		expect(() =>
			validateCustomTypeConfig("adr", {
				extends: "decision",
				required: ["decision_status"],
			}),
		).not.toThrow();
	});

	it("rejects extends pointing at a custom type", () => {
		expect(() => validateCustomTypeConfig("adr", { extends: "hypothesis" })).toThrow(
			/must be a built-in type/,
		);
	});

	it("rejects extends pointing at an unknown name", () => {
		expect(() => validateCustomTypeConfig("adr", { extends: "nope" })).toThrow(
			/must be a built-in type/,
		);
	});

	it("rejects empty string extends", () => {
		expect(() => validateCustomTypeConfig("adr", { extends: "" })).toThrow(/non-empty/);
	});

	it("requires required[] or extends — not both empty", () => {
		expect(() => validateCustomTypeConfig("adr", {})).toThrow(/non-empty.*required/);
	});

	it("dedup_key may be inherited from parent", () => {
		// decision's dedup_key is 'title'; child doesn't redeclare title.
		expect(() => validateCustomTypeConfig("adr", { extends: "decision" })).not.toThrow();
	});

	it("rejects child dedup_key referencing a field not in merged required/optional", () => {
		expect(() =>
			validateCustomTypeConfig("adr", {
				extends: "decision",
				dedup_key: "ghost",
			}),
		).toThrow(/dedup_key "ghost"/);
	});

	it("accepts child dedup_key referencing a parent field", () => {
		// pattern declares 'name' as required.
		expect(() =>
			validateCustomTypeConfig("playbook", {
				extends: "pattern",
				dedup_key: "name",
			}),
		).not.toThrow();
	});

	it("accepts aliases for inherited parent fields", () => {
		expect(() =>
			validateCustomTypeConfig("adr", {
				extends: "decision",
				aliases: { title: ["name"] },
			}),
		).not.toThrow();
	});

	it("rejects aliases legacy collision with an inherited field", () => {
		// pattern has 'name' required; aliasing description -> name must fail
		// because 'name' already exists as a current field.
		expect(() =>
			validateCustomTypeConfig("playbook", {
				extends: "pattern",
				aliases: { description: ["name"] },
			}),
		).toThrow(/aliases legacy name "name" is already declared as a current field/);
	});
});

describe("buildCustomTypeDefinition — extends", () => {
	it("inherits required + optional from parent when child adds nothing", () => {
		const def = buildCustomTypeDefinition("adr", { extends: "decision" });
		expect(def.required).toEqual(["title", "rationale"]);
		expect(def.optional).toEqual(["date"]);
		expect(def.dedupKey).toBe("title");
		expect(def.idKey).toBe("title");
		expect(def.compact).toBe("concat");
		expect(def.sectionTitle).toBe("Decisions");
		expect(def.extractsFiles).toBe(false);
	});

	it("merges child required additively (parent first, child appended)", () => {
		const def = buildCustomTypeDefinition("adr", {
			extends: "decision",
			required: ["decision_status", "deciders"],
		});
		expect(def.required).toEqual(["title", "rationale", "decision_status", "deciders"]);
		expect(def.optional).toEqual(["date"]);
	});

	it("promotes a parent optional to required when child lists it", () => {
		const def = buildCustomTypeDefinition("adr", {
			extends: "decision",
			required: ["date"],
		});
		expect(def.required).toEqual(["title", "rationale", "date"]);
		// 'date' must NOT also appear under optional.
		expect(def.optional).toEqual([]);
	});

	it("dedupes silently when child redeclares a parent required field", () => {
		const def = buildCustomTypeDefinition("adr", {
			extends: "decision",
			required: ["title", "decision_status"],
		});
		expect(def.required).toEqual(["title", "rationale", "decision_status"]);
	});

	it("overrides summary when child sets it; otherwise inherits parent's", () => {
		const inherited = buildCustomTypeDefinition("adr", { extends: "decision" });
		const overridden = buildCustomTypeDefinition("adr2", {
			extends: "decision",
			summary: "{title} :: {rationale}",
		});
		const sample = {
			type: "adr",
			classification: "tactical",
			recorded_at: "2026-05-06T00:00:00Z",
			title: "Use bun",
			rationale: "fast",
		} as unknown as Parameters<typeof inherited.summary>[0];
		// decision's built-in summary returns the title.
		expect(inherited.summary(sample)).toBe("Use bun");
		expect(overridden.summary(sample)).toBe("Use bun :: fast");
	});

	it("overrides compact when child sets it; otherwise inherits parent's", () => {
		const inherited = buildCustomTypeDefinition("adr", { extends: "decision" });
		const overridden = buildCustomTypeDefinition("adr2", {
			extends: "decision",
			compact: "manual",
		});
		expect(inherited.compact).toBe("concat"); // decision's strategy
		expect(overridden.compact).toBe("manual");
	});

	it("overrides section_title when child sets it; otherwise inherits parent's", () => {
		const inherited = buildCustomTypeDefinition("adr", { extends: "decision" });
		const overridden = buildCustomTypeDefinition("adr2", {
			extends: "decision",
			section_title: "ADRs",
		});
		expect(inherited.sectionTitle).toBe("Decisions");
		expect(overridden.sectionTitle).toBe("ADRs");
	});

	it("overrides extracts_files / files_field when child sets them", () => {
		const inherited = buildCustomTypeDefinition("playbook", { extends: "pattern" });
		expect(inherited.extractsFiles).toBe(true); // pattern's setting
		expect(inherited.filesField).toBe("files");

		const overridden = buildCustomTypeDefinition("playbook2", {
			extends: "pattern",
			extracts_files: false,
		});
		expect(overridden.extractsFiles).toBe(false);
	});

	it("emits AJV schema where parent + child fields are all required", () => {
		const def = buildCustomTypeDefinition("adr", {
			extends: "decision",
			required: ["decision_status"],
		});
		const schema = def.ajvSchema as {
			type: string;
			required: string[];
			additionalProperties: boolean;
			properties: Record<string, unknown>;
		};
		expect(schema.required).toContain("title");
		expect(schema.required).toContain("rationale");
		expect(schema.required).toContain("decision_status");
		expect(schema.required).toContain("classification");
		expect(schema.required).toContain("recorded_at");
		expect(schema.properties.title).toBeDefined();
		expect(schema.properties.rationale).toBeDefined();
		expect(schema.properties.date).toBeDefined();
		expect(schema.properties.decision_status).toBeDefined();
		expect(schema.additionalProperties).toBe(false);
	});

	it("emits AJV schema with the child's type const, not the parent's", () => {
		const def = buildCustomTypeDefinition("adr", { extends: "decision" });
		const schema = def.ajvSchema as { properties: { type: { const: string } } };
		expect(schema.properties.type.const).toBe("adr");
	});
});

describe("extends end-to-end via registry", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-extends-e2e-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("validator accepts an inherited child record carrying parent + child requireds", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				custom_types: {
					adr: {
						extends: "decision",
						required: ["decision_status"],
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const ok = getRegistry().validator({
			type: "adr",
			title: "Adopt bun",
			rationale: "speed",
			decision_status: "accepted",
			classification: "foundational",
			recorded_at: "2026-05-06T00:00:00Z",
		});
		expect(ok).toBe(true);
	});

	it("validator rejects an inherited child record missing a parent required", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				custom_types: {
					adr: {
						extends: "decision",
						required: ["decision_status"],
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const ok = getRegistry().validator({
			type: "adr",
			// missing 'title' (parent required)
			rationale: "speed",
			decision_status: "accepted",
			classification: "foundational",
			recorded_at: "2026-05-06T00:00:00Z",
		});
		expect(ok).toBe(false);
	});

	it("validator rejects an inherited child record missing a child-added required", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				custom_types: {
					adr: {
						extends: "decision",
						required: ["decision_status"],
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const ok = getRegistry().validator({
			type: "adr",
			title: "Adopt bun",
			rationale: "speed",
			// missing 'decision_status' (child required)
			classification: "foundational",
			recorded_at: "2026-05-06T00:00:00Z",
		});
		expect(ok).toBe(false);
	});

	it("init rejects extends pointing at a disabled built-in", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				disabled_types: ["decision"],
				custom_types: {
					adr: { extends: "decision" },
				},
			},
			tmpDir,
		);
		await expect(initRegistryFromConfig(tmpDir)).rejects.toThrow(/disabled_types/);
	});

	it("aliases inherited via extends rewrite legacy field names on read", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { governance: {} },
				custom_types: {
					adr: {
						extends: "decision",
						aliases: { title: ["headline"] },
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);

		const def = getRegistry().get("adr");
		expect(def?.aliases).toBeDefined();
		expect(def?.aliases?.title).toEqual(["headline"]);
	});
});

const DECISION_BASELINE_CFG: CustomTypeConfig = {
	extends: "decision",
};

describe("extends — preserved invariants under explicit override", () => {
	it("child without summary inherits parent's compiled summary fn", () => {
		const def = buildCustomTypeDefinition("adr", DECISION_BASELINE_CFG);
		const result = def.summary({
			type: "adr",
			classification: "tactical",
			recorded_at: "2026-05-06T00:00:00Z",
			title: "x",
			rationale: "y",
		} as unknown as Parameters<typeof def.summary>[0]);
		expect(result).toBe("x"); // matches decisionDef.summary
	});

	it("child id_key falls back through cfg.dedup_key, then parent.idKey", () => {
		const childOverridesDedup = buildCustomTypeDefinition("adr", {
			extends: "decision",
			required: ["slug"],
			dedup_key: "slug",
		});
		expect(childOverridesDedup.dedupKey).toBe("slug");
		expect(childOverridesDedup.idKey).toBe("slug");

		const childKeepsParentDedup = buildCustomTypeDefinition("adr2", { extends: "decision" });
		expect(childKeepsParentDedup.dedupKey).toBe("title");
		expect(childKeepsParentDedup.idKey).toBe("title");
	});
});
