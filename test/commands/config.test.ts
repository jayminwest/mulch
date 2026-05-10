import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");
const SNAPSHOT_PATH = join(import.meta.dir, "__snapshots__", "config-schema.snapshot.json");

function runCli(args: string[], cwd: string) {
	return Bun.spawnSync(["bun", CLI_PATH, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("config command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		// Run from a fresh temp dir so initRegistryFromConfig falls back to
		// built-ins-only and the test is insensitive to this repo's dogfood
		// .mulch/ config.
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-config-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("config schema (golden)", () => {
		it("emits a JSON Schema document that matches the golden snapshot", async () => {
			const result = runCli(["config", "schema"], tmpDir);
			expect(result.exitCode).toBe(0);
			const stdout = result.stdout.toString();

			// Sanity-check: stdout must be valid JSON. A clearer error than
			// `toBe` mismatch when the CLI emits something unexpected.
			try {
				JSON.parse(stdout);
			} catch (err) {
				throw new Error(
					`ml config schema did not emit valid JSON: ${(err as Error).message}\n` +
						`stdout (first 500 chars): ${stdout.slice(0, 500)}`,
				);
			}

			if (process.env.UPDATE_SNAPSHOTS === "1") {
				await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
				await writeFile(SNAPSHOT_PATH, stdout, "utf-8");
				return;
			}

			if (!existsSync(SNAPSHOT_PATH)) {
				throw new Error(
					`Snapshot missing at ${SNAPSHOT_PATH}. Run with UPDATE_SNAPSHOTS=1 to regenerate.`,
				);
			}

			const expected = await readFile(SNAPSHOT_PATH, "utf-8");
			// Byte-exact comparison so accidental drift (structural OR
			// formatting/reordering) fails CI. Intentional schema changes
			// regenerate via `UPDATE_SNAPSHOTS=1 bun test test/commands/config.test.ts`.
			expect(stdout).toBe(expected);
		});

		it("global --json flag is accepted as a no-op (output is unconditionally JSON Schema)", () => {
			const a = runCli(["config", "schema"], tmpDir);
			const b = runCli(["config", "schema", "--json"], tmpDir);
			expect(a.exitCode).toBe(0);
			expect(b.exitCode).toBe(0);
			expect(b.stdout.toString()).toBe(a.stdout.toString());
		});

		it("emitted schema covers every top-level MulchConfig field", async () => {
			const result = runCli(["config", "schema"], tmpDir);
			expect(result.exitCode).toBe(0);
			const schema = JSON.parse(result.stdout.toString()) as {
				properties: Record<string, unknown>;
				required: string[];
			};

			// Top-level required fields match the MulchConfig non-optional set.
			expect(schema.required.sort()).toEqual(
				["version", "domains", "governance", "classification_defaults"].sort(),
			);

			// Spot-check that every optional knob from the TS interface has a
			// schema entry. Drift here would mean the schema lags the type and
			// warren can't render UI for the missing knob.
			const expectedProps = [
				"version",
				"domains",
				"governance",
				"classification_defaults",
				"prime",
				"search",
				"custom_types",
				"decay",
				"disabled_types",
				"hooks",
				"hook_settings",
			];
			for (const prop of expectedProps) {
				expect(schema.properties[prop]).toBeDefined();
			}
		});
	});
});
