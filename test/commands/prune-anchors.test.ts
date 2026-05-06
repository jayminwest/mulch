import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerPruneCommand } from "../../src/commands/prune.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { getArchivePath, readArchiveFile } from "../../src/utils/archive.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

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

async function runPrune(tmpDir: string, args: string[]): Promise<CapturedRun> {
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

async function readLive(tmpDir: string, domain: string): Promise<ExpertiseRecord[]> {
	return readExpertiseFile(getExpertisePath(domain, tmpDir));
}

function findById(records: ExpertiseRecord[], id: string): ExpertiseRecord | undefined {
	return records.find((r) => r.id === id);
}

async function touch(tmpDir: string, relPath: string): Promise<void> {
	const abs = join(tmpDir, relPath);
	await mkdir(join(abs, ".."), { recursive: true });
	await writeFile(abs, "", "utf-8");
}

describe("ml prune --check-anchors — anchor-validity decay (R-05f)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-prune-anchors-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("zero-anchor records are exempt (no decay signal)", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-no0001",
				type: "convention",
				content: "Global rule with no anchors",
				classification: "foundational",
				recorded_at: daysAgo(60),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");
		expect(live[0]?.anchor_decay_demoted_at).toBeUndefined();
	});

	it("record with all anchors valid is not demoted", async () => {
		await touch(tmpDir, "src/foo.ts");
		await touch(tmpDir, "src/bar.ts");
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-ok0001",
				type: "pattern",
				name: "ok-pattern",
				description: "All anchors point to existing files",
				files: ["src/foo.ts", "src/bar.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");
		expect(live[0]?.anchor_decay_demoted_at).toBeUndefined();
	});

	it("record below threshold demotes one tier and stamps anchor_decay_demoted_at", async () => {
		await touch(tmpDir, "src/foo.ts");
		// src/missing.ts and src/gone.ts intentionally absent → 1/3 valid (33%)
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-an0001",
				type: "pattern",
				name: "decayed-pattern",
				description: "Most anchors broken",
				files: ["src/foo.ts", "src/missing.ts", "src/gone.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toMatch(/Demoted/i);

		const live = await readLive(tmpDir, "testing");
		const demoted = findById(live, "mx-an0001");
		expect(demoted?.classification).toBe("tactical");
		expect(typeof demoted?.anchor_decay_demoted_at).toBe("string");
		expect(demoted?.supersession_demoted_at).toBeUndefined();
	});

	it("grace_days guard skips records younger than the grace period", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-fresh01",
				type: "pattern",
				name: "fresh-pattern",
				description: "Anchors all broken but record is brand new",
				files: ["src/missing-a.ts", "src/missing-b.ts"],
				classification: "foundational",
				recorded_at: daysAgo(2),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");
		expect(live[0]?.anchor_decay_demoted_at).toBeUndefined();
	});

	it("dir_anchors and evidence.file count toward the validity fraction", async () => {
		await touch(tmpDir, "src/foo.ts");
		// dir 'gone-dir' and evidence file 'missing-evidence.ts' intentionally absent
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-mixed1",
				type: "pattern",
				name: "mixed-anchors",
				description: "files + dir + evidence.file",
				files: ["src/foo.ts"],
				dir_anchors: ["gone-dir"],
				evidence: { file: "missing-evidence.ts" },
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("tactical");
	});

	it("observational record with broken anchors archives instead of demoting further", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-obs0001",
				type: "pattern",
				name: "old-obs",
				description: "All anchors gone",
				files: ["src/missing-x.ts", "src/missing-y.ts"],
				classification: "observational",
				recorded_at: daysAgo(10),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Archived");

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, "mx-obs0001")).toBeUndefined();

		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive).toHaveLength(1);
		expect(archive[0]?.id).toBe("mx-obs0001");
	});

	it("--hard hard-deletes a bottomed-out anchor-decayed observational", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-obs0002",
				type: "pattern",
				name: "old-obs-hard",
				description: "All anchors gone",
				files: ["src/missing-z.ts"],
				classification: "observational",
				recorded_at: daysAgo(10),
			},
		]);

		const result = await runPrune(tmpDir, ["--hard", "--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, "mx-obs0002")).toBeUndefined();
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("--dry-run reports anchor decay without mutating live or archive files", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-dry0001",
				type: "pattern",
				name: "would-demote",
				description: "Anchors broken",
				files: ["src/missing-d.ts", "src/missing-e.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--dry-run", "--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toMatch(/Would demote/i);

		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");
		expect(live[0]?.anchor_decay_demoted_at).toBeUndefined();
	});

	it("--check-anchors off (default): broken anchors do not demote", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-off0001",
				type: "pattern",
				name: "broken-but-untouched",
				description: "Default prune ignores anchor validity",
				files: ["src/missing-f.ts", "src/missing-g.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);
		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");
	});

	it("staleness wins over anchor decay when both apply", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-both0001",
				type: "pattern",
				name: "stale-and-broken",
				description: "Tactical, ancient, anchors gone",
				files: ["src/missing-h.ts"],
				classification: "tactical",
				recorded_at: daysAgo(60),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, "mx-both0001")).toBeUndefined();
		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive).toHaveLength(1);
		expect(archive[0]?.id).toBe("mx-both0001");
		// Staleness was the reason — no anchor-decay stamp on the archived record.
		expect(archive[0]?.anchor_decay_demoted_at).toBeUndefined();
	});

	it("supersession + anchor decay together still only demote one tier and stamp both fields", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-comb0001",
				type: "pattern",
				name: "double-trouble",
				description: "Superseded AND anchor-decayed",
				files: ["src/missing-i.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
			{
				id: "mx-comb0002",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: ["mx-comb0001"],
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);

		const live = await readLive(tmpDir, "testing");
		const demoted = findById(live, "mx-comb0001");
		expect(demoted?.classification).toBe("tactical");
		expect(typeof demoted?.supersession_demoted_at).toBe("string");
		expect(typeof demoted?.anchor_decay_demoted_at).toBe("string");
	});

	it("--explain prints broken anchor list and tier transition", async () => {
		await touch(tmpDir, "src/foo.ts");
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-exp0001",
				type: "pattern",
				name: "explainable",
				description: "Half-broken",
				files: ["src/foo.ts", "src/missing-j.ts", "src/missing-k.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--check-anchors", "--explain"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Explain");
		expect(result.stdout).toContain("foundational");
		expect(result.stdout).toContain("tactical");
		expect(result.stdout).toContain("anchor_decay");
		expect(result.stdout).toContain("src/missing-j.ts");
		expect(result.stdout).toContain("src/missing-k.ts");
	});

	it("--json reports totalAnchorDemoted and per-domain anchor_demoted counts", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-json0001",
				type: "pattern",
				name: "json-decayed",
				description: "Broken anchors",
				files: ["src/missing-l.ts", "src/missing-m.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runPrune(tmpDir, ["--json", "--check-anchors"]);
		expect(result.exitCode ?? 0).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.success).toBe(true);
		expect(payload.checkAnchors).toBe(true);
		expect(payload.totalDemoted).toBe(1);
		expect(payload.totalAnchorDemoted).toBe(1);
		expect(payload.totalSupersessionDemoted).toBe(0);
		const domainEntry = payload.results.find((r: { domain: string }) => r.domain === "testing");
		expect(domainEntry).toMatchObject({
			pruned: 0,
			demoted: 1,
			anchor_demoted: 1,
			supersession_demoted: 0,
		});
	});

	it("config thresholds override defaults: threshold=0.9 catches 50%-broken records", async () => {
		await touch(tmpDir, "src/foo.ts");
		// 1/2 valid = 50%, below 0.9 threshold but above default 0.5
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-cfg0001",
				type: "pattern",
				name: "marginal",
				description: "Half valid",
				files: ["src/foo.ts", "src/missing-n.ts"],
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
		]);

		// First pass with default threshold (0.5): 50% is not < 0.5, so no demotion
		await runPrune(tmpDir, ["--check-anchors"]);
		let live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");

		// Override config threshold to 0.9
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { testing: {}, architecture: {} },
				decay: { anchor_validity: { threshold: 0.9 } },
			},
			tmpDir,
		);

		await runPrune(tmpDir, ["--check-anchors"]);
		live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("tactical");
	});

	it("config grace_days override keeps young records protected", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-grc0001",
				type: "pattern",
				name: "grace-test",
				description: "Anchors broken; 10 days old",
				files: ["src/missing-o.ts"],
				classification: "foundational",
				recorded_at: daysAgo(10),
			},
		]);

		// Default grace_days=7 → record is older, so decay would fire.
		// Bump to 30 → record is younger than the new grace, exempt.
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { testing: {}, architecture: {} },
				decay: { anchor_validity: { grace_days: 30 } },
			},
			tmpDir,
		);

		await runPrune(tmpDir, ["--check-anchors"]);
		const live = await readLive(tmpDir, "testing");
		expect(live[0]?.classification).toBe("foundational");
		expect(live[0]?.anchor_decay_demoted_at).toBeUndefined();
	});

	it("re-running prune cascades an anchor-decayed record one tier per pass", async () => {
		// Start at 8 days old — past grace_days (7) so anchor decay fires, but
		// young enough that staleness (tactical=14d, observational=30d) doesn't
		// short-circuit the demotion ladder by archiving outright.
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-cas0001",
				type: "pattern",
				name: "cascade",
				description: "Anchors broken",
				files: ["src/missing-p.ts"],
				classification: "foundational",
				recorded_at: daysAgo(8),
			},
		]);

		await runPrune(tmpDir, ["--check-anchors"]);
		let live = await readLive(tmpDir, "testing");
		expect(findById(live, "mx-cas0001")?.classification).toBe("tactical");

		await runPrune(tmpDir, ["--check-anchors"]);
		live = await readLive(tmpDir, "testing");
		expect(findById(live, "mx-cas0001")?.classification).toBe("observational");

		await runPrune(tmpDir, ["--check-anchors"]);
		live = await readLive(tmpDir, "testing");
		expect(findById(live, "mx-cas0001")).toBeUndefined();
		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive.find((r) => r.id === "mx-cas0001")).toBeDefined();
	});
});
