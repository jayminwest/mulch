import { readFile, appendFile, writeFile, stat, rename, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import type { ExpertiseRecord, RecordType, Classification } from "../schemas/record.js";
import { searchBM25, DEFAULT_BM25_PARAMS } from "./bm25.js";

export async function readExpertiseFile(
  filePath: string,
): Promise<ExpertiseRecord[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const records: ExpertiseRecord[] = [];
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  for (const line of lines) {
    records.push(JSON.parse(line) as ExpertiseRecord);
  }
  return records;
}

export function generateRecordId(record: ExpertiseRecord): string {
  let key: string;
  switch (record.type) {
    case "convention":
      key = `convention:${record.content}`;
      break;
    case "pattern":
      key = `pattern:${record.name}`;
      break;
    case "failure":
      key = `failure:${record.description}`;
      break;
    case "decision":
      key = `decision:${record.title}`;
      break;
    case "reference":
      key = `reference:${record.name}`;
      break;
    case "guide":
      key = `guide:${record.name}`;
      break;
  }
  return `mx-${createHash("sha256").update(key).digest("hex").slice(0, 6)}`;
}

export async function appendRecord(
  filePath: string,
  record: ExpertiseRecord,
): Promise<void> {
  if (!record.id) {
    record.id = generateRecordId(record);
  }
  const line = JSON.stringify(record) + "\n";
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
  const content = records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
  const tmpPath = `${filePath}.tmp.${randomBytes(8).toString("hex")}`;
  await writeFile(tmpPath, content, "utf-8");
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    try { await unlink(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export function countRecords(records: ExpertiseRecord[]): number {
  return records.length;
}

export function filterByType(
  records: ExpertiseRecord[],
  type: string,
): ExpertiseRecord[] {
  return records.filter((r) => r.type === type);
}

export function filterByClassification(
  records: ExpertiseRecord[],
  classification: string,
): ExpertiseRecord[] {
  return records.filter((r) => r.classification === classification);
}

export function filterByFile(
  records: ExpertiseRecord[],
  file: string,
): ExpertiseRecord[] {
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
  for (let i = 0; i < existing.length; i++) {
    const record = existing[i];
    if (record.type !== newRecord.type) continue;

    switch (record.type) {
      case "pattern":
        if (
          newRecord.type === "pattern" &&
          record.name === newRecord.name
        ) {
          return { index: i, record };
        }
        break;
      case "decision":
        if (
          newRecord.type === "decision" &&
          record.title === newRecord.title
        ) {
          return { index: i, record };
        }
        break;
      case "convention":
        if (
          newRecord.type === "convention" &&
          record.content === newRecord.content
        ) {
          return { index: i, record };
        }
        break;
      case "failure":
        if (
          newRecord.type === "failure" &&
          record.description === newRecord.description
        ) {
          return { index: i, record };
        }
        break;
      case "reference":
        if (
          newRecord.type === "reference" &&
          record.name === newRecord.name
        ) {
          return { index: i, record };
        }
        break;
      case "guide":
        if (
          newRecord.type === "guide" &&
          record.name === newRecord.name
        ) {
          return { index: i, record };
        }
        break;
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
export function resolveRecordId(
  records: ExpertiseRecord[],
  identifier: string,
): ResolveResult {
  // Normalize: strip mx- prefix if present to get the hash part
  const hash = identifier.startsWith("mx-")
    ? identifier.slice(3)
    : identifier;

  // Try exact match first
  const exactIndex = records.findIndex((r) => r.id === `mx-${hash}`);
  if (exactIndex !== -1) {
    return { ok: true, index: exactIndex, record: records[exactIndex] };
  }

  // Try prefix match
  const matches: Array<{ index: number; record: ExpertiseRecord }> = [];
  for (let i = 0; i < records.length; i++) {
    const rid = records[i].id;
    if (rid && rid.startsWith(`mx-${hash}`)) {
      matches.push({ index: i, record: records[i] });
    }
  }

  if (matches.length === 1) {
    return { ok: true, index: matches[0].index, record: matches[0].record };
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

/**
 * Search records using BM25 ranking algorithm.
 * Returns records sorted by relevance (highest score first).
 */
export function searchRecords(
  records: ExpertiseRecord[],
  query: string,
): ExpertiseRecord[] {
  const results = searchBM25(records, query, DEFAULT_BM25_PARAMS);
  return results.map((r) => r.record);
}

export interface DomainHealth {
  governance_utilization: number;
  stale_count: number;
  type_distribution: Record<RecordType, number>;
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
  const ageInDays = Math.floor(
    (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24),
  );

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

  // Initialize distributions
  const typeDistribution: Record<RecordType, number> = {
    convention: 0,
    pattern: 0,
    failure: 0,
    decision: 0,
    reference: 0,
    guide: 0,
  };

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
    // Type distribution
    typeDistribution[record.type]++;

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
  const governanceUtilization = maxEntries > 0
    ? Math.round((records.length / maxEntries) * 100)
    : 0;

  return {
    governance_utilization: governanceUtilization,
    stale_count: staleCount,
    type_distribution: typeDistribution,
    classification_distribution: classificationDistribution,
    oldest_timestamp: oldestTimestamp,
    newest_timestamp: newestTimestamp,
  };
}
