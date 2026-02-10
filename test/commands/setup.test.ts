import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initMulchDir } from "../../src/utils/config.js";
import {
  recipes,
  CURSOR_RULE_CONTENT,
  CLAUDE_HOOK_COMMAND,
} from "../../src/commands/setup.js";

describe("setup command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-setup-test-"));
    await initMulchDir(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Claude recipe ───────────────────────────────────────────

  describe("claude recipe", () => {
    it("installs hooks into new settings.json", async () => {
      const result = await recipes.claude.install(tmpDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Installed");

      const settingsPath = join(tmpDir, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toEqual(
        expect.arrayContaining([{ command: CLAUDE_HOOK_COMMAND }]),
      );
      expect(settings.hooks.PreCompact).toEqual(
        expect.arrayContaining([{ command: CLAUDE_HOOK_COMMAND }]),
      );
    });

    it("preserves existing settings when installing hooks", async () => {
      const settingsPath = join(tmpDir, ".claude", "settings.json");
      await mkdir(join(tmpDir, ".claude"), { recursive: true });
      await writeFile(
        settingsPath,
        JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2),
        "utf-8",
      );

      await recipes.claude.install(tmpDir);

      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      expect(settings.permissions.allow).toContain("Read");
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it("is idempotent — second install reports already installed", async () => {
      await recipes.claude.install(tmpDir);
      const result = await recipes.claude.install(tmpDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain("already installed");

      // Verify no duplicate hooks
      const settingsPath = join(tmpDir, ".claude", "settings.json");
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it("check reports success after install", async () => {
      await recipes.claude.install(tmpDir);
      const result = await recipes.claude.check(tmpDir);
      expect(result.success).toBe(true);
    });

    it("check reports failure when no settings exist", async () => {
      const result = await recipes.claude.check(tmpDir);
      expect(result.success).toBe(false);
    });

    it("check reports missing hooks", async () => {
      const settingsPath = join(tmpDir, ".claude", "settings.json");
      await mkdir(join(tmpDir, ".claude"), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ hooks: {} }), "utf-8");

      const result = await recipes.claude.check(tmpDir);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing hooks");
    });

    it("remove cleans up hooks", async () => {
      await recipes.claude.install(tmpDir);
      const result = await recipes.claude.remove(tmpDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Removed");

      const settings = JSON.parse(
        await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"),
      );
      expect(settings.hooks).toBeUndefined();
    });

    it("remove is safe when no settings exist", async () => {
      const result = await recipes.claude.remove(tmpDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain("nothing to remove");
    });
  });

  // ── Cursor recipe ──────────────────────────────────────────

  describe("cursor recipe", () => {
    it("creates rule file on install", async () => {
      const result = await recipes.cursor.install(tmpDir);
      expect(result.success).toBe(true);

      const rulePath = join(tmpDir, ".cursor", "rules", "mulch.mdc");
      expect(existsSync(rulePath)).toBe(true);

      const content = await readFile(rulePath, "utf-8");
      expect(content).toBe(CURSOR_RULE_CONTENT);
    });

    it("is idempotent", async () => {
      await recipes.cursor.install(tmpDir);
      const result = await recipes.cursor.install(tmpDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain("already installed");
    });

    it("check succeeds after install", async () => {
      await recipes.cursor.install(tmpDir);
      const result = await recipes.cursor.check(tmpDir);
      expect(result.success).toBe(true);
    });

    it("check fails when file is missing", async () => {
      const result = await recipes.cursor.check(tmpDir);
      expect(result.success).toBe(false);
    });

    it("check detects modified file", async () => {
      await recipes.cursor.install(tmpDir);
      const rulePath = join(tmpDir, ".cursor", "rules", "mulch.mdc");
      await writeFile(rulePath, "modified content", "utf-8");

      const result = await recipes.cursor.check(tmpDir);
      expect(result.success).toBe(false);
      expect(result.message).toContain("modified");
    });

    it("remove deletes the rule file", async () => {
      await recipes.cursor.install(tmpDir);
      const result = await recipes.cursor.remove(tmpDir);
      expect(result.success).toBe(true);

      const rulePath = join(tmpDir, ".cursor", "rules", "mulch.mdc");
      expect(existsSync(rulePath)).toBe(false);
    });

    it("remove is safe when file does not exist", async () => {
      const result = await recipes.cursor.remove(tmpDir);
      expect(result.success).toBe(true);
    });
  });

  // ── Codex recipe ───────────────────────────────────────────

  describe("codex recipe", () => {
    it("creates AGENTS.md with mulch section", async () => {
      const result = await recipes.codex.install(tmpDir);
      expect(result.success).toBe(true);

      const agentsPath = join(tmpDir, "AGENTS.md");
      const content = await readFile(agentsPath, "utf-8");
      expect(content).toContain("<!-- mulch:start -->");
      expect(content).toContain("mulch prime");
    });

    it("appends to existing AGENTS.md", async () => {
      const agentsPath = join(tmpDir, "AGENTS.md");
      await writeFile(agentsPath, "# Existing Content\n\nSome stuff.\n", "utf-8");

      await recipes.codex.install(tmpDir);

      const content = await readFile(agentsPath, "utf-8");
      expect(content).toContain("# Existing Content");
      expect(content).toContain("<!-- mulch:start -->");
    });

    it("is idempotent", async () => {
      await recipes.codex.install(tmpDir);
      const result = await recipes.codex.install(tmpDir);
      expect(result.success).toBe(true);
      expect(result.message).toContain("already contains");
    });

    it("check passes after install", async () => {
      await recipes.codex.install(tmpDir);
      const result = await recipes.codex.check(tmpDir);
      expect(result.success).toBe(true);
    });

    it("check fails when file is missing", async () => {
      const result = await recipes.codex.check(tmpDir);
      expect(result.success).toBe(false);
    });

    it("remove strips mulch section", async () => {
      const agentsPath = join(tmpDir, "AGENTS.md");
      await writeFile(agentsPath, "# Header\n\nParagraph.\n", "utf-8");
      await recipes.codex.install(tmpDir);
      await recipes.codex.remove(tmpDir);

      const content = await readFile(agentsPath, "utf-8");
      expect(content).toContain("# Header");
      expect(content).not.toContain("<!-- mulch:start -->");
    });

    it("remove is safe when file does not exist", async () => {
      const result = await recipes.codex.remove(tmpDir);
      expect(result.success).toBe(true);
    });
  });

  // ── Gemini recipe ──────────────────────────────────────────

  describe("gemini recipe", () => {
    it("creates settings file with mulch section", async () => {
      const result = await recipes.gemini.install(tmpDir);
      expect(result.success).toBe(true);

      const filePath = join(tmpDir, ".gemini", "settings.md");
      expect(existsSync(filePath)).toBe(true);

      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("<!-- mulch:start -->");
      expect(content).toContain("mulch prime");
    });

    it("check passes after install", async () => {
      await recipes.gemini.install(tmpDir);
      const result = await recipes.gemini.check(tmpDir);
      expect(result.success).toBe(true);
    });

    it("remove cleans up section", async () => {
      await recipes.gemini.install(tmpDir);
      await recipes.gemini.remove(tmpDir);

      const filePath = join(tmpDir, ".gemini", "settings.md");
      const content = await readFile(filePath, "utf-8");
      expect(content).not.toContain("<!-- mulch:start -->");
    });
  });

  // ── Windsurf recipe ────────────────────────────────────────

  describe("windsurf recipe", () => {
    it("creates rules file with mulch section", async () => {
      const result = await recipes.windsurf.install(tmpDir);
      expect(result.success).toBe(true);

      const filePath = join(tmpDir, ".windsurf", "rules.md");
      expect(existsSync(filePath)).toBe(true);

      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("mulch prime");
    });

    it("check passes after install", async () => {
      await recipes.windsurf.install(tmpDir);
      const result = await recipes.windsurf.check(tmpDir);
      expect(result.success).toBe(true);
    });

    it("remove cleans up section", async () => {
      await recipes.windsurf.install(tmpDir);
      await recipes.windsurf.remove(tmpDir);

      const filePath = join(tmpDir, ".windsurf", "rules.md");
      const content = await readFile(filePath, "utf-8");
      expect(content).not.toContain("<!-- mulch:start -->");
    });
  });

  // ── Aider recipe ───────────────────────────────────────────

  describe("aider recipe", () => {
    it("creates config file with mulch section", async () => {
      const result = await recipes.aider.install(tmpDir);
      expect(result.success).toBe(true);

      const filePath = join(tmpDir, ".aider.conf.md");
      expect(existsSync(filePath)).toBe(true);

      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("mulch prime");
    });

    it("check passes after install", async () => {
      await recipes.aider.install(tmpDir);
      const result = await recipes.aider.check(tmpDir);
      expect(result.success).toBe(true);
    });

    it("remove cleans up section", async () => {
      await recipes.aider.install(tmpDir);
      await recipes.aider.remove(tmpDir);

      const filePath = join(tmpDir, ".aider.conf.md");
      const content = await readFile(filePath, "utf-8");
      expect(content).not.toContain("<!-- mulch:start -->");
    });
  });
});
