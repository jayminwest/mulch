import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerPruneCommand } from "../../src/commands/prune.ts";
import { registerRestoreCommand } from "../../src/commands/restore.ts";
import { registerSearchCommand } from "../../src/commands/search.ts";
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

async function runCommand(
	tmpDir: string,
	register: (program: Command) => void,
	args: string[],
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

	try {
		const program = new Command();
		program.option("--json", "output JSON");
		program.exitOverride();
		register(program);
		await program.parseAsync(["node", "mulch", ...args]);
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

describe("ml prune soft-archive flow", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-prune-archive-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("default behaviour moves stale records to .mulch/archive/<domain>.jsonl with status + archived_at", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				type: "convention",
				content: "Permanent",
				classification: "foundational",
				recorded_at: daysAgo(365),
			},
			{
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(20),
			},
		]);

		const result = await runCommand(tmpDir, registerPruneCommand, ["prune"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Archived");

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(live[0]).toMatchObject({ content: "Permanent" });

		const archivePath = getArchivePath("testing", tmpDir);
		expect(existsSync(archivePath)).toBe(true);
		const archived = await readArchiveFile(archivePath);
		expect(archived).toHaveLength(1);
		expect(archived[0]).toMatchObject({ content: "Stale tactical", status: "archived" });
		expect(typeof archived[0]?.archived_at).toBe("string");
	});

	it("--hard deletes stale records without writing to .mulch/archive/", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runCommand(tmpDir, registerPruneCommand, ["prune", "--hard"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Deleted");

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(0);

		const archivePath = getArchivePath("testing", tmpDir);
		expect(existsSync(archivePath)).toBe(false);
	});

	it("--dry-run does not touch live or archive files", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
		]);

		const result = await runCommand(tmpDir, registerPruneCommand, ["prune", "--dry-run"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Would archive");

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});
});

describe("ml restore", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-restore-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("archive then restore round-trips a record back to live without status fields", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
		]);

		await runCommand(tmpDir, registerPruneCommand, ["prune"]);

		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(1);
		const archivedId = archived[0]?.id ?? "";
		expect(archivedId).toMatch(/^mx-/);

		const result = await runCommand(tmpDir, registerRestoreCommand, ["restore", archivedId]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Restored");

		const liveAfter = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(liveAfter).toHaveLength(1);
		expect(liveAfter[0]?.id).toBe(archivedId);
		expect(liveAfter[0]?.status).toBeUndefined();
		expect(liveAfter[0]?.archived_at).toBeUndefined();

		const archivedAfter = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archivedAfter).toHaveLength(0);
	});

	it("errors when the id does not match any archived record", async () => {
		const result = await runCommand(tmpDir, registerRestoreCommand, ["restore", "mx-deadbeef"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("not found");
	});

	it("refuses to restore over a duplicate live id and leaves the archive intact", async () => {
		// Seed a stale tactical, prune it (soft-archive), then re-record a NEW
		// record with the same id while it's archived. Restore must refuse
		// rather than silently produce a duplicate-id live file.
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-dup001",
				type: "convention",
				content: "Stale tactical",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
		]);

		await runCommand(tmpDir, registerPruneCommand, ["prune"]);

		const archivedBefore = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archivedBefore).toHaveLength(1);
		expect(archivedBefore[0]?.id).toBe("mx-dup001");

		// Re-add the same id to live by hand, simulating a re-record.
		await appendRecord(getExpertisePath("testing", tmpDir), {
			id: "mx-dup001",
			type: "convention",
			content: "Replacement live record with same id",
			classification: "foundational",
			recorded_at: daysAgo(0),
		});

		const result = await runCommand(tmpDir, registerRestoreCommand, ["restore", "mx-dup001"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/already exists/i);

		// Live file unchanged: still exactly one record with that id.
		const liveAfter = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(liveAfter.filter((r) => r.id === "mx-dup001")).toHaveLength(1);
		expect(liveAfter[0]).toMatchObject({ content: "Replacement live record with same id" });

		// Archive untouched: the original is still there for `ml search --archived`.
		const archivedAfter = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archivedAfter).toHaveLength(1);
		expect(archivedAfter[0]?.id).toBe("mx-dup001");
	});
});

describe("ml search --archived", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-search-archived-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		await seedDomain(tmpDir, "testing", [
			{
				type: "convention",
				content: "Permanent payload",
				classification: "foundational",
				recorded_at: daysAgo(365),
			},
			{
				type: "convention",
				content: "Stale tactical payload",
				classification: "tactical",
				recorded_at: daysAgo(30),
			},
		]);
		await runCommand(tmpDir, registerPruneCommand, ["prune"]);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("excludes archived records from output by default", async () => {
		const result = await runCommand(tmpDir, registerSearchCommand, ["search", "payload"]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Permanent payload");
		expect(result.stdout).not.toContain("Stale tactical payload");
		expect(result.stdout).not.toContain("[ARCHIVED");
	});

	it("--archived includes the archived match with [ARCHIVED <date> <reason>] prefix", async () => {
		const result = await runCommand(tmpDir, registerSearchCommand, [
			"search",
			"payload",
			"--archived",
		]);
		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Permanent payload");
		expect(result.stdout).toContain("Stale tactical payload");
		expect(result.stdout).toContain("(archived,");
		expect(result.stdout).toMatch(/\[ARCHIVED \d{4}-\d{2}-\d{2} stale\]/);
	});
});
