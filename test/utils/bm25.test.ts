import { describe, it, expect } from "vitest";
import {
  tokenize,
  extractRecordText,
  searchBM25,
  DEFAULT_BM25_PARAMS,
  type BM25Params,
} from "../../src/utils/bm25.js";
import type { ExpertiseRecord } from "../../src/schemas/record.js";

describe("BM25", () => {
  describe("tokenize", () => {
    it("should convert to lowercase", () => {
      expect(tokenize("Hello WORLD")).toEqual(["hello", "world"]);
    });

    it("should split on whitespace", () => {
      expect(tokenize("foo bar  baz")).toEqual(["foo", "bar", "baz"]);
    });

    it("should remove punctuation", () => {
      expect(tokenize("foo.bar,baz!qux?")).toEqual(["foo", "bar", "baz", "qux"]);
    });

    it("should preserve hyphens in words", () => {
      expect(tokenize("multi-agent system")).toEqual(["multi-agent", "system"]);
    });

    it("should filter empty tokens", () => {
      expect(tokenize("  foo   bar  ")).toEqual(["foo", "bar"]);
    });

    it("should handle empty string", () => {
      expect(tokenize("")).toEqual([]);
    });
  });

  describe("extractRecordText", () => {
    it("should extract pattern record text", () => {
      const record: ExpertiseRecord = {
        type: "pattern",
        name: "test-pattern",
        description: "A test pattern",
        files: ["src/foo.ts"],
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("test-pattern");
      expect(allText).toContain("A test pattern");
      expect(allText).toContain("src/foo.ts");
      expect(fieldTexts).toHaveProperty("name", "test-pattern");
      expect(fieldTexts).toHaveProperty("description", "A test pattern");
      expect(fieldTexts).toHaveProperty("files");
    });

    it("should extract convention record text", () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Always use semicolons",
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("Always use semicolons");
      expect(fieldTexts).toHaveProperty("content");
    });

    it("should extract failure record text", () => {
      const record: ExpertiseRecord = {
        type: "failure",
        description: "Test failed when running integration tests",
        resolution: "Fixed by updating config",
        classification: "tactical",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("Test failed");
      expect(allText).toContain("integration tests");
      expect(allText).toContain("Fixed by updating config");
    });

    it("should extract decision record text", () => {
      const record: ExpertiseRecord = {
        type: "decision",
        title: "Use TypeScript",
        rationale: "Type safety and better tooling",
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("Use TypeScript");
      expect(allText).toContain("Type safety");
      expect(allText).toContain("tooling");
    });

    it("should extract reference record text", () => {
      const record: ExpertiseRecord = {
        type: "reference",
        name: "BM25 Algorithm",
        description: "Ranking function for search engines",
        files: ["src/bm25.ts"],
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("BM25 Algorithm");
      expect(allText).toContain("Ranking function for search");
      expect(allText).toContain("src/bm25.ts");
    });

    it("should extract guide record text", () => {
      const record: ExpertiseRecord = {
        type: "guide",
        name: "Testing Guide",
        description: "How to write tests",
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("Testing Guide");
      expect(allText).toContain("How to write tests");
    });

    it("should extract tags as searchable text", () => {
      const record: ExpertiseRecord = {
        type: "pattern",
        name: "test",
        description: "test",
        evidence: "test",
        tags: ["foo", "bar", "baz"],
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("foo");
      expect(allText).toContain("bar");
      expect(allText).toContain("baz");
      expect(fieldTexts).toHaveProperty("tags");
    });

    it("should handle records without optional fields", () => {
      const record: ExpertiseRecord = {
        type: "pattern",
        name: "minimal",
        description: "minimal pattern",
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      };

      const { allText, fieldTexts } = extractRecordText(record);

      expect(allText).toContain("minimal");
      expect(allText).toContain("minimal pattern");
      expect(Object.keys(fieldTexts)).not.toContain("tags");
    });
  });

  describe("searchBM25", () => {
    const records: ExpertiseRecord[] = [
      {
        type: "pattern",
        name: "atomic-writes",
        description: "Use atomic file writes with temp files and rename",
        files: ["src/utils/expertise.ts"],
        classification: "foundational",
        recorded_at: "2024-01-01T00:00:00Z",
      },
      {
        type: "pattern",
        name: "file-locking",
        description: "Advisory file locking for concurrent access",
        files: ["src/utils/lock.ts"],
        classification: "foundational",
        recorded_at: "2024-01-02T00:00:00Z",
      },
      {
        type: "convention",
        content: "Use process.exitCode instead of process.exit()",
        classification: "foundational",
        recorded_at: "2024-01-03T00:00:00Z",
      },
      {
        type: "failure",
        description: "File writes were not atomic, concurrent writes caused corruption",
        resolution: "Implemented atomic writes pattern",
        classification: "tactical",
        recorded_at: "2024-01-04T00:00:00Z",
      },
    ];

    it("should return empty array for empty records", () => {
      const results = searchBM25([], "test");
      expect(results).toEqual([]);
    });

    it("should return empty array for empty query", () => {
      const results = searchBM25(records, "");
      expect(results).toEqual([]);
    });

    it("should return empty array for whitespace-only query", () => {
      const results = searchBM25(records, "   ");
      expect(results).toEqual([]);
    });

    it("should find exact matches", () => {
      const results = searchBM25(records, "atomic-writes");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].record.type).toBe("pattern");
      if (results[0].record.type === "pattern") {
        expect(results[0].record.name).toBe("atomic-writes");
      }
    });

    it("should rank by relevance", () => {
      const results = searchBM25(records, "locking");
      expect(results.length).toBeGreaterThan(0);

      // The pattern "file-locking" should score higher because
      // it has "locking" in both name and description
      expect(results[0].record.type).toBe("pattern");
      if (results[0].record.type === "pattern") {
        expect(results[0].record.name).toBe("file-locking");
      }
    });

    it("should handle multi-word queries", () => {
      const results = searchBM25(records, "file locking concurrent");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].record.type).toBe("pattern");
      if (results[0].record.type === "pattern") {
        expect(results[0].record.name).toBe("file-locking");
      }
    });

    it("should be case-insensitive", () => {
      const results1 = searchBM25(records, "ATOMIC");
      const results2 = searchBM25(records, "atomic");
      expect(results1.length).toBe(results2.length);
      expect(results1[0].record.id).toBe(results2[0].record.id);
    });

    it("should include match scores", () => {
      const results = searchBM25(records, "atomic");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should sort results by score descending", () => {
      const results = searchBM25(records, "file");
      expect(results.length).toBeGreaterThan(1);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should identify matched fields", () => {
      const results = searchBM25(records, "atomic-writes");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedFields).toContain("name");
    });

    it("should handle queries with no matches", () => {
      const results = searchBM25(records, "nonexistent-term-xyz");
      expect(results).toEqual([]);
    });

    it("should search across all text fields", () => {
      const results = searchBM25(records, "corruption");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].record.type).toBe("failure");
    });

    it("should handle custom BM25 parameters", () => {
      const customParams: BM25Params = { k1: 2.0, b: 0.5 };
      const results = searchBM25(records, "atomic", customParams);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("should use default parameters when not specified", () => {
      const results1 = searchBM25(records, "atomic");
      const results2 = searchBM25(records, "atomic", DEFAULT_BM25_PARAMS);
      expect(results1.length).toBe(results2.length);
      expect(results1[0].score).toBe(results2[0].score);
    });

    it("should handle records with tags", () => {
      const taggedRecords: ExpertiseRecord[] = [
        {
          type: "pattern",
          name: "test-pattern",
          description: "A test",
          tags: ["concurrency", "safety"],
          classification: "foundational",
          recorded_at: "2024-01-01T00:00:00Z",
        },
      ];

      const results = searchBM25(taggedRecords, "concurrency");
      expect(results.length).toBe(1);
      expect(results[0].matchedFields).toContain("tags");
    });

    it("should handle punctuation in queries", () => {
      const results = searchBM25(records, "process.exitCode");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].record.type).toBe("convention");
    });

    it("should boost records with multiple term matches", () => {
      const testRecords: ExpertiseRecord[] = [
        {
          type: "pattern",
          name: "single-match",
          description: "Only mentions locking once",
          classification: "foundational",
          recorded_at: "2024-01-01T00:00:00Z",
        },
        {
          type: "pattern",
          name: "multi-match",
          description: "Locking and locking and more locking",
          classification: "foundational",
          recorded_at: "2024-01-02T00:00:00Z",
        },
      ];

      const results = searchBM25(testRecords, "locking");
      expect(results.length).toBe(2);
      expect(results[0].record.type).toBe("pattern");
      if (results[0].record.type === "pattern") {
        expect(results[0].record.name).toBe("multi-match");
      }
    });

    it("should handle single-record corpus", () => {
      const singleRecord: ExpertiseRecord[] = [
        {
          type: "pattern",
          name: "lonely",
          description: "Only record",
          classification: "foundational",
          recorded_at: "2024-01-01T00:00:00Z",
        },
      ];

      const results = searchBM25(singleRecord, "lonely");
      expect(results.length).toBe(1);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });
});
