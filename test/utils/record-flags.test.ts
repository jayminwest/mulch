import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { BUILTIN_DEFS, SHARED_DEFINITIONS } from "../../src/registry/builtins.ts";
import { buildCustomTypeDefinitions } from "../../src/registry/custom.ts";
import { buildBuiltinRegistry, TypeRegistry } from "../../src/registry/type-registry.ts";
import { addCustomTypeFieldOptions, parseOutcomeFlags } from "../../src/utils/record-flags.ts";

function registryWithCustomType(): TypeRegistry {
	const custom = buildCustomTypeDefinitions({
		release_decision: {
			extends: "decision",
			required: ["title", "rationale", "version"],
			optional: ["ship_date"],
		},
	});
	return new TypeRegistry([...BUILTIN_DEFS, ...custom], SHARED_DEFINITIONS);
}

function optionNames(cmd: Command): string[] {
	return cmd.options.map((o) => o.name());
}

describe("addCustomTypeFieldOptions", () => {
	it("adds a flag per custom field not already declared, using the describe callback", () => {
		const cmd = new Command("record").option("--title <title>", "built-in title flag");
		addCustomTypeFieldOptions(cmd, registryWithCustomType(), (type, field) => `${type}:${field}`);

		const names = optionNames(cmd);
		expect(names).toContain("version");
		expect(names).toContain("ship-date"); // underscores become dashes
		expect(names.filter((n) => n === "title")).toHaveLength(1); // not re-declared
		expect(names).toContain("rationale"); // inherited from decision and not declared by the command

		const shipDate = cmd.options.find((o) => o.name() === "ship-date");
		expect(shipDate?.description).toBe("release_decision:ship_date");
		expect(shipDate?.flags).toBe("--ship-date <ship_date>");
	});

	it("declares inherited fields when the command did not declare them itself", () => {
		const cmd = new Command("edit");
		addCustomTypeFieldOptions(cmd, registryWithCustomType(), (_type, field) => field);
		expect(optionNames(cmd).sort()).toEqual(["date", "rationale", "ship-date", "title", "version"]);
	});

	it("never declares --files and adds nothing for a built-ins-only registry", () => {
		const cmd = new Command("record");
		addCustomTypeFieldOptions(cmd, buildBuiltinRegistry(), (_type, field) => field);
		expect(optionNames(cmd)).toEqual([]);
	});
});

describe("parseOutcomeFlags", () => {
	it("returns an empty result when --outcome-status is absent", () => {
		expect(parseOutcomeFlags({})).toEqual({});
		expect(parseOutcomeFlags({ outcomeDuration: "5" })).toEqual({});
	});

	it("builds an outcome from the shared flags", () => {
		expect(
			parseOutcomeFlags({
				outcomeStatus: "success",
				outcomeDuration: "120",
				outcomeTestResults: "3 pass",
				outcomeAgent: "bot",
			}),
		).toEqual({
			outcome: { status: "success", duration: 120, test_results: "3 pass", agent: "bot" },
		});
	});

	it("omits optional fields that were not passed", () => {
		expect(parseOutcomeFlags({ outcomeStatus: "partial" })).toEqual({
			outcome: { status: "partial" },
		});
	});

	it("reports a non-numeric or negative duration instead of an outcome", () => {
		expect(parseOutcomeFlags({ outcomeStatus: "failure", outcomeDuration: "nope" })).toEqual({
			error: '--outcome-duration must be a non-negative number (got "nope").',
		});
		expect(parseOutcomeFlags({ outcomeStatus: "failure", outcomeDuration: "-1" })).toEqual({
			error: '--outcome-duration must be a non-negative number (got "-1").',
		});
	});
});
