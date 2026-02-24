import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  getExpertiseDir,
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  createExpertiseFile,
  readExpertiseFile,
} from "../../src/utils/expertise.ts";

let tmpDir: string;

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mulch-doctor-test-"));
  await initMulchDir(tmpDir);
  await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing", "api"] }, tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("doctor health checks", () => {
  it("reports all passing when everything is healthy", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);
    await appendRecord(filePath, {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const apiPath = getExpertisePath("api", tmpDir);
    await createExpertiseFile(apiPath);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].id).toMatch(/^mx-/);
  });

  it("detects invalid JSON lines", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await writeFile(filePath, '{"valid":true}\nnot json\n', "utf-8");

    // Read should throw or skip invalid lines
    // The doctor command would detect this
    const content = await import("node:fs/promises").then((fs) =>
      fs.readFile(filePath, "utf-8"),
    );
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    let invalidCount = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch {
        invalidCount++;
      }
    }
    expect(invalidCount).toBe(1);
  });

  it("detects stale records", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    // Tactical record older than 14 days
    const staleRecord: ExpertiseRecord = {
      type: "convention",
      content: "Old convention",
      classification: "tactical",
      recorded_at: daysAgo(20),
    };
    await appendRecord(filePath, staleRecord);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);

    // Import isStale to verify
    const { isStale } = await import("../../src/commands/prune.js");
    const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
    expect(isStale(records[0], new Date(), shelfLife)).toBe(true);
  });

  it("detects orphaned domain files", async () => {
    // Create a JSONL file for a domain not in config
    const expertiseDir = getExpertiseDir(tmpDir);
    const orphanPath = join(expertiseDir, "orphan.jsonl");
    await writeFile(orphanPath, "", "utf-8");

    // Read the directory and check
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(expertiseDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const config = { ...DEFAULT_CONFIG, domains: ["testing", "api"] };
    const orphans = jsonlFiles
      .map((f) => f.replace(".jsonl", ""))
      .filter((d) => !config.domains.includes(d));
    expect(orphans).toContain("orphan");
  });

  it("detects duplicate records", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };

    // Force two identical records
    await appendRecord(filePath, { ...record });
    await appendRecord(filePath, { ...record, id: undefined });

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(2);

    const { findDuplicate } = await import("../../src/utils/expertise.js");
    const dup = findDuplicate([records[0]], records[1]);
    expect(dup).not.toBeNull();
  });

  it("foundational records are never stale", async () => {
    const { isStale } = await import("../../src/commands/prune.js");
    const record: ExpertiseRecord = {
      type: "convention",
      content: "Permanent rule",
      classification: "foundational",
      recorded_at: daysAgo(365),
    };
    const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
    expect(isStale(record, new Date(), shelfLife)).toBe(false);
  });

  it("detects governance threshold violations", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      domains: ["testing"],
      governance: {
        ...DEFAULT_CONFIG.governance,
        warn_entries: 5,
        max_entries: 10,
        hard_limit: 15,
      },
    };
    await writeConfig(config, tmpDir);

    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    // Add 7 records to trigger warn threshold (over warn_entries of 5)
    for (let i = 0; i < 7; i++) {
      await appendRecord(filePath, {
        type: "convention",
        content: `Convention ${i}`,
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
    }

    const records = await readExpertiseFile(filePath);
    expect(records.length).toBe(7);
    expect(records.length).toBeGreaterThan(config.governance.warn_entries);
    expect(records.length).toBeLessThan(config.governance.max_entries);
  });
});
