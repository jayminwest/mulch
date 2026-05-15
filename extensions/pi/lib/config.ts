// Resolved pi-extension config. Step 1 (mulch-be45): just the read helper —
// later steps consume the resolved values in their respective hooks. Read on
// every invocation so edits to mulch.config.yaml take effect without
// restarting the pi session.

import {
	DEFAULT_PI_CONFIG,
	type PiConfig,
	type PiScopeLoadConfig,
} from "../../../src/schemas/config.ts";
import { readConfig } from "../../../src/utils/config.ts";

export interface ResolvedPiConfig {
	auto_prime: boolean;
	scope_load: Required<PiScopeLoadConfig>;
	tools: boolean;
	commands: boolean;
	agent_end_widget: boolean;
}

export function resolvePiConfig(user: PiConfig | undefined): ResolvedPiConfig {
	return {
		auto_prime: user?.auto_prime ?? DEFAULT_PI_CONFIG.auto_prime,
		scope_load: {
			enabled: user?.scope_load?.enabled ?? DEFAULT_PI_CONFIG.scope_load.enabled,
			budget: user?.scope_load?.budget ?? DEFAULT_PI_CONFIG.scope_load.budget,
			debounce_ms: user?.scope_load?.debounce_ms ?? DEFAULT_PI_CONFIG.scope_load.debounce_ms,
		},
		tools: user?.tools ?? DEFAULT_PI_CONFIG.tools,
		commands: user?.commands ?? DEFAULT_PI_CONFIG.commands,
		agent_end_widget: user?.agent_end_widget ?? DEFAULT_PI_CONFIG.agent_end_widget,
	};
}

export async function readPiConfig(cwd: string): Promise<ResolvedPiConfig> {
	const cfg = await readConfig(cwd);
	return resolvePiConfig(cfg.pi);
}
