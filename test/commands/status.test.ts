import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initMulchDir,
  writeConfig,
  getExpertisePath,
  getMulchDir,
  readConfig,
} from "../../src/utils/config.js";
import {
  appendRecord,
  readExpertiseFile,
  createExpertiseFile,
  countRecords,
  getFileModTime,
} from "../../src/utils/expertise.js";
import { DEFAULT_CONFIG } from "../../src/schemas/config.js";
import { formatStatusOutput } from "../../src/utils/format.js";
import type { ExpertiseRecord } from "../../src/schemas/record.js";

describe("status command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-status-test-"));
    await initMulchDir(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("detects .mulch/ directory exists", () => {
    expect(existsSync(getMulchDir(tmpDir))).toBe(true);
  });

  it("detects missing .mulch/ directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "mulch-status-empty-"));
    expect(existsSync(getMulchDir(emptyDir))).toBe(false);
    await rm(emptyDir, { recursive: true, force: true });
  });

  it("shows status with no domains configured", () => {
    const output = formatStatusOutput([], DEFAULT_CONFIG.governance);
    expect(output).toContain("Mulch Status");
    expect(output).toContain("No domains configured");
  });

  it("shows status with a domain and entries", async () => {
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "convention",
      content: "Always test",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    const lastUpdated = await getFileModTime(filePath);
    const count = countRecords(records);

    const output = formatStatusOutput(
      [{ domain: "testing", count, lastUpdated }],
      DEFAULT_CONFIG.governance,
    );

    expect(output).toContain("Mulch Status");
    expect(output).toContain("testing");
    expect(output).toContain("1 entries");
  });

  it("shows multiple domains in status", async () => {
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );

    const testingPath = getExpertisePath("testing", tmpDir);
    const archPath = getExpertisePath("architecture", tmpDir);
    await createExpertiseFile(testingPath);
    await createExpertiseFile(archPath);

    await appendRecord(testingPath, {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(archPath, {
      type: "decision",
      title: "Use ESM",
      rationale: "Better tree-shaking",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(archPath, {
      type: "pattern",
      name: "Service Layer",
      description: "Business logic isolation",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const config = await readConfig(tmpDir);
    const domainStats = await Promise.all(
      config.domains.map(async (domain) => {
        const filePath = getExpertisePath(domain, tmpDir);
        const records = await readExpertiseFile(filePath);
        const lastUpdated = await getFileModTime(filePath);
        return { domain, count: countRecords(records), lastUpdated };
      }),
    );

    const output = formatStatusOutput(domainStats, config.governance);
    expect(output).toContain("testing");
    expect(output).toContain("1 entries");
    expect(output).toContain("architecture");
    expect(output).toContain("2 entries");
  });

  it("shows warning when entries reach max_entries threshold", () => {
    const output = formatStatusOutput(
      [{ domain: "testing", count: 100, lastUpdated: new Date() }],
      DEFAULT_CONFIG.governance,
    );
    expect(output).toContain("approaching limit");
  });

  it("shows warning when entries reach warn_entries threshold", () => {
    const output = formatStatusOutput(
      [{ domain: "testing", count: 150, lastUpdated: new Date() }],
      DEFAULT_CONFIG.governance,
    );
    expect(output).toContain("consider splitting domain");
  });

  it("shows hard limit warning", () => {
    const output = formatStatusOutput(
      [{ domain: "testing", count: 200, lastUpdated: new Date() }],
      DEFAULT_CONFIG.governance,
    );
    expect(output).toContain("OVER HARD LIMIT");
  });

  it("countRecords returns correct count", () => {
    const records: ExpertiseRecord[] = [
      {
        type: "convention",
        content: "Test 1",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      },
      {
        type: "convention",
        content: "Test 2",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      },
    ];
    expect(countRecords(records)).toBe(2);
  });

  it("countRecords returns zero for empty array", () => {
    expect(countRecords([])).toBe(0);
  });
});
