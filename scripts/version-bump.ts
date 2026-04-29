#!/usr/bin/env bun
/**
 * Bump version in package.json and src/cli.ts atomically.
 *
 * Usage: bun run scripts/version-bump.ts <major|minor|patch>
 */

const level = Bun.argv[2];

if (level !== "major" && level !== "minor" && level !== "patch") {
	console.error("Usage: bun run scripts/version-bump.ts <major|minor|patch>");
	process.exit(1);
}

// --- Read package.json ---
const pkgPath = new URL("../package.json", import.meta.url).pathname;
const pkgText = await Bun.file(pkgPath).text();
const pkg = JSON.parse(pkgText) as { version: string; [key: string]: unknown };

const current = pkg.version;
if (typeof current !== "string" || !/^\d+\.\d+\.\d+$/.test(current)) {
	console.error(`Invalid version in package.json: ${String(current)}`);
	process.exit(1);
}

// --- Compute next version ---
const parts = current.split(".").map(Number) as [number, number, number];
if (level === "major") {
	parts[0] += 1;
	parts[1] = 0;
	parts[2] = 0;
} else if (level === "minor") {
	parts[1] += 1;
	parts[2] = 0;
} else {
	parts[2] += 1;
}
const next = parts.join(".");

// --- Update package.json ---
const newPkgText = pkgText.replace(`"version": "${current}"`, `"version": "${next}"`);
if (newPkgText === pkgText) {
	console.error(`Could not find "version": "${current}" in package.json`);
	process.exit(1);
}
await Bun.write(pkgPath, newPkgText);

// --- Update src/cli.ts ---
const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;
const cliText = await Bun.file(cliPath).text();
const newCliText = cliText.replace(`const VERSION = "${current}"`, `const VERSION = "${next}"`);
if (newCliText === cliText) {
	console.error(`Could not find 'const VERSION = "${current}"' in src/cli.ts`);
	// Rollback package.json
	await Bun.write(pkgPath, pkgText);
	process.exit(1);
}
await Bun.write(cliPath, newCliText);

// --- Done ---
console.log(`Bumped ${current} → ${next}`);
console.log("");
console.log("Next steps:");
console.log(`  1. Update CHANGELOG.md — move [Unreleased] items to [${next}]`);
console.log("  2. git add package.json src/cli.ts CHANGELOG.md");
console.log(`  3. git commit -m "chore: release v${next}"`);
console.log(`  4. git tag v${next}`);
console.log("  5. git push && git push --tags");
