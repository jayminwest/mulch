// agent_end widget that surfaces the same `ml learn` nudges the CLI prints
// at session-close. Wraps `ml learn --json` and renders one widget line per
// suggested-domain so the LLM can pick a target without scanning the whole
// changed-files list.
//
// Type is intentionally a placeholder (`<type>`) — `ml learn` doesn't suggest
// types, and inferring one risks priming the LLM toward the wrong record
// shape. The widget exists to remind, not to decide.

import type { ExecResult } from "@earendil-works/pi-coding-agent";

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

export const LEARN_WIDGET_KEY = "mulch-learn-nudge";

const DEFAULT_LEARN_TIMEOUT_MS = 10_000;

export interface LearnDomainSuggestion {
	domain: string;
	matchCount: number;
	files: string[];
}

export interface LearnResult {
	changedFiles: string[];
	suggestedDomains: LearnDomainSuggestion[];
	unmatchedFiles: string[];
}

interface LearnCliOutput {
	success?: boolean;
	changedFiles?: unknown;
	suggestedDomains?: unknown;
	unmatchedFiles?: unknown;
	error?: string;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item === "string" && item.length > 0) out.push(item);
	}
	return out;
}

function asSuggestionArray(value: unknown): LearnDomainSuggestion[] {
	if (!Array.isArray(value)) return [];
	const out: LearnDomainSuggestion[] = [];
	for (const item of value) {
		if (item === null || typeof item !== "object") continue;
		const r = item as Record<string, unknown>;
		const domain = typeof r.domain === "string" ? r.domain : undefined;
		const matchCount = typeof r.matchCount === "number" ? r.matchCount : 0;
		if (!domain) continue;
		out.push({ domain, matchCount, files: asStringArray(r.files) });
	}
	return out;
}

export function parseLearnOutput(stdout: string): LearnResult | undefined {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) return undefined;
	let parsed: LearnCliOutput;
	try {
		parsed = JSON.parse(trimmed) as LearnCliOutput;
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	if (parsed.success === false) return undefined;
	return {
		changedFiles: asStringArray(parsed.changedFiles),
		suggestedDomains: asSuggestionArray(parsed.suggestedDomains),
		unmatchedFiles: asStringArray(parsed.unmatchedFiles),
	};
}

export interface RunMlLearnOptions {
	exec: ExecFn;
	cwd: string;
	timeoutMs?: number;
}

export async function runMlLearn(options: RunMlLearnOptions): Promise<LearnResult | undefined> {
	const { exec, cwd, timeoutMs = DEFAULT_LEARN_TIMEOUT_MS } = options;
	let result: ExecResult;
	try {
		result = await exec("ml", ["learn", "--json"], { cwd, timeout: timeoutMs });
	} catch {
		return undefined;
	}
	if (result.code !== 0) return undefined;
	return parseLearnOutput(result.stdout);
}

// Compose the widget body. Returns undefined when there's nothing worth
// surfacing — the caller treats that as "clear the widget".
export function composeLearnWidgetLines(result: LearnResult | undefined): string[] | undefined {
	if (!result) return undefined;
	const { suggestedDomains, changedFiles } = result;
	if (suggestedDomains.length === 0) return undefined;
	const fileWord = changedFiles.length === 1 ? "file" : "files";
	const lines: string[] = [
		`mulch: ${changedFiles.length} changed ${fileWord} — record an insight?`,
	];
	for (const s of suggestedDomains) {
		const matchWord = s.matchCount === 1 ? "match" : "matches";
		lines.push(`  Record: ${s.domain}/<type>?  (${s.matchCount} ${matchWord})`);
	}
	lines.push("  Run `ml learn` for the full list, then `ml record <domain> --type <type> ...`.");
	return lines;
}
