// @os-eco/pi-mulch — pi-coding-agent extension that hard-wires mulch's
// session_start / tool_call / agent_end rituals into pi lifecycle events.
//
// Step 1 (mulch-be45) ships only the skeleton: imports, config resolution,
// and a stub default export that subsequent plan steps fill in:
//   • mulch-7359 — auto-prime (session_start → before_agent_start)
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

export default function piMulchExtension(pi: ExtensionAPI): void {
	// Resolved at session_start so config edits take effect on /reload without
	// re-installing the extension. Subsequent hooks read this via the closure.
	let resolved: ResolvedPiConfig | undefined;

	pi.on("session_start", async (_event, ctx) => {
		try {
			resolved = await readPiConfig(ctx.cwd);
		} catch {
			// Mulch not initialized in this project — extension stays inert.
			resolved = undefined;
			return;
		}
		// Step 2 (mulch-7359) wires `ml prime --json` here and stashes the
		// rendered markdown for the before_agent_start hook to inject.
		void resolved;
	});

	// Stubs for subsequent plan steps. Wiring them here (rather than adding
	// the `pi.on(...)` calls in later commits) keeps the lifecycle-registration
	// surface visible in one place for review.
	pi.on("before_agent_start", () => {
		// mulch-7359: inject the systemPrompt with the primed records.
	});
	pi.on("tool_call", () => {
		// mulch-71cf: debounced `ml prime --files` scope-load.
	});
	pi.on("agent_end", () => {
		// mulch-903f: surface the `ml learn` nudge widget.
	});
}
