import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";
import {
  initMulchDir,
  readConfig,
  writeConfig,
  getMulchDir,
  getConfigPath,
  getExpertiseDir,
  getExpertisePath,
} from "../../src/utils/config.js";
import { DEFAULT_CONFIG } from "../../src/schemas/config.js";
import type { MulchConfig } from "../../src/schemas/config.js";

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
      expect(getConfigPath("/some/path")).toBe(
        "/some/path/.mulch/mulch.config.yaml",
      );
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
      expect(Array.isArray(config.domains)).toBe(true);
      expect(config.governance.max_entries).toBe(100);
    });

    it("throws when config file does not exist", async () => {
      await expect(readConfig(tmpDir)).rejects.toThrow();
    });
  });

  describe("writeConfig", () => {
    it("writes valid YAML config", async () => {
      await initMulchDir(tmpDir);

      const customConfig: MulchConfig = {
        ...DEFAULT_CONFIG,
        domains: ["testing", "architecture"],
      };
      await writeConfig(customConfig, tmpDir);

      const rawContent = await readFile(getConfigPath(tmpDir), "utf-8");
      const parsed = yaml.load(rawContent) as MulchConfig;
      expect(parsed.domains).toEqual(["testing", "architecture"]);
    });

    it("roundtrips config correctly", async () => {
      await initMulchDir(tmpDir);

      const customConfig: MulchConfig = {
        ...DEFAULT_CONFIG,
        domains: ["frontend", "backend"],
        governance: { max_entries: 50, warn_entries: 75, hard_limit: 100 },
      };
      await writeConfig(customConfig, tmpDir);
      const readBack = await readConfig(tmpDir);

      expect(readBack).toEqual(customConfig);
    });
  });
});
