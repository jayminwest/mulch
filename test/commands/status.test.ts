import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  getExpertisePath,
  getMulchDir,
  initMulchDir,
  readConfig,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  calculateDomainHealth,
  countRecords,
  createExpertiseFile,
  getFileModTime,
  readExpertiseFile,
} from "../../src/utils/expertise.ts";
import { formatStatusOutput } from "../../src/utils/format.ts";

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
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
    expect(output).toContain("1 records");
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
    expect(output).toContain("1 records");
    expect(output).toContain("architecture");
    expect(output).toContain("2 records");
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

  it("calculateDomainHealth returns correct metrics for empty domain", () => {
    const health = calculateDomainHealth([], 100, {
      tactical: 14,
      observational: 30,
    });
    expect(health.governance_utilization).toBe(0);
    expect(health.stale_count).toBe(0);
    expect(health.type_distribution).toEqual({
      convention: 0,
      pattern: 0,
      failure: 0,
      decision: 0,
      reference: 0,
      guide: 0,
    });
    expect(health.classification_distribution).toEqual({
      foundational: 0,
      tactical: 0,
      observational: 0,
    });
    expect(health.oldest_timestamp).toBeNull();
    expect(health.newest_timestamp).toBeNull();
  });

  it("calculateDomainHealth returns correct metrics with mixed records", () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    const records: ExpertiseRecord[] = [
      {
        type: "convention",
        content: "Always test",
        classification: "foundational",
        recorded_at: oldDate.toISOString(),
      },
      {
        type: "pattern",
        name: "Service Layer",
        description: "Business logic isolation",
        classification: "tactical",
        recorded_at: oldDate.toISOString(), // Stale (20 days > 14 days)
      },
      {
        type: "decision",
        title: "Use ESM",
        rationale: "Better tree-shaking",
        classification: "observational",
        recorded_at: recentDate.toISOString(), // Not stale
      },
      {
        type: "failure",
        description: "Bug in parser",
        resolution: "Fixed regex",
        classification: "tactical",
        recorded_at: recentDate.toISOString(), // Not stale
      },
      {
        type: "reference",
        name: "API Docs",
        description: "Link to API documentation",
        classification: "foundational",
        recorded_at: now.toISOString(),
      },
      {
        type: "guide",
        name: "Setup Guide",
        description: "How to set up the project",
        classification: "foundational",
        recorded_at: now.toISOString(),
      },
    ];

    const health = calculateDomainHealth(records, 100, {
      tactical: 14,
      observational: 30,
    });

    expect(health.governance_utilization).toBe(6); // 6/100 = 6%
    expect(health.stale_count).toBe(1); // Only the tactical record from 20 days ago
    expect(health.type_distribution).toEqual({
      convention: 1,
      pattern: 1,
      failure: 1,
      decision: 1,
      reference: 1,
      guide: 1,
    });
    expect(health.classification_distribution).toEqual({
      foundational: 3,
      tactical: 2,
      observational: 1,
    });
    expect(health.oldest_timestamp).toBe(oldDate.toISOString());
    expect(health.newest_timestamp).toBe(now.toISOString());
  });

  it("calculateDomainHealth calculates governance utilization correctly", () => {
    const records: ExpertiseRecord[] = Array.from({ length: 75 }, (_, i) => ({
      type: "convention",
      content: `Test ${i}`,
      classification: "foundational" as const,
      recorded_at: new Date().toISOString(),
    }));

    const health = calculateDomainHealth(records, 100, {
      tactical: 14,
      observational: 30,
    });
    expect(health.governance_utilization).toBe(75); // 75/100 = 75%
  });

  it("calculateDomainHealth identifies all stale tactical records", () => {
    const now = new Date();
    const staleDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
    const freshDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    const records: ExpertiseRecord[] = [
      {
        type: "pattern",
        name: "Stale Pattern",
        description: "Old pattern",
        classification: "tactical",
        recorded_at: staleDate.toISOString(), // Stale
      },
      {
        type: "pattern",
        name: "Fresh Pattern",
        description: "New pattern",
        classification: "tactical",
        recorded_at: freshDate.toISOString(), // Not stale
      },
      {
        type: "convention",
        content: "Old but foundational",
        classification: "foundational",
        recorded_at: staleDate.toISOString(), // Never stale
      },
    ];

    const health = calculateDomainHealth(records, 100, {
      tactical: 14,
      observational: 30,
    });
    expect(health.stale_count).toBe(1);
  });

  it("calculateDomainHealth identifies all stale observational records", () => {
    const now = new Date();
    const staleDate = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
    const freshDate = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000); // 25 days ago

    const records: ExpertiseRecord[] = [
      {
        type: "decision",
        title: "Stale Decision",
        rationale: "Old decision",
        classification: "observational",
        recorded_at: staleDate.toISOString(), // Stale (35 days > 30 days)
      },
      {
        type: "decision",
        title: "Fresh Decision",
        rationale: "Recent decision",
        classification: "observational",
        recorded_at: freshDate.toISOString(), // Not stale (25 days <= 30 days)
      },
    ];

    const health = calculateDomainHealth(records, 100, {
      tactical: 14,
      observational: 30,
    });
    expect(health.stale_count).toBe(1);
  });
});
