#!/usr/bin/env bun
/**
 * Code-quality metrics reporter (L5 toolkit).
 *
 * Emits a consolidated "code-quality metrics" panel to stdout and (when
 * the env var is set) to `$GITHUB_STEP_SUMMARY`. Aggregates the outputs
 * of the toolkit's ratchets — coverage, file-size, debt-marker, and the
 * complexity grandfather counts in `biome.json` — into a single
 * markdown table. Enforces nothing on its own: every underlying ratchet
 * already fails the build when breached. This panel just surfaces the
 * current state in one place.
 *
 * Mulch has no bundle step, so there is no bundle-size row.
 *
 * All inputs are optional. Missing artifacts render a "—" placeholder
 * row rather than failing, so the reporter is safe to run before any
 * coverage step has executed.
 *
 * Inputs (resolved relative to --repo-root, default: parent of this
 * script directory):
 *
 *   coverage/summary.json            — preferred coverage source
 *   coverage/lcov.info               — fallback coverage source
 *   scripts/coverage-budgets.json    — coverage floors
 *   biome.json                       — complexity grandfather overrides
 *   scripts/file-size-budgets.json   — file-size budget JSON
 *   scripts/debt-markers-budget.json — debt-marker budget JSON
 *
 * CLI:
 *   bun run scripts/report-quality-metrics.ts
 *   bun run scripts/report-quality-metrics.ts --repo-root /path/to/repo
 *   bun run scripts/report-quality-metrics.ts --lcov coverage/lcov.info
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dir;
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");

export interface CoverageTotals {
	functions: { hit: number; found: number; pct: number };
	lines: { hit: number; found: number; pct: number };
}

export function parseLcov(input: string): CoverageTotals | undefined {
	let fnf = 0;
	let fnh = 0;
	let lf = 0;
	let lh = 0;
	let saw = false;
	for (const rawLine of input.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon);
		const value = Number.parseInt(line.slice(colon + 1).trim(), 10);
		if (!Number.isFinite(value)) continue;
		switch (key) {
			case "FNF":
				fnf += value;
				saw = true;
				break;
			case "FNH":
				fnh += value;
				saw = true;
				break;
			case "LF":
				lf += value;
				saw = true;
				break;
			case "LH":
				lh += value;
				saw = true;
				break;
		}
	}
	if (!saw) return undefined;
	const fnPct = fnf === 0 ? 100 : (fnh / fnf) * 100;
	const linePct = lf === 0 ? 100 : (lh / lf) * 100;
	return {
		functions: { hit: fnh, found: fnf, pct: fnPct },
		lines: { hit: lh, found: lf, pct: linePct },
	};
}

export interface ComplexityOverrides {
	cognitive: number;
	linesPerFunction: number;
}

export function countComplexityOverrides(biomeJson: string): ComplexityOverrides {
	const parsed = JSON.parse(biomeJson) as {
		overrides?: Array<{
			includes?: string[];
			linter?: { rules?: { complexity?: Record<string, unknown> } };
		}>;
	};
	let cognitive = 0;
	let linesPerFunction = 0;
	for (const block of parsed.overrides ?? []) {
		const rules = block.linter?.rules?.complexity;
		if (!rules) continue;
		const includes = block.includes ?? [];
		if (rules.noExcessiveCognitiveComplexity === "off") cognitive += includes.length;
		if (rules.noExcessiveLinesPerFunction === "off") linesPerFunction += includes.length;
	}
	return { cognitive, linesPerFunction };
}

export interface FileSizeSummary {
	threshold: number;
	grandfathered: number;
	largest: number;
}

export function summariseFileSizes(budgetsJson: string): FileSizeSummary {
	const parsed = JSON.parse(budgetsJson) as {
		threshold?: number;
		budgets?: Record<string, number>;
	};
	const budgets = parsed.budgets ?? {};
	const values = Object.values(budgets);
	return {
		threshold: parsed.threshold ?? 0,
		grandfathered: values.length,
		largest: values.length === 0 ? 0 : Math.max(...values),
	};
}

export interface DebtMarkerSummary {
	grandfathered: number;
}

export function summariseDebt(budgetJson: string): DebtMarkerSummary {
	const parsed = JSON.parse(budgetJson) as { allowlist?: unknown[] };
	return { grandfathered: (parsed.allowlist ?? []).length };
}

function fmtPct(actual: number, floor: number): string {
	const delta = actual - floor;
	const sign = delta >= 0 ? "+" : "";
	return `${actual.toFixed(2)}% (floor ${floor.toFixed(2)}%, ${sign}${delta.toFixed(2)}pt)`;
}

export interface ReportInputs {
	summaryJson: string | undefined;
	lcov: string | undefined;
	coverageBudgets: string | undefined;
	biomeJson: string | undefined;
	fileSizeBudgets: string | undefined;
	debtBudget: string | undefined;
}

function parseSummaryJson(summaryJson: string): { functions?: number; lines?: number } {
	try {
		const parsed = JSON.parse(summaryJson) as { functions?: number; lines?: number };
		return {
			functions: typeof parsed.functions === "number" ? parsed.functions : undefined,
			lines: typeof parsed.lines === "number" ? parsed.lines : undefined,
		};
	} catch {
		return {};
	}
}

function resolveCoverage(
	summaryJson: string | undefined,
	lcov: string | undefined,
): { functions: number; lines: number } | undefined {
	const fromSummary = summaryJson ? parseSummaryJson(summaryJson) : {};
	const fromLcov = lcov ? parseLcov(lcov) : undefined;
	const functions = fromSummary.functions ?? fromLcov?.functions.pct;
	const lines = fromSummary.lines ?? fromLcov?.lines.pct;
	if (functions === undefined || lines === undefined) return undefined;
	return { functions, lines };
}

function renderCoverageRows(inputs: ReportInputs): string[] {
	const totals = resolveCoverage(inputs.summaryJson, inputs.lcov);
	if (!totals || !inputs.coverageBudgets) {
		return ["| Coverage | — (summary.json/lcov.info or budgets missing) |"];
	}
	const floors = JSON.parse(inputs.coverageBudgets) as { functions: number; lines: number };
	return [
		`| Coverage — functions | ${fmtPct(totals.functions, floors.functions)} |`,
		`| Coverage — lines | ${fmtPct(totals.lines, floors.lines)} |`,
	];
}

function renderComplexityRows(biomeJson: string | undefined): string[] {
	if (!biomeJson) return [];
	const c = countComplexityOverrides(biomeJson);
	return [
		`| Complexity — files exempt from cognitive-complexity ≤ 15 | ${c.cognitive} |`,
		`| Complexity — files exempt from lines-per-function ≤ 500 | ${c.linesPerFunction} |`,
	];
}

function renderRatchetRows(inputs: ReportInputs): string[] {
	const rows: string[] = [];
	if (inputs.fileSizeBudgets) {
		const fs = summariseFileSizes(inputs.fileSizeBudgets);
		rows.push(
			`| File-size budget — grandfathered files | ${fs.grandfathered} (largest ${fs.largest} lines vs ${fs.threshold} threshold) |`,
		);
	}
	if (inputs.debtBudget) {
		const d = summariseDebt(inputs.debtBudget);
		rows.push(`| Untracked debt markers — grandfathered | ${d.grandfathered} |`);
	}
	return rows;
}

export function formatReport(inputs: ReportInputs): string {
	const lines: string[] = [
		"## Code-quality metrics",
		"",
		"| Metric | Value |",
		"| --- | --- |",
		...renderCoverageRows(inputs),
		...renderComplexityRows(inputs.biomeJson),
		...renderRatchetRows(inputs),
		"",
		"<sub>All numbers above are enforced by individual ratchet scripts; this panel is a passive summary.</sub>",
		"",
	];
	return lines.join("\n");
}

function readIfExists(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

interface ParsedArgs {
	repoRoot?: string;
	lcovPath?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const out: ParsedArgs = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--repo-root") {
			out.repoRoot = argv[++i];
		} else if (a === "--lcov") {
			out.lcovPath = argv[++i];
		}
	}
	return out;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const repoRoot = args.repoRoot ? resolve(args.repoRoot) : DEFAULT_REPO_ROOT;
	const lcovPath = args.lcovPath
		? resolve(args.lcovPath)
		: resolve(repoRoot, "coverage/lcov.info");

	const formatted = formatReport({
		summaryJson: readIfExists(resolve(repoRoot, "coverage/summary.json")),
		lcov: readIfExists(lcovPath),
		coverageBudgets: readIfExists(resolve(repoRoot, "scripts/coverage-budgets.json")),
		biomeJson: readIfExists(resolve(repoRoot, "biome.json")),
		fileSizeBudgets: readIfExists(resolve(repoRoot, "scripts/file-size-budgets.json")),
		debtBudget: readIfExists(resolve(repoRoot, "scripts/debt-markers-budget.json")),
	});

	console.log(formatted);
	const stepSummary = process.env.GITHUB_STEP_SUMMARY;
	if (stepSummary) {
		appendFileSync(stepSummary, `${formatted}\n`);
	}
}

if (import.meta.main) {
	await main();
}
