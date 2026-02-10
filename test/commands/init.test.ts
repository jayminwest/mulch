import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initMulchDir,
  getMulchDir,
  getConfigPath,
  getExpertiseDir,
  readConfig,
} from "../../src/utils/config.js";

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

  it("checks that .mulch/ already exists", () => {
    // Before init, directory should not exist
    expect(existsSync(getMulchDir(tmpDir))).toBe(false);
  });
});
