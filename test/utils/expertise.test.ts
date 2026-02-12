import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readExpertiseFile,
  appendRecord,
  writeExpertiseFile,
  filterByType,
  countRecords,
  createExpertiseFile,
  searchRecords,
} from "../../src/utils/expertise.js";
import type { ExpertiseRecord } from "../../src/schemas/record.js";

const makeConvention = (content: string): ExpertiseRecord => ({
  type: "convention",
  content,
  classification: "tactical",
  recorded_at: new Date().toISOString(),
});

const makePattern = (name: string): ExpertiseRecord => ({
  type: "pattern",
  name,
  description: `Description for ${name}`,
  classification: "foundational",
  recorded_at: new Date().toISOString(),
});

describe("expertise utils", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("readExpertiseFile", () => {
    it("returns empty array when file does not exist", async () => {
      const result = await readExpertiseFile(join(tmpDir, "nonexistent.jsonl"));
      expect(result).toEqual([]);
    });

    it("returns empty array for an empty file", async () => {
      const filePath = join(tmpDir, "empty.jsonl");
      await writeFile(filePath, "", "utf-8");
      const result = await readExpertiseFile(filePath);
      expect(result).toEqual([]);
    });

    it("returns records from valid JSONL", async () => {
      const filePath = join(tmpDir, "records.jsonl");
      const record1 = makeConvention("Use single quotes");
      const record2 = makeConvention("Use semicolons");
      const content = JSON.stringify(record1) + "\n" + JSON.stringify(record2) + "\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExpertiseFile(filePath);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(record1);
      expect(result[1]).toEqual(record2);
    });

    it("handles JSONL with trailing newlines", async () => {
      const filePath = join(tmpDir, "trailing.jsonl");
      const record = makeConvention("trailing newline test");
      await writeFile(filePath, JSON.stringify(record) + "\n\n\n", "utf-8");

      const result = await readExpertiseFile(filePath);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(record);
    });
  });

  describe("appendRecord", () => {
    it("appends a JSON line to a file", async () => {
      const filePath = join(tmpDir, "append.jsonl");
      await createExpertiseFile(filePath);

      const record = makeConvention("appended record");
      await appendRecord(filePath, record);

      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(record);
    });

    it("appends multiple records", async () => {
      const filePath = join(tmpDir, "multi.jsonl");
      await createExpertiseFile(filePath);

      const record1 = makeConvention("first");
      const record2 = makeConvention("second");
      await appendRecord(filePath, record1);
      await appendRecord(filePath, record2);

      const result = await readExpertiseFile(filePath);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(record1);
      expect(result[1]).toEqual(record2);
    });
  });

  describe("filterByType", () => {
    it("filters records by type", () => {
      const records: ExpertiseRecord[] = [
        makeConvention("conv1"),
        makePattern("pattern1"),
        makeConvention("conv2"),
      ];

      const conventions = filterByType(records, "convention");
      expect(conventions).toHaveLength(2);
      expect(conventions.every((r) => r.type === "convention")).toBe(true);

      const patterns = filterByType(records, "pattern");
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe("pattern");
    });

    it("returns empty array when no records match", () => {
      const records: ExpertiseRecord[] = [makeConvention("conv1")];
      const result = filterByType(records, "failure");
      expect(result).toEqual([]);
    });

    it("returns empty array for empty input", () => {
      const result = filterByType([], "convention");
      expect(result).toEqual([]);
    });
  });

  describe("countRecords", () => {
    it("returns count of records", () => {
      const records = [makeConvention("a"), makeConvention("b")];
      expect(countRecords(records)).toBe(2);
    });

    it("returns 0 for empty array", () => {
      expect(countRecords([])).toBe(0);
    });
  });

  describe("searchRecords with arrays", () => {
    it("finds records by tag value", () => {
      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Something unrelated",
          classification: "tactical",
          recorded_at: new Date().toISOString(),
          tags: ["esm", "typescript"],
        },
        makeConvention("No tags here"),
      ];
      const matches = searchRecords(records, "esm");
      expect(matches).toHaveLength(1);
      expect((matches[0] as { content: string }).content).toBe(
        "Something unrelated",
      );
    });

    it("finds records by files array value", () => {
      const records: ExpertiseRecord[] = [
        {
          type: "pattern",
          name: "test-pattern",
          description: "desc",
          classification: "tactical",
          recorded_at: new Date().toISOString(),
          files: ["src/foo.ts"],
        },
      ];
      const matches = searchRecords(records, "foo.ts");
      expect(matches).toHaveLength(1);
    });
  });

  describe("writeExpertiseFile (atomic writes)", () => {
    it("writes records via temp file + rename (no temp file left behind)", async () => {
      const filePath = join(tmpDir, "atomic.jsonl");
      await createExpertiseFile(filePath);

      const records = [makeConvention("first"), makeConvention("second")];
      await writeExpertiseFile(filePath, records);

      // Verify content was written correctly
      const result = await readExpertiseFile(filePath);
      expect(result).toHaveLength(2);

      // Verify no temp files left behind
      const files = await readdir(tmpDir);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });

    it("writes empty file atomically", async () => {
      const filePath = join(tmpDir, "empty-atomic.jsonl");
      await createExpertiseFile(filePath);
      await writeExpertiseFile(filePath, []);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("");

      const files = await readdir(tmpDir);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });

    it("produces valid JSONL that round-trips through read", async () => {
      const filePath = join(tmpDir, "roundtrip.jsonl");
      await createExpertiseFile(filePath);

      const records = [
        makeConvention("Use single quotes"),
        makePattern("atomic-pattern"),
      ];
      await writeExpertiseFile(filePath, records);

      const result = await readExpertiseFile(filePath);
      expect(result).toHaveLength(2);
      expect((result[0] as { content: string }).content).toBe("Use single quotes");
      expect((result[1] as { name: string }).name).toBe("atomic-pattern");
    });
  });
});
