import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

function runCliAsync(args: string[], cwd: string) {
	const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	return Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]).then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }));
}

async function initMulchProject(cwd: string, configYaml: string): Promise<void> {
	const mulchDir = join(cwd, ".mulch");
	await mkdir(join(mulchDir, "expertise"), { recursive: true });
	await writeFile(join(mulchDir, "mulch.config.yaml"), configYaml, "utf-8");
}

function git(args: string[], cwd: string): void {
	execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
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
			// `prime` (whole section) is unset; schema has defaults for both
			// default_mode and tier_weights so the synthesized object includes both.
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
			expect(JSON.parse(result.stdout.toString())).toEqual({
				default_mode: "full",
				tier_weights: {
					star: 100,
					foundational: 50,
					tactical: 20,
					observational: 10,
				},
				session_close: { style: "conditional" },
			});
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

	describe("config unset", () => {
		const baseConfig = [
			"version: '1'",
			"domains: { warren: { allowed_types: [convention] } }",
			"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
			"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
			"search: { boost_factor: 0.25 }",
			"",
		].join("\n");

		it("removes an optional knob and `show --path` falls back to the schema default", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const unset = runCli(["config", "unset", "search.boost_factor"], tmpDir);
			expect(unset.exitCode).toBe(0);

			const show = runCli(["config", "show", "--path", "search.boost_factor"], tmpDir);
			expect(show.exitCode).toBe(0);
			expect(JSON.parse(show.stdout.toString())).toBe(0.1);

			// Empty parent (`search: {}`) is pruned so the YAML stays minimal
			// AND the schema's `required: [boost_factor]` under `search` doesn't
			// reject the next read.
			const configYaml = await readFile(join(tmpDir, ".mulch", "mulch.config.yaml"), "utf-8");
			expect(configYaml).not.toContain("search:");
		});

		it("removes an entry from an open map (domains.<name>)", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const unset = runCli(["config", "unset", "domains.warren"], tmpDir);
			expect(unset.exitCode).toBe(0);

			const show = runCli(["config", "show", "--path", "domains"], tmpDir);
			expect(show.exitCode).toBe(0);
			expect(JSON.parse(show.stdout.toString())).toEqual({});
		});

		it("is idempotent — unsetting a never-set path succeeds silently and does not rewrite the file", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const before = await readFile(join(tmpDir, ".mulch", "mulch.config.yaml"), "utf-8");
			const unset = runCli(["config", "unset", "prime.default_mode"], tmpDir);
			expect(unset.exitCode).toBe(0);
			const after = await readFile(join(tmpDir, ".mulch", "mulch.config.yaml"), "utf-8");
			expect(after).toBe(before);
		});

		it("is idempotent — unsetting through a missing parent succeeds silently", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const unset = runCli(["config", "unset", "hooks.pre-record"], tmpDir);
			expect(unset.exitCode).toBe(0);
		});

		it("rejects removal of a required field with a schema-titled error", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "unset", "governance.max_entries"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			const stderr = result.stderr.toString();
			expect(stderr).toContain("Invalid config after unset");
			// `required` errors report the parent's instancePath, so the schema
			// title appended to the AJV message is the section title.
			expect(stderr).toContain("must have required property 'max_entries'");
			expect(stderr).toContain("Governance limits");
		});

		it("rejects unknown closed-shape paths", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "unset", "governance.typo"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			const stderr = result.stderr.toString();
			expect(stderr).toContain("Unknown config path");
			expect(stderr).toContain("max_entries");
		});

		it("rejects empty <path>", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "unset", "."], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("must not be empty");
		});

		it("errors with the standard 'No .mulch/' message when run outside a project", () => {
			const result = runCli(["config", "unset", "search.boost_factor"], tmpDir);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("No .mulch/ directory");
		});

		it("does not leave the .tmp file behind on success", async () => {
			await initMulchProject(tmpDir, baseConfig);
			const result = runCli(["config", "unset", "search.boost_factor"], tmpDir);
			expect(result.exitCode).toBe(0);
			const { readdir } = await import("node:fs/promises");
			const files = await readdir(join(tmpDir, ".mulch"));
			const stragglers = files.filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
			expect(stragglers).toEqual([]);
		});

		it("round-trips with `ml config set` — set then unset reverts to the schema default", async () => {
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
			const set = runCli(["config", "set", "search.boost_factor", "0.25"], tmpDir);
			expect(set.exitCode).toBe(0);
			const afterSet = runCli(["config", "show", "--path", "search.boost_factor"], tmpDir);
			expect(JSON.parse(afterSet.stdout.toString())).toBe(0.25);

			const unset = runCli(["config", "unset", "search.boost_factor"], tmpDir);
			expect(unset.exitCode).toBe(0);
			const afterUnset = runCli(["config", "show", "--path", "search.boost_factor"], tmpDir);
			expect(JSON.parse(afterUnset.stdout.toString())).toBe(0.1);
		});
	});
});

describe("config command — worktree integration", () => {
	let tmpDir: string;
	let mainRepo: string;
	let worktreeDir: string;

	const baseConfig = [
		"version: '1'",
		"domains: { warren: { allowed_types: [convention] } }",
		"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
		"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
		"search: { boost_factor: 0.25 }",
		"",
	].join("\n");

	beforeEach(async () => {
		// realpath needed on macOS where /tmp is a symlink to /private/tmp.
		// getMulchDir resolves the worktree's main root via `git rev-parse
		// --git-common-dir`, which returns the resolved path; comparing with
		// the unresolved tmpDir would silently fail.
		tmpDir = await realpath(await mkdtemp(join(tmpdir(), "mulch-config-wt-test-")));
		mainRepo = join(tmpDir, "main");
		worktreeDir = join(tmpDir, "worktree");

		await mkdir(mainRepo, { recursive: true });
		git(["init", "-q"], mainRepo);
		git(["config", "user.email", "test@test.com"], mainRepo);
		git(["config", "user.name", "Test"], mainRepo);
		await writeFile(join(mainRepo, "dummy.txt"), "hello", "utf-8");
		git(["add", "."], mainRepo);
		git(["commit", "-q", "-m", "init"], mainRepo);

		await initMulchProject(mainRepo, baseConfig);
		git(["add", "."], mainRepo);
		git(["commit", "-q", "-m", "add mulch"], mainRepo);

		git(["worktree", "add", "-q", worktreeDir, "-b", "test-branch"], mainRepo);
	});

	afterEach(async () => {
		try {
			git(["worktree", "remove", "--force", worktreeDir], mainRepo);
		} catch {
			// already removed
		}
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("`config schema` works from a worktree (read-only, config-independent)", () => {
		const result = runCli(["config", "schema"], worktreeDir);
		expect(result.exitCode).toBe(0);
		// Parses as JSON Schema with the expected top-level shape.
		const parsed = JSON.parse(result.stdout.toString()) as {
			properties?: Record<string, unknown>;
		};
		expect(parsed.properties?.governance).toBeDefined();
	});

	it("`config show` from a worktree reads the main repo's config", () => {
		const result = runCli(["config", "show", "--path", "search.boost_factor"], worktreeDir);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.toString())).toBe(0.25);
	});

	it("`config set` from a worktree writes to the main repo's config (not the worktree's checkout)", async () => {
		// The worktree contains its own checkout of .mulch/mulch.config.yaml
		// (a copy from the source branch). Snapshot it so we can confirm it
		// stays untouched while the write lands in the main repo's copy —
		// that's what makes config writes survive `git worktree remove`.
		const worktreeConfigBefore = await readFile(
			join(worktreeDir, ".mulch", "mulch.config.yaml"),
			"utf-8",
		);

		const result = runCli(["config", "set", "governance.max_entries", "55"], worktreeDir);
		expect(result.exitCode).toBe(0);

		const mainConfigYaml = await readFile(join(mainRepo, ".mulch", "mulch.config.yaml"), "utf-8");
		expect(mainConfigYaml).toContain("max_entries: 55");

		// The worktree's checkout copy must NOT have been written through.
		const worktreeConfigAfter = await readFile(
			join(worktreeDir, ".mulch", "mulch.config.yaml"),
			"utf-8",
		);
		expect(worktreeConfigAfter).toBe(worktreeConfigBefore);

		// Round-trip via `show` from the worktree to confirm the update is visible.
		const show = runCli(["config", "show", "--path", "governance.max_entries"], worktreeDir);
		expect(JSON.parse(show.stdout.toString())).toBe(55);
	});

	it("`config unset` from a worktree updates the main repo's config (not the worktree's checkout)", async () => {
		const worktreeConfigBefore = await readFile(
			join(worktreeDir, ".mulch", "mulch.config.yaml"),
			"utf-8",
		);

		const result = runCli(["config", "unset", "search.boost_factor"], worktreeDir);
		expect(result.exitCode).toBe(0);

		const mainConfigYaml = await readFile(join(mainRepo, ".mulch", "mulch.config.yaml"), "utf-8");
		// `search.boost_factor` was the only key under `search`, so the empty
		// parent should have been pruned by unsetAtPath.
		expect(mainConfigYaml).not.toContain("search:");

		const worktreeConfigAfter = await readFile(
			join(worktreeDir, ".mulch", "mulch.config.yaml"),
			"utf-8",
		);
		expect(worktreeConfigAfter).toBe(worktreeConfigBefore);
	});

	it("set/unset stragglers (.tmp, .lock) land in main .mulch/ and are cleaned up", async () => {
		const set = runCli(["config", "set", "governance.max_entries", "77"], worktreeDir);
		expect(set.exitCode).toBe(0);
		const unset = runCli(["config", "unset", "search.boost_factor"], worktreeDir);
		expect(unset.exitCode).toBe(0);

		const mainFiles = await readdir(join(mainRepo, ".mulch"));
		const mainStragglers = mainFiles.filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
		expect(mainStragglers).toEqual([]);

		// And no straggler files in the worktree's checkout copy of .mulch/ either.
		const worktreeFiles = await readdir(join(worktreeDir, ".mulch"));
		const worktreeStragglers = worktreeFiles.filter(
			(f) => f.includes(".tmp.") || f.endsWith(".lock"),
		);
		expect(worktreeStragglers).toEqual([]);
	});

	it("concurrent set from the worktree and main both land (lock spans worktree boundary)", async () => {
		// Same lock file (main repo's config path) serializes both processes.
		const [a, b] = await Promise.all([
			runCliAsync(["config", "set", "governance.max_entries", "111"], worktreeDir),
			runCliAsync(["config", "set", "governance.warn_entries", "222"], mainRepo),
		]);
		expect(a.exitCode).toBe(0);
		expect(b.exitCode).toBe(0);

		const showMax = runCli(["config", "show", "--path", "governance.max_entries"], mainRepo);
		const showWarn = runCli(["config", "show", "--path", "governance.warn_entries"], mainRepo);
		expect(JSON.parse(showMax.stdout.toString())).toBe(111);
		expect(JSON.parse(showWarn.stdout.toString())).toBe(222);
	});
});

describe("config command — concurrency", () => {
	let tmpDir: string;

	const baseConfig = [
		"version: '1'",
		"domains: {}",
		"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
		"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
		"",
	].join("\n");

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-config-conc-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("concurrent set on disjoint keys: every value lands (no lost writes)", async () => {
		await initMulchProject(tmpDir, baseConfig);

		// 8 disjoint domain entries written concurrently. The advisory file
		// lock serializes the read-modify-write cycle, so each process sees
		// every prior set when it runs and includes it in its YAML dump.
		const writes = Array.from({ length: 8 }, (_, i) =>
			runCliAsync(["config", "set", `domains.d${i}`, `{ allowed_types: [convention] }`], tmpDir),
		);
		const results = await Promise.all(writes);
		for (const r of results) {
			expect(r.exitCode).toBe(0);
		}

		const show = runCli(["config", "show", "--path", "domains"], tmpDir);
		expect(show.exitCode).toBe(0);
		const domains = JSON.parse(show.stdout.toString()) as Record<string, unknown>;
		for (let i = 0; i < 8; i++) {
			expect(domains[`d${i}`]).toEqual({ allowed_types: ["convention"] });
		}
	});

	it("concurrent set on the same key: last-writer-wins, value is one of the inputs", async () => {
		await initMulchProject(tmpDir, baseConfig);

		const candidates = [10, 20, 30, 40, 50, 60, 70, 80];
		const writes = candidates.map((v) =>
			runCliAsync(["config", "set", "governance.max_entries", String(v)], tmpDir),
		);
		const results = await Promise.all(writes);
		for (const r of results) {
			expect(r.exitCode).toBe(0);
		}

		const show = runCli(["config", "show", "--path", "governance.max_entries"], tmpDir);
		expect(show.exitCode).toBe(0);
		const final = JSON.parse(show.stdout.toString()) as number;
		// The contract is "last-writer-wins under concurrent writes" — we
		// can't predict which writer wins, only that the result is exactly
		// one of the inputs (no truncated/garbled YAML, no value composition).
		expect(candidates).toContain(final);
	});

	it("concurrent set + unset on disjoint keys: both apply atomically", async () => {
		const seeded = [
			"version: '1'",
			"domains: {}",
			"governance: { max_entries: 100, warn_entries: 150, hard_limit: 200 }",
			"classification_defaults: { shelf_life: { tactical: 14, observational: 30 } }",
			"search: { boost_factor: 0.25 }",
			"",
		].join("\n");
		await initMulchProject(tmpDir, seeded);

		const [set, unset] = await Promise.all([
			runCliAsync(["config", "set", "governance.max_entries", "42"], tmpDir),
			runCliAsync(["config", "unset", "search.boost_factor"], tmpDir),
		]);
		expect(set.exitCode).toBe(0);
		expect(unset.exitCode).toBe(0);

		const showMax = runCli(["config", "show", "--path", "governance.max_entries"], tmpDir);
		expect(JSON.parse(showMax.stdout.toString())).toBe(42);

		const showBoost = runCli(["config", "show", "--path", "search.boost_factor"], tmpDir);
		// search.boost_factor falls back to the schema default after unset.
		expect(JSON.parse(showBoost.stdout.toString())).toBe(0.1);
	});

	it("concurrent invalid + valid set: invalid is rejected, valid is preserved", async () => {
		await initMulchProject(tmpDir, baseConfig);

		const [bad, good] = await Promise.all([
			runCliAsync(["config", "set", "governance.max_entries", '"not-a-number"'], tmpDir),
			runCliAsync(["config", "set", "governance.warn_entries", "175"], tmpDir),
		]);
		expect(bad.exitCode).not.toBe(0);
		expect(bad.stderr).toContain("Invalid config after set");
		expect(good.exitCode).toBe(0);

		// Bad write must NOT have corrupted on-disk config.
		const showMax = runCli(["config", "show", "--path", "governance.max_entries"], tmpDir);
		expect(JSON.parse(showMax.stdout.toString())).toBe(100);

		const showWarn = runCli(["config", "show", "--path", "governance.warn_entries"], tmpDir);
		expect(JSON.parse(showWarn.stdout.toString())).toBe(175);
	});

	it("after concurrent writes: no .lock or .tmp stragglers", async () => {
		await initMulchProject(tmpDir, baseConfig);

		const writes = Array.from({ length: 6 }, (_, i) =>
			runCliAsync(["config", "set", "governance.max_entries", String(50 + i)], tmpDir),
		);
		await Promise.all(writes);

		const files = await readdir(join(tmpDir, ".mulch"));
		const stragglers = files.filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
		expect(stragglers).toEqual([]);
	});

	it("YAML on disk stays parseable and schema-valid after concurrent writes", async () => {
		await initMulchProject(tmpDir, baseConfig);

		const writes: Promise<unknown>[] = [];
		for (let i = 0; i < 5; i++) {
			writes.push(runCliAsync(["config", "set", `domains.d${i}`, "{}"], tmpDir));
			writes.push(
				runCliAsync(["config", "set", "governance.max_entries", String(50 + i * 10)], tmpDir),
			);
		}
		await Promise.all(writes);

		// Final on-disk config must round-trip through `ml config show` (which
		// re-reads + re-validates via readConfig + applyConfigDefaults).
		const result = runCli(["config", "show"], tmpDir);
		expect(result.exitCode).toBe(0);
		const cfg = JSON.parse(result.stdout.toString()) as {
			version: string;
			governance: { max_entries: number };
			domains: Record<string, unknown>;
		};
		expect(cfg.version).toBe("1");
		expect(typeof cfg.governance.max_entries).toBe("number");
		// Every disjoint domain set should have landed.
		for (let i = 0; i < 5; i++) {
			expect(cfg.domains[`d${i}`]).toBeDefined();
		}
	});
});
