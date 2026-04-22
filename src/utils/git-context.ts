import { execFileSync } from "node:child_process";

export function getCurrentCommit(cwd?: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: cwd ?? process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return undefined;
	}
}

export function getContextFiles(cwd?: string): string[] {
	const dir = cwd ?? process.cwd();
	const files = new Set<string>();

	try {
		const staged = execFileSync("git", ["diff", "--name-only", "--cached"], {
			cwd: dir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (staged) {
			for (const f of staged.split("\n")) {
				if (f) files.add(f);
			}
		}
	} catch {
		// not a git repo or no staged changes
	}

	try {
		const unstaged = execFileSync("git", ["diff", "--name-only"], {
			cwd: dir,
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
