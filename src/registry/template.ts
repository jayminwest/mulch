import type { ExpertiseRecord } from "../schemas/record.ts";

// Interpolation only — no conditionals, fallbacks, or transforms in v1 (per
// epic mulch-632e locked design). Both `{field}` and `{{field}}` are accepted
// because Mustache-style is muscle memory; the double-brace branch is matched
// first so it's preferred over the single-brace fallback.
const TOKEN_RE = /\{\{([a-z_][a-z0-9_]*)\}\}|\{([a-z_][a-z0-9_]*)\}/gi;

export function extractTemplateTokens(template: string): string[] {
	const tokens: string[] = [];
	for (const match of template.matchAll(TOKEN_RE)) {
		const token = match[1] ?? match[2];
		if (token) tokens.push(token);
	}
	return tokens;
}

export function compileSummaryTemplate(template: string): (record: ExpertiseRecord) => string {
	const tokens: string[] = [];
	const literals: string[] = [];
	let lastIndex = 0;
	for (const match of template.matchAll(TOKEN_RE)) {
		const start = match.index ?? 0;
		literals.push(template.slice(lastIndex, start));
		tokens.push(match[1] ?? match[2] ?? "");
		lastIndex = start + match[0].length;
	}
	literals.push(template.slice(lastIndex));

	return (record: ExpertiseRecord): string => {
		let out = literals[0] ?? "";
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i] ?? "";
			const value = (record as unknown as Record<string, unknown>)[token];
			out += value == null ? "" : String(value);
			out += literals[i + 1] ?? "";
		}
		return out;
	};
}
