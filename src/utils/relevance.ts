import type {
  Classification,
  ExpertiseRecord,
  RecordType,
} from "../schemas/record.ts";
import { fileMatchesAny } from "./git.ts";
import { getSuccessRate, getTotalApplications } from "./scoring.ts";

export interface RelevanceWeights {
  type: number;
  classification: number;
  recency: number;
  outcome: number;
  fileAffinity: number;
}

export interface RelevanceConfig {
  weights: RelevanceWeights;
  halfLifeDays: number;
  maxAgeDays: number;
}

export interface ScoredRelevance {
  score: number;
  signals: {
    type: number;
    classification: number;
    recency: number;
    outcome: number;
    fileAffinity: number;
  };
}

export const DEFAULT_RELEVANCE_WEIGHTS: RelevanceWeights = {
  type: 0.25,
  classification: 0.25,
  recency: 0.2,
  outcome: 0.15,
  fileAffinity: 0.15,
};

export const DEFAULT_RELEVANCE_CONFIG: RelevanceConfig = {
  weights: DEFAULT_RELEVANCE_WEIGHTS,
  halfLifeDays: 30,
  maxAgeDays: 365,
};

/** Priority order for record types (must match budget.ts TYPE_PRIORITY) */
const TYPE_ORDER: RecordType[] = [
  "convention",
  "decision",
  "pattern",
  "guide",
  "failure",
  "reference",
];

/** Priority order for classifications */
const CLASSIFICATION_ORDER: Classification[] = [
  "foundational",
  "tactical",
  "observational",
];

/**
 * Score a record's type. Higher-priority types get higher scores.
 * convention=1.0, decision=0.8, pattern=0.6, guide=0.4, failure=0.2, reference=0.0
 */
export function scoreType(type: RecordType): number {
  const idx = TYPE_ORDER.indexOf(type);
  if (idx === -1) return 0;
  return 1 - idx / (TYPE_ORDER.length - 1);
}

/**
 * Score a record's classification.
 * foundational=1.0, tactical=0.5, observational=0.0
 */
export function scoreClassification(classification: Classification): number {
  const idx = CLASSIFICATION_ORDER.indexOf(classification);
  if (idx === -1) return 0;
  return 1 - idx / (CLASSIFICATION_ORDER.length - 1);
}

/**
 * Score a record's recency using exponential decay.
 * 0 days=1.0, halfLifeDays=0.5, clamped to 0 at maxAgeDays.
 * Invalid/missing date returns 0.5 (neutral).
 */
export function scoreRecency(
  recordedAt: string | undefined,
  now: Date,
  halfLifeDays = 30,
  maxAgeDays = 365,
): number {
  if (!recordedAt) return 0.5;
  const recordDate = new Date(recordedAt);
  if (Number.isNaN(recordDate.getTime())) return 0.5;

  const ageDays =
    (now.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 1.0;
  if (ageDays >= maxAgeDays) return 0;

  return Math.exp((-Math.LN2 / halfLifeDays) * ageDays);
}

/**
 * Score a record's outcome success.
 * No outcomes → 0.5 (neutral).
 * Otherwise: successRate * 0.9 + min(1, totalApplications/10) * 0.1
 */
export function scoreOutcomeSuccess(record: ExpertiseRecord): number {
  const total = getTotalApplications(record);
  if (total === 0) return 0.5;

  const rate = getSuccessRate(record);
  const volume = Math.min(1, total / 10);
  return rate * 0.9 + volume * 0.1;
}

/**
 * Score file affinity between a record and context files.
 * No context provided → 0.5 (neutral, effectively disabled).
 * Record has no files field → 0.5 (context-independent records).
 * Record files match context → 0.5 + 0.5 * (matchCount / totalFiles).
 * Record files exist but none match → 0.0 (strong penalty).
 */
export function scoreFileAffinity(
  record: ExpertiseRecord,
  contextFiles: string[] | undefined,
): number {
  if (!contextFiles || contextFiles.length === 0) return 0.5;

  if (!("files" in record) || !record.files || record.files.length === 0) {
    return 0.5;
  }

  const totalFiles = record.files.length;
  let matchCount = 0;
  for (const file of record.files) {
    if (fileMatchesAny(file, contextFiles)) {
      matchCount++;
    }
  }

  if (matchCount === 0) return 0;
  return 0.5 + 0.5 * (matchCount / totalFiles);
}

/**
 * Compute a composite relevance score for a record.
 * All signals are normalized to [0, 1] and combined with configurable weights.
 */
export function computeRelevanceScore(
  record: ExpertiseRecord,
  contextFiles: string[] | undefined,
  now: Date,
  config: RelevanceConfig = DEFAULT_RELEVANCE_CONFIG,
): ScoredRelevance {
  const w = config.weights;

  const signals = {
    type: scoreType(record.type),
    classification: scoreClassification(record.classification),
    recency: scoreRecency(
      record.recorded_at,
      now,
      config.halfLifeDays,
      config.maxAgeDays,
    ),
    outcome: scoreOutcomeSuccess(record),
    fileAffinity: scoreFileAffinity(record, contextFiles),
  };

  const totalWeight =
    w.type + w.classification + w.recency + w.outcome + w.fileAffinity;

  const score =
    (w.type * signals.type +
      w.classification * signals.classification +
      w.recency * signals.recency +
      w.outcome * signals.outcome +
      w.fileAffinity * signals.fileAffinity) /
    totalWeight;

  return { score, signals };
}

/**
 * Rank records by composite relevance score (highest first).
 */
export function rankByRelevance(
  records: ExpertiseRecord[],
  contextFiles?: string[],
  now: Date = new Date(),
  config: RelevanceConfig = DEFAULT_RELEVANCE_CONFIG,
): Array<{ record: ExpertiseRecord; relevance: ScoredRelevance }> {
  return records
    .map((record) => ({
      record,
      relevance: computeRelevanceScore(record, contextFiles, now, config),
    }))
    .sort((a, b) => b.relevance.score - a.relevance.score);
}
