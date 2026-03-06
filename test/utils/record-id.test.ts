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
  generateRecordId,
  readExpertiseFile,
  resolveRecordId,
  writeExpertiseFile,
} from "../../src/utils/expertise.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mulch-id-test-"));
  await initMulchDir(tmpDir);
  await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("generateRecordId", () => {
  it("generates unique IDs per call", () => {
    const id1 = generateRecordId();
    const id2 = generateRecordId();
    expect(id1).not.toBe(id2);
  });

  it("generates IDs matching the mx-<32-char-hex> pattern", () => {
    const id = generateRecordId();
    expect(id).toMatch(/^mx-[0-9a-f]{32}$/);
  });

  it("generates IDs in timestamp order", () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(generateRecordId());
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] >= ids[i - 1]).toBe(true);
    }
  });
});

describe("appendRecord with ID generation", () => {
  it("auto-generates ID when appending a record without one", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "convention",
      content: "Test convention",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);
    const records = await readExpertiseFile(filePath);
    expect(records[0].id).toMatch(/^mx-[0-9a-f]{32}$/);
  });

  it("preserves existing ID when appending", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      id: "mx-aabbcc",
      type: "convention",
      content: "Test convention",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);
    const records = await readExpertiseFile(filePath);
    expect(records[0].id).toBe("mx-aabbcc");
  });
});

describe("resolveRecordId", () => {
  const records: ExpertiseRecord[] = [
    {
      id: "mx-aabbcc",
      type: "convention",
      content: "First",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    },
    {
      id: "mx-ddeeff",
      type: "pattern",
      name: "test-pattern",
      description: "Second",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    },
    {
      id: "mx-aabb11",
      type: "failure",
      description: "Third",
      resolution: "Fix it",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    },
  ];

  it("resolves full ID (mx-aabbcc)", () => {
    const result = resolveRecordId(records, "mx-aabbcc");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.index).toBe(0);
      expect(result.record.id).toBe("mx-aabbcc");
    }
  });

  it("resolves bare hash (aabbcc)", () => {
    const result = resolveRecordId(records, "aabbcc");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.index).toBe(0);
    }
  });

  it("resolves unique prefix (dde)", () => {
    const result = resolveRecordId(records, "dde");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.index).toBe(1);
      expect(result.record.id).toBe("mx-ddeeff");
    }
  });

  it("resolves unique prefix with mx- (mx-dde)", () => {
    const result = resolveRecordId(records, "mx-dde");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.index).toBe(1);
    }
  });

  it("returns error for ambiguous prefix (aabb)", () => {
    const result = resolveRecordId(records, "aabb");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ambiguous");
      expect(result.error).toContain("mx-aabbcc");
      expect(result.error).toContain("mx-aabb11");
    }
  });

  it("returns error for non-existent ID", () => {
    const result = resolveRecordId(records, "mx-999999");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("returns error for non-existent prefix", () => {
    const result = resolveRecordId(records, "zzz");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });
});

describe("writeExpertiseFile with lazy migration", () => {
  it("assigns IDs to records that lack them", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const records: ExpertiseRecord[] = [
      {
        type: "convention",
        content: "No ID yet",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      },
    ];

    await writeExpertiseFile(filePath, records);
    const read = await readExpertiseFile(filePath);
    expect(read[0].id).toMatch(/^mx-[0-9a-f]{32}$/);
  });

  it("preserves existing IDs during write", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const records: ExpertiseRecord[] = [
      {
        id: "mx-112233",
        type: "convention",
        content: "Has ID",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      },
    ];

    await writeExpertiseFile(filePath, records);
    const read = await readExpertiseFile(filePath);
    expect(read[0].id).toBe("mx-112233");
  });
});
