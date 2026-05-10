// Type exports

export type {
	AppendOutcomeResult,
	EditOptions,
	OutcomeOptions,
	QueryOptions,
	RecordOptions,
	RecordResult,
	RecordUpdates,
	SearchOptions,
	SearchResult,
} from "./api.ts";
// Programmatic API
export {
	appendOutcome,
	editRecord,
	queryDomain,
	recordExpertise,
	searchExpertise,
} from "./api.ts";
// Schema exports
export { configSchema } from "./schemas/config-schema.ts";
export type {
	Classification,
	ConventionRecord,
	DecisionRecord,
	Evidence,
	ExpertiseRecord,
	FailureRecord,
	GuideRecord,
	MulchConfig,
	Outcome,
	PatternRecord,
	RecordType,
	ReferenceRecord,
} from "./schemas/index.ts";
export { DEFAULT_CONFIG } from "./schemas/index.ts";
export { recordSchema } from "./schemas/record-schema.ts";
// Config utilities
export { getExpertisePath, readConfig } from "./utils/config.ts";
// Expertise utilities
export {
	appendRecord,
	findDuplicate,
	generateRecordId,
	readExpertiseFile,
	searchRecords,
	writeExpertiseFile,
} from "./utils/expertise.ts";

// Scoring utilities
export type { ScoredRecord } from "./utils/scoring.ts";
export {
	applyConfirmationBoost,
	computeConfirmationScore,
	getFailureCount,
	getSuccessCount,
	getSuccessRate,
	getTotalApplications,
	sortByConfirmationScore,
} from "./utils/scoring.ts";
