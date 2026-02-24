import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

describe("update command", () => {
  it("--check --json reports version information", () => {
    const result = execSync("bun src/cli.ts update --check --json", {
      encoding: "utf-8",
      timeout: 15000,
    });
    const output = JSON.parse(result) as {
      success: boolean;
      command: string;
      current: string;
      upToDate: boolean;
      updated: boolean;
    };
    expect(output.success).toBe(true);
    expect(output.command).toBe("update");
    expect(output.current).toMatch(/^\d+\.\d+\.\d+$/);
    expect(output.updated).toBe(false);
  });

  it("--check shows human-readable output", () => {
    const result = execSync("bun src/cli.ts update --check", {
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(result).toMatch(/mulch-cli|Update available/);
  });
});
