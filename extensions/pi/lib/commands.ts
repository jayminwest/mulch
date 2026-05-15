// Slash commands registered when `pi.commands` is enabled.
//
// /ml:prime [domain] — re-runs `ml prime` (full or single-domain) and pushes
//   the rendered markdown into the conversation as a `mulch-prime-command`
//   steer message. Same banner shape as session_start scope-load so the LLM
//   treats both surfaces as one channel.
//
// Argument autocomplete enumerates the project's declared domains via the
// in-process config reader. Reads on every keystroke so newly-added domains
// surface without `/reload`.

import type { ExecResult } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { readConfig } from "../../../src/utils/config.ts";

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

export type SendMessageFn = (
	message: { customType: string; content: string; display: boolean; details?: unknown },
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

export const PRIME_COMMAND_CUSTOM_TYPE = "mulch-prime-command";

const DEFAULT_PRIME_COMMAND_TIMEOUT_MS = 15_000;

export const PRIME_COMMAND_BANNER_START = "<!-- mulch:prime-command:start -->";
export const PRIME_COMMAND_BANNER_END = "<!-- mulch:prime-command:end -->";

export interface PrimeCommandDeps {
	exec: ExecFn;
	cwd: string;
	sendMessage: SendMessageFn;
	notify?: (message: string, type?: "info" | "warning" | "error") => void;
	timeoutMs?: number;
}

export interface PrimeCommandResult {
	ok: boolean;
	scope: string;
	exitCode: number;
	error?: string;
}

export async function listConfiguredDomains(cwd: string): Promise<string[]> {
	try {
		const cfg = await readConfig(cwd);
		return Object.keys(cfg.domains ?? {}).sort();
	} catch {
		return [];
	}
}

export function composePrimeCommandMessage(scope: string, primedBody: string): string {
	return [
		PRIME_COMMAND_BANNER_START,
		`Re-primed via /ml:prime ${scope}:`,
		"",
		primedBody,
		PRIME_COMMAND_BANNER_END,
	].join("\n");
}

// Single-token domain argument. Pi splits user input on whitespace, but the
// handler receives the raw arg string so we trim and reject anything with an
// embedded space rather than silently shelling out a malformed `ml prime`.
export function parsePrimeArgs(args: string): { domain?: string; error?: string } {
	const trimmed = args.trim();
	if (trimmed.length === 0) return {};
	if (/\s/.test(trimmed)) {
		return { error: "Usage: /ml:prime [domain] — pass at most one domain name." };
	}
	return { domain: trimmed };
}

export async function runPrimeCommand(
	deps: PrimeCommandDeps,
	domain: string | undefined,
): Promise<PrimeCommandResult> {
	const scope = domain && domain.length > 0 ? domain : "(all)";
	const args = domain ? ["prime", domain] : ["prime"];
	let result: ExecResult;
	try {
		result = await deps.exec("ml", args, {
			cwd: deps.cwd,
			timeout: deps.timeoutMs ?? DEFAULT_PRIME_COMMAND_TIMEOUT_MS,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		deps.notify?.(`ml prime: exec failed — ${msg}`, "error");
		return { ok: false, scope, exitCode: -1, error: msg };
	}
	if (result.code !== 0) {
		const tail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
		deps.notify?.(`ml prime ${scope} failed: ${tail}`, "error");
		return { ok: false, scope, exitCode: result.code, error: tail };
	}
	const stdout = result.stdout.trim();
	if (stdout.length === 0) {
		deps.notify?.(`ml prime ${scope}: no records primed`, "info");
		return { ok: true, scope, exitCode: 0 };
	}
	deps.sendMessage(
		{
			customType: PRIME_COMMAND_CUSTOM_TYPE,
			content: composePrimeCommandMessage(scope, stdout),
			display: false,
			details: { scope },
		},
		{ deliverAs: "steer" },
	);
	deps.notify?.(`ml prime ${scope}: re-injected`, "info");
	return { ok: true, scope, exitCode: 0 };
}

export interface PrimeCommandRegistration {
	name: string;
	options: {
		description: string;
		getArgumentCompletions: (
			argumentPrefix: string,
		) => Promise<AutocompleteItem[] | null> | AutocompleteItem[] | null;
		handler: (args: string) => Promise<void>;
	};
}

// Deps are resolved per-invocation via a getter so the registration
// (created once at extension load) can pick up the current session cwd /
// sendMessage on every keystroke and handler call. Returns undefined when
// the extension is between sessions or has not initialized — the command
// becomes a no-op rather than throwing.
export function buildPrimeCommandRegistration(
	getDeps: () => PrimeCommandDeps | undefined,
): PrimeCommandRegistration {
	return {
		name: "ml:prime",
		options: {
			description: "Re-prime mulch context (optionally scoped to one domain).",
			async getArgumentCompletions(argumentPrefix) {
				const deps = getDeps();
				if (!deps) return [];
				const domains = await listConfiguredDomains(deps.cwd);
				const prefix = argumentPrefix.trim().toLowerCase();
				const matches =
					prefix.length === 0 ? domains : domains.filter((d) => d.toLowerCase().startsWith(prefix));
				return matches.map((value) => ({
					value,
					label: value,
					description: `Re-prime the ${value} domain`,
				}));
			},
			async handler(args) {
				const deps = getDeps();
				if (!deps) return;
				const parsed = parsePrimeArgs(args);
				if (parsed.error) {
					deps.notify?.(parsed.error, "warning");
					return;
				}
				await runPrimeCommand(deps, parsed.domain);
			},
		},
	};
}
