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
  createExpertiseFile,
  searchRecords,
  readExpertiseFile,
  filterByType,
} from "../../src/utils/expertise.js";
import { DEFAULT_CONFIG } from "../../src/schemas/config.js";
import type { ExpertiseRecord } from "../../src/schemas/record.js";

describe("search command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-search-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["database", "api"] },
      tmpDir,
    );
    const dbPath = getExpertisePath("database", tmpDir);
    const apiPath = getExpertisePath("api", tmpDir);
    await createExpertiseFile(dbPath);
    await createExpertiseFile(apiPath);

    await appendRecord(dbPath, {
      type: "convention",
      content: "Always use WAL mode for SQLite",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(dbPath, {
      type: "failure",
      description: "FTS5 queries crash without escaping",
      resolution: "Use escapeFts5Term() for all FTS5 queries",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(dbPath, {
      type: "pattern",
      name: "migration-runner",
      description: "Filesystem-driven migration system",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(apiPath, {
      type: "decision",
      title: "Use REST over GraphQL",
      rationale: "Simpler tooling, team familiarity",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("searchRecords utility", () => {
    it("matches convention content (case-insensitive)", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const matches = searchRecords(records, "wal");
      expect(matches).toHaveLength(1);
      expect((matches[0] as { content: string }).content).toContain("WAL");
    });

    it("matches failure description", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const matches = searchRecords(records, "FTS5");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("failure");
    });

    it("matches failure resolution field", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const matches = searchRecords(records, "escapeFts5Term");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("failure");
    });

    it("matches pattern name", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const matches = searchRecords(records, "migration");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("pattern");
    });

    it("matches decision title", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("api", tmpDir),
      );
      const matches = searchRecords(records, "REST");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("decision");
    });

    it("matches decision rationale", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("api", tmpDir),
      );
      const matches = searchRecords(records, "familiarity");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("decision");
    });

    it("returns empty for no match", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const matches = searchRecords(records, "nonexistent");
      expect(matches).toHaveLength(0);
    });

    it("matches across multiple records", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      // "SQLite" appears in convention, "queries" appears in failure
      const matches = searchRecords(records, "mode");
      expect(matches).toHaveLength(1); // WAL mode in convention
    });

    it("is case-insensitive", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const upper = searchRecords(records, "WAL");
      const lower = searchRecords(records, "wal");
      const mixed = searchRecords(records, "Wal");
      expect(upper).toHaveLength(1);
      expect(lower).toHaveLength(1);
      expect(mixed).toHaveLength(1);
    });
  });

  describe("cross-domain search", () => {
    it("finds records across multiple domains", async () => {
      const dbRecords = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const apiRecords = await readExpertiseFile(
        getExpertisePath("api", tmpDir),
      );
      const allRecords = [...dbRecords, ...apiRecords];
      // Search for a term that appears in content across domains
      // "system" appears in "migration-runner" description
      const matches = searchRecords(allRecords, "system");
      expect(matches).toHaveLength(1); // migration pattern
    });
  });

  describe("type-only filtering (no query)", () => {
    it("returns all failures when filtering by type without query", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const failures = filterByType(records, "failure");
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe("failure");
    });

    it("returns all conventions across domains without query", async () => {
      const dbRecords = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const apiRecords = await readExpertiseFile(
        getExpertisePath("api", tmpDir),
      );
      const allConventions = [
        ...filterByType(dbRecords, "convention"),
        ...filterByType(apiRecords, "convention"),
      ];
      expect(allConventions).toHaveLength(1);
      expect(allConventions[0].type).toBe("convention");
    });

    it("type filter combined with query narrows results", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      // "foundational" matches convention + pattern, but filtering to convention first
      const conventions = filterByType(records, "convention");
      const matches = searchRecords(conventions, "WAL");
      expect(matches).toHaveLength(1);
    });
  });

  describe("tag filtering", () => {
    it("searchRecords finds records by tag substring", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "convention",
        content: "Use parameterized queries",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        tags: ["security", "sql"],
      });

      const records = await readExpertiseFile(dbPath);
      const matches = searchRecords(records, "security");
      expect(matches).toHaveLength(1);
      expect((matches[0] as { content: string }).content).toBe(
        "Use parameterized queries",
      );
    });

    it("tag filter matches exact tag (case-insensitive)", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "caching-layer",
        description: "Redis caching pattern",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        tags: ["Redis", "Performance"],
      });

      const records = await readExpertiseFile(dbPath);
      const tagLower = "redis";
      const filtered = records.filter((r) =>
        r.tags?.some((t) => t.toLowerCase() === tagLower),
      );
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("caching-layer");
    });

    it("tag filter is case-insensitive", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "convention",
        content: "Tag case test",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        tags: ["ESM"],
      });

      const records = await readExpertiseFile(dbPath);
      const tagLower = "esm";
      const filtered = records.filter((r) =>
        r.tags?.some((t) => t.toLowerCase() === tagLower),
      );
      expect(filtered).toHaveLength(1);
    });

    it("tag filter excludes records without matching tag", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      const records = await readExpertiseFile(dbPath);
      // Existing records have no tags
      const tagLower = "nonexistent";
      const filtered = records.filter((r) =>
        r.tags?.some((t) => t.toLowerCase() === tagLower),
      );
      expect(filtered).toHaveLength(0);
    });

    it("records without tags are excluded by tag filter", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "convention",
        content: "Has tags",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        tags: ["target"],
      });

      const records = await readExpertiseFile(dbPath);
      const tagLower = "target";
      const filtered = records.filter((r) =>
        r.tags?.some((t) => t.toLowerCase() === tagLower),
      );
      // Only the one with the "target" tag, not the 3 existing untagged records
      expect(filtered).toHaveLength(1);
    });
  });
});
