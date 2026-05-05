import { createHash, randomBytes } from "node:crypto";
import { appendFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { getRegistry } from "../registry/type-registry.ts";
import type { Classification, ExpertiseRecord } from "../schemas/record.ts";
import { DEFAULT_BM25_PARAMS, searchBM25 } from "./bm25.ts";
import { applyConfirmationBoost } from "./scoring.ts";

export async function readExpertiseFile(filePath: string): Promise<ExpertiseRecord[]> {
	let content: string;
	try {
		content = await readFile(filePath, "utf-8");
	} catch {
		return [];
	}

	const records: ExpertiseRecord[] = [];
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	for (const line of lines) {
		const raw = JSON.parse(line) as Record<string, unknown>;
		// Normalize legacy outcome (singular) to outcomes (array) for backward compat
		if (
			"outcome" in raw &&
			raw.outcome !== null &&
			raw.outcome !== undefined &&
			!("outcomes" in raw)
		) {
			const legacy = raw.outcome as Record<string, unknown>;
			raw.outcomes = [
				{
					status: legacy.status,
					...(legacy.duration !== undefined ? { duration: legacy.duration } : {}),
					...(legacy.test_results !== undefined ? { test_results: legacy.test_results } : {}),
					...(legacy.agent !== undefined ? { agent: legacy.agent } : {}),
				},
			];
			raw.outcome = undefined;
		}
		records.push(raw as unknown as ExpertiseRecord);
	}
	return records;
}

export function generateRecordId(record: ExpertiseRecord): string {
	const def = getRegistry().get(record.type);
	if (!def) {
		throw new Error(`Unknown record type: ${record.type}`);
	}
	const idValue = (record as unknown as Record<string, unknown>)[def.idKey];
	const key = `${record.type}:${String(idValue ?? "")}`;
	return `mx-${createHash("sha256").update(key).digest("hex").slice(0, 6)}`;
}

export async function appendRecord(filePath: string, record: ExpertiseRecord): Promise<void> {
	if (!record.id) {
		record.id = generateRecordId(record);
	}
	const line = `${JSON.stringify(record)}\n`;
	await appendFile(filePath, line, "utf-8");
}

export async function createExpertiseFile(filePath: string): Promise<void> {
	await writeFile(filePath, "", "utf-8");
}

export async function getFileModTime(filePath: string): Promise<Date | null> {
	try {
		const stats = await stat(filePath);
		return stats.mtime;
	} catch {
		return null;
	}
}

export async function writeExpertiseFile(
	filePath: string,
	records: ExpertiseRecord[],
): Promise<void> {
	for (const r of records) {
		if (!r.id) {
			r.id = generateRecordId(r);
		}
	}
	const content =
		records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
	const tmpPath = `${filePath}.tmp.${randomBytes(8).toString("hex")}`;
	await writeFile(tmpPath, content, "utf-8");
	try {
		await rename(tmpPath, filePath);
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			/* best-effort cleanup */
		}
		throw err;
	}
}

export function countRecords(records: ExpertiseRecord[]): number {
	return records.length;
}

export function filterByType(records: ExpertiseRecord[], type: string): ExpertiseRecord[] {
	return records.filter((r) => r.type === type);
}

export function filterByClassification(
	records: ExpertiseRecord[],
	classification: string,
): ExpertiseRecord[] {
	return records.filter((r) => r.classification === classification);
}

export function filterByFile(records: ExpertiseRecord[], file: string): ExpertiseRecord[] {
	const fileLower = file.toLowerCase();
	return records.filter((r) => {
		if ("files" in r && r.files) {
			return r.files.some((f) => f.toLowerCase().includes(fileLower));
		}
		return false;
	});
}

export function findDuplicate(
	existing: ExpertiseRecord[],
	newRecord: ExpertiseRecord,
): { index: number; record: ExpertiseRecord } | null {
	const registry = getRegistry();
	const def = registry.get(newRecord.type);
	if (!def) return null;
	const dedupKey = def.dedupKey;
	if (dedupKey === "content_hash") {
		// Phase 2: content-hash dedup for custom types. No built-in uses this.
		return null;
	}
	const newValue = (newRecord as unknown as Record<string, unknown>)[dedupKey];
	for (const [i, record] of existing.entries()) {
		if (record.type !== newRecord.type) continue;
		const value = (record as unknown as Record<string, unknown>)[dedupKey];
		if (value === newValue) {
			return { index: i, record };
		}
	}
	return null;
}

export type ResolveResult =
	| { ok: true; index: number; record: ExpertiseRecord }
	| { ok: false; error: string };

/**
 * Resolve an identifier to a record within a domain.
 * Accepts: full ID (mx-abc123), bare hash (abc123), or prefix (abc / mx-abc).
 * Returns the unique matching record or an error if not found / ambiguous.
 */
export function resolveRecordId(records: ExpertiseRecord[], identifier: string): ResolveResult {
	// Normalize: strip mx- prefix if present to get the hash part
	const hash = identifier.startsWith("mx-") ? identifier.slice(3) : identifier;

	// Try exact match first
	const exactIndex = records.findIndex((r) => r.id === `mx-${hash}`);
	if (exactIndex !== -1) {
		const exactRecord = records[exactIndex];
		if (exactRecord) return { ok: true, index: exactIndex, record: exactRecord };
	}

	// Try prefix match
	const matches: Array<{ index: number; record: ExpertiseRecord }> = [];
	for (const [i, rec] of records.entries()) {
		if (rec.id?.startsWith(`mx-${hash}`)) {
			matches.push({ index: i, record: rec });
		}
	}

	const [firstMatch] = matches;
	if (matches.length === 1 && firstMatch) {
		return { ok: true, index: firstMatch.index, record: firstMatch.record };
	}

	if (matches.length > 1) {
		const ids = matches.map((m) => m.record.id).join(", ");
		return {
			ok: false,
			error: `Ambiguous identifier "${identifier}" matches ${matches.length} records: ${ids}. Use more characters to disambiguate.`,
		};
	}

	return {
		ok: false,
		error: `Record "${identifier}" not found. Run \`mulch query\` to see record IDs.`,
	};
}

export interface SearchRecordsOptions {
	// Multiplier passed to applyConfirmationBoost. >0 reorders BM25 results
	// so records with confirmed outcomes float up; 0 / undefined = pure BM25.
	boostFactor?: number;
}

/**
 * Search records using BM25 ranking algorithm.
 * Returns records sorted by relevance (highest score first), optionally
 * re-ranked by confirmation-frequency boost.
 */
export function searchRecords(
	records: ExpertiseRecord[],
	query: string,
	options: SearchRecordsOptions = {},
): ExpertiseRecord[] {
	const results = searchBM25(records, query, DEFAULT_BM25_PARAMS);
	const factor = options.boostFactor ?? 0;
	if (factor <= 0) {
		return results.map((r) => r.record);
	}
	const boosted = results.map((r) => ({
		record: r.record,
		score: applyConfirmationBoost(r.score, r.record, factor),
	}));
	boosted.sort((a, b) => b.score - a.score);
	return boosted.map((r) => r.record);
}

export interface DomainHealth {
	governance_utilization: number;
	stale_count: number;
	type_distribution: Record<string, number>;
	classification_distribution: Record<Classification, number>;
	oldest_timestamp: string | null;
	newest_timestamp: string | null;
}

/**
 * Check if a record is stale based on classification and shelf life.
 */
export function isRecordStale(
	record: ExpertiseRecord,
	now: Date,
	shelfLife: { tactical: number; observational: number },
): boolean {
	const classification: Classification = record.classification;

	if (classification === "foundational") {
		return false;
	}

	const recordedAt = new Date(record.recorded_at);
	const ageInDays = Math.floor((now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24));

	if (classification === "tactical") {
		return ageInDays > shelfLife.tactical;
	}

	if (classification === "observational") {
		return ageInDays > shelfLife.observational;
	}

	return false;
}

/**
 * Calculate comprehensive health metrics for a domain.
 */
export function calculateDomainHealth(
	records: ExpertiseRecord[],
	maxEntries: number,
	shelfLife: { tactical: number; observational: number },
): DomainHealth {
	const now = new Date();

	// Initialize distributions seeded from registry-known type names so custom
	// types (Phase 2+) appear with zero counts when absent.
	const typeDistribution: Record<string, number> = {};
	for (const name of getRegistry().names()) {
		typeDistribution[name] = 0;
	}

	const classificationDistribution: Record<Classification, number> = {
		foundational: 0,
		tactical: 0,
		observational: 0,
	};

	let staleCount = 0;
	let oldestTimestamp: string | null = null;
	let newestTimestamp: string | null = null;

	// Calculate metrics
	for (const record of records) {
		// Type distribution — `??` guards against records of types not in the
		// registry (e.g., Phase 2's --allow-unknown-types escape hatch).
		typeDistribution[record.type] = (typeDistribution[record.type] ?? 0) + 1;

		// Classification distribution
		classificationDistribution[record.classification]++;

		// Stale count
		if (isRecordStale(record, now, shelfLife)) {
			staleCount++;
		}

		// Oldest/newest timestamps
		const recordedAt = record.recorded_at;
		if (!oldestTimestamp || recordedAt < oldestTimestamp) {
			oldestTimestamp = recordedAt;
		}
		if (!newestTimestamp || recordedAt > newestTimestamp) {
			newestTimestamp = recordedAt;
		}
	}

	// Governance utilization (as percentage, 0-100)
	const governanceUtilization =
		maxEntries > 0 ? Math.round((records.length / maxEntries) * 100) : 0;

	return {
		governance_utilization: governanceUtilization,
		stale_count: staleCount,
		type_distribution: typeDistribution,
		classification_distribution: classificationDistribution,
		oldest_timestamp: oldestTimestamp,
		newest_timestamp: newestTimestamp,
	};
}
