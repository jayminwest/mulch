import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerPrimeCommand } from "../../src/commands/prime.ts";
import { registerStaleCommand } from "../../src/commands/stale.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../../src/utils/expertise.ts";

describe("stale command (mulch-094a)", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-stale-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {}, db: {} } }, tmpDir);
		const cliPath = getExpertisePath("cli", tmpDir);
		await createExpertiseFile(cliPath);
		await createExpertiseFile(getExpertisePath("db", tmpDir));
		const now = new Date().toISOString();
		await appendRecord(cliPath, {
			type: "pattern",
			name: "gone-anchor",
			description: "Pattern anchored to a deleted file",
			classification: "foundational",
			recorded_at: now,
			id: "mx-5001",
			files: ["src/gone.ts"],
		});
		await appendRecord(cliPath, {
			type: "convention",
			content: "Fresh unanchored rule",
			classification: "foundational",
			recorded_at: now,
			id: "mx-5002",
		});
		await appendRecord(cliPath, {
			type: "pattern",
			name: "replaced",
			description: "Superseded pattern with a deleted anchor",
			classification: "foundational",
			recorded_at: now,
			id: "mx-5003",
			files: ["src/old.ts"],
		});
		await appendRecord(cliPath, {
			type: "convention",
			content: "Replacement rule",
			classification: "foundational",
			recorded_at: now,
			id: "mx-5004",
			supersedes: ["mx-5003"],
		});
		process.chdir(tmpDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.exitCode = 0;
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function run(args: string[]): Promise<{ out: string; err: string }> {
		const program = new Command();
		program.name("mulch").option("--json", "output as structured JSON").exitOverride();
		registerStaleCommand(program);
		registerPrimeCommand(program);
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

	it("lists stale live records with reasons, skipping superseded ones", async () => {
		const { out } = await run(["stale"]);
		expect(out).toContain("mx-5001 (cli, pattern) missing anchors: src/gone.ts");
		expect(out).toContain("1 stale record(s)");
		expect(out).not.toContain("mx-5002");
		expect(out).not.toContain("mx-5003");
	});

	it("emits JSON with ids and structured reasons", async () => {
		const { out } = await run(["--json", "stale"]);
		const parsed = JSON.parse(out);
		expect(parsed.success).toBe(true);
		expect(parsed.records).toEqual([
			{
				id: "mx-5001",
				domain: "cli",
				type: "pattern",
				reasons: [{ kind: "anchors_missing", detail: "missing anchors: src/gone.ts" }],
			},
		]);
	});

	it("reports a clean domain and rejects unknown domains", async () => {
		expect((await run(["stale", "db"])).out).toContain("No stale records.");
		const { err } = await run(["stale", "nope"]);
		expect(err).toContain('Domain "nope" not found');
		expect(process.exitCode).toBe(1);
	});

	it("prime marks stale records in the index", async () => {
		const { out } = await run(["prime", "--records-only", "--all"]);
		expect(out).toMatch(/mx-5001 .*\(stale\?\)/);
		expect(out).not.toMatch(/mx-5002 .*\(stale\?\)/);
		const full = await run(["prime", "--full", "--all"]);
		expect(full.out).toContain("stale?");
	});

	it("prime does not mark shelf_life-only records (reported by ml stale only)", async () => {
		const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
		await appendRecord(getExpertisePath("db", tmpDir), {
			type: "convention",
			content: "Old unconfirmed tactical rule",
			classification: "tactical",
			recorded_at: old,
			id: "mx-5005",
		});
		expect((await run(["stale", "db"])).out).toContain("mx-5005");
		const { out } = await run(["prime", "--records-only", "--all"]);
		expect(out).toContain("mx-5005");
		expect(out).not.toMatch(/mx-5005 .*\(stale\?\)/);
	});
});
