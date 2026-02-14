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
import { processStdinRecords } from "../../src/commands/record.js";

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

  it("records a reference with name, description, and files", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "reference",
      name: "cli-entry",
      description: "Main CLI entry point",
      files: ["src/cli.ts"],
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("reference");
    if (records[0].type === "reference") {
      expect(records[0].name).toBe("cli-entry");
      expect(records[0].description).toBe("Main CLI entry point");
      expect(records[0].files).toEqual(["src/cli.ts"]);
    }
  });

  it("records a guide with name and description", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "guide",
      name: "add-command",
      description: "How to add a new CLI command",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("guide");
    if (records[0].type === "guide") {
      expect(records[0].name).toBe("add-command");
      expect(records[0].description).toBe("How to add a new CLI command");
    }
  });

  it("reference record missing name fails schema validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const invalidRecord = {
      type: "reference",
      description: "Some description",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    const valid = validate(invalidRecord);
    expect(valid).toBe(false);
  });

  it("guide record missing name fails schema validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const invalidRecord = {
      type: "guide",
      description: "Some description",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    const valid = validate(invalidRecord);
    expect(valid).toBe(false);
  });

  it("reference record validates successfully with all fields", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "reference",
      name: "config-file",
      description: "YAML config at .mulch/mulch.config.yaml",
      files: ["src/utils/config.ts"],
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };

    expect(validate(record)).toBe(true);
  });

  it("guide record validates successfully with all fields", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "guide",
      name: "add-domain",
      description: "Run mulch add <name> to create a new domain",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    expect(validate(record)).toBe(true);
  });

  it("record with tags validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "pattern",
      name: "tagged-pattern",
      description: "A pattern with tags",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      tags: ["esm", "typescript"],
    };

    expect(validate(record)).toBe(true);
  });

  it("record without tags still validates (backward compat)", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "No tags here",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    expect(validate(record)).toBe(true);
  });

  it("record with tags is stored and read back correctly", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "pattern",
      name: "tagged-pattern",
      description: "A pattern with tags",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      tags: ["async", "performance"],
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].tags).toEqual(["async", "performance"]);
  });

  it("tags with all record types validate", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);
    const tags = ["tag1", "tag2"];
    const base = { classification: "tactical", recorded_at: new Date().toISOString(), tags };

    expect(validate({ type: "convention", content: "test", ...base })).toBe(true);
    expect(validate({ type: "pattern", name: "p", description: "d", ...base })).toBe(true);
    expect(validate({ type: "failure", description: "d", resolution: "r", ...base })).toBe(true);
    expect(validate({ type: "decision", title: "t", rationale: "r", ...base })).toBe(true);
    expect(validate({ type: "reference", name: "r", description: "d", ...base })).toBe(true);
    expect(validate({ type: "guide", name: "g", description: "d", ...base })).toBe(true);
  });

  it("record with relates_to validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "failure",
      description: "Import error with ESM",
      resolution: "Use .js extension",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["mx-abc123"],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with supersedes validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Use Ajv default import pattern",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      supersedes: ["mx-def456"],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with both relates_to and supersedes validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "pattern",
      name: "esm-import",
      description: "ESM import pattern for Ajv",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      relates_to: ["mx-aaa111"],
      supersedes: ["mx-bbb222"],
    };

    expect(validate(record)).toBe(true);
  });

  it("relates_to with invalid ID format fails validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["not-a-valid-id"],
    };

    expect(validate(record)).toBe(false);
  });

  it("links with all record types validate", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);
    const links = { relates_to: ["mx-abc123"], supersedes: ["mx-def456"] };
    const base = { classification: "tactical", recorded_at: new Date().toISOString(), ...links };

    expect(validate({ type: "convention", content: "test", ...base })).toBe(true);
    expect(validate({ type: "pattern", name: "p", description: "d", ...base })).toBe(true);
    expect(validate({ type: "failure", description: "d", resolution: "r", ...base })).toBe(true);
    expect(validate({ type: "decision", title: "t", rationale: "r", ...base })).toBe(true);
    expect(validate({ type: "reference", name: "r", description: "d", ...base })).toBe(true);
    expect(validate({ type: "guide", name: "g", description: "d", ...base })).toBe(true);
  });

  it("record with links is stored and read back correctly", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "failure",
      description: "ESM import broke",
      resolution: "Use default import workaround",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["mx-abc123"],
      supersedes: ["mx-def456"],
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].relates_to).toEqual(["mx-abc123"]);
    expect(records[0].supersedes).toEqual(["mx-def456"]);
  });

  it("record without links still validates (backward compat)", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "No links here",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    expect(validate(record)).toBe(true);
  });

  it("record with evidence.bead validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "pattern",
      name: "test-pattern",
      description: "Pattern with bead evidence",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      evidence: {
        bead: "beads-abc123",
      },
    };

    expect(validate(record)).toBe(true);
  });

  it("record with evidence.bead is stored and read back correctly", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "failure",
      description: "Bug found in feature X",
      resolution: "Fixed by updating logic",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      evidence: {
        bead: "beads-xyz789",
      },
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].evidence?.bead).toBe("beads-xyz789");
  });

  it("record with evidence.bead and other evidence fields validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Multi-evidence test",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      evidence: {
        commit: "abc123def",
        issue: "#42",
        file: "src/test.ts",
        bead: "beads-999",
      },
    };

    expect(validate(record)).toBe(true);
  });

  it("record with only evidence.bead (no other evidence fields) validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "decision",
      title: "Use new approach",
      rationale: "Better performance",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      evidence: {
        bead: "beads-solo",
      },
    };

    expect(validate(record)).toBe(true);
  });

  it("record without evidence.bead still validates (backward compat)", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "pattern",
      name: "old-pattern",
      description: "Pattern without bead",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      evidence: {
        commit: "abc123",
        file: "src/old.ts",
      },
    };

    expect(validate(record)).toBe(true);
  });
});

describe("processStdinRecords", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-stdin-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("processes single JSON object from stdin", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
    };

    const result = await processStdinRecords("testing", false, false, JSON.stringify(record), tmpDir);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("convention");
    expect((records[0] as { content: string }).content).toBe("Use vitest");
  });

  it("processes array of JSON objects from stdin", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const records = [
      {
        type: "convention",
        content: "Use vitest",
        classification: "foundational",
      },
      {
        type: "pattern",
        name: "test-pattern",
        description: "Test pattern description",
        classification: "tactical",
      },
    ];

    const result = await processStdinRecords("testing", false, false, JSON.stringify(records), tmpDir);

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const savedRecords = await readExpertiseFile(filePath);
    expect(savedRecords).toHaveLength(2);
  });

  it("validates records and reports errors", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const records = [
      {
        type: "convention",
        // missing content field
        classification: "tactical",
      },
      {
        type: "pattern",
        name: "valid-pattern",
        description: "Valid pattern",
        classification: "tactical",
      },
    ];

    const result = await processStdinRecords("testing", false, false, JSON.stringify(records), tmpDir);

    expect(result.created).toBe(1); // Only valid record created
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Record 0");

    const savedRecords = await readExpertiseFile(filePath);
    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0].type).toBe("pattern");
  });

  it("deduplicates records (skips exact matches)", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: "2025-01-01T00:00:00.000Z",
    };

    // Add initial record
    await appendRecord(filePath, record as ExpertiseRecord);

    // Try to add same record via stdin
    const result = await processStdinRecords("testing", false, false, JSON.stringify(record), tmpDir);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1); // Still just one
  });

  it("upserts named records (pattern, decision, reference, guide)", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const originalPattern = {
      type: "pattern",
      name: "test-pattern",
      description: "Original description",
      classification: "tactical",
      recorded_at: "2025-01-01T00:00:00.000Z",
    };

    await appendRecord(filePath, originalPattern as ExpertiseRecord);

    // Update with same name
    const updatedPattern = {
      type: "pattern",
      name: "test-pattern",
      description: "Updated description",
      classification: "foundational",
      recorded_at: "2025-01-02T00:00:00.000Z",
    };

    const result = await processStdinRecords("testing", false, false, JSON.stringify(updatedPattern), tmpDir);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect((records[0] as { description: string }).description).toBe("Updated description");
    expect(records[0].classification).toBe("foundational");
  });

  it("adds recorded_at if missing", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      // no recorded_at
    };

    const before = new Date();
    const result = await processStdinRecords("testing", false, false, JSON.stringify(record), tmpDir);
    const after = new Date();

    expect(result.created).toBe(1);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    const recordedAt = new Date(records[0].recorded_at);
    expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("defaults classification to tactical if missing", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      // no classification
    };

    const result = await processStdinRecords("testing", false, false, JSON.stringify(record), tmpDir);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].classification).toBe("tactical");
  });

  it("throws error for invalid domain", async () => {
    const record = {
      type: "convention",
      content: "Test",
      classification: "tactical",
    };

    await expect(
      processStdinRecords("nonexistent", false, false, JSON.stringify(record), tmpDir),
    ).rejects.toThrow('Domain "nonexistent" not found');
  });

  it("throws error for invalid JSON", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    await expect(
      processStdinRecords("testing", false, false, "{ invalid json }", tmpDir),
    ).rejects.toThrow("Failed to parse JSON from stdin");
  });

  it("forces duplicate creation with force flag", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: "2025-01-01T00:00:00.000Z",
    };

    await appendRecord(filePath, record as ExpertiseRecord);

    const result = await processStdinRecords("testing", false, true, JSON.stringify(record), tmpDir); // force=true

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(2);
  });
});
