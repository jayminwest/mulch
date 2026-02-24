import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  createExpertiseFile,
  filterByClassification,
  filterByFile,
  filterByType,
  readExpertiseFile,
  searchRecords,
} from "../../src/utils/expertise.ts";
import {
  type Outcome,
  type ScoredRecord,
  sortByConfirmationScore,
} from "../../src/utils/scoring.ts";

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
      const records = await readExpertiseFile(getExpertisePath("api", tmpDir));
      const matches = searchRecords(records, "REST");
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("decision");
    });

    it("matches decision rationale", async () => {
      const records = await readExpertiseFile(getExpertisePath("api", tmpDir));
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

  describe("classification filtering", () => {
    it("filters foundational records", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      // beforeEach adds: convention (foundational), failure (tactical), pattern (foundational)
      const foundational = filterByClassification(records, "foundational");
      expect(foundational).toHaveLength(2);
      expect(
        foundational.every((r) => r.classification === "foundational"),
      ).toBe(true);
    });

    it("filters tactical records", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const tactical = filterByClassification(records, "tactical");
      expect(tactical).toHaveLength(1);
      expect(tactical[0].classification).toBe("tactical");
      expect(tactical[0].type).toBe("failure");
    });

    it("returns empty for observational when none exist", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      const observational = filterByClassification(records, "observational");
      expect(observational).toHaveLength(0);
    });

    it("filters observational records correctly", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "convention",
        content: "Observational note",
        classification: "observational",
        recorded_at: new Date().toISOString(),
      });
      const records = await readExpertiseFile(dbPath);
      const observational = filterByClassification(records, "observational");
      expect(observational).toHaveLength(1);
      expect(observational[0].classification).toBe("observational");
    });

    it("classification filter combined with type filter narrows results", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "convention",
        content: "Tactical convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });
      const records = await readExpertiseFile(dbPath);
      const tactical = filterByClassification(records, "tactical");
      const tacticalConventions = filterByType(tactical, "convention");
      expect(tacticalConventions).toHaveLength(1);
      expect(tacticalConventions[0].classification).toBe("tactical");
      expect(tacticalConventions[0].type).toBe("convention");
    });

    it("classification filter combined with search query narrows results", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      // Filter to foundational, then search for "WAL" (convention content)
      const foundational = filterByClassification(records, "foundational");
      const matches = searchRecords(foundational, "WAL");
      expect(matches).toHaveLength(1);
      expect(matches[0].classification).toBe("foundational");
    });
  });

  describe("file filtering", () => {
    it("filters records by exact file path", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "query-builder",
        description: "SQL query builder pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/utils/db.ts"],
      });

      const records = await readExpertiseFile(dbPath);
      const filtered = filterByFile(records, "src/utils/db.ts");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("query-builder");
    });

    it("filters records by partial file path (substring match)", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "repo-pattern",
        description: "Repository pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/repositories/user.ts", "src/repositories/post.ts"],
      });

      const records = await readExpertiseFile(dbPath);
      const filtered = filterByFile(records, "repositories");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("repo-pattern");
    });

    it("file filter is case-insensitive", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "reference",
        name: "config-ref",
        description: "Configuration reference",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/Config/Settings.ts"],
      });

      const records = await readExpertiseFile(dbPath);
      const filtered = filterByFile(records, "config/settings");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("config-ref");
    });

    it("excludes records with no files field", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      // Existing records (convention, failure) have no files field
      const filtered = filterByFile(records, "src");
      expect(filtered).toHaveLength(0);
    });

    it("excludes records whose files do not match", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "unrelated",
        description: "Some pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/other/module.ts"],
      });

      const records = await readExpertiseFile(dbPath);
      const filtered = filterByFile(records, "nonexistent");
      expect(filtered).toHaveLength(0);
    });

    it("matches records when one of multiple files matches", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "multi-file-pattern",
        description: "Pattern spanning multiple files",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      });

      const records = await readExpertiseFile(dbPath);
      const filtered = filterByFile(records, "src/b.ts");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("multi-file-pattern");
    });

    it("file filter combined with classification filter narrows results", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "foundational-file-pattern",
        description: "Foundational pattern with file",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/core.ts"],
      });
      await appendRecord(dbPath, {
        type: "pattern",
        name: "tactical-file-pattern",
        description: "Tactical pattern with same file",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        files: ["src/core.ts"],
      });

      const records = await readExpertiseFile(dbPath);
      const withFile = filterByFile(records, "src/core.ts");
      expect(withFile).toHaveLength(2);

      const foundationalWithFile = filterByClassification(
        withFile,
        "foundational",
      );
      expect(foundationalWithFile).toHaveLength(1);
      expect((foundationalWithFile[0] as { name: string }).name).toBe(
        "foundational-file-pattern",
      );
    });
  });

  describe("outcome filtering", () => {
    it("filters records with outcomes containing success", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "convention",
        content: "Successful approach",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });
      await appendRecord(dbPath, {
        type: "convention",
        content: "Failed approach",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "failure" }],
      });

      const records = await readExpertiseFile(dbPath);
      const successes = records.filter((r) =>
        r.outcomes?.some((o) => o.status === "success"),
      );
      expect(successes).toHaveLength(1);
      expect((successes[0] as { content: string }).content).toBe(
        "Successful approach",
      );
    });

    it("filters records with outcomes containing failure", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "failure",
        description: "Operation failed",
        resolution: "Use alternative",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "failure", agent: "build-agent" }],
      });

      const records = await readExpertiseFile(dbPath);
      const failures = records.filter((r) =>
        r.outcomes?.some((o) => o.status === "failure"),
      );
      // only the one we added (not the FTS5 failure which has no outcomes)
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe("failure");
      expect(failures[0].outcomes?.[0]?.agent).toBe("build-agent");
    });

    it("excludes records without outcomes when filtering by outcome status", async () => {
      const records = await readExpertiseFile(
        getExpertisePath("database", tmpDir),
      );
      // Pre-existing records have no outcomes
      const withSuccess = records.filter((r) =>
        r.outcomes?.some((o) => o.status === "success"),
      );
      expect(withSuccess).toHaveLength(0);
    });

    it("outcome filter combined with type filter narrows results", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "pattern",
        name: "successful-pattern",
        description: "Pattern that worked",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });
      await appendRecord(dbPath, {
        type: "convention",
        content: "Successful convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });

      const records = await readExpertiseFile(dbPath);
      const successRecords = records.filter((r) =>
        r.outcomes?.some((o) => o.status === "success"),
      );
      const successPatterns = successRecords.filter(
        (r) => r.type === "pattern",
      );
      expect(successPatterns).toHaveLength(1);
      expect((successPatterns[0] as { name: string }).name).toBe(
        "successful-pattern",
      );
    });

    it("record with full outcomes array is stored and read back correctly", async () => {
      const dbPath = getExpertisePath("database", tmpDir);
      await appendRecord(dbPath, {
        type: "guide",
        name: "deploy-guide",
        description: "How to deploy",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          {
            status: "success",
            duration: 3000,
            test_results: "All checks passed",
            agent: "deploy-bot",
          },
        ],
      });

      const records = await readExpertiseFile(dbPath);
      const guides = records.filter((r) => r.type === "guide");
      expect(guides).toHaveLength(1);
      expect(guides[0].outcomes?.[0]?.status).toBe("success");
      expect(guides[0].outcomes?.[0]?.duration).toBe(3000);
      expect(guides[0].outcomes?.[0]?.test_results).toBe("All checks passed");
      expect(guides[0].outcomes?.[0]?.agent).toBe("deploy-bot");
    });
  });

  describe("scoring sort integration", () => {
    function makeOutcome(status: Outcome["status"]): Outcome {
      return { status, recorded_at: new Date().toISOString() };
    }

    async function appendScoredRecord(
      filePath: string,
      record: ScoredRecord,
    ): Promise<void> {
      await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
    }

    it("sortByConfirmationScore places high-score records first", async () => {
      // Use api domain which has no pre-existing patterns
      const apiPath = getExpertisePath("api", tmpDir);
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "low-confirm",
        description: "Rarely confirmed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "high-confirm",
        description: "Highly confirmed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });

      const records = await readExpertiseFile(apiPath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      expect(sorted).toHaveLength(2);
      expect((sorted[0] as { name: string }).name).toBe("high-confirm");
      expect((sorted[1] as { name: string }).name).toBe("low-confirm");
    });

    it("records without outcomes sort to the end", async () => {
      const apiPath = getExpertisePath("api", tmpDir);
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "no-outcomes",
        description: "No outcome data",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "with-outcomes",
        description: "Has outcome data",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(apiPath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      expect((sorted[0] as { name: string }).name).toBe("with-outcomes");
      expect((sorted[sorted.length - 1] as { name: string }).name).toBe(
        "no-outcomes",
      );
    });

    it("sort combined with text query narrows then orders results", async () => {
      const apiPath = getExpertisePath("api", tmpDir);
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "caching-basic",
        description: "Basic caching pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "caching-advanced",
        description: "Advanced caching strategy",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "unrelated-pattern",
        description: "Something else entirely",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });

      const records = await readExpertiseFile(apiPath);
      const patterns = filterByType(records, "pattern");
      // Search for "caching" first, then sort by score
      const matched = searchRecords(patterns, "caching");
      const sorted = sortByConfirmationScore(matched as ScoredRecord[]);

      // Only caching records should match
      expect(sorted).toHaveLength(2);
      // advanced has 3 successes vs basic's 1
      expect((sorted[0] as { name: string }).name).toBe("caching-advanced");
      expect((sorted[1] as { name: string }).name).toBe("caching-basic");
    });

    it("sort combined with type filter works correctly", async () => {
      const apiPath = getExpertisePath("api", tmpDir);
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "a-pattern",
        description: "A pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(apiPath, {
        type: "convention",
        content: "A convention with many confirmations",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "b-pattern",
        description: "A better pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(apiPath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      // Only patterns; convention excluded
      expect(sorted.every((r) => r.type === "pattern")).toBe(true);
      // b-pattern (2 successes) before a-pattern (1 success)
      expect((sorted[0] as { name: string }).name).toBe("b-pattern");
      expect((sorted[1] as { name: string }).name).toBe("a-pattern");
    });

    it("partial outcomes contribute 0.5 to score", async () => {
      const apiPath = getExpertisePath("api", tmpDir);
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "two-successes",
        description: "Two full successes",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "one-success-two-partials",
        description: "One success, two partials",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("partial"),
          makeOutcome("partial"),
        ],
      });

      const records = await readExpertiseFile(apiPath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      // two-successes scores 2.0; one-success-two-partials scores 1.0 + 0.5 + 0.5 = 2.0
      // Both score 2.0, order determined by stable sort
      expect(sorted).toHaveLength(2);
    });

    it("does not mutate original record array order", async () => {
      const apiPath = getExpertisePath("api", tmpDir);
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "first",
        description: "First appended",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(apiPath, {
        type: "pattern",
        name: "second",
        description: "Second appended",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(apiPath);
      const patterns = filterByType(records, "pattern");
      const originalFirst = (patterns[0] as { name: string }).name;

      sortByConfirmationScore(patterns as ScoredRecord[]); // not reassigned

      // Original array unchanged
      expect((patterns[0] as { name: string }).name).toBe(originalFirst);
    });
  });
});
