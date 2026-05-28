#!/usr/bin/env bun
/**
 * Test-timing reporter (L5 toolkit).
 *
 * Parses the JUnit XML emitted by `bun test --reporter=junit` and prints
 * a human-readable timing summary: total duration, slowest test files,
 * and the top-N slowest individual test cases. When `GITHUB_STEP_SUMMARY`
 * is set the markdown is also appended there so it surfaces on the
 * GitHub Actions run page.
 *
 * Lightweight (no XML parser dep) and CI-friendly: exits 0 even when no
 * failures are present — failure reporting is the test runner's job.
 * When the JUnit artifact is missing the script also exits 0 with a
 * notice on stderr; the test job itself will have failed first.
 *
 * CLI:
 *   bun run scripts/report-test-timing.ts [path/to/junit.xml] [--top N]
 *
 * Defaults: path = junit.xml (repo root), N = 20.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

export interface TestCase {
	name: string;
	classname: string;
	file: string;
	timeSeconds: number;
}

export interface SuiteTotal {
	file: string;
	timeSeconds: number;
	tests: number;
}

export interface TimingReport {
	totalSeconds: number;
	totalTests: number;
	suites: SuiteTotal[];
	cases: TestCase[];
}

function attr(tag: string, name: string): string | undefined {
	const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
	return m ? m[1] : undefined;
}

export function parseJUnit(xml: string): TimingReport {
	const cases: TestCase[] = [];
	const caseRe = /<testcase\b[^>]*\/?>/g;
	for (const match of xml.matchAll(caseRe)) {
		const tag = match[0];
		const name = attr(tag, "name") ?? "";
		const classname = attr(tag, "classname") ?? "";
		const file = attr(tag, "file") ?? "";
		const timeStr = attr(tag, "time") ?? "0";
		const timeSeconds = Number.parseFloat(timeStr);
		if (!Number.isFinite(timeSeconds)) continue;
		cases.push({ name, classname, file, timeSeconds });
	}

	const fileTimes = new Map<string, { tests: number; timeSeconds: number }>();
	for (const c of cases) {
		const entry = fileTimes.get(c.file) ?? { tests: 0, timeSeconds: 0 };
		entry.tests += 1;
		entry.timeSeconds += c.timeSeconds;
		fileTimes.set(c.file, entry);
	}
	const suites: SuiteTotal[] = Array.from(fileTimes.entries()).map(
		([file, { tests, timeSeconds }]) => ({ file, tests, timeSeconds }),
	);

	const rootMatch = xml.match(/<testsuites\b[^>]*>/);
	let totalSeconds = 0;
	let totalTests = 0;
	if (rootMatch) {
		totalSeconds = Number.parseFloat(attr(rootMatch[0], "time") ?? "0");
		totalTests = Number.parseInt(attr(rootMatch[0], "tests") ?? "0", 10);
	}
	if (!Number.isFinite(totalSeconds) || totalSeconds === 0) {
		totalSeconds = suites.reduce((acc, s) => acc + s.timeSeconds, 0);
	}
	if (!totalTests) {
		totalTests = cases.length;
	}

	return { totalSeconds, totalTests, suites, cases };
}

function fmtSeconds(seconds: number): string {
	if (seconds >= 1) return `${seconds.toFixed(2)}s`;
	return `${(seconds * 1000).toFixed(1)}ms`;
}

export function formatReport(report: TimingReport, topN: number): string {
	const slowestCases = [...report.cases]
		.sort((a, b) => b.timeSeconds - a.timeSeconds)
		.slice(0, topN);
	const slowestSuites = [...report.suites]
		.sort((a, b) => b.timeSeconds - a.timeSeconds)
		.slice(0, topN);

	const lines: string[] = [];
	lines.push("## Test timing");
	lines.push("");
	lines.push(
		`**Total:** ${fmtSeconds(report.totalSeconds)} across ${report.totalTests} tests in ${report.suites.length} files.`,
	);
	lines.push("");
	lines.push(`### Slowest ${slowestSuites.length} test files`);
	lines.push("");
	lines.push("| Time | Tests | File |");
	lines.push("| ---: | ---: | --- |");
	for (const s of slowestSuites) {
		lines.push(`| ${fmtSeconds(s.timeSeconds)} | ${s.tests} | \`${s.file}\` |`);
	}
	lines.push("");
	lines.push(`### Slowest ${slowestCases.length} individual tests`);
	lines.push("");
	lines.push("| Time | Test | File |");
	lines.push("| ---: | --- | --- |");
	for (const c of slowestCases) {
		const name = `${c.classname} › ${c.name}`.replace(/\|/g, "\\|");
		lines.push(`| ${fmtSeconds(c.timeSeconds)} | ${name} | \`${c.file}\` |`);
	}
	lines.push("");
	return lines.join("\n");
}

interface ParsedArgs {
	path: string;
	topN: number;
}

function parseArgs(argv: string[]): ParsedArgs {
	let path = "junit.xml";
	let topN = 20;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--top") {
			const next = argv[i + 1];
			if (next) {
				const n = Number.parseInt(next, 10);
				if (Number.isFinite(n) && n > 0) topN = n;
				i++;
			}
		} else if (arg && !arg.startsWith("--")) {
			path = arg;
		}
	}
	return { path, topN };
}

async function main(): Promise<void> {
	const { path, topN } = parseArgs(process.argv.slice(2));
	if (!existsSync(path)) {
		console.error(
			`report-test-timing: ${path} not found — did 'bun test --reporter=junit --reporter-outfile=${path}' run?`,
		);
		process.exit(0);
	}
	const xml = readFileSync(path, "utf8");
	const report = parseJUnit(xml);
	const formatted = formatReport(report, topN);
	console.log(formatted);
	const stepSummary = process.env.GITHUB_STEP_SUMMARY;
	if (stepSummary) {
		appendFileSync(stepSummary, `${formatted}\n`);
	}
}

if (import.meta.main) {
	await main();
}
