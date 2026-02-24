import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read the current CLI version from package.json.
 */
export function getCurrentVersion(): string {
  const pkgPath = join(import.meta.dir, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}

/**
 * Fetch the latest published version of mulch-cli from npm.
 * Returns null if the registry is unreachable.
 */
export function getLatestVersion(): string | null {
  try {
    const result = execSync("npm view mulch-cli version", {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings (major.minor.patch).
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const segA = partsA[i] ?? 0;
    const segB = partsB[i] ?? 0;
    if (segA < segB) return -1;
    if (segA > segB) return 1;
  }
  return 0;
}
