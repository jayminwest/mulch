import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerPrimeCommand } from "../../src/commands/prime.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getExpertisePath, initMulchDir, readConfig, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../../src/utils/expertise.ts";

// Index-mode prime (mulch-bffe): failure-first ranking, anchored-failure
// pinning under --budget, --records-only hook output, supersession hiding.
describe("prime index mode (mulch-bffe)", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-prime-index-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
		const cliPath = getExpertisePath("cli", tmpDir);
		await createExpertiseFile(cliPath);
		const now = new Date().toISOString();
		await appendRecord(cliPath, {
			type: "convention",
			content: "Starred broad convention",
			classification: "foundational",
			recorded_at: now,
			id: "mx-4001",
			outcomes: [{ status: "success" }, { status: "success" }],
		});
		await appendRecord(cliPath, {
			type: "convention",
			content: "Old rule that was replaced",
			classification: "foundational",
			recorded_at: now,
			id: "mx-4002",
		});
		await appendRecord(cliPath, {
			type: "convention",
			content: "New rule replacing the old one",
			classification: "foundational",
			recorded_at: now,
			id: "mx-4003",
			supersedes: ["mx-4002"],
		});
		await appendRecord(cliPath, {
			type: "failure",
			description: "Parser crashes on empty input",
			resolution: "Guard the empty string before tokenizing",
			classification: "tactical",
			recorded_at: now,
			id: "mx-4004",
			dir_anchors: ["src/parser"],
		});
		process.chdir(tmpDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.exitCode = 0;
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function runPrime(args: string[]): Promise<string> {
		const program = new Command();
		program.name("mulch").option("--json", "output as structured JSON").exitOverride();
		registerPrimeCommand(program);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const errSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			await program.parseAsync(["node", "mulch", "prime", ...args]);
			return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		} finally {
			logSpy.mockRestore();
			errSpy.mockRestore();
		}
	}

	it("lists failures first in the index", async () => {
		const output = await runPrime(["--all"]);
		const failureAt = output.indexOf("mx-4004 [failure]");
		expect(failureAt).toBeGreaterThan(-1);
		expect(failureAt).toBeLessThan(output.indexOf("mx-4001 [convention]"));
	});

	it("hides records superseded by a live record", async () => {
		const output = await runPrime(["--all"]);
		expect(output).toContain("mx-4003");
		expect(output).not.toContain("mx-4002");
		const full = await runPrime(["--full", "--all"]);
		expect(full).not.toContain("Old rule that was replaced");
	});

	it("keeps anchored failures under a tiny --files budget", async () => {
		const output = await runPrime([
			"--files",
			"src/parser/lex.ts",
			"--budget",
			"1",
			"--records-only",
		]);
		expect(output).toContain("mx-4004 [failure] Parser crashes on empty input (src/parser)");
		expect(output).not.toContain("mx-4001");
	});

	it("--records-only emits record lines without contract, quick reference, or footer", async () => {
		const output = await runPrime(["--files", "src/parser/lex.ts", "--records-only"]);
		expect(output.startsWith("## cli (")).toBe(true);
		expect(output).not.toContain("# Project Expertise");
		expect(output).not.toContain("Quick Reference");
		expect(output).not.toContain("SESSION CLOSE");
	});

	it("--records-only prints nothing when no record matches", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { empty: {} } }, tmpDir);
		await createExpertiseFile(getExpertisePath("empty", tmpDir));
		const output = await runPrime(["--files", "src/nowhere.ts", "--records-only"]);
		expect(output).toBe("");
	});

	it("--records-only overrides a manifest default_mode", async () => {
		const config = await readConfig(tmpDir);
		await writeConfig({ ...config, prime: { default_mode: "manifest" } }, tmpDir);
		const output = await runPrime(["--records-only"]);
		expect(output).not.toContain("Manifest");
		expect(output).toContain("mx-4004 [failure]");
	});
});
