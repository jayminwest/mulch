import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GITATTRIBUTES_LINE,
  MULCH_README,
  getConfigPath,
  getExpertiseDir,
  getMulchDir,
  initMulchDir,
  readConfig,
  writeConfig,
} from "../../src/utils/config.ts";

describe("init command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-init-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .mulch/ with config and expertise/", async () => {
    await initMulchDir(tmpDir);

    expect(existsSync(getMulchDir(tmpDir))).toBe(true);
    expect(existsSync(getConfigPath(tmpDir))).toBe(true);
    expect(existsSync(getExpertiseDir(tmpDir))).toBe(true);
  });

  it("creates a valid default config", async () => {
    await initMulchDir(tmpDir);

    const config = await readConfig(tmpDir);
    expect(config.version).toBe("1");
    expect(config.domains).toEqual([]);
    expect(config.governance.max_entries).toBe(100);
    expect(config.governance.warn_entries).toBe(150);
    expect(config.governance.hard_limit).toBe(200);
  });

  it("running init twice does not error", async () => {
    await initMulchDir(tmpDir);

    // Second init should succeed without throwing
    await expect(initMulchDir(tmpDir)).resolves.toBeUndefined();

    // Config should still be valid after second init
    const config = await readConfig(tmpDir);
    expect(config.version).toBe("1");
  });

  it("re-running init preserves customized config", async () => {
    await initMulchDir(tmpDir);

    // Customize the config
    const config = await readConfig(tmpDir);
    config.domains = ["custom-domain"];
    config.governance.max_entries = 50;
    await writeConfig(config, tmpDir);

    // Re-run init
    await initMulchDir(tmpDir);

    // Config should retain customizations
    const after = await readConfig(tmpDir);
    expect(after.domains).toEqual(["custom-domain"]);
    expect(after.governance.max_entries).toBe(50);
  });

  it("checks that .mulch/ already exists", () => {
    // Before init, directory should not exist
    expect(existsSync(getMulchDir(tmpDir))).toBe(false);
  });

  it("creates .gitattributes with merge=union for JSONL files", async () => {
    await initMulchDir(tmpDir);

    const content = await readFile(join(tmpDir, ".gitattributes"), "utf-8");
    expect(content).toContain(GITATTRIBUTES_LINE);
  });

  it("appends to existing .gitattributes without overwriting", async () => {
    const existing = "*.png binary\n";
    await writeFile(join(tmpDir, ".gitattributes"), existing, "utf-8");

    await initMulchDir(tmpDir);

    const content = await readFile(join(tmpDir, ".gitattributes"), "utf-8");
    expect(content).toContain("*.png binary");
    expect(content).toContain(GITATTRIBUTES_LINE);
  });

  it("does not duplicate gitattributes line on second init", async () => {
    await initMulchDir(tmpDir);
    await initMulchDir(tmpDir);

    const content = await readFile(join(tmpDir, ".gitattributes"), "utf-8");
    const occurrences = content.split(GITATTRIBUTES_LINE).length - 1;
    expect(occurrences).toBe(1);
  });

  it("creates .mulch/README.md", async () => {
    await initMulchDir(tmpDir);

    const readmePath = join(getMulchDir(tmpDir), "README.md");
    expect(existsSync(readmePath)).toBe(true);
  });

  it("README.md contains repo URL and key commands", async () => {
    await initMulchDir(tmpDir);

    const content = await readFile(
      join(getMulchDir(tmpDir), "README.md"),
      "utf-8",
    );
    expect(content).toContain("https://github.com/jayminwest/mulch");
    expect(content).toContain("mulch record");
    expect(content).toContain("mulch query");
    expect(content).toContain("mulch prime");
  });
});
