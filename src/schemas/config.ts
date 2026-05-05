export type PrimeMode = "manifest" | "full";

export const DEFAULT_SEARCH_BOOST_FACTOR = 0.1;

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
