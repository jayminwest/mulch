import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerDeleteCommand } from "../../src/commands/delete.ts";
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

// ── Bulk delete command tests ─────────────────────────────────────────────────

async function runDelete(
  tmpDir: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const logSpy = spyOn(console, "log").mockImplementation((...a) => {
    stdoutLines.push(a.map(String).join(" "));
  });
  const errSpy = spyOn(console, "error").mockImplementation((...a) => {
    stderrLines.push(a.map(String).join(" "));
  });

  const prevExitCode = process.exitCode;
  process.exitCode = 0;

  // Override config lookup to use tmpDir
  const origCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const program = new Command();
    program.option("--json", "output JSON");
    program.exitOverride();
    registerDeleteCommand(program);
    await program.parseAsync(["node", "mulch", "delete", ...args]);
  } catch {
    // commander exitOverride throws on --help, ignore
  } finally {
    process.chdir(origCwd);
    logSpy.mockRestore();
    errSpy.mockRestore();
  }

  const exitCode = process.exitCode as number | undefined;
  process.exitCode = prevExitCode;

  return {
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.join("\n"),
    exitCode,
  };
}

async function runDeleteJson(
  tmpDir: string,
  args: string[],
): Promise<{
  result: Record<string, unknown> | null;
  exitCode: number | undefined;
}> {
  const stdoutLines: string[] = [];

  const logSpy = spyOn(console, "log").mockImplementation((...a) => {
    stdoutLines.push(a.map(String).join(" "));
  });
  const errSpy = spyOn(console, "error").mockImplementation(() => {});

  const prevExitCode = process.exitCode;
  process.exitCode = 0;

  const origCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const program = new Command();
    program.option("--json", "output JSON");
    program.exitOverride();
    registerDeleteCommand(program);
    await program.parseAsync(["node", "mulch", "--json", "delete", ...args]);
  } catch {
    // ignore
  } finally {
    process.chdir(origCwd);
    logSpy.mockRestore();
    errSpy.mockRestore();
  }

  const exitCode = process.exitCode as number | undefined;
  process.exitCode = prevExitCode;

  const raw = stdoutLines.join("\n").trim();
  let result: Record<string, unknown> | null = null;
  if (raw) {
    try {
      result = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // not valid JSON
    }
  }

  return { result, exitCode };
}

describe("delete command -- bulk flags", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-delete-bulk-test-"));
    await initMulchDir(tmpDir);
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("--records deletes multiple records by ID", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Alpha",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Beta",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Gamma",
      classification: "observational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(3);
    const id0 = records[0].id as string;
    const id2 = records[2].id as string;

    await runDelete(tmpDir, ["testing", "--records", `${id0},${id2}`]);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
    if (after[0].type === "convention") {
      expect(after[0].content).toBe("Beta");
    }
  });

  it("--records JSON output contains deleted records and kept count", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Alpha",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Beta",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const id0 = records[0].id as string;

    const { result } = await runDeleteJson(tmpDir, [
      "testing",
      "--records",
      id0,
    ]);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.dryRun).toBe(false);
    expect(Array.isArray(result?.deleted)).toBe(true);
    const deleted = result?.deleted as Array<Record<string, unknown>>;
    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe(id0);
    expect(result?.kept).toBe(1);
  });

  it("--all-except keeps specified records and deletes the rest", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Keep me",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Delete me",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Also delete me",
      classification: "observational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const keepId = records[0].id as string;

    await runDelete(tmpDir, ["testing", "--all-except", keepId]);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
    if (after[0].type === "convention") {
      expect(after[0].content).toBe("Keep me");
    }
  });

  it("--all-except JSON output contains deleted records and kept count", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Keep me",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Delete A",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Delete B",
      classification: "observational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const keepId = records[0].id as string;

    const { result } = await runDeleteJson(tmpDir, [
      "testing",
      "--all-except",
      keepId,
    ]);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.dryRun).toBe(false);
    const deleted = result?.deleted as Array<Record<string, unknown>>;
    expect(deleted).toHaveLength(2);
    expect(result?.kept).toBe(1);
  });

  it("--dry-run with --records does not modify the file", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Alpha",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Beta",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const id0 = records[0].id as string;

    await runDelete(tmpDir, ["testing", "--records", id0, "--dry-run"]);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(2);
  });

  it("--dry-run with --records JSON output has dryRun: true", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Alpha",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const id0 = records[0].id as string;

    const { result } = await runDeleteJson(tmpDir, [
      "testing",
      "--records",
      id0,
      "--dry-run",
    ]);

    expect(result?.success).toBe(true);
    expect(result?.dryRun).toBe(true);
    const deleted = result?.deleted as Array<Record<string, unknown>>;
    expect(deleted).toHaveLength(1);

    // File must be unchanged
    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
  });

  it("--dry-run with --all-except does not modify the file", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Keep me",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });
    await appendRecord(filePath, {
      type: "convention",
      content: "Would be deleted",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const keepId = records[0].id as string;

    await runDelete(tmpDir, ["testing", "--all-except", keepId, "--dry-run"]);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(2);
  });

  it("--dry-run with single ID does not modify the file", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Should stay",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const id0 = records[0].id as string;

    await runDelete(tmpDir, ["testing", id0, "--dry-run"]);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
  });

  it("--dry-run with single ID JSON output has dryRun: true", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Should stay",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const id0 = records[0].id as string;

    const { result } = await runDeleteJson(tmpDir, [
      "testing",
      id0,
      "--dry-run",
    ]);

    expect(result?.success).toBe(true);
    expect(result?.dryRun).toBe(true);
    const deleted = result?.deleted as Array<Record<string, unknown>>;
    expect(deleted).toHaveLength(1);
  });

  it("errors when no ID, --records, or --all-except provided", async () => {
    const prevExitCode = process.exitCode;
    process.exitCode = 0;

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const program = new Command();
      program.option("--json", "output JSON");
      program.exitOverride();
      registerDeleteCommand(program);
      await program.parseAsync(["node", "mulch", "delete", "testing"]);
    } catch {
      // ignore
    } finally {
      process.chdir(origCwd);
      errSpy.mockRestore();
      logSpy.mockRestore();
    }

    expect(process.exitCode).toBe(1);
    process.exitCode = prevExitCode;
  });

  it("errors when ID and --records are both provided", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Alpha",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const id0 = records[0].id as string;

    const prevExitCode = process.exitCode;
    process.exitCode = 0;

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const program = new Command();
      program.option("--json", "output JSON");
      program.exitOverride();
      registerDeleteCommand(program);
      await program.parseAsync([
        "node",
        "mulch",
        "delete",
        "testing",
        id0,
        "--records",
        id0,
      ]);
    } catch {
      // ignore
    } finally {
      process.chdir(origCwd);
      errSpy.mockRestore();
      logSpy.mockRestore();
    }

    expect(process.exitCode).toBe(1);
    process.exitCode = prevExitCode;
  });

  it("--records with unknown ID sets exit code 1 and does not modify file", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await appendRecord(filePath, {
      type: "convention",
      content: "Alpha",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const { exitCode } = await runDelete(tmpDir, [
      "testing",
      "--records",
      "mx-000000",
    ]);

    const after = await readExpertiseFile(filePath);
    expect(after).toHaveLength(1);
    expect(exitCode).toBe(1);
  });
});
