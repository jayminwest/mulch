// @os-eco/pi-mulch — pi-coding-agent extension that hard-wires mulch's
// session_start / tool_call / agent_end rituals into pi lifecycle events.
//
// Steps landed:
//   • mulch-be45 — extension skeleton, peer deps, pi.* config block
//   • mulch-7359 — auto-prime (session_start → before_agent_start)
//
// Pending steps fill in the remaining lifecycle handlers:
//   • mulch-71cf — scope-load on tool_call
//   • mulch-4d87 — record_expertise / query_expertise custom tools
//   • mulch-903f — slash commands + agent_end learn-nudge widget
//   • mulch-d060 — pi-aware onboarding marker (driven by setup recipe)
//
// Imports from @earendil-works/pi-coding-agent and typebox are declared as
// peerDependencies (optional) in package.json so CLI-only users do not pay
// the peer-dep noise. The extension is loaded by pi via the `pi.extensions`
// manifest entry which points at this file.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ResolvedPiConfig, readPiConfig } from "./lib/config.ts";
import { composePrimedSystemPrompt, runMlPrime } from "./lib/prime.ts";

export default function piMulchExtension(pi: ExtensionAPI): void {
	// Resolved once per session_start so config edits take effect on /reload
	// without re-installing the extension. Subsequent hooks close over this.
	let resolved: ResolvedPiConfig | undefined;

	// Cached `ml prime` markdown from the most recent session_start. Held in
	// the closure (not on disk) — re-priming on /reload is intentional so
	// freshly-recorded insights surface without restart.
	let primed: string | undefined;

	pi.on("session_start", async (_event, ctx) => {
		primed = undefined;
		try {
			resolved = await readPiConfig(ctx.cwd);
		} catch {
			// Mulch not initialized in this project — extension stays inert.
			resolved = undefined;
			return;
		}
		if (!resolved.auto_prime) return;
		primed = await runMlPrime({ exec: pi.exec, cwd: ctx.cwd });
	});

	pi.on("before_agent_start", (event) => {
		if (!primed) return;
		return { systemPrompt: composePrimedSystemPrompt(event.systemPrompt, primed) };
	});

	// Stubs for subsequent plan steps. Wiring them here (rather than adding
	// the `pi.on(...)` calls in later commits) keeps the lifecycle-registration
	// surface visible in one place for review.
	pi.on("tool_call", () => {
		// mulch-71cf: debounced `ml prime --files` scope-load.
	});
	pi.on("agent_end", () => {
		// mulch-903f: surface the `ml learn` nudge widget.
	});
}
