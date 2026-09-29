import { execFileSync } from "node:child_process";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { computeAnchorValidity, getRecordAnchors } from "./anchor-validity.ts";
import { fileLivesUnderDir } from "./dir-anchors.ts";
import { isRecordStale } from "./expertise.ts";
import { computeConfirmationScore } from "./scoring.ts";

// Git-based staleness (mulch-094a). A record is "stale?" when the code it
// describes has moved on: its anchored files changed in several commits
// since its evidence commit, some anchors no longer exist, or it is a non-foundational record
// past its shelf life that nobody ever confirmed. Advisory only — `ml prime`
// demotes and marks stale records, `ml stale` lists them; nothing is deleted.

/**
 * Commits touching a record's anchors since its evidence commit that count as
 * "changed substantially". Commit counts (not line counts) keep the git call
 * to a tree diff, which is what keeps the prime hook path fast.
 */
export const STALE_CHURN_COMMITS = 5;

const DAY_MS = 86_400_000;

export type StaleKind = "anchors_changed" | "anchors_missing" | "shelf_life";

export interface StaleReason {
	kind: StaleKind;
	detail: string;
}

export interface StalenessOptions {
	cwd: string;
	now: Date;
	shelfLife: { tactical: number; observational: number };
}

const SHA_LINE = /^[0-9a-f]{40}$/;

/**
 * Two batched git calls cover every record: one lists commit order since the
 * oldest record, one lists the files each commit touched within the union of
 * all anchors. Returns null when git is unavailable (not a repo, no history).
 */
function readHistory(
	cwd: string,
	since: string,
	paths: string[],
): { order: string[]; changes: Map<string, string[]> } | null {
	const git = (args: string[]): string =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			maxBuffer: 64 * 1024 * 1024,
		});
	try {
		const order = git(["log", "--format=%H", `--since=${since}`])
			.split("\n")
			.filter(Boolean);
		const out = git([
			"log",
			"--no-renames",
			"--relative",
			"--name-only",
			"--format=%H",
			`--since=${since}`,
			"--",
			...paths,
		]);
		const changes = new Map<string, string[]>();
		let current: string[] = [];
		for (const line of out.split("\n")) {
			if (!line) continue;
			if (SHA_LINE.test(line)) {
				current = [];
				changes.set(line, current);
			} else {
				current.push(line);
			}
		}
		return { order, changes };
	} catch {
		return null;
	}
}

function anchorMatches(anchor: { kind: string; path: string }, changed: string): boolean {
	const path = anchor.path.replace(/^\.\//, "");
	return anchor.kind === "dir" ? fileLivesUnderDir(changed, path) : changed === path;
}

/** Filesystem + shelf-life reasons: no git needed. */
function localReasons(r: ExpertiseRecord, opts: StalenessOptions): StaleReason[] {
	const reasons: StaleReason[] = [];
	const { broken } = computeAnchorValidity(r, opts.cwd);
	if (broken.length > 0) {
		reasons.push({
			kind: "anchors_missing",
			detail: `missing anchors: ${broken.map((b) => b.path).join(", ")}`,
		});
	}
	if (isRecordStale(r, opts.now, opts.shelfLife) && computeConfirmationScore(r) === 0) {
		const ageDays = Math.floor((opts.now.getTime() - new Date(r.recorded_at).getTime()) / DAY_MS);
		reasons.push({
			kind: "shelf_life",
			detail: `${r.classification}, ${ageDays}d old, never confirmed`,
		});
	}
	return reasons;
}

/** Commits newer than the record's evidence commit that touched its anchors. */
function churnReason(
	r: ExpertiseRecord,
	history: NonNullable<ReturnType<typeof readHistory>>,
): StaleReason | null {
	const sha = r.evidence?.commit ?? "";
	const idx = history.order.findIndex((h) => h.startsWith(sha));
	if (idx < 0) return null; // unknown or pre-window commit: no signal
	const anchors = getRecordAnchors(r);
	const touched = new Set<string>();
	let commits = 0;
	for (const commit of history.order.slice(0, idx)) {
		const hits = (history.changes.get(commit) ?? []).filter((f) =>
			anchors.some((a) => anchorMatches(a, f)),
		);
		if (hits.length === 0) continue;
		commits++;
		for (const f of hits) touched.add(f);
	}
	if (commits < STALE_CHURN_COMMITS) return null;
	const [first] = touched;
	const more = touched.size > 1 ? ` (+${touched.size - 1} more)` : "";
	return {
		kind: "anchors_changed",
		detail: `${first}${more} changed in ${commits} commits since ${sha.slice(0, 7)}`,
	};
}

/**
 * History bounded at the oldest candidate (minus a day for clock skew) so
 * large repos don't walk their full log on every prime.
 */
function readCandidateHistory(candidates: ExpertiseRecord[], opts: StalenessOptions) {
	let oldest = opts.now.getTime();
	const paths = new Set<string>();
	for (const r of candidates) {
		const t = new Date(r.recorded_at).getTime();
		if (!Number.isNaN(t) && t < oldest) oldest = t;
		for (const a of getRecordAnchors(r)) paths.add(a.path);
	}
	return readHistory(opts.cwd, new Date(oldest - DAY_MS).toISOString(), [...paths]);
}

/**
 * Flag stale records, keyed by record id (records without an id are skipped).
 * Git failures degrade silently to the filesystem + shelf-life checks.
 */
export function findStaleRecords(
	records: ExpertiseRecord[],
	opts: StalenessOptions,
): Map<string, StaleReason[]> {
	const result = new Map<string, StaleReason[]>();
	const gitCandidates: ExpertiseRecord[] = [];
	for (const r of records) {
		if (!r.id) continue;
		const reasons = localReasons(r, opts);
		if (reasons.length > 0) result.set(r.id, reasons);
		// Churn only means something while the anchors still exist.
		const anchorsIntact = !reasons.some((x) => x.kind === "anchors_missing");
		if (r.evidence?.commit && anchorsIntact && getRecordAnchors(r).length > 0) {
			gitCandidates.push(r);
		}
	}
	if (gitCandidates.length === 0) return result;

	const history = readCandidateHistory(gitCandidates, opts);
	if (!history) return result;

	for (const r of gitCandidates) {
		const reason = churnReason(r, history);
		if (reason && r.id) result.set(r.id, [...(result.get(r.id) ?? []), reason]);
	}
	return result;
}

/**
 * Reasons `ml prime` (and the Claude hook) act on: git/anchor evidence only.
 * `shelf_life` (old + never confirmed) flagged most real corpora wholesale, so
 * it is reported by `ml stale` but never demotes or marks a primed record.
 */
const PRIME_STALE_KINDS: ReadonlySet<StaleKind> = new Set(["anchors_changed", "anchors_missing"]);

/** Ids whose staleness rests on anchor evidence (see PRIME_STALE_KINDS). */
export function primeStaleIds(stale: Map<string, StaleReason[]>): Set<string> {
	const ids = new Set<string>();
	for (const [id, reasons] of stale) {
		if (reasons.some((r) => PRIME_STALE_KINDS.has(r.kind))) ids.add(id);
	}
	return ids;
}
