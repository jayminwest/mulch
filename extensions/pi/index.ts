// @os-eco/pi-mulch — pi-coding-agent extension that hard-wires mulch's
// session_start / tool_call / agent_end rituals into pi lifecycle events.
//
// Steps landed:
//   • mulch-be45 — extension skeleton, peer deps, pi.* config block
//   • mulch-7359 — auto-prime (session_start → before_agent_start)
//   • mulch-71cf — scope-load on tool_call
//   • mulch-4d87 — record_expertise / query_expertise custom tools
//   • mulch-903f — /ml:prime slash command + agent_end learn-nudge widget
//   • mulch-d060 — `ml setup pi` recipe + pi-aware onboarding marker (this commit)
//
// Pending steps:
//   • mulch-7229 — tests + README rewrite
//
// Imports from @earendil-works/pi-coding-agent and typebox are declared as
// peerDependencies (optional) in package.json so CLI-only users do not pay
// the peer-dep noise. The extension is loaded by pi via the `pi.extensions`
// manifest entry which points at this file.

import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { buildPrimeCommandRegistration, type PrimeCommandDeps } from "./lib/commands.ts";
import { type ResolvedPiConfig, readPiConfig } from "./lib/config.ts";
import { composeLearnWidgetLines, LEARN_WIDGET_KEY, runMlLearn } from "./lib/learn-nudge.ts";
import { composePrimedSystemPrompt, runMlPrime } from "./lib/prime.ts";
import {
	collectPersistedScopeLoadPaths,
	createScopeLoader,
	extractFilePathFromInput,
	SCOPE_LOAD_TOOL_NAMES,
	type ScopeLoader,
} from "./lib/scope-load.ts";
import { buildQueryExpertiseTool, buildRecordExpertiseTool } from "./lib/tools.ts";

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

	// Latest session cwd + UI handle, captured on session_start. The slash
	// command is registered once at extension load (before any session) so
	// the handler reads these via closure rather than baking in stale values.
	let sessionCwd: string | undefined;
	let notify: ((message: string, type?: "info" | "warning" | "error") => void) | undefined;

	// /ml:prime [domain] — registered once. The `getDeps` getter resolves the
	// current session cwd / sendMessage on each invocation so the command is
	// inert between sessions and re-binds cleanly across /reload.
	const primeCommand = buildPrimeCommandRegistration((): PrimeCommandDeps | undefined => {
		if (!resolved?.commands) return undefined;
		if (!sessionCwd) return undefined;
		return {
			exec: pi.exec,
			cwd: sessionCwd,
			sendMessage: (message, opts) => pi.sendMessage(message, opts),
			notify,
		};
	});
	pi.registerCommand(primeCommand.name, primeCommand.options);

	pi.on("session_start", async (_event, ctx) => {
		scopeLoader?.cancelPending();
		scopeLoader = undefined;
		primed = undefined;
		sessionCwd = ctx.cwd;
		notify = ctx.hasUI ? (msg, type) => ctx.ui.notify(msg, type) : undefined;
		// Clear any widget left over from a previous session (e.g. /reload).
		if (ctx.hasUI) ctx.ui.setWidget(LEARN_WIDGET_KEY, undefined);
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
		if (resolved.tools) {
			// Tools are dynamic per project (custom_types, per-domain rules) so we
			// rebuild on every session_start. Schema definitions and the LLM-
			// facing description both reflect the *live* mulch.config.yaml.
			try {
				const recordTool = await buildRecordExpertiseTool({ exec: pi.exec, cwd: ctx.cwd });
				pi.registerTool(recordTool);
				const queryTool = buildQueryExpertiseTool({ exec: pi.exec, cwd: ctx.cwd });
				pi.registerTool(queryTool);
			} catch {
				// Registry/config read failed mid-session_start — stay inert so a
				// transient YAML edit doesn't tear down the whole extension.
			}
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

	pi.on("session_shutdown", (_event, ctx) => {
		scopeLoader?.cancelPending();
		if (ctx.hasUI) ctx.ui.setWidget(LEARN_WIDGET_KEY, undefined);
		sessionCwd = undefined;
		notify = undefined;
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!resolved?.agent_end_widget) return;
		if (!ctx.hasUI) return;
		const learn = await runMlLearn({ exec: pi.exec, cwd: ctx.cwd });
		const lines = composeLearnWidgetLines(learn);
		ctx.ui.setWidget(LEARN_WIDGET_KEY, lines);
	});
}
