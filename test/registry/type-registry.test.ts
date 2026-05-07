import { afterEach, describe, expect, it } from "bun:test";
import { BUILTIN_DEFS, buildBuiltinRegistry } from "../../src/registry/builtins.ts";
import { compileSummaryTemplate } from "../../src/registry/template.ts";
import {
	getRegistry,
	resetRegistry,
	setRegistry,
	TypeRegistry,
} from "../../src/registry/type-registry.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";

const SIX = ["convention", "pattern", "failure", "decision", "reference", "guide"] as const;

describe("TypeRegistry", () => {
	afterEach(() => {
		resetRegistry();
	});

	it("get(name) returns the matching definition for each built-in", () => {
		const reg = buildBuiltinRegistry();
		for (const name of SIX) {
			const def = reg.get(name);
			expect(def).toBeDefined();
			expect(def?.name).toBe(name);
			expect(def?.kind).toBe("builtin");
		}
	});

	it("get(name) returns undefined for unknown types", () => {
		const reg = buildBuiltinRegistry();
		expect(reg.get("hypothesis")).toBeUndefined();
	});

	it("enabled() returns all six built-ins in section-render order", () => {
		const reg = buildBuiltinRegistry();
		const names = reg.enabled().map((d) => d.name);
		expect(names).toEqual([...SIX]);
	});

	it("names() returns the enabled set as an array of strings", () => {
		const reg = buildBuiltinRegistry();
		expect(reg.names()).toEqual([...SIX]);
	});

	it("each built-in declares its required fields, dedup key, and id key", () => {
		const reg = buildBuiltinRegistry();
		expect(reg.get("convention")).toMatchObject({
			required: ["content"],
			dedupKey: "content",
			idKey: "content",
			compact: "concat",
			extractsFiles: false,
		});
		expect(reg.get("pattern")).toMatchObject({
			required: ["name", "description"],
			dedupKey: "name",
			idKey: "name",
			extractsFiles: true,
			filesField: "files",
		});
		expect(reg.get("failure")).toMatchObject({
			required: ["description", "resolution"],
			dedupKey: "description",
			idKey: "description",
		});
		expect(reg.get("decision")).toMatchObject({
			required: ["title", "rationale"],
			dedupKey: "title",
			idKey: "title",
		});
		expect(reg.get("reference")).toMatchObject({
			required: ["name", "description"],
			extractsFiles: true,
		});
		expect(reg.get("guide")).toMatchObject({
			required: ["name", "description"],
			extractsFiles: false,
		});
	});

	it("the names() result is a fresh array (callers cannot mutate internal order)", () => {
		const reg = buildBuiltinRegistry();
		const a = reg.names();
		a.push("hypothesis");
		expect(reg.names()).toEqual([...SIX]);
	});

	it("validator accepts a well-formed record of every built-in type", () => {
		const reg = buildBuiltinRegistry();
		const samples: ExpertiseRecord[] = [
			{
				type: "convention",
				content: "x",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			},
			{
				type: "pattern",
				name: "p",
				description: "d",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			},
			{
				type: "failure",
				description: "d",
				resolution: "r",
				classification: "tactical",
				recorded_at: "2026-01-01T00:00:00Z",
			},
			{
				type: "decision",
				title: "t",
				rationale: "r",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			},
			{
				type: "reference",
				name: "n",
				description: "d",
				classification: "observational",
				recorded_at: "2026-01-01T00:00:00Z",
			},
			{
				type: "guide",
				name: "n",
				description: "d",
				classification: "tactical",
				recorded_at: "2026-01-01T00:00:00Z",
			},
		];
		for (const r of samples) {
			expect(reg.validator(r)).toBe(true);
		}
	});

	it("validator rejects records missing required fields", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "pattern",
				name: "p",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe(false);
	});

	it("validator rejects unknown types (unknown-type policy at write side)", () => {
		const reg = buildBuiltinRegistry();
		expect(
			reg.validator({
				type: "hypothesis",
				name: "h",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe(false);
	});

	it("BUILTIN_DEFS preserves the same six in declared order", () => {
		expect(BUILTIN_DEFS.map((d) => d.name)).toEqual([...SIX]);
	});
});

describe("registry singleton", () => {
	afterEach(() => {
		resetRegistry();
	});

	it("getRegistry() lazy-falls-back to a built-in registry when unset", () => {
		resetRegistry();
		const reg = getRegistry();
		expect(reg.names()).toEqual([...SIX]);
	});

	it("setRegistry() replaces the singleton (Phase 2 hook)", () => {
		const a = buildBuiltinRegistry();
		const b = buildBuiltinRegistry();
		setRegistry(a);
		expect(getRegistry()).toBe(a);
		setRegistry(b);
		expect(getRegistry()).toBe(b);
	});

	it("resetRegistry() clears the singleton so tests can isolate state", () => {
		const a = buildBuiltinRegistry();
		setRegistry(a);
		resetRegistry();
		// Lazy fallback returns a fresh registry, not `a`.
		const next = getRegistry();
		expect(next).not.toBe(a);
		expect(next.names()).toEqual([...SIX]);
	});

	it("TypeRegistry is constructable directly with a custom def list (Phase 2 path)", () => {
		const def = BUILTIN_DEFS[0];
		if (!def) throw new Error("missing builtin");
		const reg = new TypeRegistry([def], {
			classification: { type: "string", enum: ["foundational"] },
			evidence: { type: "object", additionalProperties: false, properties: {} },
			outcome: {
				type: "object",
				required: ["status"],
				additionalProperties: false,
				properties: { status: { type: "string", enum: ["success"] } },
			},
		});
		expect(reg.names()).toEqual([def.name]);
	});
});

describe("compileSummaryTemplate", () => {
	it("interpolates {field} tokens against record properties", () => {
		const fn = compileSummaryTemplate("{name} -> {description}");
		expect(
			fn({
				type: "pattern",
				name: "atomic-writes",
				description: "temp + rename",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe("atomic-writes -> temp + rename");
	});

	it("returns the literal template when no tokens are present", () => {
		const fn = compileSummaryTemplate("hello world");
		expect(
			fn({
				type: "convention",
				content: "x",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe("hello world");
	});

	it("renders missing fields as the empty string (no `undefined` leaking)", () => {
		const fn = compileSummaryTemplate("{statement}");
		expect(
			fn({
				type: "convention",
				content: "x",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe("");
	});

	it("interpolates `{{field}}` mustache-style tokens identically to `{field}`", () => {
		const fn = compileSummaryTemplate("{{name}} -> {{description}}");
		expect(
			fn({
				type: "pattern",
				name: "atomic-writes",
				description: "temp + rename",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
			}),
		).toBe("atomic-writes -> temp + rename");
	});

	it("accepts mixed `{field}` and `{{field}}` in the same template", () => {
		const fn = compileSummaryTemplate("{{decision_status}}: {title}");
		expect(
			fn({
				type: "decision",
				title: "use WAL",
				rationale: "concurrent reads",
				classification: "foundational",
				recorded_at: "2026-01-01T00:00:00Z",
				// extra field exercises the mustache branch
				decision_status: "accepted",
			} as unknown as Parameters<typeof fn>[0]),
		).toBe("accepted: use WAL");
	});
});
