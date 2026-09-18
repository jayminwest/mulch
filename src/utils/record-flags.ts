import type { Command } from "commander";
import type { TypeRegistry } from "../registry/type-registry.ts";
import type { Outcome } from "../schemas/record.ts";
import { parseStrictNonNegativeNumber } from "./numeric-flags.ts";

/**
 * Register a `--<field>` flag for every custom-type field that the command's
 * built-in flag set does not already declare, so custom_types feel first-class
 * on the CLI. `describe` renders the help text for one field.
 */
export function addCustomTypeFieldOptions(
	cmd: Command,
	registry: TypeRegistry,
	describe: (typeName: string, field: string) => string,
): void {
	const declaredOptionNames = new Set(cmd.options.map((o) => o.name()).concat(["files"]));
	for (const def of registry.enabled()) {
		if (def.kind === "builtin") continue;
		for (const field of [...def.required, ...def.optional]) {
			const flagName = field.replace(/_/g, "-");
			if (declaredOptionNames.has(flagName)) continue;
			declaredOptionNames.add(flagName);
			cmd.option(`--${flagName} <${field}>`, describe(def.name, field));
		}
	}
}

/**
 * Build an outcome from the shared `--outcome-*` flags. Returns `undefined`
 * when no `--outcome-status` was given and an `error` message for invalid input.
 */
export function parseOutcomeFlags(options: Record<string, unknown>): {
	outcome?: Outcome;
	error?: string;
} {
	if (!options.outcomeStatus) return {};
	const outcome: Outcome = {
		status: options.outcomeStatus as "success" | "failure" | "partial",
	};
	if (options.outcomeDuration !== undefined) {
		const parsed = parseStrictNonNegativeNumber(options.outcomeDuration as string);
		if (parsed === null) {
			return {
				error: `--outcome-duration must be a non-negative number (got "${options.outcomeDuration as string}").`,
			};
		}
		outcome.duration = parsed;
	}
	if (options.outcomeTestResults) {
		outcome.test_results = options.outcomeTestResults as string;
	}
	if (options.outcomeAgent) {
		outcome.agent = options.outcomeAgent as string;
	}
	return { outcome };
}
