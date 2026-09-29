import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerShowCommand } from "../../src/commands/show.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../../src/utils/expertise.ts";

describe("show command", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-show-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {}, db: {} } }, tmpDir);
		const now = new Date().toISOString();
		const cliPath = getExpertisePath("cli", tmpDir);
		const dbPath = getExpertisePath("db", tmpDir);
		await createExpertiseFile(cliPath);
		await createExpertiseFile(dbPath);
		await appendRecord(cliPath, {
			type: "failure",
			description: "Parser crashes on empty input",
			resolution: "Guard the empty string before tokenizing",
			classification: "tactical",
			recorded_at: now,
			id: "mx-aa0001",
		});
		await appendRecord(dbPath, {
			type: "convention",
			content: "Use WAL mode",
			classification: "foundational",
			recorded_at: now,
			id: "mx-aa0002",
		});
		process.chdir(tmpDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.exitCode = 0;
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function runShow(args: string[]): Promise<{ out: string; err: string }> {
		const program = new Command();
		program.name("mulch").option("--json", "output as structured JSON").exitOverride();
		registerShowCommand(program);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const errSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			await program.parseAsync(["node", "mulch", ...args]);
			return {
				out: logSpy.mock.calls.map((c) => String(c[0])).join("\n"),
				err: errSpy.mock.calls.map((c) => String(c[0])).join("\n"),
			};
		} finally {
			logSpy.mockRestore();
			errSpy.mockRestore();
		}
	}

	it("prints the full body of records across domains", async () => {
		const { out } = await runShow(["show", "mx-aa0001", "aa0002"]);
		expect(out).toContain("## cli");
		expect(out).toContain("Parser crashes on empty input");
		expect(out).toContain("Guard the empty string before tokenizing");
		expect(out).toContain("## db");
		expect(out).toContain("Use WAL mode");
	});

	it("emits records with their domain in --json mode", async () => {
		const { out } = await runShow(["--json", "show", "mx-aa0002"]);
		const parsed = JSON.parse(out);
		expect(parsed.success).toBe(true);
		expect(parsed.records).toHaveLength(1);
		expect(parsed.records[0].domain).toBe("db");
		expect(parsed.records[0].record.content).toBe("Use WAL mode");
	});

	it("errors on an unknown id", async () => {
		const { err } = await runShow(["show", "mx-ffff"]);
		expect(err).toContain('Record "mx-ffff" not found');
		expect(process.exitCode).toBe(1);
	});

	it("errors on an ambiguous prefix", async () => {
		const { err } = await runShow(["show", "aa"]);
		expect(err).toContain("Ambiguous identifier");
		expect(process.exitCode).toBe(1);
	});
});
