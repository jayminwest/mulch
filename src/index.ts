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
} from "./schemas/index.js";

export type { MulchConfig } from "./schemas/index.js";
export { DEFAULT_CONFIG } from "./schemas/index.js";

// Schema exports
export { recordSchema } from "./schemas/record-schema.js";

// Config utilities
export { readConfig, getExpertisePath } from "./utils/config.js";

// Expertise utilities
export {
  readExpertiseFile,
  searchRecords,
  appendRecord,
  writeExpertiseFile,
  findDuplicate,
  generateRecordId,
} from "./utils/expertise.js";

// Programmatic API
export {
  recordExpertise,
  searchExpertise,
  queryDomain,
  editRecord,
} from "./api.js";
export type {
  RecordOptions,
  RecordResult,
  SearchOptions,
  SearchResult,
  QueryOptions,
  EditOptions,
  RecordUpdates,
} from "./api.js";
