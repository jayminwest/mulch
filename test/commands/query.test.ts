import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
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
import { sortByConfirmationScore, type ScoredRecord, type Outcome } from "../../src/utils/scoring.js";

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

  describe("outcome-status filtering", () => {
    it("filters records with outcome.status=success", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Successful approach",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcome: { status: "success" },
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Failed approach",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcome: { status: "failure" },
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "No outcome",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const successes = records.filter((r) => r.outcome?.status === "success");
      expect(successes).toHaveLength(1);
      expect((successes[0] as { content: string }).content).toBe("Successful approach");
    });

    it("filters records with outcome.status=failure", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "failure",
        description: "Something broke",
        resolution: "Use alternative",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcome: { status: "failure", agent: "build-agent" },
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Worked fine",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcome: { status: "success" },
      });

      const records = await readExpertiseFile(filePath);
      const failures = records.filter((r) => r.outcome?.status === "failure");
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe("failure");
      expect(failures[0].outcome?.agent).toBe("build-agent");
    });

    it("excludes records without outcome when filtering by outcome status", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "No outcome here",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const withSuccess = records.filter((r) => r.outcome?.status === "success");
      expect(withSuccess).toHaveLength(0);
    });

    it("outcome-status combined with type filter narrows results", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "successful-pattern",
        description: "Pattern that worked",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcome: { status: "success" },
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Successful convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcome: { status: "success" },
      });

      const records = await readExpertiseFile(filePath);
      const successes = records.filter((r) => r.outcome?.status === "success");
      const successPatterns = filterByType(successes, "pattern");
      expect(successPatterns).toHaveLength(1);
      expect((successPatterns[0] as { name: string }).name).toBe("successful-pattern");
    });
  });

  describe("sort-by-score", () => {
    function makeOutcome(status: Outcome["status"]): Outcome {
      return { status, recorded_at: new Date().toISOString() };
    }

    async function appendScoredRecord(filePath: string, record: ScoredRecord): Promise<void> {
      await appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
    }

    it("sortByConfirmationScore places high-score records first", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "low-confirm",
        description: "Rarely confirmed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "high-confirm",
        description: "Highly confirmed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      expect(sorted).toHaveLength(2);
      expect((sorted[0] as { name: string }).name).toBe("high-confirm");
      expect((sorted[1] as { name: string }).name).toBe("low-confirm");
    });

    it("records without outcomes sort to the end", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "no-outcomes",
        description: "No outcome data",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "with-outcomes",
        description: "Has outcome data",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      expect((sorted[0] as { name: string }).name).toBe("with-outcomes");
      expect((sorted[sorted.length - 1] as { name: string }).name).toBe("no-outcomes");
    });

    it("sort combined with type filter works correctly", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "a-pattern",
        description: "A pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "convention",
        content: "A convention with many confirmations",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success"), makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "b-pattern",
        description: "A better pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      // Only patterns; convention excluded
      expect(sorted.every((r) => r.type === "pattern")).toBe(true);
      // b-pattern (2 successes) before a-pattern (1 success)
      expect((sorted[0] as { name: string }).name).toBe("b-pattern");
      expect((sorted[1] as { name: string }).name).toBe("a-pattern");
    });

    it("does not mutate original record array order", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "first",
        description: "First appended",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "second",
        description: "Second appended",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const originalFirst = (patterns[0] as { name: string }).name;

      sortByConfirmationScore(patterns as ScoredRecord[]); // not reassigned

      expect((patterns[0] as { name: string }).name).toBe(originalFirst);
    });
  });
});
