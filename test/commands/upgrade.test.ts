import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCurrentVersion } from "../../src/utils/version.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runUpgrade(args: string): {
  stdout: string;
  stderr: string;
  status: number;
} {
  try {
    const stdout = execSync(`bun src/cli.ts upgrade ${args}`, {
      encoding: "utf-8",
      timeout: 20000,
      cwd: root,
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? 1,
    };
  }
}

describe("upgrade command", () => {
  describe("--check flag", () => {
    it("outputs a message and exits 0 when up to date or update available", () => {
      const { stdout, status } = runUpgrade("--check");
      // Status 0 means either up-to-date or update available (not a fatal error)
      // Status 1 means registry unreachable — acceptable in offline environments
      if (status === 0) {
        // Either "up to date" or "Update available"
        expect(
          stdout.includes("up to date") || stdout.includes("Update available"),
        ).toBe(true);
      } else {
        // Network unreachable is acceptable
        expect(stdout + runUpgrade("--check").stderr).toBeTruthy();
      }
    });

    it("does not attempt installation with --check", () => {
      // --check should never trigger bun install; just verify it exits quickly
      const start = Date.now();
      runUpgrade("--check");
      const elapsed = Date.now() - start;
      // bun install -g takes >5s normally; --check should return faster
      expect(elapsed).toBeLessThan(15000);
    });
  });

  describe("--check --json flag", () => {
    it("outputs valid JSON on success", () => {
      const { stdout, status } = runUpgrade("--check --json");
      if (status === 0) {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        expect(parsed.success).toBe(true);
        expect(parsed.command).toBe("upgrade");
        expect(typeof parsed.current).toBe("string");
        expect(typeof parsed.latest).toBe("string");
        expect(typeof parsed.upToDate).toBe("boolean");
        expect(parsed.updated).toBe(false);
      }
    });

    it("outputs error JSON when registry is unreachable", () => {
      // This test only validates the error JSON shape if status is 1
      const { stdout, status } = runUpgrade("--check --json");
      if (status === 1) {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        expect(parsed.success).toBe(false);
        expect(parsed.command).toBe("upgrade");
        expect(typeof parsed.error).toBe("string");
      }
    });

    it("current version matches package.json", () => {
      const { stdout, status } = runUpgrade("--check --json");
      if (status === 0) {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const pkg = JSON.parse(
          readFileSync(join(root, "package.json"), "utf-8"),
        ) as { version: string };
        expect(parsed.current).toBe(pkg.version);
      }
    });
  });

  describe("getCurrentVersion integration", () => {
    it("current version in JSON output matches getCurrentVersion()", () => {
      const { stdout, status } = runUpgrade("--check --json");
      if (status === 0) {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        expect(parsed.current).toBe(getCurrentVersion());
      }
    });
  });
});
