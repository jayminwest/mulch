// JSON Schema for MulchConfig (.mulch/mulch.config.yaml).
//
// Hand-authored to mirror the TypeScript MulchConfig interface in ./config.ts.
// Powers `ml config schema` for warren and any other tool that needs to render
// a generic configuration UI against mulch's settings. Keep this in lockstep
// with the TS interface — when you add a knob, add it here too (a doctor /
// test-time check enforces parity).
//
// Conventions (matching record-schema.ts):
//   - Every object literal includes `type: "object"` alongside `required` /
//     `properties` so AJV strict mode accepts the schema.
//   - Closed shapes use `additionalProperties: false`.
//   - Open maps (domains, custom_types, aliases) use `additionalProperties` to
//     describe the value shape.

const domainConfigSchema = {
	type: "object",
	title: "Domain configuration",
	description:
		"Per-domain rules. Empty/missing fields preserve back-compat (any registered type accepted, no extra required fields).",
	properties: {
		allowed_types: {
			type: "array",
			title: "Allowed record types",
			description:
				"Gates `--type` on write for this domain. Empty/missing means all registered types are allowed. `disabled_types` wins over `allowed_types` on overlap so retiring a type does not hard-fail peers.",
			items: { type: "string" },
		},
		required_fields: {
			type: "array",
			title: "Required top-level fields",
			description:
				"Additional top-level fields every record in this domain must carry, on top of the per-type schema requirements.",
			items: { type: "string" },
		},
	},
	additionalProperties: false,
} as const;

const customTypeConfigSchema = {
	type: "object",
	title: "Custom record type",
	description:
		"Definition of a custom record type. May extend a built-in to inherit its required/optional fields, dedup_key, id_key, summary, compact strategy, section title, and file-extraction behavior — override only what differs; arrays merge as a union. Custom-from-custom is not supported.",
	properties: {
		extends: {
			type: "string",
			title: "Built-in to extend",
			description:
				"Name of a built-in type (convention, pattern, failure, decision, reference, guide). Custom-from-custom is rejected.",
			enum: ["convention", "pattern", "failure", "decision", "reference", "guide"],
		},
		required: {
			type: "array",
			title: "Required fields",
			description: "Top-level fields a record of this type must carry.",
			items: { type: "string" },
		},
		optional: {
			type: "array",
			title: "Optional fields",
			description: "Additional top-level fields a record of this type may carry.",
			items: { type: "string" },
		},
		dedup_key: {
			type: "string",
			title: "Dedup key",
			description: "Field used to detect duplicates on write (e.g. 'name' or 'content').",
		},
		id_key: {
			type: "string",
			title: "Display ID field",
			description: "Field used to render a record's identifying label in compact output.",
		},
		summary: {
			type: "string",
			title: "Summary template",
			description: "Compact-line summary template used by `ml prime`.",
		},
		extracts_files: {
			type: "boolean",
			title: "Extracts files",
			description: "Whether records of this type carry a list of file anchors.",
		},
		files_field: {
			type: "string",
			title: "Files field name",
			description: "Field name that holds file anchors when extracts_files is true (e.g. 'files').",
		},
		compact: {
			type: "string",
			title: "Compact strategy",
			description: "How `ml compact` collapses duplicates of this type.",
			enum: ["concat", "merge_outcomes", "keep_latest", "manual"],
		},
		section_title: {
			type: "string",
			title: "Section title",
			description: "Heading used when grouping this type in `ml prime` output.",
		},
		aliases: {
			type: "object",
			title: "Field aliases",
			description:
				"Map canonical (current) field name to legacy aliases. Records on disk that carry a legacy field are rewritten to the canonical name at read time.",
			additionalProperties: {
				type: "array",
				items: { type: "string" },
			},
		},
	},
	additionalProperties: false,
} as const;

const auditThresholdsSchema = {
	type: "object",
	title: "Audit thresholds",
	description:
		"PASS/WARN/FAIL bands for `ml audit`. Below `_warn` is FAIL; between `_warn` and the primary threshold is WARN; meeting the primary threshold is PASS. Floater and stale knobs use a single PASS ceiling.",
	properties: {
		evidence_coverage: {
			type: "number",
			title: "Evidence coverage (PASS)",
			description:
				"PASS when ≥ this fraction of records carry any tracker (seeds/gh/linear/bead) or commit evidence. Range: [0, 1].",
			minimum: 0,
			maximum: 1,
			default: 0.5,
		},
		evidence_coverage_warn: {
			type: "number",
			title: "Evidence coverage (WARN)",
			description:
				"WARN when evidence coverage is between this value and `evidence_coverage`. Below this is FAIL. Range: [0, 1].",
			minimum: 0,
			maximum: 1,
			default: 0.3,
		},
		floater_max: {
			type: "number",
			title: "Floater rate (PASS ceiling)",
			description:
				"PASS when the fraction of records without any tracker, relates_to, or commit evidence is ≤ this value. Above is WARN/FAIL.",
			minimum: 0,
			maximum: 1,
			default: 0.2,
		},
		rule_density_min: {
			type: "number",
			title: "Convention rule-density (PASS)",
			description:
				"PASS when ≥ this fraction of convention records contain a rule-signal word (because, must not, avoid, always, never, …). Range: [0, 1].",
			minimum: 0,
			maximum: 1,
			default: 0.25,
		},
		rule_density_warn: {
			type: "number",
			title: "Convention rule-density (WARN)",
			description:
				"WARN when rule-density is between this value and `rule_density_min`. Below this is FAIL. Range: [0, 1].",
			minimum: 0,
			maximum: 1,
			default: 0.15,
		},
		max_records_per_domain: {
			type: "integer",
			title: "Records per domain (PASS ceiling)",
			description:
				"Informational ceiling on records per domain; auditors flag domains above this number. Distinct from `governance.hard_limit` which gates writes.",
			minimum: 1,
			default: 200,
		},
		max_stale: {
			type: "integer",
			title: "Stale records (PASS ceiling)",
			description:
				"Informational ceiling on stale (past-shelf-life) records per domain. PASS when ≤ this value.",
			minimum: 0,
			default: 0,
		},
	},
	additionalProperties: false,
} as const;

const auditConfigSchema = {
	type: "object",
	title: "Audit configuration",
	description:
		"Knobs for `ml audit`. Global thresholds are merged on top of defaults; per-domain entries layer on top of the global thresholds for that domain only.",
	properties: {
		thresholds: auditThresholdsSchema,
		ignore_domains: {
			type: "array",
			title: "Domains excluded from audit",
			description:
				"Domains skipped entirely by `ml audit` (e.g. reference-doc domains that are legitimately convention-heavy and evidence-light).",
			items: { type: "string" },
		},
		per_domain: {
			type: "object",
			title: "Per-domain threshold overrides",
			description:
				"Threshold overrides keyed by domain name. Partial overrides are merged on top of the global thresholds; keys not declared inherit the global value.",
			additionalProperties: auditThresholdsSchema,
		},
	},
	additionalProperties: false,
} as const;

const anchorValidityConfigSchema = {
	type: "object",
	title: "Anchor-validity decay",
	description:
		"Tier-demotion knobs for `ml prune --check-anchors`. A record decays one tier per pass when its file/dir anchors stop resolving and `valid_fraction` drops below `threshold`, provided the record is older than `grace_days`. Records with zero anchors are exempt (absence means 'applies globally').",
	properties: {
		threshold: {
			type: "number",
			title: "Validity threshold",
			description:
				"Demote when the fraction of resolving anchors drops below this value. Range: [0, 1].",
			minimum: 0,
			maximum: 1,
			default: 0.5,
		},
		grace_days: {
			type: "integer",
			title: "Grace period (days)",
			description:
				"Records younger than this many days are exempt from anchor-validity decay so brand-new records can stabilize.",
			minimum: 0,
			default: 7,
		},
		weight: {
			type: "number",
			title: "Fitness weight",
			description:
				"Reserved for the future fitness blend (R-05g). Currently unused; safe to leave unset.",
		},
	},
	additionalProperties: false,
} as const;

const hookCommandList = {
	type: "array",
	description: "Ordered shell commands invoked for this lifecycle event.",
	items: { type: "string" },
} as const;

export const configSchema = {
	$schema: "http://json-schema.org/draft-07/schema#",
	title: "Mulch Configuration",
	description:
		"Schema for .mulch/mulch.config.yaml. Mirrors the MulchConfig TypeScript interface in src/schemas/config.ts. Consumers (e.g. warren) render generic configuration UIs against this schema via `ml config schema --json`.",
	type: "object",
	required: ["version", "domains", "governance", "classification_defaults"],
	properties: {
		version: {
			type: "string",
			title: "Config version",
			description:
				"Schema version of the on-disk config. Bumped only when the shape changes in a backwards-incompatible way.",
			default: "1",
		},
		domains: {
			type: "object",
			title: "Domains",
			description:
				"Per-domain configuration keyed by domain name. Empty object is valid (a fresh project starts with no declared domains; `ml record` auto-creates them).",
			additionalProperties: domainConfigSchema,
			default: {},
		},
		governance: {
			type: "object",
			title: "Governance limits",
			description:
				"Per-domain record-count thresholds. Mulch warns at `warn_entries` and refuses writes past `hard_limit` (configurable per project).",
			properties: {
				max_entries: {
					type: "integer",
					title: "Soft target",
					description:
						"Soft target for records per domain. Status reports flag domains above this number; writes are not blocked.",
					minimum: 1,
					default: 100,
				},
				warn_entries: {
					type: "integer",
					title: "Warn threshold",
					description: "Threshold at which `ml record` prints a 'consider compacting' warning.",
					minimum: 1,
					default: 150,
				},
				hard_limit: {
					type: "integer",
					title: "Hard limit",
					description: "Maximum records per domain. Writes past this number are refused.",
					minimum: 1,
					default: 200,
				},
			},
			required: ["max_entries", "warn_entries", "hard_limit"],
			additionalProperties: false,
		},
		classification_defaults: {
			type: "object",
			title: "Classification defaults",
			description: "Shelf-life windows (in days) for time-bound record classifications.",
			properties: {
				shelf_life: {
					type: "object",
					title: "Shelf life (days)",
					description:
						"How long records of each classification remain in primary expertise before `ml prune` considers them stale. `foundational` records are permanent and are not listed here.",
					properties: {
						tactical: {
							type: "integer",
							title: "Tactical shelf life",
							description: "Days a tactical record remains live before becoming prune-eligible.",
							minimum: 1,
							default: 14,
						},
						observational: {
							type: "integer",
							title: "Observational shelf life",
							description:
								"Days an observational record remains live before becoming prune-eligible.",
							minimum: 1,
							default: 30,
						},
					},
					required: ["tactical", "observational"],
					additionalProperties: false,
				},
			},
			required: ["shelf_life"],
			additionalProperties: false,
		},
		prime: {
			type: "object",
			title: "Prime defaults",
			description: "Defaults applied when `ml prime` is invoked without overriding flags.",
			properties: {
				default_mode: {
					type: "string",
					title: "Default prime mode",
					description:
						"`full` dumps every record; `manifest` emits a quick reference + domain index for monolith projects where dumping every record wastes context.",
					enum: ["manifest", "full"],
					default: "full",
				},
				tier_weights: {
					type: "object",
					title: "Trust-tier ranking weights",
					description:
						"Per-record sort score = stars * `star` + classification weight. Override only the knobs you want to retune; unset fields keep their default. Higher scores surface first.",
					properties: {
						star: {
							type: "number",
							title: "Star weight",
							description:
								"Multiplier applied to a record's confirmation-score (★ count from outcomes).",
							minimum: 0,
							default: 100,
						},
						foundational: {
							type: "number",
							title: "Foundational weight",
							description: "Base score added to every foundational record.",
							minimum: 0,
							default: 50,
						},
						tactical: {
							type: "number",
							title: "Tactical weight",
							description: "Base score added to every tactical record.",
							minimum: 0,
							default: 20,
						},
						observational: {
							type: "number",
							title: "Observational weight",
							description: "Base score added to every observational record.",
							minimum: 0,
							default: 10,
						},
					},
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		},
		search: {
			type: "object",
			title: "Search tuning",
			description: "Knobs that tune `ml search` / `ml rank` ranking.",
			properties: {
				boost_factor: {
					type: "number",
					title: "Confirmation boost factor",
					description:
						"Multiplier applied to BM25 scores via `applyConfirmationBoost`. 0 disables the boost.",
					minimum: 0,
					default: 0.1,
				},
			},
			required: ["boost_factor"],
			additionalProperties: false,
		},
		custom_types: {
			type: "object",
			title: "Custom record types",
			description:
				"Project-defined record types keyed by type name. Treated identically to built-ins by the registry (CLI flags, validation, dedup, formatters).",
			additionalProperties: customTypeConfigSchema,
		},
		decay: {
			type: "object",
			title: "Decay knobs",
			description:
				"Configuration for tier-demotion behavior in `ml prune`. Currently only `anchor_validity` is wired; `weight` is reserved for the future fitness blend.",
			properties: {
				anchor_validity: anchorValidityConfigSchema,
			},
			additionalProperties: false,
		},
		audit: auditConfigSchema,
		disabled_types: {
			type: "array",
			title: "Disabled types",
			description:
				"Names of registered types (built-in or custom) that emit a deprecation warning on write. Reads still succeed; the type stays in CLI choices.",
			items: { type: "string" },
		},
		hooks: {
			type: "object",
			title: "Lifecycle hooks",
			description:
				"Ordered shell scripts invoked at each lifecycle event. Scripts receive the payload as JSON on stdin (with MULCH_HOOK=1; cwd at project root). `pre-*` hooks block on non-zero exit; `post-*` hooks emit a warning. `pre-record`, `pre-prime`, and `pre-compact` may mutate the payload via stdout JSON; `pre-prune` is block-or-allow only.",
			properties: {
				"pre-record": hookCommandList,
				"post-record": hookCommandList,
				"pre-prime": hookCommandList,
				"pre-prune": hookCommandList,
				"pre-compact": hookCommandList,
			},
			additionalProperties: false,
		},
		hook_settings: {
			type: "object",
			title: "Hook execution settings",
			description: "Per-hook execution settings.",
			properties: {
				timeout_ms: {
					type: "integer",
					title: "Hook timeout (ms)",
					description: "Maximum runtime per hook script. SIGKILL on timeout. Default is 5000ms.",
					minimum: 1,
					default: 5000,
				},
			},
			additionalProperties: false,
		},
	},
	additionalProperties: false,
} as const;
