import { describe, expect, it } from "bun:test";
import {
	buildCustomTypeDefinition,
	buildCustomTypeDefinitions,
	validateCustomTypeConfig,
} from "../../src/registry/custom.ts";

describe("validateCustomTypeConfig", () => {
	it("accepts a well-formed custom type", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement", "prediction"],
				optional: ["evidence_source"],
				dedup_key: "statement",
				summary: "{statement} -> {prediction}",
			}),
		).not.toThrow();
	});

	it("rejects names that shadow a built-in type", () => {
		expect(() =>
			validateCustomTypeConfig("pattern", {
				required: ["x"],
				dedup_key: "x",
				summary: "{x}",
			}),
		).toThrow(/shadows a built-in/);
	});

	it("rejects names that don't match the regex", () => {
		expect(() =>
			validateCustomTypeConfig("Hypothesis", {
				required: ["x"],
				dedup_key: "x",
				summary: "{x}",
			}),
		).toThrow(/must match/);
	});

	it("rejects required fields colliding with base record fields", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement", "evidence"],
				dedup_key: "statement",
				summary: "{statement}",
			}),
		).toThrow(/cannot declare base field "evidence"/);
	});

	it("rejects optional fields colliding with base record fields", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement"],
				optional: ["tags"],
				dedup_key: "statement",
				summary: "{statement}",
			}),
		).toThrow(/cannot declare base field "tags"/);
	});

	it("rejects dedup_key not in required/optional or content_hash", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement"],
				dedup_key: "missing_field",
				summary: "{statement}",
			}),
		).toThrow(/dedup_key "missing_field"/);
	});

	it("accepts dedup_key=content_hash without requiring it as a field", () => {
		expect(() =>
			validateCustomTypeConfig("note", {
				required: ["body"],
				dedup_key: "content_hash",
				summary: "{body}",
			}),
		).not.toThrow();
	});

	it("rejects empty required array", () => {
		expect(() =>
			validateCustomTypeConfig("note", {
				required: [],
				dedup_key: "content_hash",
				summary: "x",
			}),
		).toThrow(/non-empty/);
	});

	it("rejects unknown compact strategies", () => {
		expect(() =>
			validateCustomTypeConfig("note", {
				required: ["body"],
				dedup_key: "body",
				summary: "{body}",
				compact: "invalid" as unknown as "concat",
			}),
		).toThrow(/invalid/);
	});

	it("rejects summary templates referencing undeclared fields", () => {
		expect(() =>
			validateCustomTypeConfig("note", {
				required: ["body"],
				dedup_key: "body",
				summary: "{body}: {missing}",
			}),
		).toThrow(/summary references unknown field "{missing}"/);
	});

	it("accepts summary templates referencing inherited (extends) fields", () => {
		// `extends: convention` brings `content` from the parent — referencing it
		// in the child's summary must validate.
		expect(() =>
			validateCustomTypeConfig("note", {
				extends: "convention",
				required: ["body"],
				summary: "{content} / {body}",
			}),
		).not.toThrow();
	});

	it("accepts summary templates referencing base record fields like {id}", () => {
		expect(() =>
			validateCustomTypeConfig("note", {
				required: ["body"],
				dedup_key: "body",
				summary: "[{id}] {body}",
			}),
		).not.toThrow();
	});

	it("validates {{field}} mustache-style tokens the same as {field}", () => {
		expect(() =>
			validateCustomTypeConfig("note", {
				required: ["body"],
				dedup_key: "body",
				summary: "{{nope}}: {{body}}",
			}),
		).toThrow(/summary references unknown field "{nope}"/);
	});
});

describe("buildCustomTypeDefinition", () => {
	const cfg = {
		required: ["statement", "prediction"],
		optional: ["evidence_source"],
		dedup_key: "statement",
		summary: "{statement} -> {prediction}",
		compact: "merge_outcomes" as const,
		section_title: "Hypotheses",
	};

	it("produces a TypeDefinition with kind: custom", () => {
		const def = buildCustomTypeDefinition("hypothesis", cfg);
		expect(def.name).toBe("hypothesis");
		expect(def.kind).toBe("custom");
		expect(def.required).toEqual(["statement", "prediction"]);
		expect(def.optional).toEqual(["evidence_source"]);
		expect(def.dedupKey).toBe("statement");
		expect(def.idKey).toBe("statement"); // defaults to dedupKey
		expect(def.compact).toBe("merge_outcomes");
		expect(def.sectionTitle).toBe("Hypotheses");
	});

	it("compiles the summary template", () => {
		const def = buildCustomTypeDefinition("hypothesis", cfg);
		const summary = def.summary({
			type: "hypothesis",
			classification: "tactical",
			recorded_at: "2026-01-01T00:00:00Z",
			statement: "rain forecast",
			prediction: "tomorrow",
		} as unknown as Parameters<typeof def.summary>[0]);
		expect(summary).toBe("rain forecast -> tomorrow");
	});

	it("emits an AJV schema with required fields and additionalProperties: false", () => {
		const def = buildCustomTypeDefinition("hypothesis", cfg);
		const schema = def.ajvSchema as {
			type: string;
			required: string[];
			additionalProperties: boolean;
			properties: Record<string, unknown>;
		};
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("type");
		expect(schema.required).toContain("statement");
		expect(schema.required).toContain("prediction");
		expect(schema.required).toContain("classification");
		expect(schema.required).toContain("recorded_at");
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties.statement).toBeDefined();
		expect(schema.properties.prediction).toBeDefined();
		expect(schema.properties.evidence_source).toBeDefined();
	});

	it("buildCustomTypeDefinitions returns one def per entry", () => {
		const defs = buildCustomTypeDefinitions({
			hypothesis: cfg,
			runbook: {
				required: ["title", "steps"],
				dedup_key: "title",
				summary: "{title}",
			},
		});
		expect(defs).toHaveLength(2);
		expect(defs.map((d) => d.name)).toEqual(["hypothesis", "runbook"]);
	});

	it("returns empty array when custom_types is undefined", () => {
		expect(buildCustomTypeDefinitions(undefined)).toEqual([]);
	});
});
