// Type exports
export type {
  RecordType,
  Classification,
  Evidence,
  Outcome,
  ConventionRecord,
  PatternRecord,
  FailureRecord,
  DecisionRecord,
  ReferenceRecord,
  GuideRecord,
  ExpertiseRecord,
} from "./schemas/index.ts";

export type { MulchConfig } from "./schemas/index.ts";
export { DEFAULT_CONFIG } from "./schemas/index.ts";

// Schema exports
export { recordSchema } from "./schemas/record-schema.ts";

// Config utilities
export { readConfig, getExpertisePath } from "./utils/config.ts";

// Expertise utilities
export {
  readExpertiseFile,
  searchRecords,
  appendRecord,
  writeExpertiseFile,
  findDuplicate,
  generateRecordId,
} from "./utils/expertise.ts";

// Programmatic API
export {
  recordExpertise,
  searchExpertise,
  queryDomain,
  editRecord,
  appendOutcome,
} from "./api.ts";
export type {
  RecordOptions,
  RecordResult,
  SearchOptions,
  SearchResult,
  QueryOptions,
  EditOptions,
  RecordUpdates,
  OutcomeOptions,
  AppendOutcomeResult,
} from "./api.ts";

// Scoring utilities
export type { ScoredRecord } from "./utils/scoring.ts";
export {
  getSuccessCount,
  getFailureCount,
  getTotalApplications,
  getSuccessRate,
  computeConfirmationScore,
  applyConfirmationBoost,
  sortByConfirmationScore,
} from "./utils/scoring.ts";
