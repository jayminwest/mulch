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
  findDuplicate,
  readExpertiseFile,
  writeExpertiseFile,
} from "../../src/utils/expertise.ts";

describe("deduplication", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-dedup-test-"));
    await initMulchDir(tmpDir);
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("findDuplicate", () => {
    it("detects duplicate convention by exact content", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const existing: ExpertiseRecord = {
        type: "convention",
        content: "Always use vitest",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };
      await appendRecord(filePath, existing);

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "convention",
        content: "Always use vitest",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(0);
    });

    it("does not flag different convention content as duplicate", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Always use vitest",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "convention",
        content: "Always use jest",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      expect(findDuplicate(records, newRecord)).toBeNull();
    });

    it("detects duplicate pattern by name", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "repo-pattern",
        description: "Old description",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "pattern",
        name: "repo-pattern",
        description: "New improved description",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(0);
    });

    it("detects duplicate decision by title", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "decision",
        title: "Use ESM",
        rationale: "Old rationale",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "decision",
        title: "Use ESM",
        rationale: "Better rationale with more detail",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(0);
    });

    it("detects duplicate failure by description", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "failure",
        description: "OOM on large datasets",
        resolution: "Use streaming",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "failure",
        description: "OOM on large datasets",
        resolution: "Use streaming with backpressure",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(0);
    });

    it("does not cross-match different record types", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Use streaming",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "failure",
        description: "Use streaming",
        resolution: "Fixed it",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };

      expect(findDuplicate(records, newRecord)).toBeNull();
    });

    it("returns correct index when duplicate is not first record", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "First convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Second convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "convention",
        content: "Second convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(1);
    });

    it("returns null for empty existing records", () => {
      const newRecord: ExpertiseRecord = {
        type: "convention",
        content: "Something new",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      expect(findDuplicate([], newRecord)).toBeNull();
    });

    it("detects duplicate reference by name", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "reference",
        name: "config-file",
        description: "Old description",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "reference",
        name: "config-file",
        description: "Updated description",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(0);
    });

    it("detects duplicate guide by name", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "guide",
        name: "deploy-guide",
        description: "Old steps",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "guide",
        name: "deploy-guide",
        description: "New improved steps",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();
      expect(dup!.index).toBe(0);
    });
  });

  describe("upsert behavior for named types", () => {
    it("pattern upsert replaces in place", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "repo-pattern",
        description: "Old description",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Unrelated convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "pattern",
        name: "repo-pattern",
        description: "New improved description",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      expect(dup).not.toBeNull();

      // Simulate upsert
      records[dup!.index] = newRecord;
      await writeExpertiseFile(filePath, records);

      const updated = await readExpertiseFile(filePath);
      expect(updated).toHaveLength(2);
      expect((updated[0] as { description: string }).description).toBe(
        "New improved description",
      );
      expect(updated[1].type).toBe("convention"); // untouched
    });

    it("decision upsert replaces in place", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "decision",
        title: "Use ESM",
        rationale: "Old rationale",
        classification: "foundational",
        recorded_at: "2025-01-01T00:00:00.000Z",
      });

      const records = await readExpertiseFile(filePath);
      const newRecord: ExpertiseRecord = {
        type: "decision",
        title: "Use ESM",
        rationale: "Better rationale",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      };

      const dup = findDuplicate(records, newRecord);
      records[dup!.index] = newRecord;
      await writeExpertiseFile(filePath, records);

      const updated = await readExpertiseFile(filePath);
      expect(updated).toHaveLength(1);
      expect((updated[0] as { rationale: string }).rationale).toBe(
        "Better rationale",
      );
    });
  });
});
