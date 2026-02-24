import { describe, expect, it } from "bun:test";
import {
  compareSemver,
  getCurrentVersion,
  getLatestVersion,
} from "../../src/utils/version.ts";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns -1 when first is older (patch)", () => {
    expect(compareSemver("1.2.3", "1.2.4")).toBe(-1);
  });

  it("returns 1 when first is newer (patch)", () => {
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
  });

  it("compares major version first", () => {
    expect(compareSemver("1.9.9", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
  });

  it("compares minor version second", () => {
    expect(compareSemver("1.2.9", "1.3.0")).toBe(-1);
    expect(compareSemver("1.3.0", "1.2.9")).toBe(1);
  });

  it("handles two-segment versions", () => {
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
    expect(compareSemver("1.2", "1.2.1")).toBe(-1);
  });

  it("handles single-segment versions", () => {
    expect(compareSemver("2", "1.9.9")).toBe(1);
    expect(compareSemver("1", "2.0.0")).toBe(-1);
  });

  it("handles 0.x versions", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("0.2.2", "0.2.2")).toBe(0);
    expect(compareSemver("0.2.3", "0.2.2")).toBe(1);
  });
});

describe("getCurrentVersion", () => {
  it("returns a valid semver string", () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("matches package.json version", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf-8"),
    ) as { version: string };
    expect(getCurrentVersion()).toBe(pkg.version);
  });
});

describe("getLatestVersion", () => {
  it("returns a string or null", () => {
    const result = getLatestVersion();
    if (result !== null) {
      expect(result).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
