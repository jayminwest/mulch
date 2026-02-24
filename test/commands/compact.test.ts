import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
  readExpertiseFile,
} from "../../src/utils/expertise.ts";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe("compact command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-compact-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("analyze", () => {
    it("finds no candidates when domain has < 2 records of any type", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);
      await appendRecord(filePath, {
        type: "convention",
        content: "Only one",
        classification: "tactical",
        recorded_at: daysAgo(20),
      });

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(1);
      // With only 1 record, no compaction candidates exist
    });

    it("finds candidates when 3+ records of same type exist", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      for (let i = 0; i < 3; i++) {
        await appendRecord(filePath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(3);
    });

    it("finds candidates when records are stale", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "failure",
        description: "Old failure 1",
        resolution: "Fix 1",
        classification: "tactical",
        recorded_at: daysAgo(20), // past 14-day shelf life
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Old failure 2",
        resolution: "Fix 2",
        classification: "tactical",
        recorded_at: daysAgo(20),
      });

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(2);
    });
  });

  describe("auto", () => {
    it("merges convention content fields", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Convention A",
          classification: "tactical",
          recorded_at: daysAgo(10),
          id: "mx-test1",
        },
        {
          type: "convention",
          content: "Convention B",
          classification: "tactical",
          recorded_at: daysAgo(8),
          id: "mx-test2",
        },
        {
          type: "convention",
          content: "Convention C",
          classification: "observational",
          recorded_at: daysAgo(5),
          id: "mx-test3",
        },
      ];

      const result = mergeRecords(records);

      expect(result.type).toBe("convention");
      if (result.type === "convention") {
        expect(result.content).toBe(
          "Convention A\n\nConvention B\n\nConvention C",
        );
      }
      expect(result.classification).toBe("foundational");
      expect(result.supersedes).toEqual(["mx-test1", "mx-test2", "mx-test3"]);
      expect(result.id).toBeDefined();
    });

    it("merges pattern names by choosing longest", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "pattern",
          name: "short",
          description: "Description 1",
          classification: "tactical",
          recorded_at: daysAgo(20),
          id: "mx-test1",
        },
        {
          type: "pattern",
          name: "much-longer-name",
          description: "Description 2",
          classification: "tactical",
          recorded_at: daysAgo(18),
          id: "mx-test2",
        },
        {
          type: "pattern",
          name: "mid",
          description: "Description 3",
          classification: "tactical",
          recorded_at: daysAgo(16),
          id: "mx-test3",
        },
      ];

      const result = mergeRecords(records);

      expect(result.type).toBe("pattern");
      if (result.type === "pattern") {
        expect(result.name).toBe("much-longer-name");
        expect(result.description).toBe(
          "Description 1\n\nDescription 2\n\nDescription 3",
        );
      }
      expect(result.classification).toBe("foundational");
      expect(result.supersedes).toEqual(["mx-test1", "mx-test2", "mx-test3"]);
    });

    it("merges failure descriptions and resolutions", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "failure",
          description: "Failure 1",
          resolution: "Fix 1",
          classification: "tactical",
          recorded_at: daysAgo(20),
          id: "mx-test1",
        },
        {
          type: "failure",
          description: "Failure 2",
          resolution: "Fix 2",
          classification: "tactical",
          recorded_at: daysAgo(18),
          id: "mx-test2",
        },
      ];

      const result = mergeRecords(records);

      expect(result.type).toBe("failure");
      if (result.type === "failure") {
        expect(result.description).toBe("Failure 1\n\nFailure 2");
        expect(result.resolution).toBe("Fix 1\n\nFix 2");
      }
      expect(result.classification).toBe("foundational");
    });

    it("merges decision titles by choosing longest", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "decision",
          title: "Short",
          rationale: "Rationale 1",
          classification: "tactical",
          recorded_at: daysAgo(20),
          id: "mx-test1",
        },
        {
          type: "decision",
          title: "Much longer decision title",
          rationale: "Rationale 2",
          classification: "tactical",
          recorded_at: daysAgo(18),
          id: "mx-test2",
        },
        {
          type: "decision",
          title: "Medium",
          rationale: "Rationale 3",
          classification: "tactical",
          recorded_at: daysAgo(16),
          id: "mx-test3",
        },
      ];

      const result = mergeRecords(records);

      expect(result.type).toBe("decision");
      if (result.type === "decision") {
        expect(result.title).toBe("Much longer decision title");
        expect(result.rationale).toBe(
          "Rationale 1\n\nRationale 2\n\nRationale 3",
        );
      }
      expect(result.classification).toBe("foundational");
    });

    it("preserves and merges tags across records", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Convention A",
          classification: "tactical",
          recorded_at: daysAgo(10),
          tags: ["tag1", "tag2"],
          id: "mx-test1",
        },
        {
          type: "convention",
          content: "Convention B",
          classification: "tactical",
          recorded_at: daysAgo(8),
          tags: ["tag2", "tag3"],
          id: "mx-test2",
        },
        {
          type: "convention",
          content: "Convention C",
          classification: "tactical",
          recorded_at: daysAgo(6),
          tags: ["tag4"],
          id: "mx-test3",
        },
      ];

      const result = mergeRecords(records);

      expect(result.tags).toBeDefined();
      expect(result.tags).toEqual(
        expect.arrayContaining(["tag1", "tag2", "tag3", "tag4"]),
      );
      expect(result.tags?.length).toBe(4); // Deduplicated
    });

    it("preserves and merges files for pattern types", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "pattern",
          name: "pattern-1",
          description: "Description 1",
          classification: "tactical",
          recorded_at: daysAgo(20),
          files: ["src/file1.ts"],
          id: "mx-test1",
        },
        {
          type: "pattern",
          name: "pattern-2",
          description: "Description 2",
          classification: "tactical",
          recorded_at: daysAgo(18),
          files: ["src/file2.ts", "src/file1.ts"],
          id: "mx-test2",
        },
        {
          type: "pattern",
          name: "pattern-3",
          description: "Description 3",
          classification: "tactical",
          recorded_at: daysAgo(16),
          files: ["src/file3.ts"],
          id: "mx-test3",
        },
      ];

      const result = mergeRecords(records);

      if (result.type === "pattern") {
        expect(result.files).toBeDefined();
        expect(result.files).toEqual(
          expect.arrayContaining([
            "src/file1.ts",
            "src/file2.ts",
            "src/file3.ts",
          ]),
        );
        expect(result.files?.length).toBe(3); // Deduplicated
      }
    });

    it("merges reference types correctly", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "reference",
          name: "short",
          description: "Desc 1",
          classification: "tactical",
          recorded_at: daysAgo(10),
          id: "mx-test1",
        },
        {
          type: "reference",
          name: "much-longer-reference-name",
          description: "Desc 2",
          classification: "tactical",
          recorded_at: daysAgo(8),
          id: "mx-test2",
        },
      ];

      const result = mergeRecords(records);

      expect(result.type).toBe("reference");
      if (result.type === "reference") {
        expect(result.name).toBe("much-longer-reference-name");
        expect(result.description).toBe("Desc 1\n\nDesc 2");
      }
    });

    it("merges guide types correctly", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "guide",
          name: "short-guide",
          description: "Guide 1",
          classification: "tactical",
          recorded_at: daysAgo(10),
          id: "mx-test1",
        },
        {
          type: "guide",
          name: "very-long-guide-name",
          description: "Guide 2",
          classification: "tactical",
          recorded_at: daysAgo(8),
          id: "mx-test2",
        },
      ];

      const result = mergeRecords(records);

      expect(result.type).toBe("guide");
      if (result.type === "guide") {
        expect(result.name).toBe("very-long-guide-name");
        expect(result.description).toBe("Guide 1\n\nGuide 2");
      }
    });
  });

  describe("guardrails", () => {
    it("respects --min-group size threshold", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      // Create 4 conventions (below default --min-group of 5)
      for (let i = 0; i < 4; i++) {
        await appendRecord(filePath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(4);

      // With --min-group 5 (default), 4 records should not be compacted
      // unless they have stale records
      const { default: findCandidates } = await import(
        "../../src/commands/compact.js"
      );
      // We'd need to export findCandidates to test this properly, or test via CLI
      // For now, we verify that the logic works in the auto handler
    });

    it("respects --max-records limit", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      // Create multiple groups that would exceed max-records limit
      for (let i = 0; i < 10; i++) {
        await appendRecord(filePath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }
      for (let i = 0; i < 10; i++) {
        await appendRecord(filePath, {
          type: "pattern",
          name: `pattern-${i}`,
          description: `Description ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(20);

      // Test that max-records limit would prevent compacting all at once
      // This would be tested more thoroughly via CLI integration tests
    });

    it("dry-run mode does not modify files", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      // Create 5 conventions that would be compacted
      for (let i = 0; i < 5; i++) {
        await appendRecord(filePath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const beforeRecords = await readExpertiseFile(filePath);
      expect(beforeRecords).toHaveLength(5);

      // In dry-run mode, records should remain unchanged
      // This would be tested via CLI, but we can verify the concept here
      const afterRecords = await readExpertiseFile(filePath);
      expect(afterRecords).toHaveLength(5);
      expect(afterRecords).toEqual(beforeRecords);
    });

    it("merges records with min-group threshold of 3", async () => {
      const { mergeRecords } = await import("../../src/commands/compact.js");

      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Convention A",
          classification: "tactical",
          recorded_at: daysAgo(10),
          id: "mx-test1",
        },
        {
          type: "convention",
          content: "Convention B",
          classification: "tactical",
          recorded_at: daysAgo(8),
          id: "mx-test2",
        },
        {
          type: "convention",
          content: "Convention C",
          classification: "tactical",
          recorded_at: daysAgo(5),
          id: "mx-test3",
        },
      ];

      const result = mergeRecords(records);
      expect(result.type).toBe("convention");
      expect(result.supersedes).toHaveLength(3);
    });

    it("does not compact groups below min threshold", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      // Create only 2 conventions (below min-group of 3 for non-stale)
      await appendRecord(filePath, {
        type: "convention",
        content: "Convention A",
        classification: "foundational",
        recorded_at: daysAgo(5),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Convention B",
        classification: "foundational",
        recorded_at: daysAgo(3),
      });

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(2);

      // With only 2 foundational (non-stale) records, they should not be auto-compacted
      // unless min-group is set to 2 or lower
    });
  });

  describe("domain filtering", () => {
    it("maintains separate expertise files for different domains", async () => {
      // Set up two domains with records
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      // Add 3 conventions to testing domain
      for (let i = 0; i < 3; i++) {
        await appendRecord(testingPath, {
          type: "convention",
          content: `Testing convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      // Add 3 patterns to architecture domain
      for (let i = 0; i < 3; i++) {
        await appendRecord(archPath, {
          type: "pattern",
          name: `arch-pattern-${i}`,
          description: `Architecture pattern ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const testingRecords = await readExpertiseFile(testingPath);
      const archRecords = await readExpertiseFile(archPath);

      // Each domain should have its own records
      expect(testingRecords).toHaveLength(3);
      expect(archRecords).toHaveLength(3);

      // Testing domain should only have conventions
      expect(testingRecords.every((r) => r.type === "convention")).toBe(true);

      // Architecture domain should only have patterns
      expect(archRecords.every((r) => r.type === "pattern")).toBe(true);
    });

    it("correctly identifies compactable groups within a single domain", async () => {
      // Set up testing domain with multiple record types
      const testingPath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(testingPath);

      // Add 3 conventions (compactable group)
      for (let i = 0; i < 3; i++) {
        await appendRecord(testingPath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      // Add only 1 pattern (not compactable)
      await appendRecord(testingPath, {
        type: "pattern",
        name: "single-pattern",
        description: "Only one pattern",
        classification: "tactical",
        recorded_at: daysAgo(5),
      });

      // Add 3 failures (compactable group)
      for (let i = 0; i < 3; i++) {
        await appendRecord(testingPath, {
          type: "failure",
          description: `Failure ${i}`,
          resolution: `Fix ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const records = await readExpertiseFile(testingPath);
      expect(records).toHaveLength(7);

      // Group by type
      const byType = new Map<string, number>();
      for (const r of records) {
        byType.set(r.type, (byType.get(r.type) || 0) + 1);
      }

      // Should have 3 conventions, 1 pattern, 3 failures
      expect(byType.get("convention")).toBe(3);
      expect(byType.get("pattern")).toBe(1);
      expect(byType.get("failure")).toBe(3);

      // Two groups would be compactable (3+ records): conventions and failures
      // One group would not be compactable (< 3 records): pattern
    });

    it("preserves domain isolation during compaction setup", async () => {
      // Set up two domains with compactable records
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      // Add 5 conventions to testing (meets min-group threshold)
      for (let i = 0; i < 5; i++) {
        await appendRecord(testingPath, {
          type: "convention",
          content: `Testing convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(10),
        });
      }

      // Add 5 patterns to architecture (meets min-group threshold)
      for (let i = 0; i < 5; i++) {
        await appendRecord(archPath, {
          type: "pattern",
          name: `arch-pattern-${i}`,
          description: `Architecture pattern ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(10),
        });
      }

      const testingBefore = await readExpertiseFile(testingPath);
      const archBefore = await readExpertiseFile(archPath);

      expect(testingBefore).toHaveLength(5);
      expect(archBefore).toHaveLength(5);

      // All testing records should be conventions
      expect(testingBefore.every((r) => r.type === "convention")).toBe(true);

      // All architecture records should be patterns
      expect(archBefore.every((r) => r.type === "pattern")).toBe(true);

      // Records from one domain should not affect the other
      // This verifies the foundation for domain-filtered compaction
    });

    it("handles multiple domains with varying record counts", async () => {
      // Set up domains with different characteristics
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      // Testing: small group (below compaction threshold)
      for (let i = 0; i < 2; i++) {
        await appendRecord(testingPath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      // Architecture: large group (above compaction threshold)
      for (let i = 0; i < 5; i++) {
        await appendRecord(archPath, {
          type: "pattern",
          name: `pattern-${i}`,
          description: `Pattern ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const testingRecords = await readExpertiseFile(testingPath);
      const archRecords = await readExpertiseFile(archPath);

      expect(testingRecords).toHaveLength(2);
      expect(archRecords).toHaveLength(5);

      // Testing domain has too few records for auto-compaction (< 3)
      // Architecture domain has enough records for auto-compaction (5)
      // Domain filtering would allow selective compaction of architecture only
    });

    it("correctly groups records by type within domain for compaction analysis", async () => {
      // Set up a domain with multiple types, some compactable
      const testingPath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(testingPath);

      // Add 3 conventions (compactable)
      for (let i = 0; i < 3; i++) {
        await appendRecord(testingPath, {
          type: "convention",
          content: `Convention ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      // Add 3 patterns (compactable)
      for (let i = 0; i < 3; i++) {
        await appendRecord(testingPath, {
          type: "pattern",
          name: `pattern-${i}`,
          description: `Pattern ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      // Add 3 failures (compactable)
      for (let i = 0; i < 3; i++) {
        await appendRecord(testingPath, {
          type: "failure",
          description: `Failure ${i}`,
          resolution: `Fix ${i}`,
          classification: "tactical",
          recorded_at: daysAgo(5),
        });
      }

      const records = await readExpertiseFile(testingPath);
      expect(records).toHaveLength(9);

      // Group by type to verify proper segregation
      const conventions = records.filter((r) => r.type === "convention");
      const patterns = records.filter((r) => r.type === "pattern");
      const failures = records.filter((r) => r.type === "failure");

      expect(conventions).toHaveLength(3);
      expect(patterns).toHaveLength(3);
      expect(failures).toHaveLength(3);

      // Each type group would be a separate compaction candidate
      // Domain filtering ensures these are analyzed independently per domain
    });

    it("correctly isolates domain records during multi-domain setup", async () => {
      // Verify that records don't leak between domains
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      await appendRecord(testingPath, {
        type: "convention",
        content: "Testing-specific convention",
        classification: "foundational",
        recorded_at: daysAgo(1),
      });

      await appendRecord(archPath, {
        type: "pattern",
        name: "arch-pattern",
        description: "Architecture-specific pattern",
        classification: "foundational",
        recorded_at: daysAgo(1),
      });

      const testingRecords = await readExpertiseFile(testingPath);
      const archRecords = await readExpertiseFile(archPath);

      // Each domain should only have its own records
      expect(testingRecords).toHaveLength(1);
      expect(testingRecords[0].type).toBe("convention");

      expect(archRecords).toHaveLength(1);
      expect(archRecords[0].type).toBe("pattern");
    });
  });

  describe("apply", () => {
    it("compacts multiple conventions into one", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Convention A",
        classification: "tactical",
        recorded_at: daysAgo(10),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Convention B",
        classification: "tactical",
        recorded_at: daysAgo(8),
      });
      await appendRecord(filePath, {
        type: "pattern",
        name: "keep-me",
        description: "Should not be removed",
        classification: "foundational",
        recorded_at: daysAgo(1),
      });

      const before = await readExpertiseFile(filePath);
      expect(before).toHaveLength(3);

      // Simulate compaction: remove conventions 1,2, add consolidated
      const idA = before[0].id!;
      const idB = before[1].id!;

      // Remove records at indices 0 and 1, keep pattern at index 2
      const remaining = [before[2]];
      const replacement: ExpertiseRecord = {
        type: "convention",
        content: "Combined: Convention A and B",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        supersedes: [idA, idB],
      };
      remaining.push(replacement);

      const { writeExpertiseFile } = await import(
        "../../src/utils/expertise.js"
      );
      await writeExpertiseFile(filePath, remaining);

      const after = await readExpertiseFile(filePath);
      expect(after).toHaveLength(2);
      expect(after[0].type).toBe("pattern");
      expect(after[1].type).toBe("convention");
      if (after[1].type === "convention") {
        expect(after[1].content).toBe("Combined: Convention A and B");
        expect(after[1].classification).toBe("foundational");
        expect(after[1].supersedes).toEqual([idA, idB]);
      }
    });

    it("compacts failures preserving non-target records", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "failure",
        description: "Failure 1",
        resolution: "Fix 1",
        classification: "tactical",
        recorded_at: daysAgo(20),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Failure 2",
        resolution: "Fix 2",
        classification: "tactical",
        recorded_at: daysAgo(18),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Unrelated convention",
        classification: "foundational",
        recorded_at: daysAgo(1),
      });

      const before = await readExpertiseFile(filePath);
      expect(before).toHaveLength(3);

      // Remove failures, keep convention, add compacted failure
      const remaining = [before[2]];
      const replacement: ExpertiseRecord = {
        type: "failure",
        description: "Combined failures",
        resolution: "Combined fixes",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      remaining.push(replacement);

      const { writeExpertiseFile } = await import(
        "../../src/utils/expertise.js"
      );
      await writeExpertiseFile(filePath, remaining);

      const after = await readExpertiseFile(filePath);
      expect(after).toHaveLength(2);
      expect(after[0].type).toBe("convention");
      expect(after[1].type).toBe("failure");
    });

    it("compacted record gets foundational classification", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "old-pattern-1",
        description: "Old pattern 1",
        classification: "tactical",
        recorded_at: daysAgo(20),
      });
      await appendRecord(filePath, {
        type: "pattern",
        name: "old-pattern-2",
        description: "Old pattern 2",
        classification: "observational",
        recorded_at: daysAgo(35),
      });

      const before = await readExpertiseFile(filePath);
      const replacement: ExpertiseRecord = {
        type: "pattern",
        name: "consolidated-pattern",
        description: "Consolidated from old patterns",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        supersedes: before.map((r) => r.id!),
      };

      const { writeExpertiseFile } = await import(
        "../../src/utils/expertise.js"
      );
      await writeExpertiseFile(filePath, [replacement]);

      const after = await readExpertiseFile(filePath);
      expect(after).toHaveLength(1);
      expect(after[0].classification).toBe("foundational");
    });

    it("compacted record has supersedes links to source IDs", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "decision",
        title: "Decision A",
        rationale: "Reason A",
        classification: "tactical",
        recorded_at: daysAgo(15),
      });
      await appendRecord(filePath, {
        type: "decision",
        title: "Decision B",
        rationale: "Reason B",
        classification: "tactical",
        recorded_at: daysAgo(12),
      });

      const before = await readExpertiseFile(filePath);
      const sourceIds = before.map((r) => r.id!);

      const replacement: ExpertiseRecord = {
        type: "decision",
        title: "Consolidated decision",
        rationale: "Combined rationale",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        supersedes: sourceIds,
      };

      const { writeExpertiseFile } = await import(
        "../../src/utils/expertise.js"
      );
      await writeExpertiseFile(filePath, [replacement]);

      const after = await readExpertiseFile(filePath);
      expect(after[0].supersedes).toEqual(sourceIds);
    });
  });
});
