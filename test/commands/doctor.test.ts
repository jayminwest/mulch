import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
	getExpertiseDir,
	getExpertisePath,
	initMulchDir,
	writeConfig,
} from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

const cliPath = resolve(process.cwd(), "src/cli.ts");

let tmpDir: string;

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "mulch-doctor-test-"));
	await initMulchDir(tmpDir);
	await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, api: {} } }, tmpDir);
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("doctor health checks", () => {
	it("reports all passing when everything is healthy", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.id).toMatch(/^mx-/);
	});

	it("detects invalid JSON lines", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await writeFile(filePath, '{"valid":true}\nnot json\n', "utf-8");

		// Read should throw or skip invalid lines
		// The doctor command would detect this
		const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
		const lines = content.split("\n").filter((l) => l.trim().length > 0);
		let invalidCount = 0;
		for (const line of lines) {
			try {
				JSON.parse(line);
			} catch {
				invalidCount++;
			}
		}
		expect(invalidCount).toBe(1);
	});

	it("detects stale records", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		// Tactical record older than 14 days
		const staleRecord: ExpertiseRecord = {
			type: "convention",
			content: "Old convention",
			classification: "tactical",
			recorded_at: daysAgo(20),
		};
		await appendRecord(filePath, staleRecord);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);

		// Import isStale to verify
		const { isStale } = await import("../../src/commands/prune.js");
		const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
		const r0 = records[0];
		if (!r0) throw new Error("expected record");
		expect(isStale(r0, new Date(), shelfLife)).toBe(true);
	});

	it("detects orphaned domain files", async () => {
		// Create a JSONL file for a domain not in config
		const expertiseDir = getExpertiseDir(tmpDir);
		const orphanPath = join(expertiseDir, "orphan.jsonl");
		await writeFile(orphanPath, "", "utf-8");

		// Read the directory and check
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(expertiseDir);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
		const config = { ...DEFAULT_CONFIG, domains: { testing: {}, api: {} } };
		const orphans = jsonlFiles
			.map((f) => f.replace(".jsonl", ""))
			.filter((d) => !(d in config.domains));
		expect(orphans).toContain("orphan");
	});

	it("detects duplicate records", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		};

		// Force two identical records
		await appendRecord(filePath, { ...record });
		await appendRecord(filePath, { ...record, id: undefined });

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(2);

		const { findDuplicate } = await import("../../src/utils/expertise.js");
		const r0dup = records[0];
		const r1dup = records[1];
		if (!r0dup || !r1dup) throw new Error("expected two records");
		const dup = findDuplicate([r0dup], r1dup);
		expect(dup).not.toBeNull();
	});

	it("foundational records are never stale", async () => {
		const { isStale } = await import("../../src/commands/prune.js");
		const record: ExpertiseRecord = {
			type: "convention",
			content: "Permanent rule",
			classification: "foundational",
			recorded_at: daysAgo(365),
		};
		const shelfLife = DEFAULT_CONFIG.classification_defaults.shelf_life;
		expect(isStale(record, new Date(), shelfLife)).toBe(false);
	});

	it("detects legacy outcome field on disk", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		// Write a record with legacy singular outcome field directly to disk
		const legacyRecord = JSON.stringify({
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			outcome: { status: "success", agent: "test-agent" },
		});
		await writeFile(filePath, `${legacyRecord}\n`, "utf-8");
		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		// Verify raw file has "outcome" (singular)
		const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
		const parsed = JSON.parse(content.trim());
		expect("outcome" in parsed).toBe(true);
		expect("outcomes" in parsed).toBe(false);
	});

	it("fix migrates legacy outcome to outcomes array", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		const legacyRecord = JSON.stringify({
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			outcome: { status: "success", agent: "test-agent", duration: 42 },
		});
		await writeFile(filePath, `${legacyRecord}\n`, "utf-8");
		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		// Read back — expertise.ts normalizes outcome→outcomes in memory
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.outcomes).toBeDefined();
		expect(Array.isArray(records[0]?.outcomes)).toBe(true);
		expect(records[0]?.outcomes?.[0]?.status).toBe("success");
		expect(records[0]?.outcomes?.[0]?.agent).toBe("test-agent");
		expect(records[0]?.outcomes?.[0]?.duration).toBe(42);
	});

	it("detects governance threshold violations", async () => {
		const config = {
			...DEFAULT_CONFIG,
			domains: { testing: {} },
			governance: {
				...DEFAULT_CONFIG.governance,
				warn_entries: 5,
				max_entries: 10,
				hard_limit: 15,
			},
		};
		await writeConfig(config, tmpDir);

		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		// Add 7 records to trigger warn threshold (over warn_entries of 5)
		for (let i = 0; i < 7; i++) {
			await appendRecord(filePath, {
				type: "convention",
				content: `Convention ${i}`,
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
		}

		const records = await readExpertiseFile(filePath);
		expect(records.length).toBe(7);
		expect(records.length).toBeGreaterThan(config.governance.warn_entries);
		expect(records.length).toBeLessThan(config.governance.max_entries);
	});
});

describe("file-anchors check", () => {
	it("passes when files[] paths all exist on disk", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const realFile = join(tmpDir, "real-file.ts");
		await writeFile(realFile, "", "utf-8");

		await appendRecord(filePath, {
			type: "pattern",
			name: "my-pattern",
			description: "desc",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			files: ["real-file.ts"],
		});

		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		const records = await readExpertiseFile(filePath);
		const record = records[0];
		if (!record) throw new Error("expected record");
		const broken =
			"files" in record && Array.isArray(record.files)
				? record.files.filter((f) => !existsSync(resolve(tmpDir, f)))
				: [];
		expect(broken).toHaveLength(0);
	});

	it("detects broken files[] paths in pattern records", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "pattern",
			name: "my-pattern",
			description: "desc",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			files: ["src/commands/nonexistent.ts", "src/utils/also-gone.ts"],
		});

		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		const records = await readExpertiseFile(filePath);
		const record = records[0];
		if (!record) throw new Error("expected record");
		const brokenPaths: string[] = [];
		if ("files" in record && Array.isArray(record.files)) {
			for (const f of record.files) {
				if (!existsSync(resolve(tmpDir, f))) {
					brokenPaths.push(f);
				}
			}
		}
		expect(brokenPaths).toHaveLength(2);
		expect(brokenPaths).toContain("src/commands/nonexistent.ts");
		expect(brokenPaths).toContain("src/utils/also-gone.ts");
	});

	it("detects broken evidence.file paths", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "some rule",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: { file: "src/deleted-file.ts" },
		});

		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		const records = await readExpertiseFile(filePath);
		const record = records[0];
		if (!record) throw new Error("expected record");
		const evidenceFile = record.evidence?.file;
		expect(evidenceFile).toBe("src/deleted-file.ts");
		if (!evidenceFile) throw new Error("expected evidenceFile");
		expect(existsSync(resolve(tmpDir, evidenceFile))).toBe(false);
	});

	it("passes when evidence.file exists on disk", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const realFile = join(tmpDir, "real-evidence.ts");
		await writeFile(realFile, "", "utf-8");

		await appendRecord(filePath, {
			type: "convention",
			content: "some rule",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: { file: "real-evidence.ts" },
		});

		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		const records = await readExpertiseFile(filePath);
		const record = records[0];
		if (!record) throw new Error("expected record");
		const evidenceFile = record.evidence?.file;
		expect(evidenceFile).toBe("real-evidence.ts");
		if (!evidenceFile) throw new Error("expected evidenceFile");
		expect(existsSync(resolve(tmpDir, evidenceFile))).toBe(true);
	});
});

describe("doctor — Phase 3 type registry + unknown-types checks", () => {
	let phase3Dir: string;

	beforeEach(async () => {
		phase3Dir = await mkdtemp(join(tmpdir(), "mulch-doctor-p3-"));
		await initMulchDir(phase3Dir);
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { cli: {} },
				custom_types: {
					hypothesis: {
						required: ["statement"],
						dedup_key: "statement",
						summary: "{statement}",
					},
				},
				disabled_types: ["failure"],
			},
			phase3Dir,
		);

		const filePath = getExpertisePath("cli", phase3Dir);
		// Two convention records, one unknown-type record.
		await writeFile(
			filePath,
			[
				JSON.stringify({
					type: "convention",
					content: "a",
					classification: "tactical",
					recorded_at: "2026-01-01T00:00:00.000Z",
				}),
				JSON.stringify({
					type: "convention",
					content: "b",
					classification: "tactical",
					recorded_at: "2026-01-01T00:00:00.000Z",
				}),
				JSON.stringify({
					type: "ghost",
					id: "mx-ghost1",
					content: "x",
					classification: "tactical",
					recorded_at: "2026-01-01T00:00:00.000Z",
				}),
				"",
			].join("\n"),
			"utf-8",
		);
	});

	afterEach(async () => {
		await rm(phase3Dir, { recursive: true, force: true });
	});

	it("doctor --json reports the type-registry check with kind+count details", () => {
		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: phase3Dir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const typeCheck = out.checks.find((c: { name: string }) => c.name === "type-registry") as {
			status: string;
			message: string;
			details: string[];
		};
		expect(typeCheck).toBeDefined();
		expect(typeCheck.status).toBe("pass");
		expect(typeCheck.message).toMatch(/7 type\(s\) registered: 6 built-in, 1 custom, 1 disabled/);
		expect(typeCheck.details).toContain("convention (built-in): 2 records");
		expect(typeCheck.details).toContain("failure (built-in, disabled): 0 records");
		expect(typeCheck.details).toContain("hypothesis (custom): 0 records");
	});

	it("doctor --json reports unknown-types as a failing check with offending id", () => {
		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: phase3Dir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const unknown = out.checks.find((c: { name: string }) => c.name === "unknown-types") as {
			status: string;
			details: string[];
		};
		expect(unknown.status).toBe("fail");
		expect(unknown.details.some((d) => d.includes("[mx-ghost1]") && d.includes('"ghost"'))).toBe(
			true,
		);
		expect(out.summary.fail).toBeGreaterThanOrEqual(1);
	});
});

describe("doctor — domain conformance (R-01d)", () => {
	let conformDir: string;

	beforeEach(async () => {
		conformDir = await mkdtemp(join(tmpdir(), "mulch-doctor-conform-"));
		await initMulchDir(conformDir);
	});

	afterEach(async () => {
		await rm(conformDir, { recursive: true, force: true });
	});

	it("passes both checks when every record matches its domain rules", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: {
					backend: { allowed_types: ["convention"], required_fields: ["oncall_owner"] },
				},
			},
			conformDir,
		);
		const filePath = getExpertisePath("backend", conformDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "ok",
			classification: "tactical",
			recorded_at: "2026-01-01T00:00:00.000Z",
			// Extra top-level field — domain rule requires it.
			oncall_owner: "alice",
		} as unknown as ExpertiseRecord);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: conformDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const info = out.checks.find((c: { name: string }) => c.name === "domain-conformance");
		const violations = out.checks.find((c: { name: string }) => c.name === "domain-violations");
		expect(info.status).toBe("pass");
		expect(info.message).toMatch(/1\/1 record\(s\) conform/);
		expect(info.details).toContain("backend (rules): 1/1 conforming, 0 violations");
		expect(violations.status).toBe("pass");
	});

	it("flags a record whose type is not in allowed_types and keeps type-registry passing", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { allowed_types: ["convention"] } },
			},
			conformDir,
		);
		const filePath = getExpertisePath("backend", conformDir);
		await createExpertiseFile(filePath);
		await writeFile(
			filePath,
			`${JSON.stringify({
				type: "pattern",
				id: "mx-bad",
				name: "n",
				description: "d",
				classification: "tactical",
				recorded_at: "2026-01-01T00:00:00.000Z",
			})}\n`,
			"utf-8",
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: conformDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const info = out.checks.find((c: { name: string }) => c.name === "domain-conformance");
		const violations = out.checks.find((c: { name: string }) => c.name === "domain-violations");
		const typeRegistry = out.checks.find((c: { name: string }) => c.name === "type-registry");
		expect(info.status).toBe("pass");
		expect(info.details[0]).toMatch(/0\/1 conforming, 1 violation/);
		expect(violations.status).toBe("fail");
		expect(violations.details.some((d: string) => d.includes("[mx-bad]"))).toBe(true);
		expect(violations.details.some((d: string) => d.includes('"pattern"'))).toBe(true);
		// pattern is registered — type-registry shouldn't fail just because the
		// domain disallows it.
		expect(typeRegistry.status).toBe("pass");
	});

	it("flags a record missing a domain-required field", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { backend: { required_fields: ["oncall_owner"] } },
			},
			conformDir,
		);
		const filePath = getExpertisePath("backend", conformDir);
		await createExpertiseFile(filePath);
		await writeFile(
			filePath,
			`${JSON.stringify({
				type: "convention",
				id: "mx-noown",
				content: "c",
				classification: "tactical",
				recorded_at: "2026-01-01T00:00:00.000Z",
			})}\n`,
			"utf-8",
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: conformDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const violations = out.checks.find((c: { name: string }) => c.name === "domain-violations");
		expect(violations.status).toBe("fail");
		expect(
			violations.details.some(
				(d: string) => d.includes("[mx-noown]") && d.includes("oncall_owner"),
			),
		).toBe(true);
		// Domain violations don't expose --fix in v1 — they require human judgment.
		expect(violations.fixable).toBe(false);
	});

	it("counts a record with multiple simultaneous violations as one record", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: {
					backend: {
						allowed_types: ["convention"],
						required_fields: ["oncall_owner"],
					},
				},
			},
			conformDir,
		);
		const filePath = getExpertisePath("backend", conformDir);
		await createExpertiseFile(filePath);
		// Two conforming records...
		await appendRecord(filePath, {
			type: "convention",
			content: "ok1",
			classification: "tactical",
			recorded_at: "2026-01-01T00:00:00.000Z",
			oncall_owner: "alice",
		} as unknown as ExpertiseRecord);
		await appendRecord(filePath, {
			type: "convention",
			content: "ok2",
			classification: "tactical",
			recorded_at: "2026-01-01T00:00:00.000Z",
			oncall_owner: "bob",
		} as unknown as ExpertiseRecord);
		// ...and one record that violates BOTH rules at once.
		await writeFile(
			filePath,
			`${(await readFile(filePath, "utf-8")).trimEnd()}\n${JSON.stringify({
				type: "reference",
				id: "mx-bad001",
				name: "n",
				description: "d",
				classification: "tactical",
				recorded_at: "2026-01-01T00:00:00.000Z",
			})}\n`,
			"utf-8",
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: conformDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const info = out.checks.find((c: { name: string }) => c.name === "domain-conformance");
		const violations = out.checks.find((c: { name: string }) => c.name === "domain-violations");
		expect(info.message).toMatch(/2\/3 record\(s\) conform/);
		expect(info.details[0]).toMatch(/2\/3 conforming, 1 violation/);
		expect(violations.status).toBe("fail");
		expect(violations.message).toMatch(/^1 record\(s\) violate/);
		// Detail block still lists every individual violation.
		expect(violations.details.length).toBe(2);
		expect(violations.details.some((d: string) => d.includes("allowed_types"))).toBe(true);
		expect(violations.details.some((d: string) => d.includes("oncall_owner"))).toBe(true);
	});
});

describe("doctor — domain-rules-compatibility (mulch-cc51)", () => {
	let compatDir: string;

	beforeEach(async () => {
		compatDir = await mkdtemp(join(tmpdir(), "mulch-doctor-compat-"));
		await initMulchDir(compatDir);
	});

	afterEach(async () => {
		await rm(compatDir, { recursive: true, force: true });
	});

	it("flags required_fields entries no allowed type can hold", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: {
					backend: { required_fields: ["oncall_owner"] },
				},
			},
			compatDir,
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: compatDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "domain-rules-compatibility");
		expect(check.status).toBe("fail");
		expect(check.message).toMatch(/1 domain required_field\(s\) incompatible/);
		expect(check.details.length).toBe(1);
		const detail = check.details[0] as string;
		expect(detail).toContain('"backend"');
		expect(detail).toContain('"oncall_owner"');
		expect(detail).toContain("custom_type");
	});

	it("passes when required_fields names a base record field", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: {
					backend: { required_fields: ["evidence", "tags"] },
				},
			},
			compatDir,
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: compatDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "domain-rules-compatibility");
		expect(check.status).toBe("pass");
	});

	it("passes when at least one allowed type declares the required field", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: {
					// pattern declares `files` as optional, so requiring `files` is satisfiable.
					notes: { allowed_types: ["pattern"], required_fields: ["files"] },
				},
			},
			compatDir,
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: compatDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "domain-rules-compatibility");
		expect(check.status).toBe("pass");
	});

	it("flags incompatibility scoped to the domain's allowed_types", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: {
					// pattern has `files` (optional), but convention does not — when
					// allowed_types is restricted to convention, requiring files is
					// unsatisfiable even though some other type would accept it.
					notes: { allowed_types: ["convention"], required_fields: ["files"] },
				},
			},
			compatDir,
		);

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: compatDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "domain-rules-compatibility");
		expect(check.status).toBe("fail");
		const detail = check.details[0] as string;
		expect(detail).toContain('"files"');
		expect(detail).toContain("allowed: convention");
	});
});

describe("doctor — dir_anchors (R-01)", () => {
	it("flags broken dir_anchors[] paths in file-anchors check", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		await appendRecord(filePath, {
			type: "convention",
			content: "anchored to dirs",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			dir_anchors: ["src/missing-dir", "src/also-gone"],
		});

		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "file-anchors") as {
			status: string;
			details: string[];
			message: string;
		};
		expect(check.status).toBe("warn");
		expect(
			check.details.some((d) => d.includes("dir_anchors[] path not found: src/missing-dir")),
		).toBe(true);
		expect(
			check.details.some((d) => d.includes("dir_anchors[] path not found: src/also-gone")),
		).toBe(true);
	});

	it("doctor --fix strips broken dir_anchors[] entries while keeping live ones", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		// Create a real "src/" dir so one anchor survives the fix.
		await mkdir(join(tmpDir, "src"), { recursive: true });
		await writeFile(join(tmpDir, "src", "keep.ts"), "", "utf-8");

		await appendRecord(filePath, {
			type: "pattern",
			name: "anchored-pat",
			description: "mixed live/dead anchors",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			dir_anchors: ["src", "src/missing", "still-gone"],
		});

		const r = spawnSync("bun", [cliPath, "doctor", "--fix", "--json"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		expect(r.status).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.fixed.some((f: string) => /broken file anchor/.test(f))).toBe(true);

		const records = await readExpertiseFile(filePath);
		expect(records[0]?.dir_anchors).toEqual(["src"]);
	});

	it("doctor --fix drops dir_anchors entirely when all entries are broken", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const apiPath = getExpertisePath("api", tmpDir);
		await createExpertiseFile(apiPath);

		await appendRecord(filePath, {
			type: "convention",
			content: "all dead",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			dir_anchors: ["does-not-exist", "also-missing"],
		});

		const r = spawnSync("bun", [cliPath, "doctor", "--fix", "--json"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		expect(r.status).toBe(0);
		const records = await readExpertiseFile(filePath);
		expect(records[0]?.dir_anchors).toBeUndefined();
	});
});

describe("doctor — decay-config check", () => {
	it("passes when decay block is absent (uses defaults)", async () => {
		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "decay-config") as {
			status: string;
		};
		expect(check.status).toBe("pass");
	});

	it("fails on negative grace_days with the offending value in details", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { testing: {}, api: {} },
				decay: { anchor_validity: { grace_days: -3 } },
			},
			tmpDir,
		);
		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "decay-config") as {
			status: string;
			details: string[];
		};
		expect(check.status).toBe("fail");
		expect(check.details.some((d) => d.includes("grace_days must be >= 0"))).toBe(true);
	});

	it("fails on threshold out of range", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { testing: {}, api: {} },
				decay: { anchor_validity: { threshold: 2 } },
			},
			tmpDir,
		);
		const r = spawnSync("bun", [cliPath, "doctor", "--json"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 10000,
		});
		const out = JSON.parse(r.stdout);
		const check = out.checks.find((c: { name: string }) => c.name === "decay-config") as {
			status: string;
			details: string[];
		};
		expect(check.status).toBe("fail");
		expect(check.details.some((d) => d.includes("threshold must be between 0 and 1"))).toBe(true);
	});
});
