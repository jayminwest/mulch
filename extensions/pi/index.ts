// @os-eco/pi-mulch — pi-coding-agent extension that hard-wires mulch's
// session_start / tool_call / agent_end rituals into pi lifecycle events.
//
// Steps landed:
//   • mulch-be45 — extension skeleton, peer deps, pi.* config block
//   • mulch-7359 — auto-prime (session_start → before_agent_start)
//   • mulch-71cf — scope-load on tool_call (this commit)
//
// Pending steps fill in the remaining lifecycle handlers:
//   • mulch-4d87 — record_expertise / query_expertise custom tools
//   • mulch-903f — slash commands + agent_end learn-nudge widget
//   • mulch-d060 — pi-aware onboarding marker (driven by setup recipe)
//
// Imports from @earendil-works/pi-coding-agent and typebox are declared as
// peerDependencies (optional) in package.json so CLI-only users do not pay
// the peer-dep noise. The extension is loaded by pi via the `pi.extensions`
// manifest entry which points at this file.

import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { type ResolvedPiConfig, readPiConfig } from "./lib/config.ts";
import { composePrimedSystemPrompt, runMlPrime } from "./lib/prime.ts";
import {
	collectPersistedScopeLoadPaths,
	createScopeLoader,
	extractFilePathFromInput,
	SCOPE_LOAD_TOOL_NAMES,
	type ScopeLoader,
} from "./lib/scope-load.ts";

export default function piMulchExtension(pi: ExtensionAPI): void {
	// Resolved once per session_start so config edits take effect on /reload
	// without re-installing the extension. Subsequent hooks close over this.
	let resolved: ResolvedPiConfig | undefined;

	// Cached `ml prime` markdown from the most recent session_start. Held in
	// the closure (not on disk) — re-priming on /reload is intentional so
	// freshly-recorded insights surface without restart.
	let primed: string | undefined;

	// Per-session scope-load orchestrator. Recreated on every session_start
	// because cwd / budget / debounce_ms may have changed. Persisted state
	// (the primedPaths set) is rehydrated from session entries below so
	// /reload doesn't re-prime files already scope-loaded this run.
	let scopeLoader: ScopeLoader | undefined;

	pi.on("session_start", async (_event, ctx) => {
		scopeLoader?.cancelPending();
		scopeLoader = undefined;
		primed = undefined;
		try {
			resolved = await readPiConfig(ctx.cwd);
		} catch {
			// Mulch not initialized in this project — extension stays inert.
			resolved = undefined;
			return;
		}
		if (resolved.auto_prime) {
			primed = await runMlPrime({ exec: pi.exec, cwd: ctx.cwd });
		}
		if (resolved.scope_load.enabled) {
			scopeLoader = createScopeLoader({
				exec: pi.exec,
				cwd: ctx.cwd,
				budget: resolved.scope_load.budget,
				debounceMs: resolved.scope_load.debounce_ms,
				sendMessage: (message, opts) => pi.sendMessage(message, opts),
				appendEntry: (customType, data) => pi.appendEntry(customType, data),
			});
			const persisted = collectPersistedScopeLoadPaths(ctx.sessionManager.getEntries());
			scopeLoader.restore(persisted);
		}
	});

	pi.on("before_agent_start", (event) => {
		if (!primed) return;
		return { systemPrompt: composePrimedSystemPrompt(event.systemPrompt, primed) };
	});

	pi.on("tool_call", (event: ToolCallEvent) => {
		if (!scopeLoader) return;
		if (!SCOPE_LOAD_TOOL_NAMES.has(event.toolName)) return;
		const path = extractFilePathFromInput(event.input);
		if (!path) return;
		scopeLoader.register(path);
	});

	pi.on("session_shutdown", () => {
		scopeLoader?.cancelPending();
	});

	pi.on("agent_end", () => {
		// mulch-903f: surface the `ml learn` nudge widget.
	});
}
