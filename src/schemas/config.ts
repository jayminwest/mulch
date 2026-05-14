export type PrimeMode = "manifest" | "full";

export const DEFAULT_SEARCH_BOOST_FACTOR = 0.1;

export const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

// Lifecycle events. `pre-*` hooks block on non-zero exit. Only `pre-record`
// and `pre-prime` may mutate the payload via stdout JSON; `pre-prune` is
// block-or-allow only (its stdout is ignored, so a hook cannot reshape the
// candidate set). `post-*` hooks are observation-only: a non-zero exit emits a
// warning but never fails the parent command.
export type HookEvent = "pre-record" | "post-record" | "pre-prime" | "pre-prune";

export const HOOK_EVENTS: readonly HookEvent[] = [
	"pre-record",
	"post-record",
	"pre-prime",
	"pre-prune",
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
		default_mode: PrimeMode;
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
