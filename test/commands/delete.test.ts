import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
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

describe("delete command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-delete-test-"));
    await initMulchDir(tmpDir);
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("deletes a record by 1-based index", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "First convention",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Second convention",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });

    const before = await readExpertiseFile(filePath);
    expect(before).toHaveLength(2);

    // Delete first record (index 1)
    const records = await readExpertiseFile(filePath);
    records.splice(0, 1);
    await writeExpertiseFile(filePath, records);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
    if (after[0].type === "convention") {
      expect(after[0].content).toBe("Second convention");
    }
  });

  it("deletes a record by ID", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "pattern",
      name: "test-pattern",
      description: "A test pattern",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Keep this one",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(2);
    const targetId = records[0].id;
    expect(targetId).toBeDefined();

    // Delete by ID
    const idx = records.findIndex((r) => r.id === targetId);
    records.splice(idx, 1);
    await writeExpertiseFile(filePath, records);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
    if (after[0].type === "convention") {
      expect(after[0].content).toBe("Keep this one");
    }
  });

  it("deletes the middle record and preserves order", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "First",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Middle",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Last",
      classification: "observational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    records.splice(1, 1); // Remove middle (0-based index 1)
    await writeExpertiseFile(filePath, records);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(2);
    if (after[0].type === "convention") {
      expect(after[0].content).toBe("First");
    }
    if (after[1].type === "convention") {
      expect(after[1].content).toBe("Last");
    }
  });

  it("deletes the last record leaving an empty file", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Only record",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);

    records.splice(0, 1);
    await writeExpertiseFile(filePath, records);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(0);
  });

  it("preserves other records when deleting the last entry", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "First",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "decision",
      title: "Use TypeScript",
      rationale: "Strong typing",
      date: "2026-01-01",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    records.splice(1, 1); // Delete last record (index 1)
    await writeExpertiseFile(filePath, records);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
    expect(after[0].type).toBe("convention");
  });
});
