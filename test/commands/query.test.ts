import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initMulchDir,
  writeConfig,
  getExpertisePath,
} from "../../src/utils/config.js";
import {
  appendRecord,
  readExpertiseFile,
  createExpertiseFile,
  filterByType,
} from "../../src/utils/expertise.js";
import { DEFAULT_CONFIG } from "../../src/schemas/config.js";
import type { ExpertiseRecord } from "../../src/schemas/record.js";

describe("query command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-query-test-"));
    await initMulchDir(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads records from a single domain", async () => {
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "convention",
      content: "Use vitest for all tests",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("convention");
    expect((records[0] as { content: string }).content).toBe(
      "Use vitest for all tests",
    );
  });

  it("filters records by type", async () => {
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const convention: ExpertiseRecord = {
      type: "convention",
      content: "Always write tests",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    const failure: ExpertiseRecord = {
      type: "failure",
      description: "Tests timed out",
      resolution: "Increase timeout",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };
    await appendRecord(filePath, convention);
    await appendRecord(filePath, failure);

    const allRecords = await readExpertiseFile(filePath);
    expect(allRecords).toHaveLength(2);

    const failures = filterByType(allRecords, "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe("failure");

    const conventions = filterByType(allRecords, "convention");
    expect(conventions).toHaveLength(1);
    expect(conventions[0].type).toBe("convention");
  });

  it("returns empty array for domain with no records", async () => {
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["empty-domain"] },
      tmpDir,
    );
    const filePath = getExpertisePath("empty-domain", tmpDir);
    await createExpertiseFile(filePath);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(0);
  });

  it("queries multiple domains", async () => {
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

    const testingRecords = await readExpertiseFile(testingPath);
    const archRecords = await readExpertiseFile(archPath);
    expect(testingRecords).toHaveLength(1);
    expect(archRecords).toHaveLength(1);
  });

  it("returns empty for non-existent expertise file", async () => {
    const filePath = getExpertisePath("nonexistent", tmpDir);
    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(0);
  });

  it("filterByType returns empty when no records match", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
    await createExpertiseFile(filePath);

    await appendRecord(filePath, {
      type: "convention",
      content: "Some convention",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const decisions = filterByType(records, "decision");
    expect(decisions).toHaveLength(0);
  });
});
