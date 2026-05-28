import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";

describe("update command (deprecated)", () => {
	it("shows deprecation warning and exits with code 1", () => {
		try {
			execFileSync("bun", ["src/cli.ts", "update"], {
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
			execFileSync("bun", ["src/cli.ts", "update", "--check"], {
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

	it("emits JSON error envelope to stderr with --json", () => {
		try {
			execFileSync("bun", ["src/cli.ts", "--json", "update"], {
				encoding: "utf-8",
				timeout: 15000,
			});
			throw new Error("Expected non-zero exit code");
		} catch (err) {
			const error = err as { status: number; stdout: string; stderr: string };
			expect(error.status).toBe(1);
			expect(error.stdout).toBe("");
			const parsed = JSON.parse(error.stderr);
			expect(parsed.success).toBe(false);
			expect(parsed.command).toBe("update");
			expect(parsed.error).toContain("deprecated");
		}
	});
});
