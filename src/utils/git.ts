import { execFileSync } from "node:child_process";
import type { ExpertiseRecord } from "../schemas/record.ts";
import type { TrackerName } from "./active-work.ts";
import { fileLivesUnderDir } from "./dir-anchors.ts";

export function isGitRepo(cwd: string): boolean {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

export function getChangedFiles(cwd: string, since: string): string[] {
	const files = new Set<string>();

	// Committed changes (since ref)
	try {
		const committed = execFileSync("git", ["diff", "--name-only", since], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (committed) {
			for (const f of committed.split("\n")) {
				if (f) files.add(f);
			}
		}
	} catch {
		// ref might not exist (e.g., first commit) — fall through
	}

	// Staged but uncommitted changes
	try {
		const staged = execFileSync("git", ["diff", "--name-only", "--cached"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (staged) {
			for (const f of staged.split("\n")) {
				if (f) files.add(f);
			}
		}
	} catch {
		// ignore
	}

	// Unstaged working tree changes
	try {
		const unstaged = execFileSync("git", ["diff", "--name-only"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (unstaged) {
			for (const f of unstaged.split("\n")) {
				if (f) files.add(f);
			}
		}
	} catch {
		// ignore
	}

	return [...files].sort();
}

// Files reported by `git status --porcelain` — staged, unstaged, and untracked
// (excluding ignored). Includes rename destinations rather than sources. Used
// by prime's auto-context-scope (slice 2) which mirrors V1_PLAN's "what the
// agent is about to work on" framing rather than `git diff HEAD~1`'s "what
// recently shipped."
export function getActiveFiles(cwd: string): string[] {
	const files = new Set<string>();
	try {
		// `-uall` lists every untracked file individually instead of collapsing
		// directories to a single `??` entry — the prime context-scope needs
		// per-file granularity to match record `files`/`dir_anchors`.
		const out = execFileSync("git", ["status", "--porcelain", "-uall"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		for (const raw of out.split("\n")) {
			if (!raw) continue;
			// Porcelain v1 lines are `XY <path>` where XY is two status chars.
			// Renames are `R  old -> new`; we keep the destination only.
			const path = raw.slice(3);
			const arrow = path.indexOf(" -> ");
			if (arrow >= 0) {
				files.add(path.slice(arrow + 4));
			} else if (path) {
				files.add(path);
			}
		}
	} catch {
		// not a repo, git missing, or status failed — caller treats empty as
		// "no signal" and falls back to unscoped output.
	}
	return [...files].sort();
}

export function fileMatchesAny(file: string, changedFiles: string[]): boolean {
	return changedFiles.some(
		(changed) => changed === file || changed.endsWith(file) || file.endsWith(changed),
	);
}

export function filterByContext(
	records: ExpertiseRecord[],
	changedFiles: string[],
): ExpertiseRecord[] {
	return records.filter((r) => {
		const hasFiles = "files" in r && Array.isArray(r.files) && r.files.length > 0;
		const hasDirAnchors = Array.isArray(r.dir_anchors) && r.dir_anchors.length > 0;

		// No anchors at all → always relevant (conventions, decisions, failures,
		// guides; or named records with no scoping declared).
		if (!hasFiles && !hasDirAnchors) return true;

		if (hasFiles && r.files !== undefined && r.files.some((f) => fileMatchesAny(f, changedFiles))) {
			return true;
		}
		if (hasDirAnchors && r.dir_anchors !== undefined) {
			for (const dir of r.dir_anchors) {
				if (changedFiles.some((cf) => fileLivesUnderDir(cf, dir))) return true;
			}
		}
		return false;
	});
}

export type ActiveTrackers = Partial<Record<TrackerName, string>>;

export interface ActiveContext {
	changedFiles: string[];
	trackers: ActiveTrackers;
}

export function activeContextHasSignal(ctx: ActiveContext): boolean {
	if (ctx.changedFiles.length > 0) return true;
	for (const v of Object.values(ctx.trackers)) {
		if (typeof v === "string" && v !== "") return true;
	}
	return false;
}

// Slice-2 auto-scope: union of filterByContext + evidence-tracker match. A
// record with no file/dir anchors AND no tracker anchors is treated as
// universal (applies everywhere); anchored records require a match on at
// least one signal.
export function filterByActiveContext(
	records: ExpertiseRecord[],
	ctx: ActiveContext,
): ExpertiseRecord[] {
	const { changedFiles, trackers } = ctx;
	return records.filter((r) => {
		const hasFiles = "files" in r && Array.isArray(r.files) && r.files.length > 0;
		const hasDirAnchors = Array.isArray(r.dir_anchors) && r.dir_anchors.length > 0;
		const ev = r.evidence;
		const seedsMatch = !!(ev?.seeds && trackers.seeds && ev.seeds === trackers.seeds);
		const ghMatch = !!(ev?.gh && trackers.gh && ev.gh === trackers.gh);
		const linearMatch = !!(ev?.linear && trackers.linear && ev.linear === trackers.linear);
		const beadMatch = !!(ev?.bead && trackers.bead && ev.bead === trackers.bead);
		if (seedsMatch || ghMatch || linearMatch || beadMatch) return true;

		if (!hasFiles && !hasDirAnchors) return true;

		if (hasFiles && r.files !== undefined && r.files.some((f) => fileMatchesAny(f, changedFiles))) {
			return true;
		}
		if (hasDirAnchors && r.dir_anchors !== undefined) {
			for (const dir of r.dir_anchors) {
				if (changedFiles.some((cf) => fileLivesUnderDir(cf, dir))) return true;
			}
		}
		return false;
	});
}
