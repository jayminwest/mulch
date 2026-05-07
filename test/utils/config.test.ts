import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MulchConfig } from "../../src/schemas/config.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import {
	getConfigPath,
	getExpertiseDir,
	getExpertisePath,
	getMulchDir,
	initMulchDir,
	readConfig,
	validateDomainName,
	writeConfig,
} from "../../src/utils/config.ts";

describe("config utils", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("path helpers", () => {
		it("getMulchDir returns .mulch under cwd", () => {
			expect(getMulchDir("/some/path")).toBe("/some/path/.mulch");
		});

		it("getConfigPath returns config file under .mulch", () => {
			expect(getConfigPath("/some/path")).toBe("/some/path/.mulch/mulch.config.yaml");
		});

		it("getExpertiseDir returns expertise dir under .mulch", () => {
			expect(getExpertiseDir("/some/path")).toBe("/some/path/.mulch/expertise");
		});

		it("getExpertisePath returns JSONL file for a domain", () => {
			expect(getExpertisePath("testing", "/some/path")).toBe(
				"/some/path/.mulch/expertise/testing.jsonl",
			);
		});
	});

	describe("initMulchDir", () => {
		it("creates .mulch directory structure", async () => {
			await initMulchDir(tmpDir);

			expect(existsSync(getMulchDir(tmpDir))).toBe(true);
			expect(existsSync(getExpertiseDir(tmpDir))).toBe(true);
			expect(existsSync(getConfigPath(tmpDir))).toBe(true);
		});

		it("writes default config", async () => {
			await initMulchDir(tmpDir);

			const config = await readConfig(tmpDir);
			expect(config.version).toBe(DEFAULT_CONFIG.version);
			expect(config.domains).toEqual(DEFAULT_CONFIG.domains);
			expect(config.governance).toEqual(DEFAULT_CONFIG.governance);
		});

		it("can be called twice without error", async () => {
			await initMulchDir(tmpDir);
			await expect(initMulchDir(tmpDir)).resolves.toBeUndefined();
		});
	});

	describe("readConfig", () => {
		it("reads a valid YAML config", async () => {
			await initMulchDir(tmpDir);
			const config = await readConfig(tmpDir);

			expect(config).toBeDefined();
			expect(config.version).toBe("1");
			expect(typeof config.domains).toBe("object");
			expect(Array.isArray(config.domains)).toBe(false);
			expect(config.governance.max_entries).toBe(100);
		});

		it("throws when config file does not exist", async () => {
			await expect(readConfig(tmpDir)).rejects.toThrow();
		});

		it("backfills missing governance and classification_defaults on a minimal config", async () => {
			// Hand-written minimal config that omits the schema's required
			// top-level sections. Consumers (doctor, prune, status, compact, prime)
			// destructure these directly, so readConfig must apply defaults
			// instead of crashing downstream with TypeError.
			await initMulchDir(tmpDir);
			const minimalYaml = `domains:
  cli: {}
`;
			await writeFile(getConfigPath(tmpDir), minimalYaml, "utf-8");

			const config = await readConfig(tmpDir);
			expect(config.governance).toEqual(DEFAULT_CONFIG.governance);
			expect(config.classification_defaults).toEqual(DEFAULT_CONFIG.classification_defaults);
			expect(config.domains).toEqual({ cli: {} });
		});

		it("preserves partial governance overrides while filling missing keys", async () => {
			await initMulchDir(tmpDir);
			const partialYaml = `domains:
  cli: {}
governance:
  max_entries: 42
`;
			await writeFile(getConfigPath(tmpDir), partialYaml, "utf-8");

			const config = await readConfig(tmpDir);
			expect(config.governance.max_entries).toBe(42);
			expect(config.governance.warn_entries).toBe(DEFAULT_CONFIG.governance.warn_entries);
			expect(config.governance.hard_limit).toBe(DEFAULT_CONFIG.governance.hard_limit);
		});

		it("formats YAML parse errors with a friendly message", async () => {
			await initMulchDir(tmpDir);
			// Invalid YAML — unclosed bracket
			await writeFile(getConfigPath(tmpDir), "domains: {cli: {", "utf-8");

			await expect(readConfig(tmpDir)).rejects.toThrow(/Failed to parse mulch.config.yaml/);
		});
	});

	describe("validateDomainName", () => {
		it("accepts simple alphanumeric names", () => {
			expect(() => validateDomainName("cli")).not.toThrow();
			expect(() => validateDomainName("testing")).not.toThrow();
			expect(() => validateDomainName("architecture")).not.toThrow();
		});

		it("accepts names with hyphens and underscores", () => {
			expect(() => validateDomainName("my-domain")).not.toThrow();
			expect(() => validateDomainName("my_domain")).not.toThrow();
			expect(() => validateDomainName("front-end")).not.toThrow();
		});

		it("accepts names starting with digits", () => {
			expect(() => validateDomainName("3d-rendering")).not.toThrow();
		});

		it("rejects path traversal attempts", () => {
			expect(() => validateDomainName("../../etc/passwd")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName("../secrets")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName("foo/../../bar")).toThrow(/Invalid domain name/);
		});

		it("rejects names with slashes", () => {
			expect(() => validateDomainName("foo/bar")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName("/absolute")).toThrow(/Invalid domain name/);
		});

		it("rejects names with dots", () => {
			expect(() => validateDomainName("my.domain")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName(".hidden")).toThrow(/Invalid domain name/);
		});

		it("rejects empty string", () => {
			expect(() => validateDomainName("")).toThrow(/Invalid domain name/);
		});

		it("rejects names starting with hyphen or underscore", () => {
			expect(() => validateDomainName("-leading")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName("_leading")).toThrow(/Invalid domain name/);
		});

		it("rejects names with spaces or special characters", () => {
			expect(() => validateDomainName("my domain")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName("domain;rm -rf")).toThrow(/Invalid domain name/);
			expect(() => validateDomainName("$(whoami)")).toThrow(/Invalid domain name/);
		});
	});

	describe("getExpertisePath with validation", () => {
		it("returns path for valid domain", () => {
			expect(getExpertisePath("testing", "/some/path")).toBe(
				"/some/path/.mulch/expertise/testing.jsonl",
			);
		});

		it("rejects path traversal via domain name", () => {
			expect(() => getExpertisePath("../../etc/passwd", "/some/path")).toThrow(
				/Invalid domain name/,
			);
		});
	});

	describe("writeConfig", () => {
		it("writes valid YAML config", async () => {
			await initMulchDir(tmpDir);

			const customConfig: MulchConfig = {
				...DEFAULT_CONFIG,
				domains: { testing: {}, architecture: {} },
			};
			await writeConfig(customConfig, tmpDir);

			const rawContent = await readFile(getConfigPath(tmpDir), "utf-8");
			const parsed = yaml.load(rawContent) as MulchConfig;
			expect(parsed.domains).toEqual({ testing: {}, architecture: {} });
		});

		it("roundtrips config correctly", async () => {
			await initMulchDir(tmpDir);

			const customConfig: MulchConfig = {
				...DEFAULT_CONFIG,
				domains: { frontend: {}, backend: {} },
				governance: { max_entries: 50, warn_entries: 75, hard_limit: 100 },
			};
			await writeConfig(customConfig, tmpDir);
			const readBack = await readConfig(tmpDir);

			expect(readBack).toEqual(customConfig);
		});

		it("normalizes legacy array shape on read", async () => {
			await initMulchDir(tmpDir);

			// Pre-1.x configs persisted domains as a YAML array. readConfig must
			// rewrite that to an object map without forcing user migration.
			const legacyYaml = `version: "1"
domains:
  - testing
  - architecture
governance:
  max_entries: 100
  warn_entries: 150
  hard_limit: 200
classification_defaults:
  shelf_life:
    tactical: 14
    observational: 30
`;
			await writeFile(getConfigPath(tmpDir), legacyYaml, "utf-8");

			const config = await readConfig(tmpDir);
			expect(config.domains).toEqual({ testing: {}, architecture: {} });
		});
	});
});
