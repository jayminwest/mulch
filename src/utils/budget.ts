import type { BuiltinRecordType, Classification, ExpertiseRecord } from "../schemas/record.ts";
import { computeConfirmationScore, type ScoredRecord } from "./scoring.ts";

export const DEFAULT_BUDGET = 4000;

// Priority order for built-in types only. Custom types (Phase 2) sort after
// built-ins (indexOf returns -1, which sorts ahead — so use length when missing).
const TYPE_PRIORITY: BuiltinRecordType[] = [
	"convention",
	"decision",
	"pattern",
	"guide",
	"failure",
	"reference",
];

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
 * Sort records by priority: type order, then classification, then confirmation score
 * (higher score = higher priority), then recency (newest first).
 */
function recordSortKey(r: ScoredRecord): [number, number, number, number] {
	const builtinIdx = TYPE_PRIORITY.indexOf(r.type as BuiltinRecordType);
	// Custom types (-1 from indexOf) sort after all built-ins.
	const typeIdx = builtinIdx === -1 ? TYPE_PRIORITY.length : builtinIdx;
	const classIdx = CLASSIFICATION_PRIORITY.indexOf(r.classification);
	const confirmationScore = computeConfirmationScore(r);
	const time = r.recorded_at ? new Date(r.recorded_at).getTime() : 0;
	return [typeIdx, classIdx, -confirmationScore, -time];
}

function compareRecords(a: ScoredRecord, b: ScoredRecord): number {
	const [a0, a1, a2, a3] = recordSortKey(a);
	const [b0, b1, b2, b3] = recordSortKey(b);
	return a0 - b0 || a1 - b1 || a2 - b2 || a3 - b3;
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
): BudgetResult {
	// Flatten all records with their domain, then sort by priority
	const tagged: Array<{ domain: string; record: ScoredRecord }> = [];
	for (const d of domains) {
		for (const r of d.records) {
			tagged.push({ domain: d.domain, record: r });
		}
	}
	tagged.sort((a, b) => compareRecords(a.record, b.record));

	const totalRecords = tagged.length;
	let usedTokens = 0;
	const kept = new Set<number>();

	for (const [i, item] of tagged.entries()) {
		const formatted = formatRecord(item.record, item.domain);
		const cost = estimateTokens(formatted);
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
