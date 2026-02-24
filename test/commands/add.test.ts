import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import {
  getExpertisePath,
  getMulchDir,
  initMulchDir,
  readConfig,
  writeConfig,
} from "../../src/utils/config.ts";
import { createExpertiseFile } from "../../src/utils/expertise.ts";

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
    expect(config.domains).toEqual([]);

    config.domains.push("testing");
    await writeConfig(config, tmpDir);

    const updatedConfig = await readConfig(tmpDir);
    expect(updatedConfig.domains).toContain("testing");
  });

  it("creates expertise file for new domain", async () => {
    const expertisePath = getExpertisePath("testing", tmpDir);
    expect(existsSync(expertisePath)).toBe(false);

    await createExpertiseFile(expertisePath);
    expect(existsSync(expertisePath)).toBe(true);
  });

  it("detects duplicate domain in config", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);

    const config = await readConfig(tmpDir);
    const isDuplicate = config.domains.includes("testing");
    expect(isDuplicate).toBe(true);
  });

  it("adding multiple domains works", async () => {
    const config = await readConfig(tmpDir);

    config.domains.push("testing");
    config.domains.push("architecture");
    config.domains.push("devops");
    await writeConfig(config, tmpDir);

    const updatedConfig = await readConfig(tmpDir);
    expect(updatedConfig.domains).toHaveLength(3);
    expect(updatedConfig.domains).toContain("testing");
    expect(updatedConfig.domains).toContain("architecture");
    expect(updatedConfig.domains).toContain("devops");
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
    config.domains.push(domainName);
    await writeConfig(config, tmpDir);

    const updatedConfig = await readConfig(tmpDir);
    expect(updatedConfig.domains).toContain(domainName);
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
    config.domains.push("testing");
    await writeConfig(config, tmpDir);

    const updatedConfig = await readConfig(tmpDir);
    expect(updatedConfig.governance.max_entries).toBe(100);
    expect(updatedConfig.governance.warn_entries).toBe(150);
    expect(updatedConfig.governance.hard_limit).toBe(200);
  });
});
