import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initMulchDir,
  writeConfig,
  getExpertisePath,
} from "../../src/utils/config.js";
import {
  appendRecord,
  readExpertiseFile,
  createExpertiseFile,
} from "../../src/utils/expertise.js";
import { DEFAULT_CONFIG } from "../../src/schemas/config.js";
import type { ExpertiseRecord } from "../../src/schemas/record.js";
import _Ajv from "ajv";
const Ajv = (_Ajv as unknown as { default: typeof _Ajv }).default ?? _Ajv;
import { recordSchema } from "../../src/schemas/record-schema.js";

describe("record command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-record-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("recording a convention appends to JSONL", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "convention",
      content: "Always use vitest for testing",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("convention");
    expect((records[0] as { content: string }).content).toBe(
      "Always use vitest for testing",
    );
  });

  it("record includes recorded_at timestamp", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const before = new Date();
    const record: ExpertiseRecord = {
      type: "convention",
      content: "Timestamp test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };
    await appendRecord(filePath, record);
    const after = new Date();

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);

    const recordedAt = new Date(records[0].recorded_at);
    expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("records a pattern with all fields", async () => {
    const filePath = getExpertisePath("architecture", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "pattern",
      name: "Repository Pattern",
      description: "Use repository pattern for data access",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      files: ["src/repos/"],
    };

    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("pattern");
  });

  it("records a failure with description and resolution", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "failure",
      description: "Tests failed due to missing mocks",
      resolution: "Add mock setup in beforeEach",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("failure");
  });

  it("records a decision with title and rationale", async () => {
    const filePath = getExpertisePath("architecture", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "decision",
      title: "Use ESM over CJS",
      rationale: "Better tree-shaking and future compatibility",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("decision");
  });

  it("convention record missing content fails schema validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const invalidRecord = {
      type: "convention",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      // missing "content" field
    };

    const valid = validate(invalidRecord);
    expect(valid).toBe(false);
  });

  it("pattern record missing name fails schema validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const invalidRecord = {
      type: "pattern",
      description: "Some description",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      // missing "name" field
    };

    const valid = validate(invalidRecord);
    expect(valid).toBe(false);
  });

  it("failure record missing resolution fails schema validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const invalidRecord = {
      type: "failure",
      description: "Something failed",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      // missing "resolution" field
    };

    const valid = validate(invalidRecord);
    expect(valid).toBe(false);
  });
});
