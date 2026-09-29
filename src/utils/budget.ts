import type { Classification, ExpertiseRecord } from "../schemas/record.ts";
import { computeConfirmationScore, type ScoredRecord } from "./scoring.ts";

export const DEFAULT_BUDGET = 4000;

/** Priority order for classifications (lower index = higher priority) */
const CLASSIFICATION_PRIORITY: Classification[] = ["foundational", "tactical", "observational"];

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

/**
 * Rank tier (lower = kept first). Records anchored to the requested paths
 * lead, failures first within each group: anchored failures, other anchored
 * records, unanchored failures, everything else. `isAnchored` is only passed
 * when the caller scoped by file (`--files` / `--context`); without it the
 * order reduces to failures, then the rest.
 */
function rankTier(r: ScoredRecord, isAnchored?: (r: ExpertiseRecord) => boolean): number {
	const failure = r.type === "failure";
	const anchored = isAnchored ? isAnchored(r) : false;
	if (anchored) return failure ? 0 : 1;
	return failure ? 2 : 3;
}

/**
 * Sort key: rank tier, then confirmation score (higher first), then
 * classification, then recency (newest first).
 */
function recordSortKey(
	r: ScoredRecord,
	isAnchored?: (r: ExpertiseRecord) => boolean,
): [number, number, number, number] {
	const classIdx = CLASSIFICATION_PRIORITY.indexOf(r.classification);
	const confirmationScore = computeConfirmationScore(r);
	const time = r.recorded_at ? new Date(r.recorded_at).getTime() : 0;
	return [rankTier(r, isAnchored), -confirmationScore, classIdx, -time];
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
 * Records are ranked failures first, then by confirmation score (higher =
 * higher priority), then classification (foundational > tactical >
 * observational), then recency (newest first). When `isAnchored` is given,
 * failures it matches are always kept (even past the budget) and other
 * matching records rank ahead of every unmatched record.
 *
 * The formatRecord callback is used to estimate per-record token cost.
 */
export function applyBudget(
	domains: DomainRecords[],
	budget: number,
	formatRecord: (record: ExpertiseRecord, domain: string) => string,
	isAnchored?: (record: ExpertiseRecord) => boolean,
): BudgetResult {
	// Flatten all records with their domain, then sort by priority
	const tagged: Array<{ domain: string; record: ScoredRecord; key: number[] }> = [];
	for (const d of domains) {
		for (const r of d.records) {
			tagged.push({ domain: d.domain, record: r, key: recordSortKey(r, isAnchored) });
		}
	}
	tagged.sort((a, b) => {
		for (let i = 0; i < a.key.length; i++) {
			const diff = (a.key[i] ?? 0) - (b.key[i] ?? 0);
			if (diff !== 0) return diff;
		}
		return 0;
	});

	const totalRecords = tagged.length;
	let usedTokens = 0;
	const kept = new Set<number>();

	for (const [i, item] of tagged.entries()) {
		const formatted = formatRecord(item.record, item.domain);
		const cost = estimateTokens(formatted);
		const pinned = item.key[0] === 0;
		if (pinned || usedTokens + cost <= budget) {
			usedTokens += cost;
			kept.add(i);
		}
	}

	// Rebuild domain groups preserving original domain order and record order
	const domainOrder = domains.map((d) => d.domain);
	const result: DomainRecords[] = [];
	const droppedDomains = new Set<string>();

	for (const domainName of domainOrder) {
		const originalRecords = domains.find((d) => d.domain === domainName)?.records;
		const keptRecords: ScoredRecord[] = [];

		for (const rec of originalRecords ?? []) {
			// Find this record's index in the tagged array
			const idx = tagged.findIndex((t) => t.domain === domainName && t.record === rec);
			if (idx !== -1 && kept.has(idx)) {
				keptRecords.push(rec);
			} else if (idx !== -1) {
				droppedDomains.add(domainName);
			}
		}

		if (keptRecords.length > 0) {
			result.push({ domain: domainName, records: keptRecords });
		} else if ((originalRecords ?? []).length > 0) {
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
export function formatBudgetSummary(droppedCount: number, droppedDomainCount: number): string {
	const domainPart =
		droppedDomainCount > 0
			? ` across ${droppedDomainCount} domain${droppedDomainCount === 1 ? "" : "s"}`
			: "";
	return `... and ${droppedCount} more record${droppedCount === 1 ? "" : "s"}${domainPart} (use --budget <n> to show more)`;
}
