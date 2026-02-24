import type { ExpertiseRecord, Outcome } from "../schemas/record.ts";

export type { Outcome };

/**
 * An ExpertiseRecord with outcome history for confirmation-frequency scoring.
 * Since ExpertiseRecord now includes outcomes?: Outcome[], this is an alias.
 */
export type ScoredRecord = ExpertiseRecord;

/**
 * Returns the number of successful outcomes for a record.
 * Successful outcomes indicate confirmed, working applications of the record.
 */
export function getSuccessCount(record: ScoredRecord): number {
  if (!record.outcomes || record.outcomes.length === 0) return 0;
  return record.outcomes.filter((o) => o.status === "success").length;
}

/**
 * Returns the number of failed outcomes for a record.
 */
export function getFailureCount(record: ScoredRecord): number {
  if (!record.outcomes || record.outcomes.length === 0) return 0;
  return record.outcomes.filter((o) => o.status === "failure").length;
}

/**
 * Returns the total number of recorded outcomes (applications) for a record.
 */
export function getTotalApplications(record: ScoredRecord): number {
  return record.outcomes?.length ?? 0;
}

/**
 * Returns the success rate (0-1) for a record.
 * Partial outcomes are counted as 0.5 (half success).
 * Returns 0 for records with no outcomes.
 */
export function getSuccessRate(record: ScoredRecord): number {
  const total = getTotalApplications(record);
  if (total === 0) return 0;
  const partialCount =
    record.outcomes?.filter((o) => o.status === "partial").length ?? 0;
  const successCount = getSuccessCount(record);
  return (successCount + partialCount * 0.5) / total;
}

/**
 * Computes the confirmation-frequency score for a record.
 *
 * The score is the count of successful confirmations (applications where
 * the record's guidance was applied and the outcome was "success").
 * Partial outcomes contribute 0.5 to the score.
 *
 * Records with no outcomes return 0.
 * Records with only failures return 0.
 */
export function computeConfirmationScore(record: ScoredRecord): number {
  if (!record.outcomes || record.outcomes.length === 0) return 0;
  const successCount = getSuccessCount(record);
  const partialCount = record.outcomes.filter(
    (o) => o.status === "partial",
  ).length;
  return successCount + partialCount * 0.5;
}

/**
 * Applies a confirmation-frequency boost to a base score (e.g., a BM25 relevance score).
 *
 * Records with no outcomes (score = 0) are returned unchanged.
 * Records with confirmed applications receive a multiplicative boost proportional
 * to their confirmation score.
 *
 * @param baseScore - The base relevance score (e.g., from BM25)
 * @param record - The record to score
 * @param boostFactor - Multiplier controlling boost magnitude (default: 0.1)
 * @returns The boosted score
 */
export function applyConfirmationBoost(
  baseScore: number,
  record: ScoredRecord,
  boostFactor = 0.1,
): number {
  const confirmationScore = computeConfirmationScore(record);
  if (confirmationScore === 0) return baseScore;
  return baseScore * (1 + boostFactor * confirmationScore);
}

/**
 * Sorts records by confirmation-frequency score, highest first.
 * Records with equal scores maintain their original relative order (stable sort).
 * Records with no outcomes (score = 0) sort to the end.
 */
export function sortByConfirmationScore<T extends ScoredRecord>(
  records: T[],
): T[] {
  return [...records].sort(
    (a, b) => computeConfirmationScore(b) - computeConfirmationScore(a),
  );
}
