import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerPruneCommand } from "../../src/commands/prune.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../../src/utils/expertise.ts";
import { setQuiet } from "../../src/utils/palette.ts";

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

interface CapturedRun {
	stdout: string;
	stderr: string;
	exitCode: number | undefined;
}

async function runPrune(
	tmpDir: string,
	args: string[],
	opts: { quiet?: boolean } = {},
): Promise<CapturedRun> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];

	const logSpy = spyOn(console, "log").mockImplementation((...a) => {
		stdoutLines.push(a.map(String).join(" "));
	});
	const errSpy = spyOn(console, "error").mockImplementation((...a) => {
		stderrLines.push(a.map(String).join(" "));
	});

	const prevExitCode = process.exitCode;
	process.exitCode = 0;
	const origCwd = process.cwd();
	process.chdir(tmpDir);
	if (opts.quiet) setQuiet(true);

	try {
		const program = new Command();
		program.option("--json", "output JSON");
		program.exitOverride();
		registerPruneCommand(program);
		await program.parseAsync(["node", "mulch", "prune", ...args]);
	} catch {
		// commander exitOverride throws; the inner action sets process.exitCode.
	} finally {
		process.chdir(origCwd);
		if (opts.quiet) setQuiet(false);
		logSpy.mockRestore();
		errSpy.mockRestore();
	}

	const exitCode = process.exitCode as number | undefined;
	process.exitCode = prevExitCode;
	return {
		stdout: stdoutLines.join("\n"),
		stderr: stderrLines.join("\n"),
		exitCode,
	};
}

async function seedDomain(
	tmpDir: string,
	domain: string,
	records: ExpertiseRecord[],
): Promise<void> {
	const filePath = getExpertisePath(domain, tmpDir);
	await createExpertiseFile(filePath);
	for (const r of records) {
		await appendRecord(filePath, r);
	}
}

async function touch(tmpDir: string, relPath: string): Promise<void> {
	const abs = join(tmpDir, relPath);
	await mkdir(join(abs, ".."), { recursive: true });
	await writeFile(abs, "", "utf-8");
}

// Strip ANSI escape codes so assertions stay readable.
function plain(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping.
	return s.replace(/\[[0-9;]*m/g, "");
}

describe("ml prune --dry-run — granular per-record output (mulch-5ce3)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-prune-granular-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("default --dry-run prints one line per affected record (stale + superseded + anchor_decay)", async () => {
		await touch(tmpDir, "src/exists.ts");
		const staleId = "mx-stale01";
		const supersededId = "mx-sup0001";
		const replacementId = "mx-rep0001";
		const anchorId = "mx-anch001";
		await seedDomain(tmpDir, "testing", [
			{
				id: staleId,
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
			{
				id: supersededId,
				type: "convention",
				content: "To be superseded",
				classification: "foundational",
				recorded_at: daysAgo(1),
			},
			{
				id: replacementId,
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [supersededId],
			},
			{
				id: anchorId,
				type: "pattern",
				name: "broken-anchors",
				description: "All anchors broken",
				files: ["src/missing.ts"],
				classification: "foundational",
				recorded_at: daysAgo(60),
			},
		]);

		const result = await runPrune(tmpDir, ["--dry-run", "--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);

		const out = plain(result.stdout);
		// Stale → archived
		expect(out).toMatch(
			new RegExp(`${staleId}\\s+\\[convention\\]:\\s+tactical → archived \\(stale\\)`),
		);
		// Supersession → tactical
		expect(out).toMatch(
			new RegExp(
				`${supersededId}\\s+\\[convention\\]:\\s+foundational → tactical \\(superseded\\)`,
			),
		);
		// Anchor decay → tactical
		expect(out).toMatch(
			new RegExp(`${anchorId}\\s+\\[pattern\\]:\\s+foundational → tactical \\(anchor_decay\\)`),
		);
		// Totals still print.
		expect(out).toMatch(/Total:.*would archive 1 stale record/);
		// Anchor breakdown is NOT shown by default (gated on --explain).
		expect(out).not.toMatch(/anchors:\s+\d+\/\d+ valid/);
		expect(out).not.toContain("src/missing.ts");
	});

	it("--dry-run --explain adds anchor breakdown on top of the default per-record list", async () => {
		await touch(tmpDir, "src/keep.ts");
		const anchorId = "mx-anch002";
		await seedDomain(tmpDir, "testing", [
			{
				id: anchorId,
				type: "pattern",
				name: "half-broken",
				description: "Some anchors broken",
				files: ["src/keep.ts", "src/gone1.ts", "src/gone2.ts"],
				classification: "foundational",
				recorded_at: daysAgo(60),
			},
		]);

		const result = await runPrune(tmpDir, ["--dry-run", "--check-anchors", "--explain"]);
		expect(result.exitCode ?? 0).toBe(0);

		const out = plain(result.stdout);
		// Default per-record line still present.
		expect(out).toMatch(
			new RegExp(`${anchorId}\\s+\\[pattern\\]:\\s+foundational → tactical \\(anchor_decay\\)`),
		);
		// Anchor breakdown only appears under --explain.
		expect(out).toMatch(/anchors:\s+1\/3 valid \(33%\)/);
		expect(out).toContain("src/gone1.ts");
		expect(out).toContain("src/gone2.ts");
	});

	it("--dry-run --quiet prints only the total line (no per-record list, no per-domain header)", async () => {
		const staleId = "mx-stale02";
		await seedDomain(tmpDir, "testing", [
			{
				id: staleId,
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--dry-run"], { quiet: true });
		expect(result.exitCode ?? 0).toBe(0);

		const out = plain(result.stdout);
		// Totals line is preserved under --quiet.
		expect(out).toMatch(/Total:.*would archive 1 stale record/);
		// Per-record list is suppressed.
		expect(out).not.toContain(staleId);
		// Per-domain header is suppressed.
		expect(out).not.toMatch(/testing:\s+Would archive/);
	});

	it("--dry-run --json output is unchanged: explanations remain gated on --explain and exclude stale-only entries", async () => {
		const staleId = "mx-stale03";
		const supersededId = "mx-sup0003";
		await seedDomain(tmpDir, "testing", [
			{
				id: staleId,
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
			{
				id: supersededId,
				type: "convention",
				content: "Old",
				classification: "foundational",
				recorded_at: daysAgo(1),
			},
			{
				id: "mx-rep0003",
				type: "convention",
				content: "New",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [supersededId],
			},
		]);

		// Without --explain: no explanations field.
		const r1 = await runPrune(tmpDir, ["--dry-run", "--json"]);
		expect(r1.exitCode ?? 0).toBe(0);
		const payload1 = JSON.parse(r1.stdout);
		expect(payload1.success).toBe(true);
		expect(payload1.dryRun).toBe(true);
		expect(payload1.totalPruned).toBe(1);
		expect(payload1.totalDemoted).toBe(1);
		expect(payload1.explanations).toBeUndefined();

		// With --explain: only demotion entries (no stale-only entries).
		const r2 = await runPrune(tmpDir, ["--dry-run", "--explain", "--json"]);
		expect(r2.exitCode ?? 0).toBe(0);
		const payload2 = JSON.parse(r2.stdout);
		expect(Array.isArray(payload2.explanations)).toBe(true);
		const ids = payload2.explanations.map((e: { id?: string }) => e.id);
		expect(ids).toContain(supersededId);
		expect(ids).not.toContain(staleId);
		const sup = payload2.explanations.find((e: { id?: string }) => e.id === supersededId);
		expect(sup).toMatchObject({
			from: "foundational",
			to: "tactical",
			type: "convention",
			reasons: ["superseded"],
		});
	});
});
