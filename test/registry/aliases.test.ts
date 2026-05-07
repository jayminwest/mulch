import { describe, expect, it } from "bun:test";
import { buildCustomTypeDefinition, validateCustomTypeConfig } from "../../src/registry/custom.ts";
import { applyAliases } from "../../src/utils/expertise.ts";

describe("validateCustomTypeConfig — aliases", () => {
	it("accepts canonical-to-legacy mapping where canonical is declared", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement"],
				optional: ["prediction"],
				dedup_key: "statement",
				summary: "{statement}",
				aliases: { statement: ["claim"] },
			}),
		).not.toThrow();
	});

	it("rejects alias key that isn't in required/optional", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement"],
				dedup_key: "statement",
				summary: "{statement}",
				aliases: { mystery: ["claim"] },
			}),
		).toThrow(/aliases key "mystery" must be declared in required\/optional/);
	});

	it("rejects empty alias arrays", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement"],
				dedup_key: "statement",
				summary: "{statement}",
				aliases: { statement: [] },
			}),
		).toThrow(/non-empty array/);
	});

	it("rejects an alias name that collides with a base record field", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement"],
				dedup_key: "statement",
				summary: "{statement}",
				aliases: { statement: ["evidence"] },
			}),
		).toThrow(/collides with a base field/);
	});

	it("rejects an alias name that's also a current declared field", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement", "prediction"],
				dedup_key: "statement",
				summary: "{statement}",
				aliases: { statement: ["prediction"] },
			}),
		).toThrow(/already declared as a current field/);
	});

	it("rejects the same legacy name appearing under multiple canonical keys", () => {
		expect(() =>
			validateCustomTypeConfig("hypothesis", {
				required: ["statement", "prediction"],
				dedup_key: "statement",
				summary: "{statement}",
				aliases: { statement: ["claim"], prediction: ["claim"] },
			}),
		).toThrow(/appears under multiple canonical fields/);
	});

	it("threads aliases onto the resulting TypeDefinition", () => {
		const def = buildCustomTypeDefinition("hypothesis", {
			required: ["statement"],
			dedup_key: "statement",
			summary: "{statement}",
			aliases: { statement: ["claim", "assertion"] },
		});
		expect(def.aliases).toEqual({ statement: ["claim", "assertion"] });
	});

	it("omits aliases on the TypeDefinition when not configured", () => {
		const def = buildCustomTypeDefinition("hypothesis", {
			required: ["statement"],
			dedup_key: "statement",
			summary: "{statement}",
		});
		expect(def.aliases).toBeUndefined();
	});
});

describe("applyAliases", () => {
	const aliases = { statement: ["claim", "assertion"] };

	it("rewrites a legacy field to the canonical name", () => {
		const raw = { type: "hypothesis", claim: "the sky is blue" } as Record<string, unknown>;
		applyAliases(raw, aliases);
		expect(raw.statement).toBe("the sky is blue");
		expect(raw.claim).toBeUndefined();
	});

	it("supports multiple legacy names mapping to one canonical", () => {
		const raw = { type: "hypothesis", assertion: "x" } as Record<string, unknown>;
		applyAliases(raw, aliases);
		expect(raw.statement).toBe("x");
		expect(raw.assertion).toBeUndefined();
	});

	it("when both canonical and legacy are present, canonical wins and legacy is dropped", () => {
		const raw = {
			type: "hypothesis",
			statement: "kept",
			claim: "discarded",
		} as Record<string, unknown>;
		applyAliases(raw, aliases);
		expect(raw.statement).toBe("kept");
		expect(raw.claim).toBeUndefined();
	});

	it("is a no-op when aliases is undefined", () => {
		const raw = { type: "hypothesis", claim: "x" } as Record<string, unknown>;
		applyAliases(raw, undefined);
		expect(raw.claim).toBe("x");
		expect(raw.statement).toBeUndefined();
	});

	it("is idempotent (running twice yields the same record)", () => {
		const raw = { type: "hypothesis", claim: "x" } as Record<string, unknown>;
		applyAliases(raw, aliases);
		applyAliases(raw, aliases);
		expect(raw.statement).toBe("x");
		expect(raw.claim).toBeUndefined();
	});

	it("treats empty-string canonical as missing (legacy fills it in)", () => {
		const raw = { type: "hypothesis", statement: "", claim: "filled" } as Record<string, unknown>;
		applyAliases(raw, aliases);
		expect(raw.statement).toBe("filled");
		expect(raw.claim).toBeUndefined();
	});
});
