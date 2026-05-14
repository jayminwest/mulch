import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
	type ActiveContext,
	activeContextHasSignal,
	filterByActiveContext,
	getActiveFiles,
} from "../../src/utils/git.ts";

function initGitRepo(dir: string): void {
	execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
}

describe("git utils — slice 2 helpers", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-git-utils-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("getActiveFiles", () => {
		it("returns empty outside a git repo", () => {
			expect(getActiveFiles(tmpDir)).toEqual([]);
		});

		it("returns staged additions", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "a.txt"), "a");
			execSync("git add a.txt", { cwd: tmpDir, stdio: "pipe" });
			expect(getActiveFiles(tmpDir)).toEqual(["a.txt"]);
		});

		it("returns untracked files", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "untracked.txt"), "x");
			expect(getActiveFiles(tmpDir)).toEqual(["untracked.txt"]);
		});

		it("returns unstaged modifications after commit", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "file.txt"), "original");
			execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
			execSync("git commit -q -m initial", { cwd: tmpDir, stdio: "pipe" });
			await writeFile(join(tmpDir, "file.txt"), "modified");
			expect(getActiveFiles(tmpDir)).toContain("file.txt");
		});

		it("returns rename destination only", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "old.txt"), "x");
			execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
			execSync("git commit -q -m initial", { cwd: tmpDir, stdio: "pipe" });
			execSync("git mv old.txt new.txt", { cwd: tmpDir, stdio: "pipe" });
			const files = getActiveFiles(tmpDir);
			expect(files).toContain("new.txt");
			expect(files).not.toContain("old.txt");
		});

		it("returns nested paths verbatim", async () => {
			initGitRepo(tmpDir);
			await mkdir(join(tmpDir, "src", "commands"), { recursive: true });
			await writeFile(join(tmpDir, "src", "commands", "prime.ts"), "// stub");
			expect(getActiveFiles(tmpDir)).toEqual(["src/commands/prime.ts"]);
		});

		it("returns a sorted list", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "b.txt"), "b");
			await writeFile(join(tmpDir, "a.txt"), "a");
			const out = getActiveFiles(tmpDir);
			expect(out).toEqual([...out].sort());
		});
	});

	describe("activeContextHasSignal", () => {
		it("returns false when both files and trackers are empty", () => {
			expect(activeContextHasSignal({ changedFiles: [], trackers: {} })).toBe(false);
		});

		it("returns true when files are present", () => {
			expect(activeContextHasSignal({ changedFiles: ["a"], trackers: {} })).toBe(true);
		});

		it("returns true when any tracker is set", () => {
			expect(activeContextHasSignal({ changedFiles: [], trackers: { seeds: "mulch-1234" } })).toBe(
				true,
			);
		});

		it("treats empty-string tracker values as no signal", () => {
			expect(activeContextHasSignal({ changedFiles: [], trackers: { seeds: "" } })).toBe(false);
		});
	});

	describe("filterByActiveContext", () => {
		const universal: ExpertiseRecord = {
			type: "convention",
			content: "Always lint",
			classification: "foundational",
			recorded_at: "2026-05-13T00:00:00Z",
		};
		const fileAnchored: ExpertiseRecord = {
			type: "pattern",
			name: "cli-entry",
			description: "CLI entry",
			files: ["src/cli.ts"],
			classification: "foundational",
			recorded_at: "2026-05-13T00:00:00Z",
		};
		const dirAnchored: ExpertiseRecord = {
			type: "pattern",
			name: "schema-area",
			description: "Schema area pattern",
			classification: "foundational",
			recorded_at: "2026-05-13T00:00:00Z",
			dir_anchors: ["src/schemas"],
		};
		const seedAnchored: ExpertiseRecord = {
			type: "pattern",
			name: "tracked-by-seed",
			description: "Tracked by mulch-244c",
			files: ["totally/different/path.ts"],
			classification: "foundational",
			recorded_at: "2026-05-13T00:00:00Z",
			evidence: { seeds: "mulch-244c" },
		};

		it("keeps universal records regardless of context", () => {
			const ctx: ActiveContext = { changedFiles: [], trackers: {} };
			expect(filterByActiveContext([universal], ctx)).toEqual([universal]);
		});

		it("matches by file anchor", () => {
			const ctx: ActiveContext = { changedFiles: ["src/cli.ts"], trackers: {} };
			const kept = filterByActiveContext([fileAnchored, dirAnchored], ctx);
			expect(kept.map((r) => "name" in r && r.name)).toEqual(["cli-entry"]);
		});

		it("matches by dir anchor", () => {
			const ctx: ActiveContext = {
				changedFiles: ["src/schemas/record.ts"],
				trackers: {},
			};
			const kept = filterByActiveContext([fileAnchored, dirAnchored], ctx);
			expect(kept.map((r) => "name" in r && r.name)).toEqual(["schema-area"]);
		});

		it("matches by seeds evidence tracker even when files don't match", () => {
			const ctx: ActiveContext = {
				changedFiles: ["src/cli.ts"],
				trackers: { seeds: "mulch-244c" },
			};
			const kept = filterByActiveContext([seedAnchored], ctx);
			expect(kept).toHaveLength(1);
		});

		it("does not match when tracker id differs", () => {
			const ctx: ActiveContext = {
				changedFiles: [],
				trackers: { seeds: "mulch-0000" },
			};
			expect(filterByActiveContext([seedAnchored], ctx)).toHaveLength(0);
		});

		it("matches gh/linear/bead tracker evidence symmetrically", () => {
			const ghRecord: ExpertiseRecord = {
				type: "pattern",
				name: "gh-tracked",
				description: "tracked by gh #42",
				files: ["other/path.ts"],
				classification: "foundational",
				recorded_at: "2026-05-13T00:00:00Z",
				evidence: { gh: "#42" },
			};
			const linearRecord: ExpertiseRecord = {
				type: "pattern",
				name: "linear-tracked",
				description: "tracked by WEB-100",
				files: ["other/path.ts"],
				classification: "foundational",
				recorded_at: "2026-05-13T00:00:00Z",
				evidence: { linear: "WEB-100" },
			};
			const beadRecord: ExpertiseRecord = {
				type: "pattern",
				name: "bead-tracked",
				description: "tracked by bd-7",
				files: ["other/path.ts"],
				classification: "foundational",
				recorded_at: "2026-05-13T00:00:00Z",
				evidence: { bead: "bd-7" },
			};
			const ctx: ActiveContext = {
				changedFiles: [],
				trackers: { gh: "#42", linear: "WEB-100", bead: "bd-7" },
			};
			const kept = filterByActiveContext([ghRecord, linearRecord, beadRecord], ctx);
			expect(kept).toHaveLength(3);
		});

		it("drops anchored records when no signals match", () => {
			const ctx: ActiveContext = { changedFiles: ["src/unrelated.ts"], trackers: {} };
			expect(filterByActiveContext([fileAnchored], ctx)).toHaveLength(0);
		});
	});
});
