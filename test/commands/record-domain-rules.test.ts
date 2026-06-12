// Per-domain rule enforcement on `ml record` — allowed_types (R-01b),
// required_fields (R-01c), and the --allow-domain-mismatch escape hatch
// (R-01d). Split out of record.test.ts to keep that file inside its
// file-size budget (pl-237d).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { processStdinRecords } from "../../src/commands/record.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { resetRegistry } from "../../src/registry/type-registry.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

describe("per-domain allowed_types (R-01b)", () => {
	const cliPath = resolve(process.cwd(), "src/cli.ts");
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-allowed-types-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("allows a record whose type is in domain allowed_types", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention"] } },
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[cliPath, "record", "backend", "ok content", "--type", "convention"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded convention/);
	});

	it("rejects a record whose type is not in domain allowed_types and prints retry hint", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention"] } },
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[cliPath, "record", "backend", "--type", "pattern", "--name", "x", "--description", "y"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/type "pattern" is not allowed in domain "backend"/);
		expect(r.stderr).toMatch(/Allowed types: convention/);
		expect(r.stderr).toMatch(/Retry: ml record backend/);
		expect(r.stderr).toMatch(/--type convention/);
	});

	it("empty/missing allowed_types preserves back-compat for all registered types", () => {
		// Default config has empty domains map; auto-create produces {} (no allowed_types).
		const r = spawnSync(
			"bun",
			[cliPath, "record", "anywhere", "--type", "decision", "--title", "t", "--rationale", "r"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded decision/);
	});

	it("disabled_types wins when an allowed type is also disabled (writes with warning)", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention", "failure"] } },
				disabled_types: ["failure"],
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[
				cliPath,
				"record",
				"backend",
				"--type",
				"failure",
				"--description",
				"d",
				"--resolution",
				"r",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stderr).toMatch(/Warning: type "failure" is disabled/);
		expect(r.stdout).toMatch(/Recorded failure/);
	});

	it("processStdinRecords rejects per-record when type not in allowed_types", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention"] } },
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);
		const filePath = getExpertisePath("backend", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"backend",
			false,
			false,
			false,
			JSON.stringify([
				{ type: "convention", content: "ok", classification: "tactical" },
				{
					type: "pattern",
					name: "p1",
					description: "d",
					classification: "tactical",
				},
			]),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatch(/type "pattern" is not allowed in domain "backend"/);
		expect(result.errors[0]).toMatch(/Allowed types: convention/);
	});
});

describe("per-domain required_fields (R-01c)", () => {
	const cliPath = resolve(process.cwd(), "src/cli.ts");
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-required-fields-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("succeeds when all required_fields are present on the record", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
				custom_types: {
					task: {
						required: ["description"],
						optional: ["oncall_owner"],
						dedup_key: "description",
						summary: "{description}",
					},
				},
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[
				cliPath,
				"record",
				"backend",
				"--type",
				"task",
				"--description",
				"ship it",
				"--oncall-owner",
				"alice",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded task/);

		await initRegistryFromConfig(tmpDir);
		const records = await readExpertiseFile(getExpertisePath("backend", tmpDir));
		expect(records).toHaveLength(1);
		expect((records[0] as unknown as Record<string, unknown>).oncall_owner).toBe("alice");
	});

	it("rejects a record missing one required_field with retry hint", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
				custom_types: {
					task: {
						required: ["description"],
						optional: ["oncall_owner"],
						dedup_key: "description",
						summary: "{description}",
					},
				},
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[cliPath, "record", "backend", "--type", "task", "--description", "ship it"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/domain "backend" requires field\(s\) "oncall_owner"/);
		expect(r.stderr).toMatch(/Retry: ml record backend/);
		expect(r.stderr).toMatch(/--oncall-owner "<oncall_owner>"/);
	});

	it("lists every missing required_field in a single error", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner", "severity"] } },
				custom_types: {
					task: {
						required: ["description"],
						optional: ["oncall_owner", "severity"],
						dedup_key: "description",
						summary: "{description}",
					},
				},
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[cliPath, "record", "backend", "--type", "task", "--description", "ship it"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(1);
		// Single error line lists all missing fields.
		expect(r.stderr).toMatch(/domain "backend" requires field\(s\) "oncall_owner", "severity"/);
		// Retry hint includes both missing flags.
		expect(r.stderr).toMatch(/--oncall-owner "<oncall_owner>"/);
		expect(r.stderr).toMatch(/--severity "<severity>"/);
	});

	it("stacks on top of per-type required (per-type still enforced)", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
				custom_types: {
					task: {
						required: ["description"],
						optional: ["oncall_owner"],
						dedup_key: "description",
						summary: "{description}",
					},
				},
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		// Has the domain-required field but is missing the per-type required
		// "description". Per-type validation must still fire — the domain check
		// adds on top, doesn't replace.
		const r = spawnSync(
			"bun",
			[cliPath, "record", "backend", "--type", "task", "--oncall-owner", "alice"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/task records are missing required flag\(s\): --description/);
	});

	it("missing/empty required_fields preserves back-compat", () => {
		// Default config has no required_fields → behavior unchanged.
		const r = spawnSync(
			"bun",
			[cliPath, "record", "anywhere", "--type", "decision", "--title", "t", "--rationale", "r"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded decision/);
	});

	it("targeted hint when required_field is rejected by closed schema (mulch-cc51)", async () => {
		// Domain demands a field that no allowed type holds (built-in convention
		// has additionalProperties: false). Without the hint, AJV emits a
		// confusing oneOf/additionalProperties soup. With the hint, the user
		// learns the real cause: declare a custom_type or drop the requirement.
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);
		const filePath = getExpertisePath("backend", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"backend",
			false,
			false,
			false,
			JSON.stringify({
				type: "convention",
				content: "be on call",
				oncall_owner: "@platform",
				classification: "tactical",
			}),
			tmpDir,
		);

		expect(result.created).toBe(0);
		expect(result.errors).toHaveLength(1);
		const err = result.errors[0] as string;
		expect(err).toMatch(/Domain "backend" requires field\(s\) "oncall_owner"/);
		expect(err).toMatch(/type "convention" does not declare them/);
		expect(err).toMatch(/custom_type/);
	});

	it("processStdinRecords rejects per-record when required_fields are missing", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
				custom_types: {
					task: {
						required: ["description"],
						optional: ["oncall_owner"],
						dedup_key: "description",
						summary: "{description}",
					},
				},
			},
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);
		const filePath = getExpertisePath("backend", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"backend",
			false,
			false,
			false,
			JSON.stringify([
				{
					type: "task",
					description: "with owner",
					oncall_owner: "alice",
					classification: "tactical",
				},
				{
					type: "task",
					description: "no owner",
					classification: "tactical",
				},
			]),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatch(/domain "backend" requires field\(s\) "oncall_owner"/);
	});
});

describe("--allow-domain-mismatch escape hatch (R-01d)", () => {
	const cliPath = resolve(process.cwd(), "src/cli.ts");
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-domain-mismatch-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("--allow-domain-mismatch lets a disallowed type write", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention"] } },
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[
				cliPath,
				"--allow-domain-mismatch",
				"record",
				"backend",
				"--type",
				"pattern",
				"--name",
				"x",
				"--description",
				"y",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded pattern/);
	});

	it("--allow-domain-mismatch lets a record without required_fields write", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[
				cliPath,
				"--allow-domain-mismatch",
				"record",
				"backend",
				"some content",
				"--type",
				"convention",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded convention/);
	});

	it("without the flag, the same record is rejected (regression guard)", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention"] } },
			},
			tmpDir,
		);
		await createExpertiseFile(getExpertisePath("backend", tmpDir));

		const r = spawnSync(
			"bun",
			[cliPath, "record", "backend", "--type", "pattern", "--name", "x", "--description", "y"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/type "pattern" is not allowed/);
	});
});
