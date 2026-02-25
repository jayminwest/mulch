import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOutcome } from "../../src/api.ts";
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
} from "../../src/utils/expertise.ts";

describe("outcome command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-outcome-test-"));
    await initMulchDir(tmpDir);
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("appendOutcome API", () => {
    it("appends a success outcome to a record", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await appendRecord(filePath, {
        type: "convention",
        content: "Always use WAL mode",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const record = records[0];
      const id = record.id!;

      const result = await appendOutcome(
        "testing",
        id,
        { status: "success", agent: "test-agent" },
        { cwd: tmpDir },
      );

      expect(result.outcome.status).toBe("success");
      expect(result.outcome.agent).toBe("test-agent");
      expect(result.total_outcomes).toBe(1);
      expect(result.record.outcomes).toHaveLength(1);
    });

    it("appends a failure outcome with notes", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await appendRecord(filePath, {
        type: "pattern",
        name: "retry-pattern",
        description: "Retry on transient failures",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const id = records[0].id!;

      const result = await appendOutcome(
        "testing",
        id,
        { status: "failure", notes: "Caused infinite loop in some cases" },
        { cwd: tmpDir },
      );

      expect(result.outcome.status).toBe("failure");
      expect(result.outcome.notes).toBe("Caused infinite loop in some cases");
      expect(result.total_outcomes).toBe(1);
    });

    it("accumulates multiple outcomes on the same record", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await appendRecord(filePath, {
        type: "convention",
        content: "Use strict TypeScript",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const id = records[0].id!;

      await appendOutcome(
        "testing",
        id,
        { status: "success" },
        { cwd: tmpDir },
      );
      await appendOutcome(
        "testing",
        id,
        { status: "success", agent: "agent-2" },
        { cwd: tmpDir },
      );
      const result = await appendOutcome(
        "testing",
        id,
        { status: "partial", notes: "Mostly worked" },
        { cwd: tmpDir },
      );

      expect(result.total_outcomes).toBe(3);

      const updated = await readExpertiseFile(filePath);
      const updatedRecord = updated[0];
      expect(updatedRecord.outcomes).toHaveLength(3);
      expect(updatedRecord.outcomes?.[0].status).toBe("success");
      expect(updatedRecord.outcomes?.[1].status).toBe("success");
      expect(updatedRecord.outcomes?.[2].status).toBe("partial");
    });

    it("persists outcomes to disk", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await appendRecord(filePath, {
        type: "decision",
        title: "Use Bun runtime",
        rationale: "Faster test execution",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const id = records[0].id!;

      await appendOutcome(
        "testing",
        id,
        { status: "success", duration: 1234, test_results: "all passed" },
        { cwd: tmpDir },
      );

      const updated = await readExpertiseFile(filePath);
      const updatedRecord = updated[0];
      expect(updatedRecord.outcomes).toHaveLength(1);
      expect(updatedRecord.outcomes?.[0].duration).toBe(1234);
      expect(updatedRecord.outcomes?.[0].test_results).toBe("all passed");
    });

    it("throws when domain does not exist", async () => {
      expect(
        appendOutcome(
          "nonexistent",
          "mx-abc123",
          { status: "success" },
          { cwd: tmpDir },
        ),
      ).rejects.toThrow("nonexistent");
    });

    it("throws when record ID is not found", async () => {
      expect(
        appendOutcome(
          "testing",
          "mx-ffffff",
          { status: "success" },
          { cwd: tmpDir },
        ),
      ).rejects.toThrow("not found");
    });

    it("does not modify other records when appending an outcome", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await appendRecord(filePath, {
        type: "convention",
        content: "Record one",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Record two",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const id = records[0].id!;

      await appendOutcome(
        "testing",
        id,
        { status: "success" },
        { cwd: tmpDir },
      );

      const updated = await readExpertiseFile(filePath);
      expect(updated).toHaveLength(2);
      expect(updated[0].outcomes).toHaveLength(1);
      expect(updated[1].outcomes).toBeUndefined();
    });

    it("sets recorded_at on the outcome", async () => {
      const filePath = getExpertisePath("testing", tmpDir);
      await appendRecord(filePath, {
        type: "convention",
        content: "Test recorded_at",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const id = records[0].id!;

      const result = await appendOutcome(
        "testing",
        id,
        { status: "success" },
        { cwd: tmpDir },
      );

      expect(result.outcome.recorded_at).toBeDefined();
      expect(typeof result.outcome.recorded_at).toBe("string");
    });
  });
});
