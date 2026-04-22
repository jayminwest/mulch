import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContextFiles, getCurrentCommit } from "../../src/utils/git-context.ts";

function initGitRepo(dir: string): void {
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
}

describe("git-context", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-git-ctx-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("getCurrentCommit", () => {
		it("returns undefined outside a git repo", () => {
			const result = getCurrentCommit(tmpDir);
			expect(result).toBeUndefined();
		});

		it("returns a commit SHA in a git repo with at least one commit", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "file.txt"), "hello");
			execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: tmpDir, stdio: "pipe" });

			const result = getCurrentCommit(tmpDir);
			expect(result).toBeTruthy();
			expect(result).toMatch(/^[0-9a-f]{40}$/);
		});

		it("returns undefined when repo has no commits", () => {
			initGitRepo(tmpDir);
			const result = getCurrentCommit(tmpDir);
			expect(result).toBeUndefined();
		});
	});

	describe("getContextFiles", () => {
		it("returns empty array outside a git repo", () => {
			const result = getContextFiles(tmpDir);
			expect(result).toEqual([]);
		});

		it("returns empty array when no changes exist", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "file.txt"), "hello");
			execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: tmpDir, stdio: "pipe" });

			const result = getContextFiles(tmpDir);
			expect(result).toEqual([]);
		});

		it("includes staged files", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "file.txt"), "hello");
			execSync("git add file.txt", { cwd: tmpDir, stdio: "pipe" });

			const result = getContextFiles(tmpDir);
			expect(result).toContain("file.txt");
		});

		it("includes unstaged modified files after initial commit", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "file.txt"), "hello");
			execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: tmpDir, stdio: "pipe" });
			await writeFile(join(tmpDir, "file.txt"), "modified");

			const result = getContextFiles(tmpDir);
			expect(result).toContain("file.txt");
		});

		it("returns sorted list", async () => {
			initGitRepo(tmpDir);
			await writeFile(join(tmpDir, "b.txt"), "b");
			await writeFile(join(tmpDir, "a.txt"), "a");
			execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

			const result = getContextFiles(tmpDir);
			expect(result).toEqual([...result].sort());
		});
	});
});
