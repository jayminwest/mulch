export type RecordType = "convention" | "pattern" | "failure" | "decision";

export type Classification = "foundational" | "tactical" | "observational";

export interface Evidence {
  commit?: string;
  date?: string;
  issue?: string;
  file?: string;
}

interface BaseRecord {
  classification: Classification;
  recorded_at: string;
  evidence?: Evidence;
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

export type ExpertiseRecord =
  | ConventionRecord
  | PatternRecord
  | FailureRecord
  | DecisionRecord;
