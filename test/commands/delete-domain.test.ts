import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerDeleteDomainCommand } from "../../src/commands/delete-domain.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import {
	addDomain,
	getExpertisePath,
	initMulchDir,
	readConfig,
	removeDomain,
	writeConfig,
} from "../../src/utils/config.ts";
import { createExpertiseFile } from "../../src/utils/expertise.ts";

async function runDeleteDomain(
	tmpDir: string,
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
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
		registerDeleteDomainCommand(program);
		await program.parseAsync(["node", "mulch", "delete-domain", ...args]);
	} catch {
		// ignore
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

async function runDeleteDomainJson(
	tmpDir: string,
	args: string[],
): Promise<{ parsed: unknown; exitCode: number | undefined }> {
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
		registerDeleteDomainCommand(program);
		await program.parseAsync(["node", "mulch", "--json", "delete-domain", ...args]);
	} catch {
		// ignore
	} finally {
		process.chdir(origCwd);
		logSpy.mockRestore();
		errSpy.mockRestore();
	}
	const exitCode = process.exitCode as number | undefined;
	process.exitCode = prevExitCode;
	const allOutput = [...stdoutLines, ...stderrLines].join("\n");
	let parsed: unknown = {};
	try {
		parsed = JSON.parse(allOutput || "{}");
	} catch {
		// ignore parse errors
	}
	return { parsed, exitCode };
}

describe("delete-domain command (removeDomain)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-delete-domain-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("removes an existing domain from config", async () => {
		await addDomain("testing", tmpDir);
		const before = await readConfig(tmpDir);
		expect(before.domains).toHaveProperty("testing");

		await removeDomain("testing", tmpDir);

		const after = await readConfig(tmpDir);
		expect(after.domains).not.toHaveProperty("testing");
	});

	it("throws when domain does not exist", async () => {
		await expect(removeDomain("nonexistent", tmpDir)).rejects.toThrow(
			'Domain "nonexistent" not found in config.',
		);
	});

	it("always deletes expertise file", async () => {
		await addDomain("testing", tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		expect(existsSync(filePath)).toBe(true);

		await removeDomain("testing", tmpDir);

		expect(existsSync(filePath)).toBe(false);
	});

	it("does not throw when expertise file is already missing", async () => {
		await addDomain("testing", tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await rm(filePath);

		await expect(removeDomain("testing", tmpDir)).resolves.toBeUndefined();
		const after = await readConfig(tmpDir);
		expect(after.domains).not.toHaveProperty("testing");
	});

	it("removes only the specified domain, leaves others intact", async () => {
		await addDomain("alpha", tmpDir);
		await addDomain("beta", tmpDir);
		await addDomain("gamma", tmpDir);

		await removeDomain("beta", tmpDir);

		const config = await readConfig(tmpDir);
		expect(config.domains).not.toHaveProperty("beta");
		expect(config.domains).toHaveProperty("alpha");
		expect(config.domains).toHaveProperty("gamma");
	});

	it("config governance settings are preserved after removal", async () => {
		await addDomain("testing", tmpDir);
		await removeDomain("testing", tmpDir);

		const config = await readConfig(tmpDir);
		expect(config.governance.max_entries).toBe(100);
		expect(config.governance.warn_entries).toBe(150);
		expect(config.governance.hard_limit).toBe(200);
	});
});

describe("delete-domain CLI", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-delete-domain-cli-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("deletes domain and file with --yes", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		expect(existsSync(filePath)).toBe(true);

		const { exitCode } = await runDeleteDomain(tmpDir, ["testing", "--yes"]);

		expect(exitCode).toBe(0);
		const config = await readConfig(tmpDir);
		expect(config.domains).not.toHaveProperty("testing");
		expect(existsSync(filePath)).toBe(false);
	});

	it("sets exitCode=1 for nonexistent domain", async () => {
		const { exitCode, stderr } = await runDeleteDomain(tmpDir, ["nonexistent", "--yes"]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("nonexistent");
	});

	it("dry-run with --yes does not delete anything", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		const { exitCode, stdout } = await runDeleteDomain(tmpDir, ["testing", "--yes", "--dry-run"]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("[DRY RUN]");
		// Domain and file should still exist
		const config = await readConfig(tmpDir);
		expect(config.domains).toHaveProperty("testing");
		expect(existsSync(filePath)).toBe(true);
	});

	it("JSON mode: returns success payload with --yes", async () => {
		const { parsed, exitCode } = await runDeleteDomainJson(tmpDir, ["testing", "--yes"]);

		expect(exitCode).toBe(0);
		expect(parsed).toMatchObject({
			success: true,
			command: "delete-domain",
			domain: "testing",
			deletedFile: true,
		});
	});

	it("JSON mode: returns error for nonexistent domain", async () => {
		const { parsed, exitCode } = await runDeleteDomainJson(tmpDir, ["nonexistent", "--yes"]);

		expect(exitCode).toBe(1);
		expect(parsed).toMatchObject({ success: false, command: "delete-domain" });
	});

	it("JSON mode dry-run: returns dryRun:true without deleting", async () => {
		const { parsed, exitCode } = await runDeleteDomainJson(tmpDir, ["testing", "--dry-run"]);

		expect(exitCode).toBe(0);
		expect(parsed).toMatchObject({
			success: true,
			command: "delete-domain",
			domain: "testing",
			dryRun: true,
		});
		const config = await readConfig(tmpDir);
		expect(config.domains).toHaveProperty("testing");
	});
});
