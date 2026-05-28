import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadBudget, scan } from "./check-debt-markers.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

function makeFixture(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "check-debt-markers-"));
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

function writeBudget(
	path: string,
	trackerPatterns: string[],
	allowlist: string[] = [],
): void {
	writeFileSync(path, JSON.stringify({ trackerPatterns, allowlist }));
}

const DEFAULT_PATTERNS = ["\\b(?:mulch|mx)-[0-9a-f]+\\b", "#\\d+\\b", "https?://\\S+"];

describe("loadBudget", () => {
	test("parses tracker patterns into RegExp instances", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "b.json");
			writeBudget(p, DEFAULT_PATTERNS);
			const { trackerRegexes } = loadBudget(p);
			expect(trackerRegexes).toHaveLength(3);
			expect(trackerRegexes[0]?.test("// TODO(mulch-abc1): later")).toBe(true);
			expect(trackerRegexes[1]?.test("// TODO #42")).toBe(true);
			expect(trackerRegexes[2]?.test("// TODO https://x.example/")).toBe(true);
		} finally {
			cleanup();
		}
	});

	test("rejects non-array trackerPatterns", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "b.json");
			writeFileSync(p, JSON.stringify({ trackerPatterns: "nope", allowlist: [] }));
			expect(() => loadBudget(p)).toThrow(/trackerPatterns/);
		} finally {
			cleanup();
		}
	});

	test("rejects malformed allowlist entry", () => {
		const { root, cleanup } = makeFixture();
		try {
			const p = join(root, "b.json");
			writeFileSync(
				p,
				JSON.stringify({ trackerPatterns: DEFAULT_PATTERNS, allowlist: ["bad-no-colon"] }),
			);
			expect(() => loadBudget(p)).toThrow(/path:line/);
		} finally {
			cleanup();
		}
	});
});

describe("scan — synthetic pass", () => {
	test("returns no untracked markers when every marker has a tracker", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "// TODO(mulch-7f2b): later\nexport const a = 1;\n",
				"src/b.ts": "// FIXME #123 wire this up\nexport const b = 2;\n",
				"src/c.ts": "// HACK https://example.com/x — temporary\nexport const c = 3;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS);
			const result = scan({
				repoRoot: root,
				budgetPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
				selfExclude: new Set(),
			});
			expect(result.untracked).toEqual([]);
			expect(result.staleAllowlistEntries).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("placeholder strings like mulch-XXXX are not flagged as markers", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts":
					"// example placeholder: mulch-XXXX or mx-XXXX (no real marker)\nexport const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS);
			const result = scan({
				repoRoot: root,
				budgetPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
				selfExclude: new Set(),
			});
			expect(result.untracked).toEqual([]);
		} finally {
			cleanup();
		}
	});
});

describe("scan — synthetic violation", () => {
	test("flags a bare TODO with no tracker reference", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "// TODO: revisit later\nexport const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS);
			const result = scan({
				repoRoot: root,
				budgetPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
				selfExclude: new Set(),
			});
			expect(result.untracked).toHaveLength(1);
			expect(result.untracked[0]?.path).toBe("src/a.ts");
			expect(result.untracked[0]?.line).toBe(1);
			expect(result.untracked[0]?.marker).toBe("TODO");
		} finally {
			cleanup();
		}
	});

	test("flags FIXME and HACK alongside TODO", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "// FIXME later\n// HACK so it works\nexport const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS);
			const result = scan({
				repoRoot: root,
				budgetPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
				selfExclude: new Set(),
			});
			expect(result.untracked.map((m) => m.marker).sort()).toEqual(["FIXME", "HACK"]);
		} finally {
			cleanup();
		}
	});

	test("allowlist silences a known untracked marker", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "// TODO: revisit later\nexport const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS, ["src/a.ts:1"]);
			const result = scan({
				repoRoot: root,
				budgetPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
				selfExclude: new Set(),
			});
			expect(result.untracked).toEqual([]);
			expect(result.allowedSilenced).toHaveLength(1);
			expect(result.staleAllowlistEntries).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("stale allowlist entries are reported", () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "export const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS, ["src/a.ts:1"]);
			const result = scan({
				repoRoot: root,
				budgetPath,
				scanRoots: ["src"],
				excludePathPrefixes: [],
				selfExclude: new Set(),
			});
			expect(result.staleAllowlistEntries).toEqual(["src/a.ts:1"]);
		} finally {
			cleanup();
		}
	});
});

describe("CLI integration", () => {
	test("CLI exits 0 when every marker carries a tracker", async () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "// TODO(mulch-7f2b): later\nexport const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS);
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-debt-markers.ts"),
					"--repo-root",
					root,
					"--budget",
					budgetPath,
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

	test("CLI exits 1 on a bare-TODO tree", async () => {
		const { root, cleanup } = makeFixture();
		try {
			writeFileTree(root, {
				"src/a.ts": "// TODO: revisit later\nexport const a = 1;\n",
			});
			const budgetPath = join(root, "budget.json");
			writeBudget(budgetPath, DEFAULT_PATTERNS);
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-debt-markers.ts"),
					"--repo-root",
					root,
					"--budget",
					budgetPath,
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
	test("scripts/debt-markers-budget.json is well-formed", () => {
		const raw = JSON.parse(
			readFileSync(resolve(REPO_ROOT, "scripts/debt-markers-budget.json"), "utf8"),
		) as { trackerPatterns: unknown; allowlist: unknown };
		expect(Array.isArray(raw.trackerPatterns)).toBe(true);
		expect(Array.isArray(raw.allowlist)).toBe(true);
		for (const p of raw.trackerPatterns as unknown[]) {
			expect(typeof p).toBe("string");
			expect(() => new RegExp(p as string, "i")).not.toThrow();
		}
	});
});
