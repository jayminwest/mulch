import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type CoverageBudgets,
	type CoverageTotals,
	type PackageRow,
	checkBudgets,
	loadBudgets,
	parseAllFilesRow,
	parseFileRows,
} from "./check-coverage.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

function makeTmpFile(contents: string): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "check-coverage-"));
	const path = join(dir, "f");
	writeFileSync(path, contents);
	return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const COVERAGE_TABLE_PASS = [
	"--------------------------------------|---------|---------|-------------------",
	"File                                  | % Funcs | % Lines | Uncovered Line #s",
	"--------------------------------------|---------|---------|-------------------",
	" src/a.ts                             |   90.00 |   95.00 |",
	" src/b.ts                             |  100.00 |  100.00 |",
	" All files                            |   95.00 |   97.50 |",
	"--------------------------------------|---------|---------|-------------------",
].join("\n");

const COVERAGE_TABLE_FAIL = [
	"--------------------------------------|---------|---------|-------------------",
	"File                                  | % Funcs | % Lines | Uncovered Line #s",
	"--------------------------------------|---------|---------|-------------------",
	" src/a.ts                             |   40.00 |   50.00 |",
	" All files                            |   40.00 |   50.00 |",
	"--------------------------------------|---------|---------|-------------------",
].join("\n");

describe("loadBudgets", () => {
	test("parses valid percentages with no packages map", () => {
		const b = loadBudgets(JSON.stringify({ functions: 85.5, lines: 90.25 }));
		expect(b.functions).toBe(85.5);
		expect(b.lines).toBe(90.25);
		expect(b.packages).toEqual({});
	});

	test("parses per-package floors", () => {
		const b = loadBudgets(
			JSON.stringify({
				functions: 80,
				lines: 85,
				packages: { "src/core/": { functions: 95, lines: 98 } },
			}),
		);
		expect(b.packages["src/core/"]).toEqual({ functions: 95, lines: 98 });
	});

	test("rejects out-of-range functions floor", () => {
		expect(() => loadBudgets(JSON.stringify({ functions: 120, lines: 90 }))).toThrow(/functions/);
	});

	test("rejects non-numeric lines floor", () => {
		expect(() => loadBudgets(JSON.stringify({ functions: 85, lines: "90" }))).toThrow(/lines/);
	});

	test("rejects malformed packages map", () => {
		expect(() =>
			loadBudgets(
				JSON.stringify({ functions: 80, lines: 85, packages: { "src/x/": { functions: "nope" } } }),
			),
		).toThrow(/packages/);
	});
});

describe("parseAllFilesRow", () => {
	test("extracts functions and lines from the Bun coverage table", () => {
		expect(parseAllFilesRow(COVERAGE_TABLE_PASS)).toEqual({ functions: 95, lines: 97.5 });
	});

	test("strips ANSI color codes before matching", () => {
		const colored =
			" All files                            |   \x1B[32m100.00\x1B[0m |   \x1B[32m99.50\x1B[0m |";
		expect(parseAllFilesRow(colored)).toEqual({ functions: 100, lines: 99.5 });
	});

	test("returns undefined when the row is missing", () => {
		expect(parseAllFilesRow("no coverage table here\n")).toBeUndefined();
	});
});

describe("parseFileRows", () => {
	test("extracts per-file rows but skips the aggregate", () => {
		const rows = parseFileRows(COVERAGE_TABLE_PASS);
		expect(rows.map((r) => r.file)).toEqual(["src/a.ts", "src/b.ts"]);
		expect(rows[0]).toEqual({ file: "src/a.ts", functions: 90, lines: 95 });
	});
});

describe("checkBudgets — synthetic pass", () => {
	test("no failures when totals clear floors", () => {
		const budgets: CoverageBudgets = { functions: 85, lines: 90, packages: {} };
		const totals: CoverageTotals = { functions: 95, lines: 97.5 };
		expect(checkBudgets(totals, [], budgets)).toEqual([]);
	});

	test("per-package floors pass when aggregates clear them", () => {
		const budgets: CoverageBudgets = {
			functions: 80,
			lines: 85,
			packages: { "src/": { functions: 90, lines: 95 } },
		};
		const rows: PackageRow[] = parseFileRows(COVERAGE_TABLE_PASS);
		const totals = parseAllFilesRow(COVERAGE_TABLE_PASS) as CoverageTotals;
		expect(checkBudgets(totals, rows, budgets)).toEqual([]);
	});
});

describe("checkBudgets — synthetic violation", () => {
	test("flags both aggregate metrics when below floor", () => {
		const budgets: CoverageBudgets = { functions: 85, lines: 90, packages: {} };
		const totals: CoverageTotals = { functions: 40, lines: 50 };
		const failures = checkBudgets(totals, [], budgets);
		expect(failures.map((f) => f.metric).sort()).toEqual(["functions", "lines"]);
		for (const f of failures) {
			expect(f.scope).toBe("All files");
		}
	});

	test("flags a missing per-package prefix", () => {
		const budgets: CoverageBudgets = {
			functions: 0,
			lines: 0,
			packages: { "src/missing/": { functions: 90, lines: 95 } },
		};
		const failures = checkBudgets({ functions: 100, lines: 100 }, [], budgets);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.scope).toBe("src/missing/");
	});

	test("flags a per-package floor violation", () => {
		const budgets: CoverageBudgets = {
			functions: 0,
			lines: 0,
			packages: { "src/": { functions: 95, lines: 98 } },
		};
		const rows: PackageRow[] = [{ file: "src/a.ts", functions: 40, lines: 50 }];
		const failures = checkBudgets({ functions: 100, lines: 100 }, rows, budgets);
		expect(failures.map((f) => f.scope)).toEqual(["src/", "src/"]);
	});
});

describe("CLI integration", () => {
	test("CLI exits 0 with --parse when totals clear the floors", async () => {
		const { path, cleanup } = makeTmpFile(COVERAGE_TABLE_PASS);
		const { path: budgetPath, cleanup: budgetCleanup } = makeTmpFile(
			JSON.stringify({ functions: 80, lines: 85, packages: {} }),
		);
		try {
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-coverage.ts"),
					"--budget",
					budgetPath,
					"--parse",
					path,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);
		} finally {
			cleanup();
			budgetCleanup();
		}
	});

	test("CLI exits 1 with --parse when totals drop below floors", async () => {
		const { path, cleanup } = makeTmpFile(COVERAGE_TABLE_FAIL);
		const { path: budgetPath, cleanup: budgetCleanup } = makeTmpFile(
			JSON.stringify({ functions: 80, lines: 85, packages: {} }),
		);
		try {
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/check-coverage.ts"),
					"--budget",
					budgetPath,
					"--parse",
					path,
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(1);
		} finally {
			cleanup();
			budgetCleanup();
		}
	});
});

describe("repo budget JSON", () => {
	test("scripts/coverage-budgets.json is well-formed", () => {
		const raw = readFileSync(resolve(REPO_ROOT, "scripts/coverage-budgets.json"), "utf8");
		const budgets = loadBudgets(raw, "scripts/coverage-budgets.json");
		expect(budgets.functions).toBeGreaterThanOrEqual(0);
		expect(budgets.lines).toBeGreaterThanOrEqual(0);
		expect(typeof budgets.packages).toBe("object");
	});
});
