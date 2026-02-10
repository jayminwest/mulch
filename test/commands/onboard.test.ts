import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOnboard } from "../../src/commands/onboard.js";

describe("onboard command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-onboard-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates AGENTS.md by default when no agent file exists", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runOnboard({ cwd: tmpDir });

      expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("## Project Expertise (Mulch)");
      expect(content).toContain("mulch prime");
      expect(content).toContain("mulch record");
      expect(content).toContain("mulch status");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("writes to CLAUDE.md if it already exists", async () => {
    await writeFile(join(tmpDir, "CLAUDE.md"), "# Existing content\n", "utf-8");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runOnboard({ cwd: tmpDir });

      expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
      // Should not create AGENTS.md
      expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(false);

      const content = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
      expect(content).toContain("# Existing content");
      expect(content).toContain("## Project Expertise (Mulch)");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("appends to existing file without overwriting", async () => {
    const existingContent = "# My Project\n\nSome important info.\n";
    await writeFile(join(tmpDir, "AGENTS.md"), existingContent, "utf-8");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runOnboard({ cwd: tmpDir });

      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("# My Project");
      expect(content).toContain("Some important info.");
      expect(content).toContain("## Project Expertise (Mulch)");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("does not duplicate snippet if already present", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Run onboard twice
      await runOnboard({ cwd: tmpDir });
      await runOnboard({ cwd: tmpDir });

      const content = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
      const matches = content.match(/## Project Expertise \(Mulch\)/g);
      expect(matches).toHaveLength(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("prints to stdout with --stdout flag", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runOnboard({ stdout: true, cwd: tmpDir });

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("## Project Expertise (Mulch)"),
      );
      // Should not create any files
      expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(false);
      expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(false);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("generates claude-specific snippet with --provider claude", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runOnboard({ stdout: true, provider: "claude", cwd: tmpDir });

      const output = (stdoutSpy.mock.calls[0] as string[])[0];
      expect(output).toContain("At the start of every session");
      expect(output).toContain("mulch prime");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("uses default snippet for unknown provider", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runOnboard({ stdout: true, provider: "unknown-provider", cwd: tmpDir });

      const output = (stdoutSpy.mock.calls[0] as string[])[0];
      expect(output).toContain("Before starting work");
      expect(output).toContain("mulch prime");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it("snippet contains all essential commands", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runOnboard({ stdout: true, cwd: tmpDir });

      const output = (stdoutSpy.mock.calls[0] as string[])[0];
      expect(output).toContain("mulch prime");
      expect(output).toContain("mulch record");
      expect(output).toContain("mulch status");
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
