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

async function initMulchProject(cwd: string, configYaml: string): Promise<void> {
	const mulchDir = join(cwd, ".mulch");
	await mkdir(join(mulchDir, "expertise"), { recursive: true });
	await writeFile(join(mulchDir, "mulch.config.yaml"), configYaml, "utf-8");
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

	describe("config show", () => {
		it("emits the on-disk config (with applied defaults) as JSON", async () => {
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: { warren: {}, mulch: {} }",
					"governance: { max_entries: 50, warn_entries: 75, hard_limit: 100 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"search: { boost_factor: 0.25 }",
					"",
				].join("\n"),
			);
			const result = runCli(["config", "show"], tmpDir);
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout.toString()) as {
				version: string;
				domains: Record<string, unknown>;
				governance: { max_entries: number };
				search?: { boost_factor: number };
			};
			expect(parsed.version).toBe("1");
			expect(parsed.domains.warren).toEqual({});
			expect(parsed.governance.max_entries).toBe(50);
			expect(parsed.search?.boost_factor).toBe(0.25);
		});

		it("--path returns a single user-set knob", async () => {
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 42, warn_entries: 60, hard_limit: 80 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"",
				].join("\n"),
			);
			const result = runCli(["config", "show", "--path", "governance.max_entries"], tmpDir);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toBe(42);
		});

		it("--path falls back to the schema default when the knob is unset", async () => {
			// search.boost_factor is omitted; schema default is 0.1.
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"",
				].join("\n"),
			);
			const result = runCli(["config", "show", "--path", "search.boost_factor"], tmpDir);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toBe(0.1);
		});

		it("--path on an unset section synthesizes an object from leaf defaults", async () => {
			// `prime` (whole section) is unset; schema has prime.default_mode default 'full'.
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"",
				].join("\n"),
			);
			const result = runCli(["config", "show", "--path", "prime"], tmpDir);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toEqual({ default_mode: "full" });
		});

		it("returns a nested user-set value", async () => {
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
					"classification_defaults: { shelf_life: { tactical: 7, observational: 14 } }",
					"",
				].join("\n"),
			);
			const result = runCli(
				["config", "show", "--path", "classification_defaults.shelf_life.tactical"],
				tmpDir,
			);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toBe(7);
		});

		it("errors when --path targets an unknown closed-shape knob", async () => {
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"",
				].join("\n"),
			);
			const result = runCli(["config", "show", "--path", "governance.typo"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("not found");
		});

		it("errors when --path is empty", async () => {
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"",
				].join("\n"),
			);
			const result = runCli(["config", "show", "--path", "."], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("must not be empty");
		});

		it("errors with the standard 'No .mulch/' message when run outside a project", () => {
			const result = runCli(["config", "show"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("No .mulch/ directory");
		});

		it("global --json flag is accepted as a no-op (output is unconditionally JSON)", async () => {
			await initMulchProject(
				tmpDir,
				[
					"version: '1'",
					"domains: {}",
					"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
					"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
					"",
				].join("\n"),
			);
			const a = runCli(["config", "show"], tmpDir);
			const b = runCli(["config", "show", "--json"], tmpDir);
			expect(a.exitCode).toBe(0);
			expect(b.exitCode).toBe(0);
			expect(b.stdout.toString()).toBe(a.stdout.toString());
		});
	});

	describe("config set", () => {
		const baseConfig = [
			"version: '1'",
			"domains: {}",
			"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
			"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
			"",
		].join("\n");

		it("sets a numeric leaf and round-trips through `ml config show`", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const set = runCli(["config", "set", "governance.max_entries", "50"], tmpDir);
			expect(set.exitCode).toBe(0);
			const show = runCli(["config", "show", "--path", "governance.max_entries"], tmpDir);
			expect(show.exitCode).toBe(0);
			expect(JSON.parse(show.stdout.toString())).toBe(50);
		});

		it("YAML-parses the value (boolean, list, object)", async () => {
			await initMulchProject(tmpDir, baseConfig);

			// list
			const list = runCli(
				["config", "set", "domains.warren", "{ allowed_types: [convention, pattern] }"],
				tmpDir,
			);
			expect(list.exitCode).toBe(0);
			const showList = runCli(["config", "show", "--path", "domains.warren.allowed_types"], tmpDir);
			expect(showList.exitCode).toBe(0);
			expect(JSON.parse(showList.stdout.toString())).toEqual(["convention", "pattern"]);

			// number-as-string is preserved as a number when YAML parses it as such
			const num = runCli(["config", "set", "search.boost_factor", "0.25"], tmpDir);
			expect(num.exitCode).toBe(0);
			const showNum = runCli(["config", "show", "--path", "search.boost_factor"], tmpDir);
			expect(JSON.parse(showNum.stdout.toString())).toBe(0.25);
		});

		it("rejects unknown closed-shape paths with a list of known keys", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "set", "governance.typo", "5"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			const stderr = result.stderr.toString();
			expect(stderr).toContain("Unknown config path");
			expect(stderr).toContain("max_entries");
		});

		it("rejects values that fail schema validation with a schema-titled error", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "set", "governance.max_entries", '"oops"'], tmpDir);
			expect(result.exitCode).not.toBe(0);
			const stderr = result.stderr.toString();
			expect(stderr).toContain("Invalid config after set");
			expect(stderr).toContain("must be integer");
			expect(stderr).toContain("Soft target");
		});

		it("rejects empty <path>", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "set", ".", "5"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("must not be empty");
		});

		it("rejects invalid YAML for <value>", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "set", "governance.max_entries", "{unbalanced: ["], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("Invalid YAML");
		});

		it("errors with the standard 'No .mulch/' message when run outside a project", () => {
			const result = runCli(["config", "set", "governance.max_entries", "50"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("No .mulch/ directory");
		});

		it("creates intermediate objects through open maps (domains.<name>)", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(
				["config", "set", "domains.brand-new.required_fields", "[owner]"],
				tmpDir,
			);
			expect(result.exitCode).toBe(0);
			const show = runCli(
				["config", "show", "--path", "domains.brand-new.required_fields"],
				tmpDir,
			);
			expect(show.exitCode).toBe(0);
			expect(JSON.parse(show.stdout.toString())).toEqual(["owner"]);
		});

		it("does not leave the .tmp file behind on success", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "set", "governance.max_entries", "75"], tmpDir);
			expect(result.exitCode).toBe(0);
			const { readdir } = await import("node:fs/promises");
			const files = await readdir(join(tmpDir, ".mulch"));
			const stragglers = files.filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
			expect(stragglers).toEqual([]);
		});

		it("rejects a closed-shape replacement that violates required fields", async () => {
			// Replacing the whole governance section with an object missing required
			// fields must fail schema validation, not silently strip required keys.
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "set", "governance", "{ max_entries: 50 }"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("Invalid config after set");
		});
	});
});
