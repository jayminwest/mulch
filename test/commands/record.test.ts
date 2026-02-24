import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
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

  it("record with cross-domain relates_to reference validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "pattern",
      name: "cross-domain-pattern",
      description: "Pattern referencing another domain",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["cli:mx-abc123"],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with cross-domain supersedes reference validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "New convention",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      supersedes: ["architecture:mx-def456"],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with mixed local and cross-domain references validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "failure",
      description: "Bug with dependencies",
      resolution: "Updated both modules",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["mx-1a2b3c4d", "testing:mx-abc456", "cli:mx-def789"],
      supersedes: ["mx-0a1b2c3d"],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with cross-domain reference is stored and read back correctly", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "pattern",
      name: "cross-ref-pattern",
      description: "Pattern with cross-domain link",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["cli:mx-abc123", "mx-1a2b3c4d"],
      supersedes: ["architecture:mx-def789"],
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].relates_to).toEqual(["cli:mx-abc123", "mx-1a2b3c4d"]);
    expect(records[0].supersedes).toEqual(["architecture:mx-def789"]);
  });

  it("cross-domain reference with invalid format fails validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["INVALID:mx-123"],
    };

    expect(validate(record)).toBe(false);
  });

  it("cross-domain reference with missing hash fails validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["cli:"],
    };

    expect(validate(record)).toBe(false);
  });

  it("cross-domain reference with numeric domain validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      relates_to: ["api-v2:mx-abc123"],
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
        bead: "seeds-abc123",
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
        bead: "seeds-xyz789",
      },
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].evidence?.bead).toBe("seeds-xyz789");
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
        bead: "seeds-999",
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
        bead: "seeds-solo",
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

  it("record with outcomes[0].status=success validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Use outcome metadata",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [{ status: "success" }],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with outcomes[0].status=failure validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "failure",
      description: "Build failed",
      resolution: "Fix the error",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [{ status: "failure" }],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with outcomes[0].status=partial validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Partial outcome",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [{ status: "partial" }],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with full outcomes array validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "pattern",
      name: "test-runner",
      description: "How to run tests",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
      outcomes: [
        {
          status: "success",
          duration: 1500,
          test_results: "42 passed, 0 failed",
          agent: "test-agent",
        },
      ],
    };

    expect(validate(record)).toBe(true);
  });

  it("record with multiple outcomes validates against schema", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [{ status: "failure" }, { status: "success" }],
    };

    expect(validate(record)).toBe(true);
  });

  it("outcomes item with invalid status fails validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [{ status: "unknown" }],
    };

    expect(validate(record)).toBe(false);
  });

  it("outcomes item without status fails validation", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "Test",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [{ duration: 100 }],
    };

    expect(validate(record)).toBe(false);
  });

  it("record without outcomes still validates (backward compat)", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);

    const record = {
      type: "convention",
      content: "No outcomes here",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };

    expect(validate(record)).toBe(true);
  });

  it("outcomes with all record types validates", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(recordSchema);
    const outcomes = [{ status: "success", duration: 100 }];
    const base = { classification: "tactical", recorded_at: new Date().toISOString(), outcomes };

    expect(validate({ type: "convention", content: "test", ...base })).toBe(true);
    expect(validate({ type: "pattern", name: "p", description: "d", ...base })).toBe(true);
    expect(validate({ type: "failure", description: "d", resolution: "r", ...base })).toBe(true);
    expect(validate({ type: "decision", title: "t", rationale: "r", ...base })).toBe(true);
    expect(validate({ type: "reference", name: "r", description: "d", ...base })).toBe(true);
    expect(validate({ type: "guide", name: "g", description: "d", ...base })).toBe(true);
  });

  it("record with outcomes is stored and read back correctly", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "pattern",
      name: "outcome-pattern",
      description: "Pattern with outcome metadata",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
      outcomes: [
        {
          status: "success",
          duration: 2500,
          test_results: "10 passed",
          agent: "my-agent",
        },
      ],
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].outcomes?.[0]?.status).toBe("success");
    expect(records[0].outcomes?.[0]?.duration).toBe(2500);
    expect(records[0].outcomes?.[0]?.test_results).toBe("10 passed");
    expect(records[0].outcomes?.[0]?.agent).toBe("my-agent");
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

    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(record), tmpDir);

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

    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(records), tmpDir);

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

    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(records), tmpDir);

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
    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(record), tmpDir);

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

    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(updatedPattern), tmpDir);

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
    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(record), tmpDir);
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

    const result = await processStdinRecords("testing", false, false, false, JSON.stringify(record), tmpDir);

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
      processStdinRecords("nonexistent", false, false, false, JSON.stringify(record), tmpDir),
    ).rejects.toThrow('Domain "nonexistent" not found');
  });

  it("throws error for invalid JSON", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    await expect(
      processStdinRecords("testing", false, false, false, "{ invalid json }", tmpDir),
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

    const result = await processStdinRecords("testing", false, true, false, JSON.stringify(record), tmpDir); // force=true

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(2);
  });

  it("dry-run shows what would be created without writing", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
    };

    const result = await processStdinRecords("testing", false, false, true, JSON.stringify(record), tmpDir); // dryRun=true

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify nothing was actually written
    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(0);
  });

  it("dry-run shows what would be updated without writing", async () => {
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

    const updatedPattern = {
      type: "pattern",
      name: "test-pattern",
      description: "Updated description",
      classification: "foundational",
    };

    const result = await processStdinRecords("testing", false, false, true, JSON.stringify(updatedPattern), tmpDir); // dryRun=true

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);

    // Verify original record was not modified
    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect((records[0] as { description: string }).description).toBe("Original description");
  });

  it("dry-run shows what would be skipped without writing", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: "2025-01-01T00:00:00.000Z",
    };

    await appendRecord(filePath, record as ExpertiseRecord);

    const result = await processStdinRecords("testing", false, false, true, JSON.stringify(record), tmpDir); // dryRun=true

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);

    // Verify original record was not duplicated
    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
  });

  it("dry-run processes multiple records without writing", async () => {
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
        description: "Test pattern",
        classification: "tactical",
      },
    ];

    const result = await processStdinRecords("testing", false, false, true, JSON.stringify(records), tmpDir); // dryRun=true

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);

    // Verify nothing was written
    const savedRecords = await readExpertiseFile(filePath);
    expect(savedRecords).toHaveLength(0);
  });
});

describe("record command help text", () => {
  it("--help displays required fields per record type", () => {
    const helpOutput = execSync("node dist/cli.js record --help", {
      encoding: "utf-8",
      timeout: 5000,
    });

    // Verify the help text section exists
    expect(helpOutput).toContain("Required fields per record type:");

    // Verify each record type is listed with its required fields
    expect(helpOutput).toContain("convention");
    expect(helpOutput).toContain("[content] or --description");

    expect(helpOutput).toContain("pattern");
    expect(helpOutput).toContain("--name, --description");

    expect(helpOutput).toContain("failure");
    expect(helpOutput).toContain("--resolution");

    expect(helpOutput).toContain("decision");
    expect(helpOutput).toContain("--title, --rationale");

    expect(helpOutput).toContain("reference");
    expect(helpOutput).toContain("guide");
  });

  it("--help displays batch recording examples", () => {
    const helpOutput = execSync("node dist/cli.js record --help", {
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(helpOutput).toContain("Batch recording examples:");
    expect(helpOutput).toContain("--batch records.json");
    expect(helpOutput).toContain("--batch records.json --dry-run");
  });
});

describe("batch mode (--batch)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-batch-test-"));
    await initMulchDir(tmpDir);
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("processes single JSON object from batch file", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest for testing",
      classification: "foundational",
    };

    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(record));

    const result = await processStdinRecords("testing", false, false, false, await readFile(batchFile, "utf-8"), tmpDir);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("convention");
    expect((records[0] as { content: string }).content).toBe("Use vitest for testing");
  });

  it("processes array of JSON objects from batch file", async () => {
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

    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(records));

    const result = await processStdinRecords("testing", false, false, false, await readFile(batchFile, "utf-8"), tmpDir);

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const savedRecords = await readExpertiseFile(filePath);
    expect(savedRecords).toHaveLength(2);
  });

  it("batch mode with --dry-run shows what would be created without writing", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
    };

    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(record));

    const result = await processStdinRecords("testing", false, false, true, await readFile(batchFile, "utf-8"), tmpDir);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify nothing was actually written
    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(0);
  });

  it("batch mode deduplicates records (skips exact matches)", async () => {
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

    // Try to add same record via batch file
    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(record));

    const result = await processStdinRecords("testing", false, false, false, await readFile(batchFile, "utf-8"), tmpDir);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1); // Still just one
  });

  it("batch mode upserts named records (pattern, decision, reference, guide)", async () => {
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

    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(updatedPattern));

    const result = await processStdinRecords("testing", false, false, false, await readFile(batchFile, "utf-8"), tmpDir);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect((records[0] as { description: string }).description).toBe("Updated description");
    expect(records[0].classification).toBe("foundational");
  });

  it("batch mode validates records and reports errors", async () => {
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

    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(records));

    const result = await processStdinRecords("testing", false, false, false, await readFile(batchFile, "utf-8"), tmpDir);

    expect(result.created).toBe(1); // Only valid record created
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Record 0");

    const savedRecords = await readExpertiseFile(filePath);
    expect(savedRecords).toHaveLength(1);
    expect(savedRecords[0].type).toBe("pattern");
  });

  it("batch mode forces duplicate creation with force flag", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record = {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: "2025-01-01T00:00:00.000Z",
    };

    await appendRecord(filePath, record as ExpertiseRecord);

    const batchFile = join(tmpDir, "batch.json");
    await writeFile(batchFile, JSON.stringify(record));

    const result = await processStdinRecords("testing", false, true, false, await readFile(batchFile, "utf-8"), tmpDir); // force=true

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(2);
  });
});
