import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

describe("update command (deprecated)", () => {
  it("shows deprecation warning and exits with code 1", () => {
    try {
      execSync("bun src/cli.ts update", {
        encoding: "utf-8",
        timeout: 15000,
      });
      throw new Error("Expected non-zero exit code");
    } catch (err) {
      const error = err as { status: number; stdout: string; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stdout).toContain("deprecated");
      expect(error.stdout).toContain("upgrade");
    }
  });

  it("shows deprecation warning even with --check", () => {
    try {
      execSync("bun src/cli.ts update --check", {
        encoding: "utf-8",
        timeout: 15000,
      });
      throw new Error("Expected non-zero exit code");
    } catch (err) {
      const error = err as { status: number; stdout: string; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stdout).toContain("deprecated");
    }
  });
});
