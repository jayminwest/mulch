// Per-file scope-loading on tool_call events. The LLM reads/edits a file,
// pi fires `tool_call`, and this module debounces those events to one
// `ml prime --files <path>` invocation per file. The rendered markdown is
// surfaced via `pi.sendMessage` as a `mulch-scope-load` steer message — the
// LLM sees the records inline with its next response, without consuming
// systemPrompt budget on every turn.
//
// Persistence: each successful scope-load also appends a session entry of
// type `mulch-scope-load` (`pi.appendEntry`). On `session_start` (including
// /reload) the extension walks `sessionManager.getEntries()`, filters by that
// customType, and pre-populates the primedPaths set. Same-file edits after
// /reload then skip the re-prime.

import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ExecResult } from "@earendil-works/pi-coding-agent";

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

export type SendMessageFn = (
	message: { customType: string; content: string; display: boolean; details?: unknown },
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

export type AppendEntryFn = (customType: string, data?: unknown) => void;

export const SCOPE_LOAD_CUSTOM_TYPE = "mulch-scope-load";

// 15s matches runMlPrime's session_start cap. Scope-load runs are typically
// smaller than a full prime, but a wedged pre-prime hook could hang either.
const DEFAULT_SCOPE_TIMEOUT_MS = 15_000;

export interface ScopeLoaderOptions {
	exec: ExecFn;
	cwd: string;
	budget: number;
	debounceMs: number;
	sendMessage: SendMessageFn;
	appendEntry: AppendEntryFn;
	// Optional: override the default 15s exec timeout per call.
	timeoutMs?: number;
	// Optional logger; defaults to a noop so the extension stays quiet on the
	// happy path. The session_start logger doesn't surface in pi's TUI either,
	// so failures here are intentionally silent.
	onError?: (err: unknown, path: string) => void;
	// Optional clock injection for tests (setTimeout/clearTimeout-shaped).
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export interface ScopeLoader {
	// Schedule a scope-load for the given path. Idempotent: paths already in
	// `primedPaths` short-circuit, and rapid repeat calls for the same path
	// coalesce into one exec via the per-path debounce window.
	register(rawPath: string): void;
	// Re-hydrate the primedPaths set from prior session entries. Called on
	// session_start so /reload doesn't re-prime files already loaded this run.
	restore(paths: Iterable<string>): void;
	// Test/diagnostic accessors. Both return canonicalized absolute paths.
	isPrimed(rawPath: string): boolean;
	primedPaths(): readonly string[];
	// Cancel any pending debounce timers — used on session_shutdown so a
	// /reload doesn't fire stale exec calls against a torn-down runtime.
	cancelPending(): void;
}

export function createScopeLoader(options: ScopeLoaderOptions): ScopeLoader {
	const {
		exec,
		cwd,
		budget,
		debounceMs,
		sendMessage,
		appendEntry,
		timeoutMs = DEFAULT_SCOPE_TIMEOUT_MS,
		onError,
		setTimer = (fn, ms) => setTimeout(fn, ms),
		clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	} = options;

	const primed = new Set<string>();
	const pendingTimers = new Map<string, unknown>();
	// In-flight exec set so a second tool_call that arrives while the first
	// exec is awaiting doesn't re-fire `ml prime --files`. Cleared after the
	// exec resolves (success or failure).
	const inFlight = new Set<string>();

	function canonicalize(rawPath: string): string {
		return isAbsolute(rawPath) ? rawPath : resolvePath(cwd, rawPath);
	}

	function register(rawPath: string): void {
		if (!rawPath || rawPath.length === 0) return;
		const path = canonicalize(rawPath);
		if (primed.has(path)) return;
		if (inFlight.has(path)) return;
		const existing = pendingTimers.get(path);
		if (existing !== undefined) clearTimer(existing);
		const handle = setTimer(() => {
			pendingTimers.delete(path);
			void fire(path);
		}, debounceMs);
		pendingTimers.set(path, handle);
	}

	async function fire(path: string): Promise<void> {
		if (primed.has(path)) return;
		if (inFlight.has(path)) return;
		inFlight.add(path);
		try {
			const result = await exec("ml", ["prime", "--files", path, "--budget", String(budget)], {
				cwd,
				timeout: timeoutMs,
			});
			if (result.code !== 0) return;
			const stdout = result.stdout.trim();
			if (stdout.length === 0) return;
			primed.add(path);
			// Persist BEFORE sending the steer message so /reload mid-flight
			// still records the path. The entry shape is deliberately small —
			// only `path` is needed to reconstruct primedPaths.
			appendEntry(SCOPE_LOAD_CUSTOM_TYPE, { path });
			sendMessage(
				{
					customType: SCOPE_LOAD_CUSTOM_TYPE,
					content: composeScopeLoadMessage(path, stdout),
					display: false,
					details: { path },
				},
				{ deliverAs: "steer" },
			);
		} catch (err) {
			onError?.(err, path);
		} finally {
			inFlight.delete(path);
		}
	}

	function restore(paths: Iterable<string>): void {
		for (const raw of paths) {
			if (typeof raw !== "string" || raw.length === 0) continue;
			primed.add(canonicalize(raw));
		}
	}

	function isPrimed(rawPath: string): boolean {
		return primed.has(canonicalize(rawPath));
	}

	function primedPaths(): readonly string[] {
		return Array.from(primed);
	}

	function cancelPending(): void {
		for (const handle of pendingTimers.values()) clearTimer(handle);
		pendingTimers.clear();
	}

	return { register, restore, isPrimed, primedPaths, cancelPending };
}

// Pull the file-path argument out of a tool_call input shape. Pi's built-in
// read/edit/write tools standardize on `path` (with `file_path` as a legacy
// renderer fallback — see pi/dist/core/tools/read.js). Grep/find tools also
// carry an optional `path`, but it's a directory and rarely worth scope-loading
// per-edit, so the caller filters by toolName before delegating here.
export function extractFilePathFromInput(input: unknown): string | undefined {
	if (input === null || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const raw = record.path ?? record.file_path;
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

// Tool names that carry a single file path worth scope-loading. Grep/find are
// excluded — their `path` is a directory/glob root and the scope-load would
// over-fire on every search. The list mirrors pi's built-in read/edit/write
// trio; custom file tools can route their own paths through `register()`.
export const SCOPE_LOAD_TOOL_NAMES: ReadonlySet<string> = new Set(["read", "edit", "write"]);

// Banner-wrapped body. Same banners as the systemPrompt inject — the LLM has
// already been trained on the format from session_start. Keeping them stable
// across both entry points means the model treats them as the same channel.
export const SCOPE_LOAD_BANNER_START = "<!-- mulch:scope-load:start -->";
export const SCOPE_LOAD_BANNER_END = "<!-- mulch:scope-load:end -->";

export function composeScopeLoadMessage(path: string, primedBody: string): string {
	return [
		SCOPE_LOAD_BANNER_START,
		`Scope-loaded records for ${path}:`,
		"",
		primedBody,
		SCOPE_LOAD_BANNER_END,
	].join("\n");
}

// Walk session entries (as returned by `sessionManager.getEntries()`) and
// extract the persisted paths for restore(). The entries are loosely typed in
// the public ExtensionAPI surface, so we keep the read defensive.
export function collectPersistedScopeLoadPaths(entries: readonly unknown[]): string[] {
	const out: string[] = [];
	for (const entry of entries) {
		if (entry === null || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		if (e.type !== "custom") continue;
		if (e.customType !== SCOPE_LOAD_CUSTOM_TYPE) continue;
		const data = e.data;
		if (data === null || typeof data !== "object") continue;
		const path = (data as Record<string, unknown>).path;
		if (typeof path === "string" && path.length > 0) out.push(path);
	}
	return out;
}
