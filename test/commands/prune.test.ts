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
  writeExpertiseFile,
} from "../../src/utils/expertise.ts";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

describe("prune command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-prune-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("writeExpertiseFile", () => {
    it("writes records as JSONL and can be read back", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

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
          classification: "tactical",
          recorded_at: new Date().toISOString(),
        },
      ];

      await writeExpertiseFile(filePath, records);

      const readBack = await readExpertiseFile(filePath);
      expect(readBack).toHaveLength(2);
      expect((readBack[0] as { content: string }).content).toBe("First record");
      expect((readBack[1] as { content: string }).content).toBe(
        "Second record",
      );
    });

    it("writes empty array results in empty file", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await writeExpertiseFile(filePath, []);

      const readBack = await readExpertiseFile(filePath);
      expect(readBack).toHaveLength(0);
    });
  });

  describe("stale entry detection", () => {
    it("foundational records are never pruned regardless of age", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const record: ExpertiseRecord = {
        type: "convention",
        content: "Permanent convention",
        classification: "foundational",
        recorded_at: daysAgo(365),
      };
      await appendRecord(filePath, record);

      const records = await readExpertiseFile(filePath);
      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;

      const now = new Date();
      const staleRecords = records.filter((r) => {
        if (r.classification === "foundational") return false;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age > shelfLife.tactical;
        if (r.classification === "observational")
          return age > shelfLife.observational;
        return false;
      });

      expect(staleRecords).toHaveLength(0);
    });

    it("tactical records older than 14 days are stale", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const freshRecord: ExpertiseRecord = {
        type: "convention",
        content: "Fresh tactical",
        classification: "tactical",
        recorded_at: daysAgo(5),
      };
      const staleRecord: ExpertiseRecord = {
        type: "convention",
        content: "Stale tactical",
        classification: "tactical",
        recorded_at: daysAgo(20),
      };

      await appendRecord(filePath, freshRecord);
      await appendRecord(filePath, staleRecord);

      const records = await readExpertiseFile(filePath);
      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
      const now = new Date();

      const kept = records.filter((r) => {
        if (r.classification === "foundational") return true;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age <= shelfLife.tactical;
        if (r.classification === "observational")
          return age <= shelfLife.observational;
        return true;
      });

      expect(kept).toHaveLength(1);
      expect((kept[0] as { content: string }).content).toBe("Fresh tactical");
    });

    it("observational records older than 30 days are stale", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const freshRecord: ExpertiseRecord = {
        type: "convention",
        content: "Fresh observational",
        classification: "observational",
        recorded_at: daysAgo(10),
      };
      const staleRecord: ExpertiseRecord = {
        type: "convention",
        content: "Stale observational",
        classification: "observational",
        recorded_at: daysAgo(45),
      };

      await appendRecord(filePath, freshRecord);
      await appendRecord(filePath, staleRecord);

      const records = await readExpertiseFile(filePath);
      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
      const now = new Date();

      const kept = records.filter((r) => {
        if (r.classification === "foundational") return true;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age <= shelfLife.tactical;
        if (r.classification === "observational")
          return age <= shelfLife.observational;
        return true;
      });

      expect(kept).toHaveLength(1);
      expect((kept[0] as { content: string }).content).toBe(
        "Fresh observational",
      );
    });
  });

  describe("pruning with file rewrite", () => {
    it("prune removes stale entries and keeps fresh ones", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Permanent",
          classification: "foundational",
          recorded_at: daysAgo(365),
        },
        {
          type: "convention",
          content: "Fresh tactical",
          classification: "tactical",
          recorded_at: daysAgo(3),
        },
        {
          type: "convention",
          content: "Stale tactical",
          classification: "tactical",
          recorded_at: daysAgo(20),
        },
        {
          type: "convention",
          content: "Stale observational",
          classification: "observational",
          recorded_at: daysAgo(45),
        },
      ];

      for (const record of records) {
        await appendRecord(filePath, record);
      }

      // Read, filter, and rewrite
      const allRecords = await readExpertiseFile(filePath);
      expect(allRecords).toHaveLength(4);

      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
      const now = new Date();

      const kept = allRecords.filter((r) => {
        if (r.classification === "foundational") return true;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age <= shelfLife.tactical;
        if (r.classification === "observational")
          return age <= shelfLife.observational;
        return true;
      });

      expect(kept).toHaveLength(2);
      await writeExpertiseFile(filePath, kept);

      // Verify file was rewritten correctly
      const afterPrune = await readExpertiseFile(filePath);
      expect(afterPrune).toHaveLength(2);
      expect((afterPrune[0] as { content: string }).content).toBe("Permanent");
      expect((afterPrune[1] as { content: string }).content).toBe(
        "Fresh tactical",
      );
    });

    it("prune across multiple domains", async () => {
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      // Testing domain: 1 stale, 1 fresh
      await appendRecord(testingPath, {
        type: "convention",
        content: "Stale testing",
        classification: "tactical",
        recorded_at: daysAgo(20),
      });
      await appendRecord(testingPath, {
        type: "convention",
        content: "Fresh testing",
        classification: "tactical",
        recorded_at: daysAgo(5),
      });

      // Architecture domain: 1 stale observational
      await appendRecord(archPath, {
        type: "decision",
        title: "Old decision",
        rationale: "Was temporary",
        classification: "observational",
        recorded_at: daysAgo(60),
      });
      await appendRecord(archPath, {
        type: "decision",
        title: "Recent decision",
        rationale: "Still relevant",
        classification: "foundational",
        recorded_at: daysAgo(60),
      });

      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
      const now = new Date();

      // Prune testing
      const testRecords = await readExpertiseFile(testingPath);
      const keptTesting = testRecords.filter((r) => {
        if (r.classification === "foundational") return true;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age <= shelfLife.tactical;
        if (r.classification === "observational")
          return age <= shelfLife.observational;
        return true;
      });
      await writeExpertiseFile(testingPath, keptTesting);

      // Prune architecture
      const archRecords = await readExpertiseFile(archPath);
      const keptArch = archRecords.filter((r) => {
        if (r.classification === "foundational") return true;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age <= shelfLife.tactical;
        if (r.classification === "observational")
          return age <= shelfLife.observational;
        return true;
      });
      await writeExpertiseFile(archPath, keptArch);

      // Verify
      const afterTesting = await readExpertiseFile(testingPath);
      expect(afterTesting).toHaveLength(1);
      expect((afterTesting[0] as { content: string }).content).toBe(
        "Fresh testing",
      );

      const afterArch = await readExpertiseFile(archPath);
      expect(afterArch).toHaveLength(1);
      expect(afterArch[0].type).toBe("decision");
      expect((afterArch[0] as { title: string }).title).toBe("Recent decision");
    });

    it("no stale entries means no file rewrite", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const records: ExpertiseRecord[] = [
        {
          type: "convention",
          content: "Fresh foundational",
          classification: "foundational",
          recorded_at: daysAgo(1),
        },
        {
          type: "convention",
          content: "Fresh tactical",
          classification: "tactical",
          recorded_at: daysAgo(5),
        },
      ];

      for (const record of records) {
        await appendRecord(filePath, record);
      }

      const allRecords = await readExpertiseFile(filePath);
      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
      const now = new Date();

      const stale = allRecords.filter((r) => {
        if (r.classification === "foundational") return false;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age > shelfLife.tactical;
        if (r.classification === "observational")
          return age > shelfLife.observational;
        return false;
      });

      expect(stale).toHaveLength(0);

      // File should still have both records
      const afterCheck = await readExpertiseFile(filePath);
      expect(afterCheck).toHaveLength(2);
    });

    it("tactical record exactly at boundary (14 days) is not pruned", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const record: ExpertiseRecord = {
        type: "convention",
        content: "Boundary tactical",
        classification: "tactical",
        recorded_at: daysAgo(14),
      };
      await appendRecord(filePath, record);

      const records = await readExpertiseFile(filePath);
      const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
      const now = new Date();

      const stale = records.filter((r) => {
        if (r.classification === "foundational") return false;
        const age = Math.floor(
          (now.getTime() - new Date(r.recorded_at).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (r.classification === "tactical") return age > shelfLife.tactical;
        if (r.classification === "observational")
          return age > shelfLife.observational;
        return false;
      });

      // At exactly 14 days (within rounding), should not be pruned
      // The daysAgo function sets the time to now minus 14 full days,
      // so the age is approximately 14.0 days, which is not > 14
      expect(stale).toHaveLength(0);
    });

    it("empty domain file is skipped gracefully", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(0);
    });
  });
});
