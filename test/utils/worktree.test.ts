import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getMulchDir, initMulchDir, isInsideWorktree, readConfig } from "../../src/utils/config.ts";

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

describe("worktree resolution", () => {
	let tmpDir: string;
	let mainRepo: string;
	let worktreeDir: string;

	beforeEach(async () => {
		tmpDir = await realpath(await mkdtemp(join(tmpdir(), "mulch-wt-test-")));
		mainRepo = join(tmpDir, "main");
		worktreeDir = join(tmpDir, "worktree");

		// Create a git repo with a commit
		await mkdir(mainRepo, { recursive: true });
		git(["init"], mainRepo);
		git(["config", "user.email", "test@test.com"], mainRepo);
		git(["config", "user.name", "Test"], mainRepo);
		await writeFile(join(mainRepo, "dummy.txt"), "hello");
		git(["add", "."], mainRepo);
		git(["commit", "-m", "init"], mainRepo);

		// Initialize mulch in main repo
		await initMulchDir(mainRepo);
		git(["add", "."], mainRepo);
		git(["commit", "-m", "add mulch"], mainRepo);

		// Create a worktree
		git(["worktree", "add", worktreeDir, "-b", "test-branch"], mainRepo);
	});

	afterEach(async () => {
		// Remove worktree before cleaning up
		try {
			git(["worktree", "remove", "--force", worktreeDir], mainRepo);
		} catch {
			// Already removed
		}
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("isInsideWorktree", () => {
		it("returns false for main repo", () => {
			expect(isInsideWorktree(mainRepo)).toBe(false);
		});

		it("returns true for worktree", () => {
			expect(isInsideWorktree(worktreeDir)).toBe(true);
		});

		it("returns false for non-git directory", () => {
			expect(isInsideWorktree(tmpDir)).toBe(false);
		});
	});

	describe("getMulchDir", () => {
		it("returns main repo .mulch/ when called from worktree", () => {
			const mulchDir = getMulchDir(worktreeDir);
			expect(mulchDir).toBe(join(mainRepo, ".mulch"));
		});

		it("returns main repo .mulch/ when called from main repo", () => {
			const mulchDir = getMulchDir(mainRepo);
			expect(mulchDir).toBe(join(mainRepo, ".mulch"));
		});

		it("returns local .mulch/ for non-git directory", () => {
			const mulchDir = getMulchDir(tmpDir);
			expect(mulchDir).toBe(join(tmpDir, ".mulch"));
		});
	});

	describe("readConfig from worktree", () => {
		it("reads main repo config when called from worktree", async () => {
			const config = await readConfig(worktreeDir);
			expect(config.version).toBe(DEFAULT_CONFIG.version);
		});
	});

	describe("worktree without main .mulch/", () => {
		let bareRepo: string;
		let bareWorktree: string;

		beforeEach(async () => {
			bareRepo = join(tmpDir, "bare-main");
			bareWorktree = join(tmpDir, "bare-wt");

			await mkdir(bareRepo, { recursive: true });
			git(["init"], bareRepo);
			git(["config", "user.email", "test@test.com"], bareRepo);
			git(["config", "user.name", "Test"], bareRepo);
			await writeFile(join(bareRepo, "dummy.txt"), "hello");
			git(["add", "."], bareRepo);
			git(["commit", "-m", "init"], bareRepo);

			// No mulch init — main repo has no .mulch/
			git(["worktree", "add", bareWorktree, "-b", "bare-branch"], bareRepo);
		});

		afterEach(async () => {
			try {
				git(["worktree", "remove", "--force", bareWorktree], bareRepo);
			} catch {
				// Already removed
			}
		});

		it("falls back to worktree-local path when main has no .mulch/", () => {
			const mulchDir = getMulchDir(bareWorktree);
			expect(mulchDir).toBe(join(bareWorktree, ".mulch"));
		});
	});
});
