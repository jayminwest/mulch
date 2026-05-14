export type BuiltinRecordType =
	| "convention"
	| "pattern"
	| "failure"
	| "decision"
	| "reference"
	| "guide";

// Phase 2: widened to string so config-declared custom types are first-class.
// Use `BuiltinRecordType` for narrowing back to the six known shapes (e.g.,
// `registry.get(r.type)?.kind === "builtin"` then cast to a builtin record).
export type RecordType = string;

export type Classification = "foundational" | "tactical" | "observational";

export interface Evidence {
	commit?: string;
	date?: string;
	issue?: string;
	file?: string;
	bead?: string;
	seeds?: string;
	gh?: string;
	linear?: string;
}

export interface Outcome {
	status: "success" | "failure" | "partial";
	duration?: number;
	test_results?: string;
	agent?: string;
	notes?: string;
	recorded_at?: string;
}

interface BaseRecord {
	id?: string;
	classification: Classification;
	recorded_at: string;
	evidence?: Evidence;
	tags?: string[];
	relates_to?: string[];
	supersedes?: string[];
	outcomes?: Outcome[];
	dir_anchors?: string[];
	// R-06 ownership: opaque handle (e.g. "@user" or "@team"). Stamped by the
	// owner-resolution chain at write time (mulch-41e1) and consumed by
	// `ml review` (mulch-8cce). No internal validation in v1.
	owner?: string;
	// Lifecycle status. "draft" / "active" / "deprecated" are author-set on
	// live records; "archived" is set by `ml prune` soft-archive (lives only
	// under .mulch/archive/<domain>.jsonl) and the live AJV schemas reject it.
	status?: "draft" | "active" | "deprecated" | "archived";
	archived_at?: string;
	// Set by `archiveRecords` on every code path that moves a record to
	// .mulch/archive/. Convention values: "stale" | "superseded" |
	// "anchor_decay" | "manual" | "compacted"; a free-text suffix is permitted
	// (e.g. "manual: wrong domain"). Optional for back-compat with archives
	// written before mulch-b41a landed; lives only on archived records.
	archive_reason?: string;
	// Set by `ml prune` when supersession decay (R-05e) demotes a record one
	// classification tier. Lives on the record across the demotion until
	// archive; bumped each pass that re-demotes.
	supersession_demoted_at?: string;
	// Set by `ml prune --check-anchors` when anchor-validity decay (R-05f)
	// demotes a record one tier because too many of its file/dir anchors no
	// longer resolve. Bumped each pass that re-demotes.
	anchor_decay_demoted_at?: string;
}

export interface ConventionRecord extends BaseRecord {
	type: "convention";
	content: string;
}

export interface PatternRecord extends BaseRecord {
	type: "pattern";
	name: string;
	description: string;
	files?: string[];
}

export interface FailureRecord extends BaseRecord {
	type: "failure";
	description: string;
	resolution: string;
}

export interface DecisionRecord extends BaseRecord {
	type: "decision";
	title: string;
	rationale: string;
	date?: string;
}

export interface ReferenceRecord extends BaseRecord {
	type: "reference";
	name: string;
	description: string;
	files?: string[];
}

export interface GuideRecord extends BaseRecord {
	type: "guide";
	name: string;
	description: string;
}

export type ExpertiseRecord =
	| ConventionRecord
	| PatternRecord
	| FailureRecord
	| DecisionRecord
	| ReferenceRecord
	| GuideRecord;
