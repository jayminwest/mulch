import type { ExpertiseRecord } from "../schemas/record.ts";
import { type RelevanceConfig, computeRelevanceScore } from "./relevance.ts";
import type { ScoredRecord } from "./scoring.ts";

export const DEFAULT_BUDGET = 4000;

export interface DomainRecords {
  domain: string;
  records: ScoredRecord[];
}

export interface BudgetResult {
  /** Records kept, grouped by domain (preserves original domain order) */
  kept: DomainRecords[];
  /** Total number of records that were dropped */
  droppedCount: number;
  /** Number of domains that had records dropped */
  droppedDomainCount: number;
}

export interface BudgetOptions {
  contextFiles?: string[];
  relevanceConfig?: RelevanceConfig;
}

/**
 * Estimate token count from character count (chars / 4).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Apply a token budget to records across multiple domains.
 *
 * Records are prioritized by type (conventions first, then decisions, etc.),
 * then by classification (foundational > tactical > observational),
 * then by confirmation score (higher = higher priority),
 * then by recency (newest first).
 *
 * The formatRecord callback is used to estimate per-record token cost.
 */
export function applyBudget(
  domains: DomainRecords[],
  budget: number,
  formatRecord: (record: ExpertiseRecord, domain: string) => string,
  countTokens: (text: string) => number = estimateTokens,
  options?: BudgetOptions,
): BudgetResult {
  const now = new Date();
  const contextFiles = options?.contextFiles;
  const relevanceConfig = options?.relevanceConfig;

  // Flatten all records with their domain, then sort by relevance score
  const tagged: Array<{
    domain: string;
    record: ScoredRecord;
    score: number;
  }> = [];
  for (const d of domains) {
    for (const r of d.records) {
      const relevance = computeRelevanceScore(
        r,
        contextFiles,
        now,
        relevanceConfig,
      );
      tagged.push({ domain: d.domain, record: r, score: relevance.score });
    }
  }
  tagged.sort((a, b) => b.score - a.score);

  const totalRecords = tagged.length;
  let usedTokens = 0;
  const kept = new Set<number>();

  for (let i = 0; i < tagged.length; i++) {
    const formatted = formatRecord(tagged[i].record, tagged[i].domain);
    const cost = countTokens(formatted);
    if (usedTokens + cost <= budget) {
      usedTokens += cost;
      kept.add(i);
    }
  }

  // Rebuild domain groups preserving original domain order and record order
  const domainOrder = domains.map((d) => d.domain);
  const result: DomainRecords[] = [];
  const droppedDomains = new Set<string>();

  for (const domainName of domainOrder) {
    const originalRecords = domains.find(
      (d) => d.domain === domainName,
    )!.records;
    const keptRecords: ScoredRecord[] = [];

    for (const rec of originalRecords) {
      // Find this record's index in the tagged array
      const idx = tagged.findIndex(
        (t) => t.domain === domainName && t.record === rec,
      );
      if (idx !== -1 && kept.has(idx)) {
        keptRecords.push(rec);
      } else if (idx !== -1) {
        droppedDomains.add(domainName);
      }
    }

    if (keptRecords.length > 0) {
      result.push({ domain: domainName, records: keptRecords });
    } else if (originalRecords.length > 0) {
      droppedDomains.add(domainName);
    }
  }

  const droppedCount = totalRecords - kept.size;

  return {
    kept: result,
    droppedCount,
    droppedDomainCount: droppedDomains.size,
  };
}

/**
 * Format the truncation summary line shown when records are dropped.
 */
export function formatBudgetSummary(
  droppedCount: number,
  droppedDomainCount: number,
): string {
  const domainPart =
    droppedDomainCount > 0
      ? ` across ${droppedDomainCount} domain${droppedDomainCount === 1 ? "" : "s"}`
      : "";
  return `... and ${droppedCount} more record${droppedCount === 1 ? "" : "s"}${domainPart} (use --budget <n> to show more)`;
}
