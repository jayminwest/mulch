import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerSyncCommand } from "../../src/commands/sync.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import {
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  createExpertiseFile,
} from "../../src/utils/expertise.ts";

function makeProgram(): Command {
  const program = new Command();
  program
    .name("mulch")
    .option("--json", "output as structured JSON")
    .exitOverride();
  registerSyncCommand(program);
  return program;
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", {
    cwd: dir,
    stdio: "pipe",
  });
  execSync("git config user.name 'Test User'", { cwd: dir, stdio: "pipe" });
}

function gitCommitAll(dir: string, message: string): void {
  execSync("git add .", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "pipe" });
}

function getGitLog(dir: string): string {
  return execSync("git log --oneline", {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function isGitClean(dir: string): boolean {
  const status = execSync("git status --porcelain .mulch/", {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return status.trim().length === 0;
}

describe("sync command", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-sync-test-"));
    await initMulchDir(tmpDir);
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const expertisePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(expertisePath);
    initGitRepo(tmpDir);
    gitCommitAll(tmpDir, "initial");
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports no changes when .mulch/ is clean", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = makeProgram();
      await program.parseAsync(["node", "mulch", "sync"]);
      expect(process.exitCode).toBeFalsy();
      const allLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allLogs).toContain("No .mulch/ changes to commit");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("validates, stages, and commits .mulch/ changes", async () => {
    await appendRecord(getExpertisePath("testing", tmpDir), {
      type: "convention",
      content: "Use real filesystems in tests",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = makeProgram();
      await program.parseAsync(["node", "mulch", "sync"]);
      expect(process.exitCode).toBeFalsy();
      expect(isGitClean(tmpDir)).toBe(true);
      const log = getGitLog(tmpDir);
      expect(log).toContain("mulch: update expertise");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses custom commit message via --message", async () => {
    await appendRecord(getExpertisePath("testing", tmpDir), {
      type: "convention",
      content: "Custom message test",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = makeProgram();
      await program.parseAsync([
        "node",
        "mulch",
        "sync",
        "--message",
        "chore: record session insights",
      ]);
      expect(process.exitCode).toBeFalsy();
      const log = getGitLog(tmpDir);
      expect(log).toContain("chore: record session insights");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("is idempotent: second sync reports no changes", async () => {
    await appendRecord(getExpertisePath("testing", tmpDir), {
      type: "convention",
      content: "Idempotent test",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program1 = makeProgram();
      await program1.parseAsync(["node", "mulch", "sync"]);
      expect(process.exitCode).toBeFalsy();

      const program2 = makeProgram();
      await program2.parseAsync(["node", "mulch", "sync"]);
      expect(process.exitCode).toBeFalsy();
      const allLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allLogs).toContain("No .mulch/ changes to commit");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("--no-validate skips validation and commits invalid JSONL", async () => {
    const expertisePath = getExpertisePath("testing", tmpDir);
    await writeFile(expertisePath, "not valid json\n", "utf-8");

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = makeProgram();
      await program.parseAsync(["node", "mulch", "sync", "--no-validate"]);
      expect(process.exitCode).toBeFalsy();
      expect(isGitClean(tmpDir)).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("fails when validation detects invalid JSON in JSONL", async () => {
    const expertisePath = getExpertisePath("testing", tmpDir);
    await writeFile(expertisePath, "not valid json\n", "utf-8");

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = makeProgram();
      await program.parseAsync(["node", "mulch", "sync"]);
      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allErrors).toContain("Validation failed");
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("fails when validation detects schema-invalid records", async () => {
    const expertisePath = getExpertisePath("testing", tmpDir);
    await writeFile(
      expertisePath,
      `${JSON.stringify({ type: "convention" })}\n`,
      "utf-8",
    );

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = makeProgram();
      await program.parseAsync(["node", "mulch", "sync"]);
      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allErrors).toContain("Validation failed");
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  describe("not in a git repo", () => {
    let nonGitDir: string;

    beforeEach(async () => {
      nonGitDir = await mkdtemp(join(tmpdir(), "mulch-sync-nogit-"));
      await initMulchDir(nonGitDir);
      process.chdir(nonGitDir);
    });

    afterEach(async () => {
      await rm(nonGitDir, { recursive: true, force: true });
    });

    it("errors when not in a git repo", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "sync"]);
        expect(process.exitCode).toBe(1);
        const allErrors = errorSpy.mock.calls
          .map((c) => c.join(" "))
          .join("\n");
        expect(allErrors).toContain("not in a git repository");
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("JSON mode", () => {
    it("returns success:true, committed:false when no changes", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "sync"]);
        expect(process.exitCode).toBeFalsy();
        const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.committed).toBe(false);
        expect(parsed.message).toBe("No changes to commit");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("returns success:true, committed:true after committing changes", async () => {
      await appendRecord(getExpertisePath("testing", tmpDir), {
        type: "convention",
        content: "JSON mode test",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "sync"]);
        expect(process.exitCode).toBeFalsy();
        const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.committed).toBe(true);
        expect(parsed.validated).toBe(true);
        expect(parsed.message).toBe("mulch: update expertise");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("returns error JSON when not in a git repo", async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), "mulch-sync-json-nogit-"));
      try {
        await initMulchDir(nonGitDir);
        process.chdir(nonGitDir);
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
          const program = makeProgram();
          await program.parseAsync(["node", "mulch", "--json", "sync"]);
          expect(process.exitCode).toBe(1);
          const output = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
          const parsed = JSON.parse(output);
          expect(parsed.success).toBe(false);
          expect(parsed.error).toBeDefined();
        } finally {
          errorSpy.mockRestore();
          process.chdir(tmpDir);
        }
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });

    it("returns error JSON when validation fails", async () => {
      const expertisePath = getExpertisePath("testing", tmpDir);
      await writeFile(expertisePath, "not valid json\n", "utf-8");

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "sync"]);
        expect(process.exitCode).toBe(1);
        const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(false);
        expect(parsed.validated).toBe(false);
        expect(parsed.errors).toBeDefined();
        expect(parsed.errors.length).toBeGreaterThan(0);
      } finally {
        logSpy.mockRestore();
      }
    });

    it("reflects validated:false when --no-validate is used", async () => {
      await appendRecord(getExpertisePath("testing", tmpDir), {
        type: "convention",
        content: "No-validate JSON test",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "sync",
          "--no-validate",
        ]);
        expect(process.exitCode).toBeFalsy();
        const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.validated).toBe(false);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});
