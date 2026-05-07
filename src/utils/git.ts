import { execFileSync } from "node:child_process";
import type { ExpertiseRecord } from "../schemas/record.ts";
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
