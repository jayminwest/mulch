import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { countLines, loadBudgets, scan } from "./check-file-sizes.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

function makeFixture(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "check-file-sizes-"));
	const cleanup = () => rmSync(root, { recursive: true, force: true });
	return { root, cleanup };
}

function writeFileTree(root: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
}

function writeBudget(path: string, threshold: number, budgets: Record<string, number> = {}): void {
	writeFileSync(path, JSON.stringify({ threshold, budgets }));
}

describe("loadBudgets", () => {
	test("parses a valid budget JSON", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "b.json");
			writeBudget(p, 500, { "src/foo.ts": 700 });
			const parsed = loadBudgets(p);
			expect(parsed.threshold).toBe(500);
			expect(parsed.budgets["src/foo.ts"]).toBe(700);
		} finally {
			cleanup();
		}
	});

	test("rejects non-positive threshold", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "b.json");
			writeFileSync(p, JSON.stringify({ threshold: 0, budgets: {} }));
			expect(() => loadBudgets(p)).toThrow(/threshold/);
		} finally {
			cleanup();
		}
	});

	test("rejects non-numeric entry", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "b.json");
			writeFileSync(p, JSON.stringify({ threshold: 500, budgets: { "src/a.ts": "200" } }));
			expect(() => loadBudgets(p)).toThrow(/positive number/);
		} finally {
			cleanup();
		}
	});
});

describe("scan — synthetic pass", () => {
	test("returns no failures when every file is under threshold", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": `${"line\n".repeat(50)}`,
				"src/sub/b.ts": `${"line\n".repeat(120)}`,
				"scripts/x.ts": `${"line\n".repeat(80)}`,
			});
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500);
			const result = scan({
				repoRoot: root,
				budgetsPath,
				scanRoots: ["src", "scripts"],
				excludePathPrefixes: [],
			});
			expect(result.failures).toEqual([]);
			expect(result.staleBudgetEntries).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("file with explicit budget passes when within budget", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/big.ts": `${"line\n".repeat(700)}`,
			});
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500, { "src/big.ts": 750 });
			const result = scan({
				repoRoot: root,
				budgetsPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
			});
			expect(result.failures).toEqual([]);
		} finally {
			cleanup();
		}
	});
});

describe("scan — synthetic violation", () => {
	test("flags a file that exceeds the threshold", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/huge.ts": `${"line\n".repeat(800)}`,
			});
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500);
			const result = scan({
				repoRoot: root,
				budgetsPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
			});
			expect(result.failures.length).toBe(1);
			expect(result.failures[0]?.path).toBe("src/huge.ts");
			expect(result.failures[0]?.lines).toBe(800);
			expect(result.failures[0]?.budget).toBe(500);
		} finally {
			cleanup();
		}
	});

	test("flags a file that exceeds its frozen budget", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/grandfathered.ts": `${"line\n".repeat(900)}`,
			});
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500, { "src/grandfathered.ts": 800 });
			const result = scan({
				repoRoot: root,
				budgetsPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
			});
			expect(result.failures.length).toBe(1);
			expect(result.failures[0]?.budget).toBe(800);
			expect(result.failures[0]?.lines).toBe(900);
		} finally {
			cleanup();
		}
	});

	test("reports stale budget entries that no longer match a file", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/keep.ts": "x\n",
			});
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500, { "src/gone.ts": 700 });
			const result = scan({
				repoRoot: root,
				budgetsPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
			});
			expect(result.failures).toEqual([]);
			expect(result.staleBudgetEntries).toEqual(["src/gone.ts"]);
		} finally {
			cleanup();
		}
	});
});

describe("CLI integration", () => {
	test("CLI exits 0 on a synthetic-pass tree", async () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, { "src/a.ts": `${"line\n".repeat(100)}` });
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500);
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-file-sizes.ts"),
					"--repo-root",
					root,
					"--budget",
					budgetsPath,
					"--root",
					"src",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);
		} finally {
			cleanup();
		}
	});

	test("CLI exits 1 on a synthetic-violation tree", async () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, { "src/huge.ts": `${"line\n".repeat(800)}` });
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 500);
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-file-sizes.ts"),
					"--repo-root",
					root,
					"--budget",
					budgetsPath,
					"--root",
					"src",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(1);
		} finally {
			cleanup();
		}
	});
});

describe("countLines", () => {
	test("returns 0 for an empty file", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "empty.ts");
			writeFileSync(p, "");
			expect(countLines(p)).toBe(0);
		} finally {
			cleanup();
		}
	});

	test("counts logical lines for a file ending with a trailing newline", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "trailing.ts");
			writeFileSync(p, "line1\nline2\n");
			expect(countLines(p)).toBe(2);
		} finally {
			cleanup();
		}
	});

	test("counts logical lines for a file lacking a trailing newline (newlineCount + 1)", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "no-trailing.ts");
			writeFileSync(p, "line1\nline2");
			expect(countLines(p)).toBe(2);
		} finally {
			cleanup();
		}
	});

	test("counts a single-line file with no newline as 1", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "single.ts");
			writeFileSync(p, "just one line");
			expect(countLines(p)).toBe(1);
		} finally {
			cleanup();
		}
	});
});

describe("scan — trailing newline correctness", () => {
	test("flags a 2-line file without trailing newline against threshold=1", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/two-lines-no-trailing.ts": "line1\nline2",
			});
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 1);
			const result = scan({
				repoRoot: root,
				budgetsPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
			});
			expect(result.failures.length).toBe(1);
			expect(result.failures[0]?.path).toBe("src/two-lines-no-trailing.ts");
			expect(result.failures[0]?.lines).toBe(2);
			expect(result.failures[0]?.budget).toBe(1);
		} finally {
			cleanup();
		}
	});
});

describe("CLI integration — trailing newline bypass", () => {
	test("CLI exits 1 on a 2-line no-trailing-newline file against threshold=1", async () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, { "src/bypass.ts": "line1\nline2" });
			const budgetsPath = join(root, "budget.json");
			writeBudget(budgetsPath, 1);
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-file-sizes.ts"),
					"--repo-root",
					root,
					"--budget",
					budgetsPath,
					"--root",
					"src",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(1);
		} finally {
			cleanup();
		}
	});
});

describe("repo budget JSON", () => {
	test("scripts/file-size-budgets.json is well-formed", () => {
		const raw = JSON.parse(
			readFileSync(resolve(REPO_ROOT, "scripts/file-size-budgets.json"), "utf8"),
		) as { threshold: unknown; budgets: unknown };
		expect(typeof raw.threshold).toBe("number");
		expect(raw.threshold).toBeGreaterThan(0);
		expect(typeof raw.budgets).toBe("object");
		expect(raw.budgets).not.toBeNull();
	});
});
