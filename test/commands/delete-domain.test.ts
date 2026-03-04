import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDomain,
  getExpertisePath,
  initMulchDir,
  readConfig,
  removeDomain,
} from "../../src/utils/config.ts";

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
    expect(before.domains).toContain("testing");

    await removeDomain("testing", tmpDir);

    const after = await readConfig(tmpDir);
    expect(after.domains).not.toContain("testing");
  });

  it("throws when domain does not exist", async () => {
    await expect(removeDomain("nonexistent", tmpDir)).rejects.toThrow(
      'Domain "nonexistent" not found in config.',
    );
  });

  it("keeps expertise file by default (deleteFile=false)", async () => {
    await addDomain("testing", tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    expect(existsSync(filePath)).toBe(true);

    await removeDomain("testing", tmpDir, false);

    expect(existsSync(filePath)).toBe(true);
  });

  it("deletes expertise file when deleteFile=true", async () => {
    await addDomain("testing", tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    expect(existsSync(filePath)).toBe(true);

    await removeDomain("testing", tmpDir, true);

    expect(existsSync(filePath)).toBe(false);
  });

  it("removesDomain with deleteFile=true when file missing does not throw", async () => {
    await addDomain("testing", tmpDir);
    // Manually remove the file first
    const filePath = getExpertisePath("testing", tmpDir);
    await rm(filePath);

    // Should not throw even if file is already gone
    await expect(
      removeDomain("testing", tmpDir, true),
    ).resolves.toBeUndefined();
    const after = await readConfig(tmpDir);
    expect(after.domains).not.toContain("testing");
  });

  it("removes only the specified domain, leaves others intact", async () => {
    await addDomain("alpha", tmpDir);
    await addDomain("beta", tmpDir);
    await addDomain("gamma", tmpDir);

    await removeDomain("beta", tmpDir);

    const config = await readConfig(tmpDir);
    expect(config.domains).not.toContain("beta");
    expect(config.domains).toContain("alpha");
    expect(config.domains).toContain("gamma");
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
