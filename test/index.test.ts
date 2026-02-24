import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import all exports from src/index.ts
import type {
  Classification,
  ConventionRecord,
  DecisionRecord,
  Evidence,
  ExpertiseRecord,
  FailureRecord,
  MulchConfig,
  PatternRecord,
  RecordType,
} from "../src/index.ts";

import {
  DEFAULT_CONFIG,
  appendRecord,
  findDuplicate,
  generateRecordId,
  getExpertisePath,
  readConfig,
  readExpertiseFile,
  recordSchema,
  searchRecords,
  writeExpertiseFile,
} from "../src/index.ts";

describe("src/index.ts exports", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-index-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("type exports", () => {
    it("exports RecordType type", () => {
      // TypeScript compilation verifies the type exists
      const recordType: RecordType = "convention";
      expect(recordType).toBe("convention");
    });

    it("exports Classification type", () => {
      const classification: Classification = "foundational";
      expect(classification).toBe("foundational");
    });

    it("exports Evidence type", () => {
      const evidence: Evidence = {
        commit: "abc123",
      };
      expect(evidence.commit).toBe("abc123");
    });

    it("exports ConventionRecord type", () => {
      const record: ConventionRecord = {
        type: "convention",
        content: "Use semicolons",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      expect(record.type).toBe("convention");
    });

    it("exports PatternRecord type", () => {
      const record: PatternRecord = {
        type: "pattern",
        name: "test-pattern",
        description: "A test pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      expect(record.type).toBe("pattern");
    });

    it("exports FailureRecord type", () => {
      const record: FailureRecord = {
        type: "failure",
        error: "Something went wrong",
        impact: "Tests failed",
        fix: "Run npm install",
        classification: "observational",
        recorded_at: new Date().toISOString(),
      };
      expect(record.type).toBe("failure");
    });

    it("exports DecisionRecord type", () => {
      const record: DecisionRecord = {
        type: "decision",
        title: "Use TypeScript",
        rationale: "Type safety",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      expect(record.type).toBe("decision");
    });

    it("exports ExpertiseRecord type", () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Test export",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      expect(record.type).toBe("convention");
    });

    it("exports MulchConfig type", () => {
      const config: MulchConfig = {
        version: "1",
        domains: ["test"],
        governance: {
          max_entries: 100,
          warn_entries: 75,
          hard_limit: 100,
        },
      };
      expect(config.version).toBe("1");
    });
  });

  describe("value exports", () => {
    it("exports DEFAULT_CONFIG", () => {
      expect(DEFAULT_CONFIG).toBeDefined();
      expect(DEFAULT_CONFIG.version).toBe("1");
      expect(DEFAULT_CONFIG.governance.max_entries).toBe(100);
    });

    it("exports recordSchema", () => {
      expect(recordSchema).toBeDefined();
      expect(recordSchema.oneOf).toBeDefined();
      expect(Array.isArray(recordSchema.oneOf)).toBe(true);
    });
  });

  describe("config utilities", () => {
    it("exports and uses readConfig", async () => {
      // Create a minimal config file
      const { mkdir } = await import("node:fs/promises");
      const configDir = join(tmpDir, ".mulch");
      await mkdir(configDir, { recursive: true });

      const configPath = join(configDir, "mulch.config.yaml");
      const configContent = `version: "1"
domains: []
governance:
  max_entries: 100
  warn_entries: 75
  hard_limit: 100
`;
      await writeFile(configPath, configContent, "utf-8");

      const config = await readConfig(tmpDir);
      expect(config).toBeDefined();
      expect(config.version).toBe("1");
    });

    it("exports and uses getExpertisePath", () => {
      const path = getExpertisePath("testing", tmpDir);
      expect(path).toBe(join(tmpDir, ".mulch", "expertise", "testing.jsonl"));
    });
  });

  describe("expertise utilities", () => {
    it("exports and uses readExpertiseFile", async () => {
      const filePath = join(tmpDir, "test.jsonl");
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Test convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      await writeFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe("convention");
    });

    it("exports and uses searchRecords", () => {
      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Use semicolons in JavaScript",
          classification: "foundational",
          recorded_at: new Date().toISOString(),
        },
        {
          type: "pattern",
          name: "test-pattern",
          description: "A pattern for testing",
          classification: "foundational",
          recorded_at: new Date().toISOString(),
        },
      ];

      const matches = searchRecords(records, "JavaScript");
      expect(matches).toHaveLength(1);
      expect((matches[0] as ConventionRecord).content).toContain("JavaScript");
    });

    it("exports and uses appendRecord", async () => {
      const filePath = join(tmpDir, "append.jsonl");
      await writeFile(filePath, "", "utf-8");

      const record: ExpertiseRecord = {
        type: "convention",
        content: "Appended record",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      await appendRecord(filePath, record);

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(1);
      expect((records[0] as ConventionRecord).content).toBe("Appended record");
    });

    it("exports and uses writeExpertiseFile", async () => {
      const filePath = join(tmpDir, "write.jsonl");
      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "First record",
          classification: "foundational",
          recorded_at: new Date().toISOString(),
        },
        {
          type: "convention",
          content: "Second record",
          classification: "foundational",
          recorded_at: new Date().toISOString(),
        },
      ];

      await writeExpertiseFile(filePath, records);

      const readBack = await readExpertiseFile(filePath);
      expect(readBack).toHaveLength(2);
      expect((readBack[0] as ConventionRecord).content).toBe("First record");
      expect((readBack[1] as ConventionRecord).content).toBe("Second record");
    });

    it("exports and uses findDuplicate", () => {
      const record1: ExpertiseRecord = {
        type: "convention",
        content: "Unique convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      const record2: ExpertiseRecord = {
        type: "convention",
        content: "Unique convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const existing = [record1];
      const duplicate = findDuplicate(existing, record2);
      expect(duplicate).toBeDefined();
      expect(duplicate).not.toBeNull();
      expect(duplicate?.record.type).toBe("convention");
      expect((duplicate?.record as ConventionRecord).content).toBe(
        "Unique convention",
      );
    });

    it("exports and uses generateRecordId", () => {
      const record: ExpertiseRecord = {
        type: "convention",
        content: "Test record for ID generation",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const id = generateRecordId(record);
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^mx-[a-f0-9]{6}$/);
    });
  });

  describe("integration - full workflow", () => {
    it("demonstrates a complete workflow using exported functions", async () => {
      // Get expertise path
      const { mkdir } = await import("node:fs/promises");
      const domain = "integration-test";
      const filePath = getExpertisePath(domain, tmpDir);

      // Ensure directory exists
      const expertiseDir = join(tmpDir, ".mulch", "expertise");
      await mkdir(expertiseDir, { recursive: true });

      // Create initial record
      const record1: ExpertiseRecord = {
        type: "pattern",
        name: "workflow-pattern",
        description: "Integration test pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      // Write initial records
      await writeExpertiseFile(filePath, [record1]);

      // Append another record
      const record2: ExpertiseRecord = {
        type: "convention",
        content: "Integration test convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };
      await appendRecord(filePath, record2);

      // Read all records
      const allRecords = await readExpertiseFile(filePath);
      expect(allRecords).toHaveLength(2);

      // Search records
      const matches = searchRecords(allRecords, "integration");
      expect(matches).toHaveLength(2);

      // Check for duplicates
      const duplicate = findDuplicate(allRecords, record1);
      expect(duplicate).toBeDefined();
      expect(duplicate?.index).toBe(0);

      // Generate IDs
      const id1 = generateRecordId(record1);
      const id2 = generateRecordId(record2);
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });
});
