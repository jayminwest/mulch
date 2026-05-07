import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExpertiseRecord } from "../schemas/record.ts";

export type AnchorKind = "file" | "dir" | "evidence_file";

export interface RecordAnchor {
	kind: AnchorKind;
	path: string;
}

export interface AnchorValidity {
	total: number;
	valid: number;
	broken: RecordAnchor[];
	// `null` when the record has zero anchors — callers should treat that as
	// "applies globally, no decay signal" rather than 100% valid (a 0/0 record
	// would otherwise compute NaN and falsely trigger the threshold).
	validFraction: number | null;
}

/**
 * Enumerate every filesystem anchor a record carries: the typed `files[]`
 * (PatternRecord/ReferenceRecord), `dir_anchors[]` (any record), and
 * `evidence.file` (single string). Returns canonical kind+path pairs so
 * `--explain` output can attribute each broken entry.
 */
export function getRecordAnchors(record: ExpertiseRecord): RecordAnchor[] {
	const anchors: RecordAnchor[] = [];
	if ("files" in record && Array.isArray(record.files)) {
		for (const f of record.files) {
			if (typeof f === "string" && f.length > 0) {
				anchors.push({ kind: "file", path: f });
			}
		}
	}
	if (Array.isArray(record.dir_anchors)) {
		for (const d of record.dir_anchors) {
			if (typeof d === "string" && d.length > 0) {
				anchors.push({ kind: "dir", path: d });
			}
		}
	}
	if (record.evidence?.file && typeof record.evidence.file === "string") {
		anchors.push({ kind: "evidence_file", path: record.evidence.file });
	}
	return anchors;
}

export function computeAnchorValidity(
	record: ExpertiseRecord,
	projectRoot: string,
): AnchorValidity {
	const anchors = getRecordAnchors(record);
	const total = anchors.length;
	if (total === 0) {
		return { total: 0, valid: 0, broken: [], validFraction: null };
	}
	const broken: RecordAnchor[] = [];
	let valid = 0;
	for (const a of anchors) {
		if (existsSync(resolve(projectRoot, a.path))) {
			valid++;
		} else {
			broken.push(a);
		}
	}
	return { total, valid, broken, validFraction: valid / total };
}

/**
 * True when the record is older than the configured grace period, so we
 * shouldn't punish anchor decay on a record that was just written (e.g., a
 * file moved/created between `ml record` and the next `ml prune`).
 */
export function passedAnchorGrace(record: ExpertiseRecord, now: Date, graceDays: number): boolean {
	const recordedAt = new Date(record.recorded_at);
	const ageDays = (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24);
	return ageDays > graceDays;
}
