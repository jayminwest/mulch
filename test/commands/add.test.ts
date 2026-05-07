import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerAddCommand } from "../../src/commands/add.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import {
	getExpertisePath,
	getMulchDir,
	initMulchDir,
	readConfig,
	writeConfig,
} from "../../src/utils/config.ts";
import { createExpertiseFile } from "../../src/utils/expertise.ts";
import { setQuiet } from "../../src/utils/palette.ts";

describe("add command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-add-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("adds a new domain to config", async () => {
		const config = await readConfig(tmpDir);
		expect(config.domains).toEqual({});

		config.domains.testing = {};
		await writeConfig(config, tmpDir);

		const updatedConfig = await readConfig(tmpDir);
		expect(updatedConfig.domains).toHaveProperty("testing");
	});

	it("creates expertise file for new domain", async () => {
		const expertisePath = getExpertisePath("testing", tmpDir);
		expect(existsSync(expertisePath)).toBe(false);

		await createExpertiseFile(expertisePath);
		expect(existsSync(expertisePath)).toBe(true);
	});

	it("detects duplicate domain in config", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);

		const config = await readConfig(tmpDir);
		const isDuplicate = "testing" in config.domains;
		expect(isDuplicate).toBe(true);
	});

	it("adding multiple domains works", async () => {
		const config = await readConfig(tmpDir);

		config.domains.testing = {};
		config.domains.architecture = {};
		config.domains.devops = {};
		await writeConfig(config, tmpDir);

		const updatedConfig = await readConfig(tmpDir);
		expect(Object.keys(updatedConfig.domains)).toHaveLength(3);
		expect(updatedConfig.domains).toHaveProperty("testing");
		expect(updatedConfig.domains).toHaveProperty("architecture");
		expect(updatedConfig.domains).toHaveProperty("devops");
	});

	it("creating expertise file for each domain", async () => {
		const domains = ["testing", "architecture", "devops"];
		for (const domain of domains) {
			const expertisePath = getExpertisePath(domain, tmpDir);
			await createExpertiseFile(expertisePath);
			expect(existsSync(expertisePath)).toBe(true);
		}
	});

	it("domain name is preserved in config round-trip", async () => {
		const domainName = "my-special-domain";
		const config = await readConfig(tmpDir);
		config.domains[domainName] = {};
		await writeConfig(config, tmpDir);

		const updatedConfig = await readConfig(tmpDir);
		expect(updatedConfig.domains).toHaveProperty(domainName);
	});

	it("expertise file path uses domain name", () => {
		const path = getExpertisePath("testing", tmpDir);
		expect(path).toContain("testing.jsonl");
	});

	it("requires .mulch/ directory to exist", async () => {
		const emptyDir = await mkdtemp(join(tmpdir(), "mulch-add-empty-"));
		expect(existsSync(getMulchDir(emptyDir))).toBe(false);
		await rm(emptyDir, { recursive: true, force: true });
	});

	it("config preserves governance settings after adding domain", async () => {
		const config = await readConfig(tmpDir);
		config.domains.testing = {};
		await writeConfig(config, tmpDir);

		const updatedConfig = await readConfig(tmpDir);
		expect(updatedConfig.governance.max_entries).toBe(100);
		expect(updatedConfig.governance.warn_entries).toBe(150);
		expect(updatedConfig.governance.hard_limit).toBe(200);
	});

	describe("--quiet semantics", () => {
		it("suppresses the success message when quiet is set", async () => {
			const origCwd = process.cwd();
			process.chdir(tmpDir);
			setQuiet(true);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = new Command();
				program.name("mulch").exitOverride();
				registerAddCommand(program);
				await program.parseAsync(["node", "mulch", "add", "qtest"]);
				expect(logSpy).not.toHaveBeenCalled();
				const updated = await readConfig(tmpDir);
				expect(updated.domains).toHaveProperty("qtest");
			} finally {
				logSpy.mockRestore();
				setQuiet(false);
				process.chdir(origCwd);
			}
		});

		it("emits the success message when quiet is unset", async () => {
			const origCwd = process.cwd();
			process.chdir(tmpDir);
			setQuiet(false);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = new Command();
				program.name("mulch").exitOverride();
				registerAddCommand(program);
				await program.parseAsync(["node", "mulch", "add", "loud"]);
				expect(logSpy).toHaveBeenCalled();
				expect(logSpy.mock.calls[0]?.[0]).toContain("Added domain");
			} finally {
				logSpy.mockRestore();
				process.chdir(origCwd);
			}
		});
	});
});
