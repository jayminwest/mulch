import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
		// commander exitOverride throws on errors; the inner action sets process.exitCode.
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

describe("ml prune — supersession-based auto-demotion (R-05e)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-prune-supersession-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("foundational superseded record demotes to tactical and is stamped with supersession_demoted_at", async () => {
		const oldId = "mx-aaaaaa";
		const newId = "mx-bbbbbb";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old approach",
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
			{
				id: newId,
				type: "convention",
				content: "New approach",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toMatch(/Demoted/i);

		const live = await readLive(tmpDir, "testing");
		expect(live).toHaveLength(2);
		const old = findById(live, oldId);
		expect(old?.classification).toBe("tactical");
		expect(typeof old?.supersession_demoted_at).toBe("string");

		const fresh = findById(live, newId);
		expect(fresh?.classification).toBe("foundational");
		expect(fresh?.supersession_demoted_at).toBeUndefined();
	});

	it("ladder demotion: tactical → observational on a single pass", async () => {
		const oldId = "mx-aaaa01";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old tactical",
				classification: "tactical",
				recorded_at: daysAgo(2),
			},
			{
				id: "mx-bbbb01",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		await runPrune(tmpDir, []);

		const live = await readLive(tmpDir, "testing");
		const old = findById(live, oldId);
		expect(old?.classification).toBe("observational");
	});

	it("ladder demotion: observational superseded record bottoms out into the archive", async () => {
		const oldId = "mx-aaaa02";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old observational",
				classification: "observational",
				recorded_at: daysAgo(2),
			},
			{
				id: "mx-bbbb02",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Archived");

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, oldId)).toBeUndefined();

		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive).toHaveLength(1);
		expect(archive[0]?.id).toBe(oldId);
		expect(archive[0]).toMatchObject({ status: "archived" });
	});

	it("--hard hard-deletes a bottomed-out observational instead of archiving", async () => {
		const oldId = "mx-aaaa03";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old observational",
				classification: "observational",
				recorded_at: daysAgo(2),
			},
			{
				id: "mx-bbbb03",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		const result = await runPrune(tmpDir, ["--hard"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Deleted");

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, oldId)).toBeUndefined();
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("--aggressive collapses any superseded record straight to archived in one pass", async () => {
		const oldFoundationalId = "mx-aaaa04";
		const oldTacticalId = "mx-cccc04";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldFoundationalId,
				type: "convention",
				content: "Old foundational",
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
			{
				id: oldTacticalId,
				type: "convention",
				content: "Old tactical",
				classification: "tactical",
				recorded_at: daysAgo(2),
			},
			{
				id: "mx-bbbb04",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldFoundationalId, oldTacticalId],
			},
		]);

		await runPrune(tmpDir, ["--aggressive"]);

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, oldFoundationalId)).toBeUndefined();
		expect(findById(live, oldTacticalId)).toBeUndefined();

		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive).toHaveLength(2);
	});

	it("--dry-run reports demotions without mutating live or archive files", async () => {
		const oldId = "mx-aaaa05";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old foundational",
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
			{
				id: "mx-bbbb05",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		const result = await runPrune(tmpDir, ["--dry-run"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toMatch(/Would demote/i);

		const live = await readLive(tmpDir, "testing");
		const old = findById(live, oldId);
		expect(old?.classification).toBe("foundational");
		expect(old?.supersession_demoted_at).toBeUndefined();
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("cross-domain supersession demotes records across domain boundaries", async () => {
		const oldId = "mx-aaaa06";
		await seedDomain(tmpDir, "architecture", [
			{
				id: oldId,
				type: "decision",
				title: "Old architecture",
				rationale: "Replaced",
				classification: "foundational",
				recorded_at: daysAgo(60),
			},
		]);
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-bbbb06",
				type: "convention",
				content: "Cross-domain replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		await runPrune(tmpDir, []);

		const arch = await readLive(tmpDir, "architecture");
		const old = findById(arch, oldId);
		expect(old?.classification).toBe("tactical");
		expect(typeof old?.supersession_demoted_at).toBe("string");
	});

	it("staleness wins over supersession when both apply: record archives without an extra demotion step", async () => {
		const oldId = "mx-aaaa07";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Stale and superseded",
				classification: "tactical",
				recorded_at: daysAgo(60),
			},
			{
				id: "mx-bbbb07",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		await runPrune(tmpDir, []);

		const live = await readLive(tmpDir, "testing");
		expect(findById(live, oldId)).toBeUndefined();
		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive).toHaveLength(1);
		expect(archive[0]?.id).toBe(oldId);
		// Staleness is the reason for archive — we did not stamp a demotion mid-flight.
		expect(archive[0]?.supersession_demoted_at).toBeUndefined();
	});

	it("A↔B supersession cycle: neither cycle member is demoted, both stay live", async () => {
		// Pre-fix bug: A.supersedes=[B] and B.supersedes=[A] caused both ids to
		// land in supersededIds, so both got demoted/archived together. The
		// cycle-detection path must keep both alive.
		const aId = "mx-cycle1a";
		const bId = "mx-cycle1b";
		await seedDomain(tmpDir, "testing", [
			{
				id: aId,
				type: "convention",
				content: "Record A",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [bId],
			},
			{
				id: bId,
				type: "convention",
				content: "Record B",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [aId],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stderr).toMatch(/cycle/i);

		const live = await readLive(tmpDir, "testing");
		expect(live).toHaveLength(2);
		const a = findById(live, aId);
		const b = findById(live, bId);
		expect(a?.classification).toBe("foundational");
		expect(b?.classification).toBe("foundational");
		expect(a?.supersession_demoted_at).toBeUndefined();
		expect(b?.supersession_demoted_at).toBeUndefined();
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("triangular supersession cycle (A→B→C→A): all three cycle members survive a prune pass", async () => {
		const aId = "mx-tri001a";
		const bId = "mx-tri001b";
		const cId = "mx-tri001c";
		await seedDomain(tmpDir, "testing", [
			{
				id: aId,
				type: "convention",
				content: "A supersedes B",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [bId],
			},
			{
				id: bId,
				type: "convention",
				content: "B supersedes C",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [cId],
			},
			{
				id: cId,
				type: "convention",
				content: "C supersedes A",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [aId],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);

		const live = await readLive(tmpDir, "testing");
		expect(live).toHaveLength(3);
		for (const id of [aId, bId, cId]) {
			expect(findById(live, id)?.classification).toBe("foundational");
		}
	});

	it("a record outside any cycle still demotes even when other records form a cycle", async () => {
		const cycleA = "mx-mix001a";
		const cycleB = "mx-mix001b";
		const oldId = "mx-mix001c";
		const replacementId = "mx-mix001d";
		await seedDomain(tmpDir, "testing", [
			{
				id: cycleA,
				type: "convention",
				content: "Cycle A",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [cycleB],
			},
			{
				id: cycleB,
				type: "convention",
				content: "Cycle B",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [cycleA],
			},
			{
				id: oldId,
				type: "convention",
				content: "Genuinely old",
				classification: "foundational",
				recorded_at: daysAgo(1),
			},
			{
				id: replacementId,
				type: "convention",
				content: "Replacement (no cycle)",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);

		const live = await readLive(tmpDir, "testing");
		// Cycle members untouched.
		expect(findById(live, cycleA)?.classification).toBe("foundational");
		expect(findById(live, cycleB)?.classification).toBe("foundational");
		// Non-cycle supersession still demotes.
		expect(findById(live, oldId)?.classification).toBe("tactical");
		expect(typeof findById(live, oldId)?.supersession_demoted_at).toBe("string");
	});

	it("self-supersession does not demote a record (typo guard)", async () => {
		const selfId = "mx-aaaa08";
		await seedDomain(tmpDir, "testing", [
			{
				id: selfId,
				type: "convention",
				content: "Self-referencing typo",
				classification: "foundational",
				recorded_at: daysAgo(30),
				supersedes: [selfId],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);

		const live = await readLive(tmpDir, "testing");
		expect(live).toHaveLength(1);
		expect(live[0]?.classification).toBe("foundational");
	});

	it("supersedes pointing at an unknown id is a harmless no-op", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-bbbb09",
				type: "convention",
				content: "Replacement of nothing",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: ["mx-deadbeef"],
			},
		]);

		const result = await runPrune(tmpDir, []);
		expect(result.exitCode ?? 0).toBe(0);
		const live = await readLive(tmpDir, "testing");
		expect(live).toHaveLength(1);
	});

	it("re-running prune cascades a supersession-demoted record one tier per pass", async () => {
		const oldId = "mx-aaaa10";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old foundational",
				classification: "foundational",
				recorded_at: daysAgo(1),
			},
			{
				id: "mx-bbbb10",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		await runPrune(tmpDir, []);
		let live = await readLive(tmpDir, "testing");
		expect(findById(live, oldId)?.classification).toBe("tactical");

		await runPrune(tmpDir, []);
		live = await readLive(tmpDir, "testing");
		expect(findById(live, oldId)?.classification).toBe("observational");

		await runPrune(tmpDir, []);
		live = await readLive(tmpDir, "testing");
		expect(findById(live, oldId)).toBeUndefined();
		const archive = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archive.find((r) => r.id === oldId)).toBeDefined();
	});

	it("--json reports totalDemoted, totalPruned, and per-domain demoted counts", async () => {
		const oldId = "mx-aaaa11";
		await seedDomain(tmpDir, "testing", [
			{
				id: oldId,
				type: "convention",
				content: "Old foundational",
				classification: "foundational",
				recorded_at: daysAgo(30),
			},
			{
				id: "mx-bbbb11",
				type: "convention",
				content: "Replacement",
				classification: "foundational",
				recorded_at: daysAgo(1),
				supersedes: [oldId],
			},
		]);

		const result = await runPrune(tmpDir, ["--json"]);
		expect(result.exitCode ?? 0).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.success).toBe(true);
		expect(payload.totalDemoted).toBe(1);
		expect(payload.totalPruned).toBe(0);
		const domainEntry = payload.results.find((r: { domain: string }) => r.domain === "testing");
		expect(domainEntry).toMatchObject({ pruned: 0, demoted: 1, before: 2, after: 2 });
	});
});
