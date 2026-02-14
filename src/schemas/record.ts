export type RecordType = "convention" | "pattern" | "failure" | "decision" | "reference" | "guide";

export type Classification = "foundational" | "tactical" | "observational";

export interface Evidence {
  commit?: string;
  date?: string;
  issue?: string;
  file?: string;
  bead?: string;
}

interface BaseRecord {
  id?: string;
  classification: Classification;
  recorded_at: string;
  evidence?: Evidence;
  tags?: string[];
  relates_to?: string[];
  supersedes?: string[];
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
