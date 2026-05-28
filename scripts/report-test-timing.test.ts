import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatReport, parseJUnit } from "./report-test-timing.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="5" failures="0" skipped="0" time="1.234567">
  <testsuite name="a.test.ts" file="a.test.ts" tests="2" assertions="3" failures="0" skipped="0" time="0.5" hostname="h">
    <testsuite name="group A" file="a.test.ts" line="1" tests="2" assertions="3" failures="0" skipped="0" time="0.5" hostname="h">
      <testcase name="fast case" classname="group A" time="0.001" file="a.test.ts" line="2" assertions="1" />
      <testcase name="slow case" classname="group A" time="0.4" file="a.test.ts" line="5" assertions="2" />
    </testsuite>
  </testsuite>
  <testsuite name="b.test.ts" file="b.test.ts" tests="1" assertions="2" failures="0" skipped="0" time="0.734567" hostname="h">
    <testcase name="b case" classname="group B" time="0.7" file="b.test.ts" line="2" assertions="2" />
  </testsuite>
</testsuites>`;

describe("parseJUnit", () => {
	test("extracts root totals, file suites, and individual test cases", () => {
		const report = parseJUnit(SAMPLE_XML);
		expect(report.totalTests).toBe(3);
		expect(report.totalSeconds).toBeCloseTo(1.234567, 5);
		expect(report.suites).toHaveLength(2);
		expect(report.suites.map((s) => s.file).sort()).toEqual(["a.test.ts", "b.test.ts"]);
		expect(report.cases).toHaveLength(3);
		const slow = report.cases.find((c) => c.name === "slow case");
		expect(slow?.timeSeconds).toBeCloseTo(0.4, 5);
		expect(slow?.file).toBe("a.test.ts");
	});

	test("falls back to suite sums when root totals are missing", () => {
		const xml = SAMPLE_XML.replace(/tests="3"[^>]*time="1.234567"/, 'tests="0" time="0"');
		const report = parseJUnit(xml);
		expect(report.totalTests).toBe(3);
		expect(report.totalSeconds).toBeCloseTo(0.001 + 0.4 + 0.7, 5);
	});

	test("returns zero totals on an empty document", () => {
		const report = parseJUnit("<testsuites />");
		expect(report.totalTests).toBe(0);
		expect(report.cases).toEqual([]);
		expect(report.suites).toEqual([]);
	});
});

describe("formatReport", () => {
	test("renders a markdown summary with slowest cases first", () => {
		const report = parseJUnit(SAMPLE_XML);
		const md = formatReport(report, 2);
		expect(md).toContain("## Test timing");
		expect(md).toContain("Slowest 2 test files");
		expect(md).toContain("Slowest 2 individual tests");
		const bIdx = md.indexOf("b case");
		const sIdx = md.indexOf("slow case");
		expect(bIdx).toBeGreaterThan(-1);
		expect(sIdx).toBeGreaterThan(-1);
		expect(bIdx).toBeLessThan(sIdx);
	});

	test("escapes pipes in test names so the markdown table stays well-formed", () => {
		const report = parseJUnit(
			`<testsuites><testsuite file="a.test.ts"><testcase name="weird | name" classname="X" time="0.1" file="a.test.ts" /></testsuite></testsuites>`,
		);
		const md = formatReport(report, 5);
		expect(md).toContain("weird \\| name");
	});
});

describe("CLI integration", () => {
	test("CLI exits 0 even when the junit artifact is missing", async () => {
		const root = mkdtempSync(join(tmpdir(), "report-test-timing-"));
		try {
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/report-test-timing.ts"),
					join(root, "does-not-exist.xml"),
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("CLI exits 0 and prints the summary when junit.xml is present", async () => {
		const root = mkdtempSync(join(tmpdir(), "report-test-timing-"));
		try {
			const junitPath = join(root, "junit.xml");
			writeFileSync(junitPath, SAMPLE_XML);
			const proc = Bun.spawn(
				[
					"bun",
					"run",
					resolve(REPO_ROOT, "scripts/report-test-timing.ts"),
					junitPath,
					"--top",
					"3",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const exitCode = await proc.exited;
			expect(exitCode).toBe(0);
			const stdout = await new Response(proc.stdout).text();
			expect(stdout).toContain("Test timing");
			expect(stdout).toContain("Slowest 2 test files");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
