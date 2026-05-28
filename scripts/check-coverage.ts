#!/usr/bin/env bun
/**
 * Coverage guard (L5 toolkit ratchet).
 *
 * Wraps `bun test --coverage` so CI gets:
 *   1. A normal test run (failures still fail the step).
 *   2. A text coverage table in the log.
 *   3. A `coverage/lcov.info` artifact for downstream tooling.
 *   4. A JUnit XML report (when `--junit` is passed).
 *   5. Ratchet enforcement of the floors in
 *      `scripts/coverage-budgets.json`.
 *
 * The aggregate floors (`functions`, `lines`) are checked against the
 * `All files` row emitted by Bun's text coverage reporter. Optionally, a
 * `packages` map declares per-package floors keyed by path prefix; rows
 * whose filename starts with a given prefix are aggregated and compared
 * against that prefix's floors.
 *
 * The ratchet only goes UP. To raise a floor: add tests, observe the new
 * aggregate, then bump the budget JSON. Lowering a floor implies deleting
 * tests — that should be a conscious decision with a tracker reference.
 * This script never auto-edits its own budget; loosening requires an
 * explicit commit by a human.
 *
 * CLI:
 *   bun run scripts/check-coverage.ts                 # run tests + enforce
 *   bun run scripts/check-coverage.ts --junit         # also emit junit.xml
 *   bun run scripts/check-coverage.ts --parse FILE    # offline: parse a captured log
 *   bun run scripts/check-coverage.ts --budget P.json # override budget path
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dir;
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_BUDGETS_PATH = resolve(SCRIPT_DIR, "coverage-budgets.json");

export interface PackageBudget {
	functions: number;
	lines: number;
}

export interface CoverageBudgets {
	functions: number;
	lines: number;
	packages: Record<string, PackageBudget>;
}

export interface CoverageTotals {
	functions: number;
	lines: number;
}

export interface PackageRow extends CoverageTotals {
	file: string;
}

export interface CoverageFailure {
	scope: string;
	metric: "functions" | "lines";
	actual: number;
	floor: number;
}

function parsePercentage(value: unknown, field: string, source: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error(`${source}: '${field}' must be a percentage in [0, 100]`);
	}
	return value;
}

export function loadBudgets(raw: string, source = "<budget>"): CoverageBudgets {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	const functions = parsePercentage(parsed.functions, "functions", source);
	const lines = parsePercentage(parsed.lines, "lines", source);
	const packagesRaw = parsed.packages;
	const packages: Record<string, PackageBudget> = {};
	if (packagesRaw !== undefined) {
		if (packagesRaw === null || typeof packagesRaw !== "object" || Array.isArray(packagesRaw)) {
			throw new Error(`${source}: 'packages' must be an object`);
		}
		for (const [prefix, value] of Object.entries(packagesRaw)) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) {
				throw new Error(`${source}: packages['${prefix}'] must be an object`);
			}
			const v = value as Record<string, unknown>;
			packages[prefix] = {
				functions: parsePercentage(v.functions, `packages['${prefix}'].functions`, source),
				lines: parsePercentage(v.lines, `packages['${prefix}'].lines`, source),
			};
		}
	}
	return { functions, lines, packages };
}

/**
 * Parse the `All files` aggregate row of Bun's text coverage reporter.
 *
 * Example: ` All files                            |   86.25 |   91.62 |`
 *
 * Returns `undefined` when the row is absent.
 */
export function parseAllFilesRow(output: string): CoverageTotals | undefined {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI CSI sequences
	const plain = output.replace(/\x1B\[[0-9;]*m/g, "");
	const match = plain.match(/^\s*All files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/m);
	if (!match) return undefined;
	const functions = Number.parseFloat(match[1] ?? "");
	const lines = Number.parseFloat(match[2] ?? "");
	if (!Number.isFinite(functions) || !Number.isFinite(lines)) return undefined;
	return { functions, lines };
}

/**
 * Parse individual per-file rows from Bun's text coverage reporter.
 * Returns one entry per source file row (skips the `All files`
 * aggregate and table separators).
 */
export function parseFileRows(output: string): PackageRow[] {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI CSI sequences
	const plain = output.replace(/\x1B\[[0-9;]*m/g, "");
	const rows: PackageRow[] = [];
	const re = /^\s*([^|\s][^|]*?)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/gm;
	for (const m of plain.matchAll(re)) {
		const name = (m[1] ?? "").trim();
		if (!name || name === "All files" || name === "File") continue;
		const functions = Number.parseFloat(m[2] ?? "");
		const lines = Number.parseFloat(m[3] ?? "");
		if (!Number.isFinite(functions) || !Number.isFinite(lines)) continue;
		rows.push({ file: name, functions, lines });
	}
	return rows;
}

function aggregateByPrefix(rows: PackageRow[], prefix: string): CoverageTotals | undefined {
	const matching = rows.filter((r) => r.file.startsWith(prefix));
	if (matching.length === 0) return undefined;
	let fnSum = 0;
	let lnSum = 0;
	for (const r of matching) {
		fnSum += r.functions;
		lnSum += r.lines;
	}
	return {
		functions: fnSum / matching.length,
		lines: lnSum / matching.length,
	};
}

export function checkBudgets(
	totals: CoverageTotals,
	rows: PackageRow[],
	budgets: CoverageBudgets,
): CoverageFailure[] {
	const failures: CoverageFailure[] = [];
	if (totals.functions < budgets.functions) {
		failures.push({
			scope: "All files",
			metric: "functions",
			actual: totals.functions,
			floor: budgets.functions,
		});
	}
	if (totals.lines < budgets.lines) {
		failures.push({
			scope: "All files",
			metric: "lines",
			actual: totals.lines,
			floor: budgets.lines,
		});
	}
	for (const [prefix, floors] of Object.entries(budgets.packages)) {
		const agg = aggregateByPrefix(rows, prefix);
		if (!agg) {
			failures.push({
				scope: prefix,
				metric: "functions",
				actual: 0,
				floor: floors.functions,
			});
			continue;
		}
		if (agg.functions < floors.functions) {
			failures.push({
				scope: prefix,
				metric: "functions",
				actual: agg.functions,
				floor: floors.functions,
			});
		}
		if (agg.lines < floors.lines) {
			failures.push({
				scope: prefix,
				metric: "lines",
				actual: agg.lines,
				floor: floors.lines,
			});
		}
	}
	return failures;
}

function formatLine(totals: CoverageTotals, budgets: CoverageBudgets): string {
	return `Coverage — functions ${totals.functions.toFixed(2)}% (floor ${budgets.functions.toFixed(2)}%), lines ${totals.lines.toFixed(2)}% (floor ${budgets.lines.toFixed(2)}%)`;
}

function reportResult(
	totals: CoverageTotals | undefined,
	rows: PackageRow[],
	budgets: CoverageBudgets,
	testExitCode: number,
): number {
	if (totals) writeSummary(resolve(DEFAULT_REPO_ROOT, "coverage"), totals);
	if (!totals) {
		console.error(
			"check-coverage: could not find 'All files' row in test output — did the test run finish?",
		);
		return testExitCode === 0 ? 1 : testExitCode;
	}
	const failures = checkBudgets(totals, rows, budgets);
	console.error(formatLine(totals, budgets));
	if (failures.length > 0) {
		for (const f of failures) {
			console.error(
				`check-coverage: [${f.scope}] ${f.metric} coverage ${f.actual.toFixed(2)}% is below floor ${f.floor.toFixed(2)}%. Add tests to lift it, or — if you're intentionally removing coverage — document the drop and lower the floor in the budget JSON (explicit human commit required).`,
			);
		}
		return testExitCode === 0 ? 1 : testExitCode;
	}
	return testExitCode;
}

function runBunTest(repoRoot: string, emitJUnit: boolean): { exitCode: number; combined: string } {
	const coverageDir = resolve(repoRoot, "coverage");
	const junitPath = resolve(repoRoot, "junit.xml");
	mkdirSync(coverageDir, { recursive: true });
	const args = [
		"test",
		"--coverage",
		"--coverage-reporter=text",
		"--coverage-reporter=lcov",
		`--coverage-dir=${coverageDir}`,
	];
	if (emitJUnit) {
		args.push("--reporter=junit", `--reporter-outfile=${junitPath}`);
	}
	const result = spawnSync("bun", args, { cwd: repoRoot, encoding: "utf8" });
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	process.stdout.write(stdout);
	process.stderr.write(stderr);
	const exitCode = result.status ?? (result.signal ? 1 : 0);
	return { exitCode, combined: `${stdout}\n${stderr}` };
}

interface ParsedArgs {
	budgetsPath?: string;
	repoRoot?: string;
	parseFile?: string;
	emitJUnit: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const out: ParsedArgs = { emitJUnit: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--budget") {
			out.budgetsPath = argv[++i];
		} else if (a === "--repo-root") {
			out.repoRoot = argv[++i];
		} else if (a === "--parse") {
			out.parseFile = argv[++i];
		} else if (a === "--junit") {
			out.emitJUnit = true;
		}
	}
	return out;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const budgetsPath = args.budgetsPath ? resolve(args.budgetsPath) : DEFAULT_BUDGETS_PATH;
	const repoRoot = args.repoRoot ? resolve(args.repoRoot) : DEFAULT_REPO_ROOT;
	const budgets = loadBudgets(readFileSync(budgetsPath, "utf8"), budgetsPath);

	if (args.parseFile) {
		if (!existsSync(args.parseFile)) {
			console.error(`check-coverage: --parse expected an existing file, got ${args.parseFile}`);
			process.exit(2);
		}
		const captured = readFileSync(args.parseFile, "utf8");
		const totals = parseAllFilesRow(captured);
		const rows = parseFileRows(captured);
		process.exit(reportResult(totals, rows, budgets, 0));
	}

	const { exitCode, combined } = runBunTest(repoRoot, args.emitJUnit);
	const totals = parseAllFilesRow(combined);
	const rows = parseFileRows(combined);
	process.exit(reportResult(totals, rows, budgets, exitCode));
}

// Persist the text-reporter totals so downstream consumers
// (scripts/report-quality-metrics.ts) render the same numbers users see
// in the CI log. lcov.info aggregates diverge here (it counts
// non-executable spans), so this JSON is the source of truth for the
// `All files` aggregate.
export function writeSummary(coverageDir: string, totals: CoverageTotals): void {
	try {
		mkdirSync(coverageDir, { recursive: true });
		writeFileSync(
			resolve(coverageDir, "summary.json"),
			`${JSON.stringify({ functions: totals.functions, lines: totals.lines }, null, 2)}\n`,
		);
	} catch (err) {
		console.error(`check-coverage: failed to write coverage/summary.json: ${err}`);
	}
}

if (import.meta.main) {
	await main();
}
