import type { QualityLevel } from "../schemas/config.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { hasRuleSignal } from "./audit.ts";
import { searchBM25, tokenize } from "./bm25.ts";
import { recordBodyText } from "./expertise.ts";

// Write-time quality gate for `ml record`. Deterministic, no LLM: near-dup
// detection shortlists with BM25 then scores token-set Jaccard, and the
// quality checks reuse `ml audit`'s rule-signal heuristic.

export const DEFAULT_QUALITY_LEVEL: QualityLevel = "warn";

// Jaccard similarity at or above which a new record is treated as a
// near-duplicate. Lowered when the two records share a file/dir anchor, since
// same-place records restating the same idea are the common slop shape.
export const NEAR_DUP_THRESHOLD = 0.6;
export const NEAR_DUP_ANCHORED_THRESHOLD = 0.45;
const NEAR_DUP_SHORTLIST = 10;

export interface NearDuplicate {
	record: ExpertiseRecord;
	similarity: number;
	sharedAnchors: string[];
}

// Tokens of 3+ chars: drops "a"/"to"/"of"-style noise that inflates overlap
// between short records.
function tokenSet(text: string): Set<string> {
	return new Set(tokenize(text).filter((t) => t.length >= 3));
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const t of a) if (b.has(t)) shared++;
	return shared / (a.size + b.size - shared);
}

function anchorsOf(record: ExpertiseRecord): string[] {
	const out: string[] = [];
	if ("files" in record && Array.isArray(record.files)) out.push(...record.files);
	if (record.dir_anchors) out.push(...record.dir_anchors);
	if (record.evidence?.file) out.push(record.evidence.file);
	return out;
}

/**
 * Existing records that say nearly the same thing as `candidate`, most
 * similar first. Records the candidate already supersedes are excluded.
 */
export function findNearDuplicates(
	existing: ExpertiseRecord[],
	candidate: ExpertiseRecord,
): NearDuplicate[] {
	const text = recordBodyText(candidate);
	const tokens = tokenSet(text);
	if (tokens.size === 0) return [];
	const superseded = new Set(candidate.supersedes ?? []);
	const anchors = new Set(anchorsOf(candidate));

	const out: NearDuplicate[] = [];
	for (const { record } of searchBM25(existing, text).slice(0, NEAR_DUP_SHORTLIST)) {
		if (record.id && superseded.has(record.id)) continue;
		const similarity = jaccard(tokens, tokenSet(recordBodyText(record)));
		const sharedAnchors = anchorsOf(record).filter((a) => anchors.has(a));
		const threshold = sharedAnchors.length > 0 ? NEAR_DUP_ANCHORED_THRESHOLD : NEAR_DUP_THRESHOLD;
		if (similarity >= threshold) out.push({ record, similarity, sharedAnchors });
	}
	return out.sort((a, b) => b.similarity - a.similarity);
}

export interface QualityOptions {
	// True when evidence.commit came from git HEAD rather than an explicit
	// --evidence-commit. An ambient commit says nothing about the record.
	autoCommit?: boolean;
}

function hasGrounding(record: ExpertiseRecord, opts: QualityOptions): boolean {
	if (anchorsOf(record).length > 0) return true;
	const ev = record.evidence;
	if (!ev) return false;
	if (ev.issue || ev.seeds || ev.gh || ev.linear || ev.bead) return true;
	return Boolean(ev.commit) && !opts.autoCommit;
}

/**
 * Soft quality checks. Returns one human-readable issue per failed check;
 * empty means the record passes.
 */
export function checkRecordQuality(record: ExpertiseRecord, opts: QualityOptions = {}): string[] {
	const issues: string[] = [];
	if ((record.type === "convention" || record.type === "pattern") && !hasGrounding(record, opts)) {
		issues.push(
			`${record.type} has no file/dir anchor or evidence; add --files, --dir-anchor, or an --evidence-* flag so it can be scoped and verified.`,
		);
	}
	if (record.type === "convention" && !hasRuleSignal(record.content)) {
		issues.push(
			'convention reads like a restatement of code (no rule words such as "because", "avoid", "never", "prefer"); state the rule and why, or skip it.',
		);
	}
	return issues;
}
