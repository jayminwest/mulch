import {
	DEFAULT_HOOK_TIMEOUT_MS,
	HOOK_EVENTS,
	type HookEvent,
	type MulchConfig,
} from "../schemas/config.ts";
import { readConfig } from "./config.ts";

// Events whose hooks may mutate the payload via stdout JSON. Per the R-02
// spec, only `pre-record` and `pre-prime` carry mutable payloads — `pre-prune`
// is block-or-allow only (a hook can prevent the prune but not reshape the
// candidate set).
const MUTABLE_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>(["pre-record", "pre-prime"]);

const BLOCKING_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
	"pre-record",
	"pre-prime",
	"pre-prune",
]);

export interface HookExecution {
	command: string;
	exitCode: number;
	stderr: string;
	stdout: string;
	durationMs: number;
	timedOut: boolean;
}

export interface HookResult<T> {
	// Whether at least one hook script was executed.
	ranAny: boolean;
	// True iff a `pre-*` hook exited non-zero (or timed out). The caller MUST
	// abort the parent command when blocked is true.
	blocked: boolean;
	// Human-readable reason when blocked (script command + exit code/stderr).
	blockReason?: string;
	// Warnings collected from post-* failures or pre-* hooks whose stdout
	// could not be parsed as JSON. Callers should surface these to the user.
	warnings: string[];
	// Possibly-mutated payload. For non-mutable events or when no hook altered
	// stdout, this equals the input payload.
	payload: T;
	// Per-script execution diagnostics (in invocation order).
	executions: HookExecution[];
}

interface HookSettings {
	timeoutMs: number;
}

function resolveSettings(config: MulchConfig): HookSettings {
	const raw = config.hook_settings?.timeout_ms;
	const timeoutMs = typeof raw === "number" && raw > 0 ? raw : DEFAULT_HOOK_TIMEOUT_MS;
	return { timeoutMs };
}

function getHookList(config: MulchConfig, event: HookEvent): string[] {
	const list = config.hooks?.[event] ?? [];
	return Array.isArray(list)
		? list.filter((s) => typeof s === "string" && s.trim().length > 0)
		: [];
}

interface RunOneResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	timedOut: boolean;
}

async function runOne(
	command: string,
	stdinJson: string,
	cwd: string,
	timeoutMs: number,
): Promise<RunOneResult> {
	const start = Date.now();
	// `timeout: <ms>` instructs Bun to SIGTERM the subprocess (and its process
	// group) when the deadline elapses. `killSignal: "SIGKILL"` upgrades to
	// SIGKILL after a short grace, so a `sleep` invoked through `sh -c` doesn't
	// outlive the parent shell.
	const proc = Bun.spawn(["sh", "-c", command], {
		cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, MULCH_HOOK: "1" },
		timeout: timeoutMs,
		killSignal: "SIGKILL",
	});

	try {
		proc.stdin.write(stdinJson);
		await proc.stdin.end();
	} catch {
		// Script may have closed stdin early — not fatal.
	}

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	const timedOut = proc.signalCode === "SIGTERM" || proc.signalCode === "SIGKILL";

	return {
		exitCode: timedOut ? 124 : (exitCode ?? 0),
		stdout,
		stderr,
		durationMs: Date.now() - start,
		timedOut,
	};
}

/**
 * Run all hook scripts registered for `event` in declaration order. Each script
 * receives the current payload as JSON on stdin. For mutable events
 * (pre-record / pre-prime / pre-prune), a script may print modified JSON on
 * stdout; that JSON becomes the input to the next script and the final
 * `result.payload` returned to the caller.
 *
 * Semantics summary:
 *   - `pre-*` non-zero exit (or timeout) → blocks: subsequent scripts skipped,
 *     caller must abort. `result.blocked` is true with a reason string.
 *   - `post-*` non-zero exit → warning only, all scripts still run.
 *   - Empty / whitespace stdout from a mutable hook → payload unchanged.
 *   - Non-JSON stdout from a mutable hook → payload unchanged + warning.
 *   - Stderr from any script is forwarded to the user's stderr unless captured.
 */
export async function runHooks<T>(
	event: HookEvent,
	payload: T,
	opts: { cwd?: string; config?: MulchConfig; forwardStderr?: boolean } = {},
): Promise<HookResult<T>> {
	if (!HOOK_EVENTS.includes(event)) {
		throw new Error(`Unknown hook event: "${event}".`);
	}

	const cwd = opts.cwd ?? process.cwd();

	let config: MulchConfig;
	try {
		config = opts.config ?? (await readConfig(cwd));
	} catch {
		// No config available (e.g., before `ml init`). Treat as no hooks.
		return {
			ranAny: false,
			blocked: false,
			warnings: [],
			payload,
			executions: [],
		};
	}

	const scripts = getHookList(config, event);
	if (scripts.length === 0) {
		return {
			ranAny: false,
			blocked: false,
			warnings: [],
			payload,
			executions: [],
		};
	}

	const settings = resolveSettings(config);
	const isMutable = MUTABLE_EVENTS.has(event);
	const isBlocking = BLOCKING_EVENTS.has(event);
	const forwardStderr = opts.forwardStderr !== false;

	const warnings: string[] = [];
	const executions: HookExecution[] = [];
	let currentPayload: T = payload;

	for (const command of scripts) {
		const stdinJson = JSON.stringify({ event, payload: currentPayload });
		const res = await runOne(command, stdinJson, cwd, settings.timeoutMs);

		executions.push({
			command,
			exitCode: res.exitCode,
			stderr: res.stderr,
			stdout: res.stdout,
			durationMs: res.durationMs,
			timedOut: res.timedOut,
		});

		if (forwardStderr && res.stderr.length > 0) {
			process.stderr.write(res.stderr);
			if (!res.stderr.endsWith("\n")) process.stderr.write("\n");
		}

		if (res.exitCode !== 0) {
			const reason = res.timedOut
				? `hook \`${command}\` timed out after ${settings.timeoutMs}ms`
				: `hook \`${command}\` exited with code ${res.exitCode}`;
			if (isBlocking) {
				return {
					ranAny: true,
					blocked: true,
					blockReason: reason,
					warnings,
					payload: currentPayload,
					executions,
				};
			}
			warnings.push(reason);
			continue;
		}

		if (isMutable) {
			const trimmed = res.stdout.trim();
			if (trimmed.length === 0) continue;
			try {
				const parsed = JSON.parse(trimmed) as { payload?: T } | T;
				if (
					parsed !== null &&
					typeof parsed === "object" &&
					"payload" in (parsed as Record<string, unknown>)
				) {
					currentPayload = (parsed as { payload: T }).payload;
				} else {
					currentPayload = parsed as T;
				}
			} catch (err) {
				warnings.push(
					`hook \`${command}\` printed non-JSON on stdout (mutation ignored): ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}

	return {
		ranAny: true,
		blocked: false,
		warnings,
		payload: currentPayload,
		executions,
	};
}
