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
  filterByClassification,
  filterByFile,
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

  describe("classification filtering", () => {
    it("filters by foundational classification", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Foundational rule",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Tactical note",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Observational failure",
        resolution: "Fixed it",
        classification: "observational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(3);

      const foundational = filterByClassification(records, "foundational");
      expect(foundational).toHaveLength(1);
      expect(foundational[0].classification).toBe("foundational");

      const tactical = filterByClassification(records, "tactical");
      expect(tactical).toHaveLength(1);
      expect(tactical[0].classification).toBe("tactical");

      const observational = filterByClassification(records, "observational");
      expect(observational).toHaveLength(1);
      expect(observational[0].classification).toBe("observational");
    });

    it("returns empty when no records match classification", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Only foundational",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const tactical = filterByClassification(records, "tactical");
      expect(tactical).toHaveLength(0);
    });

    it("combines classification filter with type filter", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Foundational convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Foundational failure",
        resolution: "Fixed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Tactical convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const foundational = filterByClassification(records, "foundational");
      const foundationalConventions = filterByType(foundational, "convention");
      expect(foundationalConventions).toHaveLength(1);
      expect((foundationalConventions[0] as { content: string }).content).toBe("Foundational convention");
    });
  });

  describe("file filtering", () => {
    it("filters pattern records by file path", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "test-helper",
        description: "Testing helper pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["test/helpers/setup.ts"],
      });
      await appendRecord(filePath, {
        type: "pattern",
        name: "other-pattern",
        description: "Unrelated pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/utils/other.ts"],
      });

      const records = await readExpertiseFile(filePath);
      const filtered = filterByFile(records, "test/helpers");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("test-helper");
    });

    it("filters reference records by file path", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "reference",
        name: "api-ref",
        description: "API reference",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/api/routes.ts"],
      });

      const records = await readExpertiseFile(filePath);
      const filtered = filterByFile(records, "api/routes");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("api-ref");
    });

    it("records without files field are excluded", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "No files here",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Failure without files",
        resolution: "Fixed",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const filtered = filterByFile(records, "src");
      expect(filtered).toHaveLength(0);
    });

    it("file filter across domains isolates correctly", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      await appendRecord(testingPath, {
        type: "pattern",
        name: "test-pattern",
        description: "Testing pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/shared/utils.ts"],
      });
      await appendRecord(archPath, {
        type: "pattern",
        name: "arch-pattern",
        description: "Architecture pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/shared/utils.ts"],
      });

      const testingRecords = await readExpertiseFile(testingPath);
      const archRecords = await readExpertiseFile(archPath);

      const filteredTesting = filterByFile(testingRecords, "src/shared");
      const filteredArch = filterByFile(archRecords, "src/shared");

      expect(filteredTesting).toHaveLength(1);
      expect((filteredTesting[0] as { name: string }).name).toBe("test-pattern");
      expect(filteredArch).toHaveLength(1);
      expect((filteredArch[0] as { name: string }).name).toBe("arch-pattern");
    });
  });
});
