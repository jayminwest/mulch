import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyConfirmationBoost,
  computeConfirmationScore,
  editRecord,
  getFailureCount,
  getSuccessCount,
  getSuccessRate,
  getTotalApplications,
  queryDomain,
  recordExpertise,
  searchExpertise,
  sortByConfirmationScore,
} from "../src/index.ts";
import type { ScoredRecord } from "../src/index.ts";
import { DEFAULT_CONFIG } from "../src/schemas/config.ts";
import type { ExpertiseRecord } from "../src/schemas/record.ts";
import {
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../src/utils/expertise.ts";

describe("programmatic API", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-api-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );
    await createExpertiseFile(getExpertisePath("testing", tmpDir));
    await createExpertiseFile(getExpertisePath("architecture", tmpDir));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("recordExpertise", () => {
    it("creates a new convention record", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Always write tests",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const result = await recordExpertise("testing", record, { cwd: tmpDir });

      expect(result.action).toBe("created");
      expect(result.record.type).toBe("convention");
    });

    it("assigns an id to the created record", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Record gets an id",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const result = await recordExpertise("testing", record, { cwd: tmpDir });

      expect(result.record.id).toBeDefined();
      expect(result.record.id).toMatch(/^mx-[0-9a-f]+$/);
    });

    it("skips duplicate convention records", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Always write tests",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      await recordExpertise("testing", record, { cwd: tmpDir });
      const result = await recordExpertise("testing", record, { cwd: tmpDir });

      expect(result.action).toBe("skipped");
    });

    it("upserts named records (pattern)", async () => {
      const record: ExpertiseRecord = {
        type: "pattern",
        name: "file-locking",
        description: "Use advisory file locks",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      await recordExpertise("testing", record, { cwd: tmpDir });

      const updated: ExpertiseRecord = {
        ...record,
        description: "Use withFileLock helper",
      };
      const result = await recordExpertise("testing", updated, { cwd: tmpDir });

      expect(result.action).toBe("updated");

      const records = await queryDomain("testing", { cwd: tmpDir });
      expect(records).toHaveLength(1);
      expect((records[0] as { description: string }).description).toBe(
        "Use withFileLock helper",
      );
    });

    it("force-creates duplicate convention records when force=true", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Always write tests",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      await recordExpertise("testing", record, { cwd: tmpDir });
      const result = await recordExpertise("testing", record, {
        cwd: tmpDir,
        force: true,
      });

      expect(result.action).toBe("created");

      const records = await queryDomain("testing", { cwd: tmpDir });
      expect(records).toHaveLength(2);
    });

    it("throws on unknown domain", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "test",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };

      await expect(
        recordExpertise("nonexistent", record, { cwd: tmpDir }),
      ).rejects.toThrow(/Domain "nonexistent" not found/);
    });

    it("persists record to disk", async () => {
      const record: ExpertiseRecord = {
        type: "failure",
        description: "Used process.exit(1)",
        resolution: "Use process.exitCode = 1 instead",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      await recordExpertise("testing", record, { cwd: tmpDir });

      const records = await queryDomain("testing", { cwd: tmpDir });
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("failure");
    });
  });

  describe("searchExpertise", () => {
    beforeEach(async () => {
      await appendRecord(getExpertisePath("testing", tmpDir), {
        type: "convention",
        content: "Always use TypeScript strict mode for type safety",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        tags: ["typescript"],
      });
      await appendRecord(getExpertisePath("testing", tmpDir), {
        type: "pattern",
        name: "file-locking",
        description: "Use advisory file locks for concurrent writes",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(getExpertisePath("architecture", tmpDir), {
        type: "decision",
        title: "ESM module resolution",
        rationale: "Use NodeNext for proper TypeScript ESM support",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
    });

    it("returns matching records by keyword", async () => {
      const results = await searchExpertise("TypeScript", { cwd: tmpDir });

      expect(results.length).toBeGreaterThan(0);
      const testingDomain = results.find((r) => r.domain === "testing");
      expect(testingDomain).toBeDefined();
      expect(testingDomain!.records.length).toBeGreaterThan(0);
    });

    it("limits search to specified domain", async () => {
      const results = await searchExpertise("TypeScript", {
        cwd: tmpDir,
        domain: "testing",
      });

      expect(results.every((r) => r.domain === "testing")).toBe(true);
    });

    it("searches across all domains when no domain specified", async () => {
      const results = await searchExpertise("TypeScript", { cwd: tmpDir });

      const domains = results.map((r) => r.domain);
      // Should find results in both domains (both have "TypeScript" content)
      expect(results.length).toBeGreaterThan(0);
      expect(domains).toContain("testing");
    });

    it("filters by type", async () => {
      const results = await searchExpertise("file locks", {
        cwd: tmpDir,
        type: "pattern",
      });

      for (const domainResult of results) {
        for (const rec of domainResult.records) {
          expect(rec.type).toBe("pattern");
        }
      }
    });

    it("filters by tag", async () => {
      const results = await searchExpertise("strict", {
        cwd: tmpDir,
        tag: "typescript",
      });

      for (const domainResult of results) {
        for (const rec of domainResult.records) {
          expect(rec.tags).toContain("typescript");
        }
      }
    });

    it("throws on unknown domain", async () => {
      await expect(
        searchExpertise("query", { cwd: tmpDir, domain: "nonexistent" }),
      ).rejects.toThrow(/Domain "nonexistent" not found/);
    });

    it("returns empty array when no matches", async () => {
      const results = await searchExpertise("xyzzy_no_match_here", {
        cwd: tmpDir,
      });

      expect(results).toEqual([]);
    });
  });

  describe("queryDomain", () => {
    beforeEach(async () => {
      await appendRecord(getExpertisePath("testing", tmpDir), {
        type: "convention",
        content: "Use vitest for all tests",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(getExpertisePath("testing", tmpDir), {
        type: "pattern",
        name: "temp-dirs",
        description: "Use mkdtemp for temp directories in tests",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });
    });

    it("returns all records in domain", async () => {
      const records = await queryDomain("testing", { cwd: tmpDir });
      expect(records).toHaveLength(2);
    });

    it("filters by type", async () => {
      const records = await queryDomain("testing", {
        cwd: tmpDir,
        type: "convention",
      });

      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("convention");
    });

    it("filters by classification", async () => {
      const records = await queryDomain("testing", {
        cwd: tmpDir,
        classification: "foundational",
      });

      expect(records).toHaveLength(1);
      expect(records[0].classification).toBe("foundational");
    });

    it("throws on unknown domain", async () => {
      await expect(queryDomain("nonexistent", { cwd: tmpDir })).rejects.toThrow(
        /Domain "nonexistent" not found/,
      );
    });

    it("returns empty array for empty domain", async () => {
      const records = await queryDomain("architecture", { cwd: tmpDir });
      expect(records).toHaveLength(0);
    });
  });

  describe("scoring exports", () => {
    const makeRecord = (outcomes?: ScoredRecord["outcomes"]): ScoredRecord => ({
      type: "convention",
      content: "test record",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      outcomes,
    });

    it("getSuccessCount returns 0 for record with no outcomes", () => {
      expect(getSuccessCount(makeRecord())).toBe(0);
    });

    it("getSuccessCount counts only success outcomes", () => {
      const record = makeRecord([
        { status: "success" },
        { status: "failure" },
        { status: "success" },
      ]);
      expect(getSuccessCount(record)).toBe(2);
    });

    it("getFailureCount counts only failure outcomes", () => {
      const record = makeRecord([
        { status: "success" },
        { status: "failure" },
        { status: "partial" },
      ]);
      expect(getFailureCount(record)).toBe(1);
    });

    it("getTotalApplications returns outcome count", () => {
      const record = makeRecord([{ status: "success" }, { status: "failure" }]);
      expect(getTotalApplications(record)).toBe(2);
    });

    it("getTotalApplications returns 0 with no outcomes", () => {
      expect(getTotalApplications(makeRecord())).toBe(0);
    });

    it("getSuccessRate returns 0 for no outcomes", () => {
      expect(getSuccessRate(makeRecord())).toBe(0);
    });

    it("getSuccessRate counts partial outcomes as 0.5", () => {
      const record = makeRecord([{ status: "success" }, { status: "partial" }]);
      expect(getSuccessRate(record)).toBe(0.75);
    });

    it("computeConfirmationScore returns 0 for no outcomes", () => {
      expect(computeConfirmationScore(makeRecord())).toBe(0);
    });

    it("computeConfirmationScore adds 0.5 per partial outcome", () => {
      const record = makeRecord([
        { status: "success" },
        { status: "partial" },
        { status: "failure" },
      ]);
      expect(computeConfirmationScore(record)).toBe(1.5);
    });

    it("applyConfirmationBoost returns baseScore unchanged when no outcomes", () => {
      expect(applyConfirmationBoost(10, makeRecord())).toBe(10);
    });

    it("applyConfirmationBoost boosts score based on confirmation score", () => {
      const record = makeRecord([{ status: "success" }, { status: "success" }]);
      // confirmationScore = 2, boost = 10 * (1 + 0.1 * 2) = 12
      expect(applyConfirmationBoost(10, record)).toBe(12);
    });

    it("sortByConfirmationScore orders highest score first", () => {
      const low = makeRecord([{ status: "failure" }]);
      const high = makeRecord([{ status: "success" }, { status: "success" }]);
      const mid = makeRecord([{ status: "success" }]);
      const sorted = sortByConfirmationScore([low, high, mid]);
      expect(computeConfirmationScore(sorted[0])).toBeGreaterThanOrEqual(
        computeConfirmationScore(sorted[1]),
      );
      expect(computeConfirmationScore(sorted[1])).toBeGreaterThanOrEqual(
        computeConfirmationScore(sorted[2]),
      );
    });
  });

  describe("editRecord", () => {
    it("edits convention content", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Original content",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      const created = await recordExpertise("testing", record, { cwd: tmpDir });
      const id = created.record.id!;

      const updated = await editRecord(
        "testing",
        id,
        { content: "Updated content" },
        { cwd: tmpDir },
      );

      expect((updated as { content: string }).content).toBe("Updated content");
    });

    it("edits pattern name and description", async () => {
      const record: ExpertiseRecord = {
        type: "pattern",
        name: "old-pattern-name",
        description: "Original description",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      const created = await recordExpertise("testing", record, { cwd: tmpDir });
      const id = created.record.id!;

      const updated = await editRecord(
        "testing",
        id,
        { description: "Updated description" },
        { cwd: tmpDir },
      );

      expect((updated as { description: string }).description).toBe(
        "Updated description",
      );
    });

    it("edits classification", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "test classification edit",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };
      const created = await recordExpertise("testing", record, { cwd: tmpDir });
      const id = created.record.id!;

      const updated = await editRecord(
        "testing",
        id,
        { classification: "foundational" },
        { cwd: tmpDir },
      );

      expect(updated.classification).toBe("foundational");
    });

    it("edits failure resolution", async () => {
      const record: ExpertiseRecord = {
        type: "failure",
        description: "Used process.exit",
        resolution: "Original fix",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };
      const created = await recordExpertise("testing", record, { cwd: tmpDir });
      const id = created.record.id!;

      const updated = await editRecord(
        "testing",
        id,
        { resolution: "Use process.exitCode = 1" },
        { cwd: tmpDir },
      );

      expect((updated as { resolution: string }).resolution).toBe(
        "Use process.exitCode = 1",
      );
    });

    it("throws on unknown domain", async () => {
      await expect(
        editRecord("nonexistent", "mx-abc123", {}, { cwd: tmpDir }),
      ).rejects.toThrow(/Domain "nonexistent" not found/);
    });

    it("throws on non-existent record ID", async () => {
      await expect(
        editRecord("testing", "mx-ffffff", {}, { cwd: tmpDir }),
      ).rejects.toThrow(/not found/);
    });

    it("persists changes to disk", async () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Original",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };
      const created = await recordExpertise("testing", record, { cwd: tmpDir });
      const id = created.record.id!;

      await editRecord(
        "testing",
        id,
        { content: "Persisted" },
        { cwd: tmpDir },
      );

      const records = await queryDomain("testing", { cwd: tmpDir });
      expect((records[0] as { content: string }).content).toBe("Persisted");
    });
  });
});
