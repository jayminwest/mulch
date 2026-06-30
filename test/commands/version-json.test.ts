import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import pkg from "../../package.json" with { type: "json" };

describe("--version --json", () => {
	it("emits 2-space-indented JSON with the standard fields", () => {
		const result = execFileSync("bun", ["src/cli.ts", "--version", "--json"], {
			encoding: "utf-8",
			timeout: 15000,
		});

		// Must be multi-line / indented (was previously single-line).
		expect(result).toContain("\n");
		expect(result).toContain('  "name"');

		const parsed = JSON.parse(result);
		expect(parsed).toEqual({
			name: "@os-eco/mulch-cli",
			version: pkg.version,
			runtime: "bun",
			platform: `${process.platform}-${process.arch}`,
		});
	});
});
