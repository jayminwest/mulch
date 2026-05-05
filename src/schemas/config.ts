export type PrimeMode = "manifest" | "full";

export const DEFAULT_SEARCH_BOOST_FACTOR = 0.1;

export const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

// Lifecycle events. `pre-*` hooks block on non-zero exit and may mutate the
// payload via stdout JSON (only events that pass payloads where mutation is
// meaningful — pre-record, pre-prime, pre-prune). `post-*` hooks are
// observation-only: a non-zero exit emits a warning but never fails the parent
// command.
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
	required: string[];
	optional?: string[];
	dedup_key: string;
	id_key?: string;
	summary: string;
	extracts_files?: boolean;
	files_field?: string;
	compact?: CustomCompactStrategy;
	section_title?: string;
	// Map canonical (current) field name to legacy aliases. Records on disk that
	// carry a legacy field are rewritten to the canonical name at read time.
	aliases?: Record<string, string[]>;
}

export interface MulchConfig {
	version: string;
	domains: string[];
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
	domains: [],
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
