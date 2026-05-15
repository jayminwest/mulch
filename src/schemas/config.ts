export type PrimeMode = "manifest" | "full";

// Session-close footer styles. Audit (V1_PLAN §3) found 70-80% of conventions
// were ritual restatements driven by an earlier "you MUST run this checklist"
// prose; the v0.10.0 reframing dropped it for `conditional`. `directive` ships
// a numbered imperative + type glossary + anti-filler guardrails for projects
// that need a louder voice. `minimal` is a one-line nudge. `none` suppresses
// the footer entirely. `custom` (via SessionCloseConfig.custom) wins over
// style and ships the raw string verbatim.
export type SessionCloseStyleName = "directive" | "conditional" | "minimal" | "none";

export const DEFAULT_SESSION_CLOSE_STYLE: SessionCloseStyleName = "conditional";

export interface SessionCloseConfig {
	style?: SessionCloseStyleName;
	custom?: string;
}

export const DEFAULT_SEARCH_BOOST_FACTOR = 0.1;

// Trust-tier ranking weights for `ml prime` full-mode output (v0.10 slice 3).
// Sort score = stars * star_weight + classification_weight. Higher scores are
// surfaced first; ties preserve insertion order so within-tier output stays
// stable across runs.
export interface PrimeTierWeights {
	star?: number;
	foundational?: number;
	tactical?: number;
	observational?: number;
}

export const DEFAULT_PRIME_TIER_WEIGHTS: Required<PrimeTierWeights> = {
	star: 100,
	foundational: 50,
	tactical: 20,
	observational: 10,
};

export const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

// `pi.*` namespace consumed by the in-tree `@os-eco/pi-mulch` extension
// (extensions/pi/index.ts). The extension reads these knobs on every hook
// invocation via readConfig() so edits take effect without restart. Stored
// inside the existing mulch.config.yaml so file locking, atomic writes, and
// schema validation are inherited.
export interface PiScopeLoadConfig {
	// Fire `ml prime --files <path>` on tool_call read/edit/write events.
	enabled?: boolean;
	// Per-call token budget passed to `ml prime --budget`. Tune downward if
	// scope-load floods the message stream; upward if records truncate.
	budget?: number;
	// Coalesce rapid file events to one scope-load per file within this window.
	debounce_ms?: number;
}

export interface PiConfig {
	// Run `ml prime` on session_start and inject the result via the
	// before_agent_start systemPrompt hook. Falls back to manifest mode when
	// `prime.default_mode` is `manifest`.
	auto_prime?: boolean;
	// Per-file scope-loading on tool_call events. See PiScopeLoadConfig.
	scope_load?: PiScopeLoadConfig;
	// Register the record_expertise / query_expertise custom tools.
	tools?: boolean;
	// Register /ml:prime, /ml:status, /ml:doctor slash commands.
	commands?: boolean;
	// Surface the `ml learn` nudge widget on agent_end.
	agent_end_widget?: boolean;
}

export const DEFAULT_PI_CONFIG: Required<Omit<PiConfig, "scope_load">> & {
	scope_load: Required<PiScopeLoadConfig>;
} = {
	auto_prime: true,
	scope_load: {
		enabled: true,
		budget: 2000,
		debounce_ms: 500,
	},
	tools: true,
	commands: true,
	agent_end_widget: true,
};

// Lifecycle events. `pre-*` hooks block on non-zero exit. `pre-record`,
// `pre-prime`, and `pre-compact` may mutate the payload via stdout JSON;
// `pre-prune` is block-or-allow only (its stdout is ignored, so a hook cannot
// reshape the candidate set). `post-*` hooks are observation-only: a non-zero
// exit emits a warning but never fails the parent command.
export type HookEvent = "pre-record" | "post-record" | "pre-prime" | "pre-prune" | "pre-compact";

export const HOOK_EVENTS: readonly HookEvent[] = [
	"pre-record",
	"post-record",
	"pre-prime",
	"pre-prune",
	"pre-compact",
];

export type HooksConfig = Partial<Record<HookEvent, string[]>>;

export type CustomCompactStrategy = "concat" | "merge_outcomes" | "keep_latest" | "manual";

export interface CustomTypeConfig {
	// Inherit required/optional/dedup_key/id_key/summary/compact/section_title/
	// extracts_files/files_field from a built-in type. Custom-from-custom is not
	// supported in v1. When set, all other fields override only what differs;
	// arrays merge as a union.
	extends?: string;
	required?: string[];
	optional?: string[];
	dedup_key?: string;
	id_key?: string;
	summary?: string;
	extracts_files?: boolean;
	files_field?: string;
	compact?: CustomCompactStrategy;
	section_title?: string;
	// Map canonical (current) field name to legacy aliases. Records on disk that
	// carry a legacy field are rewritten to the canonical name at read time.
	aliases?: Record<string, string[]>;
}

// Per-domain configuration. `allowed_types` gates which registered record
// types may be written into the domain — empty/missing means all registered
// types are allowed (back-compat). `required_fields` lists additional
// top-level fields a record must carry on top of its per-type requirements;
// empty/missing means no extra requirements.
export interface DomainConfig {
	allowed_types?: string[];
	required_fields?: string[];
}

export interface AnchorValidityConfig {
	threshold?: number;
	grace_days?: number;
	weight?: number;
}

export interface DecayConfig {
	anchor_validity?: AnchorValidityConfig;
}

export const DEFAULT_ANCHOR_VALIDITY_THRESHOLD = 0.5;
export const DEFAULT_ANCHOR_VALIDITY_GRACE_DAYS = 7;

// `ml audit` thresholds. PASS/WARN/FAIL bands for the three primary corpus
// health metrics. Defaults relaxed from the Python prototype per V1_PLAN §4.2
// ("0.7 evidence coverage is empirically unreachable today"). All knobs are
// overridable globally under `audit.thresholds` and per-domain under
// `audit.per_domain.<name>` — partial overrides are merged on top of defaults.
export interface AuditThresholds {
	evidence_coverage?: number; // PASS ≥, default 0.5
	evidence_coverage_warn?: number; // WARN ≥, default 0.3 (below = FAIL)
	floater_max?: number; // PASS ≤ (fraction of records), default 0.2
	rule_density_min?: number; // PASS ≥, default 0.25
	rule_density_warn?: number; // WARN ≥, default 0.15 (below = FAIL)
	max_records_per_domain?: number; // PASS ≤, default 200 (matches governance.hard_limit)
	max_stale?: number; // PASS ≤ stale-record count, default 0
}

export interface AuditConfig {
	thresholds?: AuditThresholds;
	// Domains excluded from audit metrics entirely (e.g. reference-doc domains
	// that are legitimately convention-heavy and evidence-light).
	ignore_domains?: string[];
	// Per-domain threshold overrides. Each value is merged on top of the global
	// thresholds for that domain only — keys not declared fall back to the global.
	per_domain?: Record<string, AuditThresholds>;
}

export const DEFAULT_AUDIT_THRESHOLDS: Required<AuditThresholds> = {
	evidence_coverage: 0.5,
	evidence_coverage_warn: 0.3,
	floater_max: 0.2,
	rule_density_min: 0.25,
	rule_density_warn: 0.15,
	max_records_per_domain: 200,
	max_stale: 0,
};

export function resolveAuditThresholds(
	cfg: AuditConfig | undefined,
	domain?: string,
): Required<AuditThresholds> {
	const global = { ...DEFAULT_AUDIT_THRESHOLDS, ...(cfg?.thresholds ?? {}) };
	if (!domain) return global;
	const override = cfg?.per_domain?.[domain];
	if (!override) return global;
	return { ...global, ...override };
}

/**
 * Range-check decay.anchor_validity knobs. Returns a list of human-readable
 * error strings (empty when valid). Caught at command-time (e.g. `ml prune
 * --check-anchors`) so a misconfigured threshold/grace doesn't silently produce
 * wrong demotion decisions:
 *   - threshold < 0 or > 1: validFraction is in [0, 1], so out-of-range values
 *     either always-decay (threshold > 1) or never-decay (threshold < 0).
 *   - grace_days < 0: every record passes the grace check, so brand-new records
 *     can decay before their anchors stabilize.
 *   - non-finite numbers (NaN/Infinity): YAML accepts `.nan` / `.inf` literals
 *     that bypass the type check.
 */
export function validateAnchorValidityConfig(cfg: AnchorValidityConfig): string[] {
	const errors: string[] = [];
	const t = cfg.threshold;
	if (t !== undefined) {
		if (typeof t !== "number" || !Number.isFinite(t)) {
			errors.push(`threshold must be a finite number (got ${JSON.stringify(t)})`);
		} else if (t < 0 || t > 1) {
			errors.push(`threshold must be between 0 and 1 (got ${t})`);
		}
	}
	const g = cfg.grace_days;
	if (g !== undefined) {
		if (typeof g !== "number" || !Number.isFinite(g)) {
			errors.push(`grace_days must be a finite number (got ${JSON.stringify(g)})`);
		} else if (g < 0) {
			errors.push(`grace_days must be >= 0 (got ${g})`);
		}
	}
	return errors;
}

export interface MulchConfig {
	version: string;
	domains: Record<string, DomainConfig>;
	governance: {
		max_entries: number;
		warn_entries: number;
		hard_limit: number;
	};
	classification_defaults: {
		shelf_life: {
			tactical: number;
			observational: number;
		};
	};
	prime?: {
		default_mode?: PrimeMode;
		// Trust-tier ranking weights. Each knob is optional; unset fields fall
		// back to DEFAULT_PRIME_TIER_WEIGHTS so projects can tune one dimension
		// (e.g. observational only) without redeclaring the whole block.
		tier_weights?: PrimeTierWeights;
		// Session-close footer customization. `style` selects a built-in preset
		// (directive / conditional / minimal / none); `custom` overrides the
		// preset entirely with verbatim prose. Both are optional — unset means
		// DEFAULT_SESSION_CLOSE_STYLE ("conditional", v0.10.0 back-compat).
		session_close?: SessionCloseConfig;
	};
	search?: {
		// Multiplier applied to BM25 scores via applyConfirmationBoost. 0 disables.
		boost_factor: number;
	};
	custom_types?: Record<string, CustomTypeConfig>;
	// Decay knobs. R-05f wires `anchor_validity` into `ml prune --check-anchors`;
	// `weight` is reserved for the future R-05g fitness blend and otherwise unused.
	decay?: DecayConfig;
	// `ml audit` thresholds and ignore-list. See AuditConfig.
	audit?: AuditConfig;
	// Names of registered types (built-in or custom) that emit a deprecation
	// warning on write. Reads still succeed; the type stays in CLI choices.
	disabled_types?: string[];
	// Lifecycle hook scripts. Each event maps to an ordered array of shell
	// commands. Mulch invokes each script with the relevant payload as JSON on
	// stdin. See HookEvent for semantics.
	hooks?: HooksConfig;
	// Per-hook execution settings. `timeout_ms` defaults to DEFAULT_HOOK_TIMEOUT_MS.
	hook_settings?: {
		timeout_ms?: number;
	};
	// Configuration consumed by the in-tree `@os-eco/pi-mulch` pi-coding-agent
	// extension (extensions/pi/index.ts). Absent means defaults apply; the
	// extension is a no-op when pi is not the active runtime regardless.
	pi?: PiConfig;
}

export const DEFAULT_CONFIG: MulchConfig = {
	version: "1",
	domains: {},
	governance: {
		max_entries: 100,
		warn_entries: 150,
		hard_limit: 200,
	},
	classification_defaults: {
		shelf_life: {
			tactical: 14,
			observational: 30,
		},
	},
};
