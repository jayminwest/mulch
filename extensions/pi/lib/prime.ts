// Session-start helper that spawns `ml prime` and returns the rendered
// markdown for the before_agent_start systemPrompt injection.
//
// Shells out (rather than calling commands/prime.ts in-process) so the
// extension picks up project-wide CLI behavior verbatim: auto-flip to
// manifest, per-domain rules, pre-prime hooks, --json fallbacks, and any
// future flag changes. `ml` is on PATH whenever this extension is loaded
// (the @os-eco/mulch-cli package ships both).

import type { ExecResult } from "@earendil-works/pi-coding-agent";

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

export interface RunMlPrimeOptions {
	exec: ExecFn;
	cwd: string;
	// Hard cap so a slow hook or wedged ml never stalls pi startup. The CLI
	// itself is sub-second on every project we measured; 15s is generous.
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runMlPrime(options: RunMlPrimeOptions): Promise<string | undefined> {
	const { exec, cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
	let result: ExecResult;
	try {
		result = await exec("ml", ["prime"], { cwd, timeout: timeoutMs });
	} catch {
		return undefined;
	}
	if (result.code !== 0) return undefined;
	const stdout = result.stdout.trim();
	return stdout.length > 0 ? stdout : undefined;
}

// Format the systemPrompt injection. Kept separate so before_agent_start
// callers (and tests) can compose without re-implementing the separator.
// Fenced with a stable banner so successive injects across turns are
// idempotent even when `event.systemPrompt` already carries a previous run's
// output (pi chains extension systemPrompt results).
export const PRIMED_BANNER_START = "<!-- mulch:prime:start -->";
export const PRIMED_BANNER_END = "<!-- mulch:prime:end -->";

export function composePrimedSystemPrompt(basePrompt: string, primed: string): string {
	const fenced = `${PRIMED_BANNER_START}\n${primed}\n${PRIMED_BANNER_END}`;
	const stripped = stripExistingPrimedFence(basePrompt);
	if (stripped.length === 0) return fenced;
	const separator = stripped.endsWith("\n") ? "\n" : "\n\n";
	return `${stripped}${separator}${fenced}`;
}

function stripExistingPrimedFence(prompt: string): string {
	const startIdx = prompt.indexOf(PRIMED_BANNER_START);
	if (startIdx === -1) return prompt;
	const endIdx = prompt.indexOf(PRIMED_BANNER_END, startIdx);
	if (endIdx === -1) return prompt;
	const tail = endIdx + PRIMED_BANNER_END.length;
	return (prompt.slice(0, startIdx) + prompt.slice(tail)).replace(/\n{3,}$/, "\n").trimEnd();
}
