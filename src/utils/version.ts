import { execFileSync } from "node:child_process";
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
		const result = execFileSync(
			"npm",
			["view", "@os-eco/mulch-cli", "version"],
			{
				encoding: "utf-8",
				timeout: 10000,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		return result.trim();
	} catch {
		return null;
	}
}

/**
 * Split a semver string into its main (major.minor.patch) segment and its
 * optional prerelease tail. Build metadata (after `+`) is ignored per semver
 * 2.0.0 precedence rules.
 */
function splitSemver(v: string): { main: string; prerelease: string | null } {
	const noBuild = v.split("+", 1)[0] ?? v;
	const dashIdx = noBuild.indexOf("-");
	if (dashIdx === -1) return { main: noBuild, prerelease: null };
	return {
		main: noBuild.slice(0, dashIdx),
		prerelease: noBuild.slice(dashIdx + 1),
	};
}

/**
 * Parse a single main-version segment to a non-negative integer. Returns 0
 * for empty / non-numeric input so e.g. `"1.2"` still compares cleanly
 * against `"1.2.0"`.
 */
function parseMainSegment(s: string | undefined): number {
	if (!s) return 0;
	const n = Number(s);
	return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * Compare two prerelease identifier lists per semver 2.0.0 §11.4:
 *   - identifiers are split on '.'
 *   - numeric identifiers compare numerically and rank below non-numeric
 *   - non-numeric identifiers compare lexically (ASCII)
 *   - a longer prerelease list wins when all leading identifiers match
 */
function comparePrerelease(a: string, b: string): -1 | 0 | 1 {
	const idsA = a.split(".");
	const idsB = b.split(".");
	const len = Math.max(idsA.length, idsB.length);
	for (let i = 0; i < len; i++) {
		const x = idsA[i];
		const y = idsB[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) {
			const nx = Number(x);
			const ny = Number(y);
			if (nx < ny) return -1;
			if (nx > ny) return 1;
			continue;
		}
		if (xNumeric) return -1;
		if (yNumeric) return 1;
		if (x < y) return -1;
		if (x > y) return 1;
	}
	return 0;
}

/**
 * Compare two semver strings (major.minor.patch with optional prerelease).
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 *
 * Handles prerelease / non-numeric segments per semver 2.0.0: a version with
 * a prerelease tail (e.g. "1.2.3-beta") ranks below the same main version
 * without one ("1.2.3"), and never causes a misleading 0 result when the
 * main components differ.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
	const sa = splitSemver(a);
	const sb = splitSemver(b);
	const partsA = sa.main.split(".");
	const partsB = sb.main.split(".");

	for (let i = 0; i < 3; i++) {
		const segA = parseMainSegment(partsA[i]);
		const segB = parseMainSegment(partsB[i]);
		if (segA < segB) return -1;
		if (segA > segB) return 1;
	}

	// Main parts equal — apply prerelease precedence.
	if (sa.prerelease === null && sb.prerelease === null) return 0;
	if (sa.prerelease === null) return 1; // a is release, b is prerelease
	if (sb.prerelease === null) return -1;
	return comparePrerelease(sa.prerelease, sb.prerelease);
}
