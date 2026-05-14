import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerArchiveCommand } from "../../src/commands/archive.ts";
import { registerRestoreCommand } from "../../src/commands/restore.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { getArchivePath, readArchiveFile } from "../../src/utils/archive.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

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

describe("ml archive", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-archive-cmd-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("moves a single record from live to archive with status + archived_at + manual reason", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-keep001",
				type: "convention",
				content: "Keep me alive",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
			{
				id: "mx-arch001",
				type: "convention",
				content: "Archive me directly",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"mx-arch001",
			"--reason",
			"wrong",
		]);

		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Archived");
		expect(result.stdout).toContain("manual: wrong");

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(live[0]?.id).toBe("mx-keep001");

		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(1);
		expect(archived[0]).toMatchObject({
			id: "mx-arch001",
			status: "archived",
			archive_reason: "manual: wrong",
		});
		expect(typeof archived[0]?.archived_at).toBe("string");
	});

	it("accepts prefix ids (matches `ml delete`/`ml restore` resolution)", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-abcdef12",
				type: "convention",
				content: "Prefix me",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"abc",
			"--reason",
			"prefix resolves",
		]);

		expect(result.exitCode ?? 0).toBe(0);
		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(1);
		expect(archived[0]?.id).toBe("mx-abcdef12");
	});

	it("--records archives multiple ids in a single pass with the same reason", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-bulk001",
				type: "convention",
				content: "A",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
			{
				id: "mx-bulk002",
				type: "convention",
				content: "B",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
			{
				id: "mx-bulk003",
				type: "convention",
				content: "C",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"--records",
			"mx-bulk001,mx-bulk002",
			"--reason",
			"duplicate cluster",
		]);

		expect(result.exitCode ?? 0).toBe(0);

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(live[0]?.id).toBe("mx-bulk003");

		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(2);
		expect(archived.map((r) => r.id).sort()).toEqual(["mx-bulk001", "mx-bulk002"]);
		for (const r of archived) {
			expect(r.archive_reason).toBe("manual: duplicate cluster");
			expect(r.status).toBe("archived");
		}
	});

	it("--dry-run previews without writing to live or archive files", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-dry0001",
				type: "convention",
				content: "Dry run target",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"--records",
			"mx-dry0001",
			"--reason",
			"preview only",
			"--dry-run",
		]);

		expect(result.exitCode ?? 0).toBe(0);
		expect(result.stdout).toContain("Would archive");

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("refuses an unknown id with a helpful error and leaves files untouched", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-real0001",
				type: "convention",
				content: "Real record",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"mx-nope",
			"--reason",
			"won't fire",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/not found/i);

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("rejects an unknown domain", async () => {
		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"nope",
			"mx-anything",
			"--reason",
			"won't fire",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/domain "nope" not found/i);
	});

	it("requires --reason (commander's required-option gate)", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-req00001",
				type: "convention",
				content: "Should not be archived",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		// Commander's exitOverride throws a CommanderError for missing required
		// options before the action runs; the runner swallows it. Assert the
		// action didn't fire by checking the live file is untouched and no
		// archive file was created.
		await runCommand(tmpDir, registerArchiveCommand, ["archive", "testing", "mx-req00001"]);

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(existsSync(getArchivePath("testing", tmpDir))).toBe(false);
	});

	it("rejects an empty --reason", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-empty001",
				type: "convention",
				content: "X",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"mx-empty001",
			"--reason",
			"   ",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/--reason must not be empty/i);
	});

	it("rejects combining a positional id with --records", async () => {
		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"mx-anything",
			"--records",
			"mx-other",
			"--reason",
			"won't fire",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/cannot combine/i);
	});

	it("requires either a positional id or --records", async () => {
		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"--reason",
			"won't fire",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/must provide a record ID or --records/i);
	});

	it("emits structured JSON when --json is set", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-json0001",
				type: "convention",
				content: "JSON target",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const result = await runCommand(tmpDir, registerArchiveCommand, [
			"--json",
			"archive",
			"testing",
			"mx-json0001",
			"--reason",
			"json mode",
		]);

		expect(result.exitCode ?? 0).toBe(0);
		const parsed = JSON.parse(result.stdout);
		expect(parsed).toMatchObject({
			success: true,
			command: "archive",
			domain: "testing",
			dryRun: false,
			kept: 0,
		});
		expect(parsed.archived).toHaveLength(1);
		expect(parsed.archived[0]).toMatchObject({
			id: "mx-json0001",
			type: "convention",
			reason: "manual: json mode",
		});
	});

	it("round-trips through `ml restore`: archived → restored back to live without status fields", async () => {
		await seedDomain(tmpDir, "testing", [
			{
				id: "mx-rnd00001",
				type: "convention",
				content: "Round-trip me",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
		]);

		const archiveRes = await runCommand(tmpDir, registerArchiveCommand, [
			"archive",
			"testing",
			"mx-rnd00001",
			"--reason",
			"oops",
		]);
		expect(archiveRes.exitCode ?? 0).toBe(0);

		const archived = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archived).toHaveLength(1);
		expect(archived[0]?.archive_reason).toBe("manual: oops");

		const restoreRes = await runCommand(tmpDir, registerRestoreCommand, ["restore", "mx-rnd00001"]);
		expect(restoreRes.exitCode ?? 0).toBe(0);

		const live = await readExpertiseFile(getExpertisePath("testing", tmpDir));
		expect(live).toHaveLength(1);
		expect(live[0]?.id).toBe("mx-rnd00001");
		expect(live[0]?.status).toBeUndefined();
		expect(live[0]?.archived_at).toBeUndefined();
		expect(live[0]?.archive_reason).toBeUndefined();

		const archivedAfter = await readArchiveFile(getArchivePath("testing", tmpDir));
		expect(archivedAfter).toHaveLength(0);
	});
});
