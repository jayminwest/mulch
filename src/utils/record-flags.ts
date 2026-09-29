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

function unset(v: unknown): boolean {
	return v === undefined || v === "";
}

/** kebab-case name from the first few words of `text` (pattern/reference/guide). */
export function deriveName(text: string): string {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean);
	return words.slice(0, 6).join("-").slice(0, 60).replace(/-+$/, "") || "record";
}

/** First sentence of `text`, capped at 80 chars (decision titles). */
export function deriveTitle(text: string): string {
	const first = (text.trim().split(/(?<=[.!?])\s/)[0] ?? "").trim();
	return first.length > 80 ? `${first.slice(0, 77).trimEnd()}...` : first;
}

/**
 * `ml record` accepts `--description` (or positional [content]) as the primary
 * text for every built-in type (mulch-7164). Type-specific required-flag errors
 * pushed agents to hand-edit the JSONL, so missing fields are filled instead:
 *   convention                  content  <- description
 *   pattern / reference / guide name     <- derived from description
 *   decision                    title    <- first sentence; rationale <- description
 * Explicit flags always win. failure still needs --resolution (not derivable).
 */
export function applyDescriptionDefaults(
	def: { name: string; kind: string },
	content: string | undefined,
	options: Record<string, unknown>,
): Record<string, unknown> {
	if (def.kind !== "builtin") return options;
	const text = [options.description, content].find(
		(v): v is string => typeof v === "string" && v.trim() !== "",
	);
	if (text === undefined) return options;
	const out = { ...options };
	const fill = (key: string, value: string): void => {
		if (unset(out[key])) out[key] = value;
	};
	if (def.name === "convention" && content === undefined) fill("content", text);
	if (def.name === "pattern" || def.name === "reference" || def.name === "guide") {
		fill("name", deriveName(text));
	}
	if (def.name === "decision") {
		fill("title", deriveTitle(text));
		fill("rationale", text);
	}
	return out;
}
