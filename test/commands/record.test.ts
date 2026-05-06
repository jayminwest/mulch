import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv from "ajv";
import { processStdinRecords } from "../../src/commands/record.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { resetRegistry } from "../../src/registry/type-registry.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { recordSchema } from "../../src/schemas/record-schema.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

describe("record command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-record-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("recording a convention appends to JSONL", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "convention",
			content: "Always use vitest for testing",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		};

		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("convention");
		expect(records[0]).toMatchObject({ content: "Always use vitest for testing" });
	});

	it("record includes recorded_at timestamp", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const before = new Date();
		const record: ExpertiseRecord = {
			type: "convention",
			content: "Timestamp test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};
		await appendRecord(filePath, record);
		const after = new Date();

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);

		const r0 = records[0];
		if (!r0) throw new Error("Expected record");
		const recordedAt = new Date(r0.recorded_at);
		expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime());
	});

	it("records a pattern with all fields", async () => {
		const filePath = getExpertisePath("architecture", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "pattern",
			name: "Repository Pattern",
			description: "Use repository pattern for data access",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			files: ["src/repos/"],
		};

		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("pattern");
	});

	it("records a failure with description and resolution", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "failure",
			description: "Tests failed due to missing mocks",
			resolution: "Add mock setup in beforeEach",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("failure");
	});

	it("records a decision with title and rationale", async () => {
		const filePath = getExpertisePath("architecture", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "decision",
			title: "Use ESM over CJS",
			rationale: "Better tree-shaking and future compatibility",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		};

		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("decision");
	});

	it("convention record missing content fails schema validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const invalidRecord = {
			type: "convention",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			// missing "content" field
		};

		const valid = validate(invalidRecord);
		expect(valid).toBe(false);
	});

	it("pattern record missing name fails schema validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const invalidRecord = {
			type: "pattern",
			description: "Some description",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			// missing "name" field
		};

		const valid = validate(invalidRecord);
		expect(valid).toBe(false);
	});

	it("failure record missing resolution fails schema validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const invalidRecord = {
			type: "failure",
			description: "Something failed",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			// missing "resolution" field
		};

		const valid = validate(invalidRecord);
		expect(valid).toBe(false);
	});

	it("records a reference with name, description, and files", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "reference",
			name: "cli-entry",
			description: "Main CLI entry point",
			files: ["src/cli.ts"],
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		};

		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("reference");
		if (records[0]?.type === "reference") {
			expect(records[0]?.name).toBe("cli-entry");
			expect(records[0]?.description).toBe("Main CLI entry point");
			expect(records[0]?.files).toEqual(["src/cli.ts"]);
		}
	});

	it("records a guide with name and description", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "guide",
			name: "add-command",
			description: "How to add a new CLI command",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("guide");
		if (records[0]?.type === "guide") {
			expect(records[0]?.name).toBe("add-command");
			expect(records[0]?.description).toBe("How to add a new CLI command");
		}
	});

	it("reference record missing name fails schema validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const invalidRecord = {
			type: "reference",
			description: "Some description",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		const valid = validate(invalidRecord);
		expect(valid).toBe(false);
	});

	it("guide record missing name fails schema validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const invalidRecord = {
			type: "guide",
			description: "Some description",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		const valid = validate(invalidRecord);
		expect(valid).toBe(false);
	});

	it("reference record validates successfully with all fields", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "reference",
			name: "config-file",
			description: "YAML config at .mulch/mulch.config.yaml",
			files: ["src/utils/config.ts"],
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		};

		expect(validate(record)).toBe(true);
	});

	it("guide record validates successfully with all fields", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "guide",
			name: "add-domain",
			description: "Run mulch add <name> to create a new domain",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		expect(validate(record)).toBe(true);
	});

	it("record with tags validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "tagged-pattern",
			description: "A pattern with tags",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			tags: ["esm", "typescript"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record without tags still validates (backward compat)", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "No tags here",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		expect(validate(record)).toBe(true);
	});

	it("record with tags is stored and read back correctly", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "pattern",
			name: "tagged-pattern",
			description: "A pattern with tags",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			tags: ["async", "performance"],
		};
		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.tags).toEqual(["async", "performance"]);
	});

	it("tags with all record types validate", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);
		const tags = ["tag1", "tag2"];
		const base = {
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			tags,
		};

		expect(validate({ type: "convention", content: "test", ...base })).toBe(true);
		expect(validate({ type: "pattern", name: "p", description: "d", ...base })).toBe(true);
		expect(validate({ type: "failure", description: "d", resolution: "r", ...base })).toBe(true);
		expect(validate({ type: "decision", title: "t", rationale: "r", ...base })).toBe(true);
		expect(validate({ type: "reference", name: "r", description: "d", ...base })).toBe(true);
		expect(validate({ type: "guide", name: "g", description: "d", ...base })).toBe(true);
	});

	it("record with relates_to validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "failure",
			description: "Import error with ESM",
			resolution: "Use .js extension",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["mx-abc123"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with supersedes validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Use Ajv default import pattern",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			supersedes: ["mx-def456"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with both relates_to and supersedes validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "esm-import",
			description: "ESM import pattern for Ajv",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			relates_to: ["mx-aaa111"],
			supersedes: ["mx-bbb222"],
		};

		expect(validate(record)).toBe(true);
	});

	it("relates_to with invalid ID format fails validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["not-a-valid-id"],
		};

		expect(validate(record)).toBe(false);
	});

	it("links with all record types validate", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);
		const links = { relates_to: ["mx-abc123"], supersedes: ["mx-def456"] };
		const base = {
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			...links,
		};

		expect(validate({ type: "convention", content: "test", ...base })).toBe(true);
		expect(validate({ type: "pattern", name: "p", description: "d", ...base })).toBe(true);
		expect(validate({ type: "failure", description: "d", resolution: "r", ...base })).toBe(true);
		expect(validate({ type: "decision", title: "t", rationale: "r", ...base })).toBe(true);
		expect(validate({ type: "reference", name: "r", description: "d", ...base })).toBe(true);
		expect(validate({ type: "guide", name: "g", description: "d", ...base })).toBe(true);
	});

	it("record with links is stored and read back correctly", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "failure",
			description: "ESM import broke",
			resolution: "Use default import workaround",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["mx-abc123"],
			supersedes: ["mx-def456"],
		};
		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.relates_to).toEqual(["mx-abc123"]);
		expect(records[0]?.supersedes).toEqual(["mx-def456"]);
	});

	it("record without links still validates (backward compat)", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "No links here",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		expect(validate(record)).toBe(true);
	});

	it("record with cross-domain relates_to reference validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "cross-domain-pattern",
			description: "Pattern referencing another domain",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["cli:mx-abc123"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with cross-domain supersedes reference validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "New convention",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			supersedes: ["architecture:mx-def456"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with mixed local and cross-domain references validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "failure",
			description: "Bug with dependencies",
			resolution: "Updated both modules",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["mx-1a2b3c4d", "testing:mx-abc456", "cli:mx-def789"],
			supersedes: ["mx-0a1b2c3d"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with cross-domain reference is stored and read back correctly", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "pattern",
			name: "cross-ref-pattern",
			description: "Pattern with cross-domain link",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["cli:mx-abc123", "mx-1a2b3c4d"],
			supersedes: ["architecture:mx-def789"],
		};
		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.relates_to).toEqual(["cli:mx-abc123", "mx-1a2b3c4d"]);
		expect(records[0]?.supersedes).toEqual(["architecture:mx-def789"]);
	});

	it("cross-domain reference with invalid format fails validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["INVALID:mx-123"],
		};

		expect(validate(record)).toBe(false);
	});

	it("cross-domain reference with missing hash fails validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["cli:"],
		};

		expect(validate(record)).toBe(false);
	});

	it("cross-domain reference with numeric domain validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: ["api-v2:mx-abc123"],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with evidence.bead validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "test-pattern",
			description: "Pattern with bead evidence",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			evidence: {
				bead: "seeds-abc123",
			},
		};

		expect(validate(record)).toBe(true);
	});

	it("record with evidence.bead is stored and read back correctly", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "failure",
			description: "Bug found in feature X",
			resolution: "Fixed by updating logic",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			evidence: {
				bead: "seeds-xyz789",
			},
		};
		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.evidence?.bead).toBe("seeds-xyz789");
	});

	it("record with evidence.bead and other evidence fields validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Multi-evidence test",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: {
				commit: "abc123def",
				issue: "#42",
				file: "src/test.ts",
				bead: "seeds-999",
			},
		};

		expect(validate(record)).toBe(true);
	});

	it("record with only evidence.bead (no other evidence fields) validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "decision",
			title: "Use new approach",
			rationale: "Better performance",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			evidence: {
				bead: "seeds-solo",
			},
		};

		expect(validate(record)).toBe(true);
	});

	it("record without evidence.bead still validates (backward compat)", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "old-pattern",
			description: "Pattern without bead",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			evidence: {
				commit: "abc123",
				file: "src/old.ts",
			},
		};

		expect(validate(record)).toBe(true);
	});

	it("record with outcomes[0].status=success validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Use outcome metadata",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [{ status: "success" }],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with outcomes[0].status=failure validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "failure",
			description: "Build failed",
			resolution: "Fix the error",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [{ status: "failure" }],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with outcomes[0].status=partial validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Partial outcome",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [{ status: "partial" }],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with full outcomes array validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "test-runner",
			description: "How to run tests",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			outcomes: [
				{
					status: "success",
					duration: 1500,
					test_results: "42 passed, 0 failed",
					agent: "test-agent",
				},
			],
		};

		expect(validate(record)).toBe(true);
	});

	it("record with multiple outcomes validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [{ status: "failure" }, { status: "success" }],
		};

		expect(validate(record)).toBe(true);
	});

	it("outcomes item with invalid status fails validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [{ status: "unknown" }],
		};

		expect(validate(record)).toBe(false);
	});

	it("outcomes item without status fails validation", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Test",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [{ duration: 100 }],
		};

		expect(validate(record)).toBe(false);
	});

	it("record without outcomes still validates (backward compat)", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "No outcomes here",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		};

		expect(validate(record)).toBe(true);
	});

	it("outcomes with all record types validates", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);
		const outcomes = [{ status: "success", duration: 100 }];
		const base = {
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes,
		};

		expect(validate({ type: "convention", content: "test", ...base })).toBe(true);
		expect(validate({ type: "pattern", name: "p", description: "d", ...base })).toBe(true);
		expect(validate({ type: "failure", description: "d", resolution: "r", ...base })).toBe(true);
		expect(validate({ type: "decision", title: "t", rationale: "r", ...base })).toBe(true);
		expect(validate({ type: "reference", name: "r", description: "d", ...base })).toBe(true);
		expect(validate({ type: "guide", name: "g", description: "d", ...base })).toBe(true);
	});

	it("record with outcomes is stored and read back correctly", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "pattern",
			name: "outcome-pattern",
			description: "Pattern with outcome metadata",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [
				{
					status: "success",
					duration: 2500,
					test_results: "10 passed",
					agent: "my-agent",
				},
			],
		};
		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.outcomes?.[0]?.status).toBe("success");
		expect(records[0]?.outcomes?.[0]?.duration).toBe(2500);
		expect(records[0]?.outcomes?.[0]?.test_results).toBe("10 passed");
		expect(records[0]?.outcomes?.[0]?.agent).toBe("my-agent");
	});
});

describe("processStdinRecords", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-stdin-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("processes single JSON object from stdin", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("convention");
		expect(records[0]).toMatchObject({ content: "Use vitest" });
	});

	it("processes array of JSON objects from stdin", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const records = [
			{
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
			},
			{
				type: "pattern",
				name: "test-pattern",
				description: "Test pattern description",
				classification: "tactical",
			},
		];

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(records),
			tmpDir,
		);

		expect(result.created).toBe(2);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		const savedRecords = await readExpertiseFile(filePath);
		expect(savedRecords).toHaveLength(2);
	});

	it("validates records and reports errors", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const records = [
			{
				type: "convention",
				// missing content field
				classification: "tactical",
			},
			{
				type: "pattern",
				name: "valid-pattern",
				description: "Valid pattern",
				classification: "tactical",
			},
		];

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(records),
			tmpDir,
		);

		expect(result.created).toBe(1); // Only valid record created
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("Record 0");

		const savedRecords = await readExpertiseFile(filePath);
		expect(savedRecords).toHaveLength(1);
		expect(savedRecords[0]?.type).toBe("pattern");
	});

	it("deduplicates records (skips exact matches)", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		// Add initial record
		await appendRecord(filePath, record as ExpertiseRecord);

		// Try to add same record via stdin
		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.created).toBe(0);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(1);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1); // Still just one
	});

	it("upserts named records (pattern, decision, reference, guide)", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const originalPattern = {
			type: "pattern",
			name: "test-pattern",
			description: "Original description",
			classification: "tactical",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		await appendRecord(filePath, originalPattern as ExpertiseRecord);

		// Update with same name
		const updatedPattern = {
			type: "pattern",
			name: "test-pattern",
			description: "Updated description",
			classification: "foundational",
			recorded_at: "2025-01-02T00:00:00.000Z",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(updatedPattern),
			tmpDir,
		);

		expect(result.created).toBe(0);
		expect(result.updated).toBe(1);
		expect(result.skipped).toBe(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ description: "Updated description" });
		expect(records[0]?.classification).toBe("foundational");
	});

	it("adds recorded_at if missing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			// no recorded_at
		};

		const before = new Date();
		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);
		const after = new Date();

		expect(result.created).toBe(1);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		const r0 = records[0];
		if (!r0) throw new Error("Expected record");
		const recordedAt = new Date(r0.recorded_at);
		expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
		expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime());
	});

	it("defaults classification to tactical if missing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			// no classification
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.classification).toBe("tactical");
	});

	it("auto-creates domain when domain not found", async () => {
		const record = {
			type: "convention",
			content: "Test",
			classification: "tactical",
		};

		const result = await processStdinRecords(
			"newdomain",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(0);

		const filePath = getExpertisePath("newdomain", tmpDir);
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);

		const config = await import("../../src/utils/config.ts").then((m) => m.readConfig(tmpDir));
		expect(config.domains).toHaveProperty("newdomain");
	});

	it("throws error for invalid JSON", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await expect(
			processStdinRecords("testing", false, false, false, "{ invalid json }", tmpDir),
		).rejects.toThrow("Failed to parse JSON from stdin");
	});

	it("forces duplicate creation with force flag", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		await appendRecord(filePath, record as ExpertiseRecord);

		const result = await processStdinRecords(
			"testing",
			false,
			true,
			false,
			JSON.stringify(record),
			tmpDir,
		); // force=true

		expect(result.created).toBe(1);
		expect(result.skipped).toBe(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(2);
	});

	it("dry-run shows what would be created without writing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			true,
			JSON.stringify(record),
			tmpDir,
		); // dryRun=true

		expect(result.created).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		// Verify nothing was actually written
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(0);
	});

	it("dry-run shows what would be updated without writing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const originalPattern = {
			type: "pattern",
			name: "test-pattern",
			description: "Original description",
			classification: "tactical",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		await appendRecord(filePath, originalPattern as ExpertiseRecord);

		const updatedPattern = {
			type: "pattern",
			name: "test-pattern",
			description: "Updated description",
			classification: "foundational",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			true,
			JSON.stringify(updatedPattern),
			tmpDir,
		); // dryRun=true

		expect(result.created).toBe(0);
		expect(result.updated).toBe(1);
		expect(result.skipped).toBe(0);

		// Verify original record was not modified
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ description: "Original description" });
	});

	it("dry-run shows what would be skipped without writing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		await appendRecord(filePath, record as ExpertiseRecord);

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			true,
			JSON.stringify(record),
			tmpDir,
		); // dryRun=true

		expect(result.created).toBe(0);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(1);

		// Verify original record was not duplicated
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
	});

	it("dry-run processes multiple records without writing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const records = [
			{
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
			},
			{
				type: "pattern",
				name: "test-pattern",
				description: "Test pattern",
				classification: "tactical",
			},
		];

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			true,
			JSON.stringify(records),
			tmpDir,
		); // dryRun=true

		expect(result.created).toBe(2);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);

		// Verify nothing was written
		const savedRecords = await readExpertiseFile(filePath);
		expect(savedRecords).toHaveLength(0);
	});
});

describe("record command help text", () => {
	it("--help displays required fields per record type", () => {
		const helpOutput = execSync("bun src/cli.ts record --help", {
			encoding: "utf-8",
			timeout: 5000,
		});

		// Verify the help text section exists
		expect(helpOutput).toContain("Required fields per record type:");

		// Verify each record type is listed with its required fields
		expect(helpOutput).toContain("convention");
		expect(helpOutput).toContain("[content] or --description");

		expect(helpOutput).toContain("pattern");
		expect(helpOutput).toContain("--name, --description");

		expect(helpOutput).toContain("failure");
		expect(helpOutput).toContain("--resolution");

		expect(helpOutput).toContain("decision");
		expect(helpOutput).toContain("--title, --rationale");

		expect(helpOutput).toContain("reference");
		expect(helpOutput).toContain("guide");
	});

	it("--help displays batch recording examples", () => {
		const helpOutput = execSync("bun src/cli.ts record --help", {
			encoding: "utf-8",
			timeout: 5000,
		});

		expect(helpOutput).toContain("Batch recording examples:");
		expect(helpOutput).toContain("--batch records.json");
		expect(helpOutput).toContain("--batch records.json --dry-run");
	});
});

describe("batch mode (--batch)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-batch-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("processes single JSON object from batch file", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest for testing",
			classification: "foundational",
		};

		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(record));

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("convention");
		expect(records[0]).toMatchObject({ content: "Use vitest for testing" });
	});

	it("processes array of JSON objects from batch file", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const records = [
			{
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
			},
			{
				type: "pattern",
				name: "test-pattern",
				description: "Test pattern description",
				classification: "tactical",
			},
		];

		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(records));

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		);

		expect(result.created).toBe(2);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		const savedRecords = await readExpertiseFile(filePath);
		expect(savedRecords).toHaveLength(2);
	});

	it("batch mode with --dry-run shows what would be created without writing", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
		};

		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(record));

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			true,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.errors).toHaveLength(0);

		// Verify nothing was actually written
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(0);
	});

	it("batch mode deduplicates records (skips exact matches)", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		// Add initial record
		await appendRecord(filePath, record as ExpertiseRecord);

		// Try to add same record via batch file
		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(record));

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		);

		expect(result.created).toBe(0);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(1);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1); // Still just one
	});

	it("batch mode upserts named records (pattern, decision, reference, guide)", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const originalPattern = {
			type: "pattern",
			name: "test-pattern",
			description: "Original description",
			classification: "tactical",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		await appendRecord(filePath, originalPattern as ExpertiseRecord);

		// Update with same name
		const updatedPattern = {
			type: "pattern",
			name: "test-pattern",
			description: "Updated description",
			classification: "foundational",
			recorded_at: "2025-01-02T00:00:00.000Z",
		};

		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(updatedPattern));

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		);

		expect(result.created).toBe(0);
		expect(result.updated).toBe(1);
		expect(result.skipped).toBe(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ description: "Updated description" });
		expect(records[0]?.classification).toBe("foundational");
	});

	it("batch mode validates records and reports errors", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const records = [
			{
				type: "convention",
				// missing content field
				classification: "tactical",
			},
			{
				type: "pattern",
				name: "valid-pattern",
				description: "Valid pattern",
				classification: "tactical",
			},
		];

		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(records));

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		);

		expect(result.created).toBe(1); // Only valid record created
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("Record 0");

		const savedRecords = await readExpertiseFile(filePath);
		expect(savedRecords).toHaveLength(1);
		expect(savedRecords[0]?.type).toBe("pattern");
	});

	it("batch mode forces duplicate creation with force flag", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: "2025-01-01T00:00:00.000Z",
		};

		await appendRecord(filePath, record as ExpertiseRecord);

		const batchFile = join(tmpDir, "batch.json");
		await writeFile(batchFile, JSON.stringify(record));

		const result = await processStdinRecords(
			"testing",
			false,
			true,
			false,
			await readFile(batchFile, "utf-8"),
			tmpDir,
		); // force=true

		expect(result.created).toBe(1);
		expect(result.skipped).toBe(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(2);
	});
});

describe("validation hints", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-record-hints-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("pattern record missing name includes type hint in error", async () => {
		const record = {
			type: "pattern",
			description: "some description",
			classification: "tactical",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("pattern records require: name, description");
	});

	it("failure record missing resolution includes type hint in error", async () => {
		const record = {
			type: "failure",
			description: "something went wrong",
			classification: "tactical",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("failure records require: description, resolution");
	});

	it("record with no type field does not include Hint in error", async () => {
		const record = {
			classification: "tactical",
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).not.toContain("Hint:");
	});
});

describe("auto-create domain in CLI mode", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-record-autocreate-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: {} }, tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("auto-creates domain and writes record via processStdinRecords", async () => {
		const record = {
			type: "convention",
			content: "Use tabs for indentation",
			classification: "foundational",
		};

		const result = await processStdinRecords(
			"newdomain",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(0);

		const filePath = getExpertisePath("newdomain", tmpDir);
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.type).toBe("convention");
	});

	it("auto-created domain appears in config", async () => {
		const record = {
			type: "convention",
			content: "Some convention",
			classification: "tactical",
		};

		await processStdinRecords("autodomain", false, false, false, JSON.stringify(record), tmpDir);

		const { readConfig } = await import("../../src/utils/config.ts");
		const config = await readConfig(tmpDir);
		expect(config.domains).toHaveProperty("autodomain");
	});

	it("recording to existing domain still works", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { existing: {} } }, tmpDir);
		const filePath = getExpertisePath("existing", tmpDir);
		await createExpertiseFile(filePath);

		const record = {
			type: "convention",
			content: "Existing domain record",
			classification: "tactical",
		};

		const result = await processStdinRecords(
			"existing",
			false,
			false,
			false,
			JSON.stringify(record),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(0);
	});

	it("upsert merges outcomes from existing named record", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const original = {
			type: "pattern",
			name: "merge-outcomes-pattern",
			description: "Pattern description",
			classification: "tactical",
			recorded_at: "2025-01-01T00:00:00.000Z",
			outcomes: [{ status: "failure", agent: "session-1" }],
		};
		await appendRecord(filePath, original as ExpertiseRecord);

		const updated = {
			type: "pattern",
			name: "merge-outcomes-pattern",
			description: "Pattern description updated",
			classification: "foundational",
			recorded_at: "2025-01-02T00:00:00.000Z",
			outcomes: [{ status: "success", agent: "session-2" }],
		};

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify(updated),
			tmpDir,
		);

		expect(result.updated).toBe(1);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]?.outcomes).toHaveLength(2);
		expect(records[0]?.outcomes?.[0]?.agent).toBe("session-1");
		expect(records[0]?.outcomes?.[1]?.agent).toBe("session-2");
	});
});

describe("evidence schema: multi-tracker fields", () => {
	it("evidence.seeds validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "seeds-linked",
			description: "Pattern with seeds evidence",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			evidence: { seeds: "mulch-123a" },
		};

		expect(validate(record)).toBe(true);
	});

	it("evidence.gh validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "convention",
			content: "Convention linked to GitHub PR",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: { gh: "org/repo#42" },
		};

		expect(validate(record)).toBe(true);
	});

	it("evidence.linear validates against schema", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "decision",
			title: "Use Linear for tracking",
			rationale: "Better UX than Jira",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: { linear: "ENG-123" },
		};

		expect(validate(record)).toBe(true);
	});

	it("all multi-tracker evidence fields together validate", () => {
		const ajv = new Ajv();
		const validate = ajv.compile(recordSchema);

		const record = {
			type: "pattern",
			name: "multi-tracker",
			description: "Pattern with all tracker evidence",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			evidence: {
				commit: "abc123def",
				bead: "bd-001",
				seeds: "mulch-abc",
				gh: "org/repo#99",
				linear: "ENG-456",
			},
		};

		expect(validate(record)).toBe(true);
	});

	it("evidence.seeds is stored and read back correctly", async () => {
		const tmpDir2 = await mkdtemp(join(tmpdir(), "mulch-ev-test-"));
		try {
			await initMulchDir(tmpDir2);
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir2);
			const filePath = getExpertisePath("testing", tmpDir2);
			await createExpertiseFile(filePath);

			const record: ExpertiseRecord = {
				type: "pattern",
				name: "seeds-evidence",
				description: "Pattern with seeds tracker evidence",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
				evidence: { seeds: "mulch-xyz", gh: "org/repo#10" },
			};
			await appendRecord(filePath, record);

			const records = await readExpertiseFile(filePath);
			expect(records).toHaveLength(1);
			expect(records[0]?.evidence?.seeds).toBe("mulch-xyz");
			expect(records[0]?.evidence?.gh).toBe("org/repo#10");
		} finally {
			await rm(tmpDir2, { recursive: true, force: true });
		}
	});
});

describe("disabled-type writes (Phase 3)", () => {
	const cliPath = resolve(process.cwd(), "src/cli.ts");
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-disabled-write-"));
		await initMulchDir(tmpDir);
		await writeConfig(
			{ ...DEFAULT_CONFIG, domains: { cli: {} }, disabled_types: ["failure"] },
			tmpDir,
		);
		await initRegistryFromConfig(tmpDir);
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("processStdinRecords emits one warning per disabled type seen", async () => {
		const filePath = getExpertisePath("cli", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"cli",
			false,
			false,
			false,
			JSON.stringify([
				{
					type: "failure",
					description: "d1",
					resolution: "r1",
					classification: "tactical",
				},
				{
					type: "failure",
					description: "d2",
					resolution: "r2",
					classification: "tactical",
				},
				{
					type: "convention",
					content: "ok",
					classification: "tactical",
				},
			]),
			tmpDir,
		);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/type "failure" is disabled/);
		expect(result.created).toBe(3);
	});

	it("CLI write of a disabled type emits stderr warning", () => {
		const r = spawnSync(
			"bun",
			[cliPath, "record", "cli", "--type", "failure", "--description", "d", "--resolution", "x"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stderr).toMatch(/Warning: type "failure" is disabled/);
		expect(r.stdout).toMatch(/Recorded failure/);
	});

	it("--quiet suppresses the disabled-type warning but still writes", () => {
		const r = spawnSync(
			"bun",
			[
				cliPath,
				"record",
				"cli",
				"--type",
				"failure",
				"--description",
				"d2",
				"--resolution",
				"x",
				"-q",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		expect(r.stderr).not.toMatch(/Warning/);
	});

	it("JSON mode includes warnings array on disabled-type write", () => {
		const r = spawnSync(
			"bun",
			[
				cliPath,
				"record",
				"cli",
				"--type",
				"failure",
				"--description",
				"d3",
				"--resolution",
				"x",
				"--json",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.success).toBe(true);
		expect(out.warnings).toBeDefined();
		expect(out.warnings[0]).toMatch(/type "failure" is disabled/);
	});
});

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
		expect(r.stderr).toMatch(/task records require: description/);
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

describe("dir_anchors (R-01)", () => {
	const cliPath = resolve(process.cwd(), "src/cli.ts");
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-dir-anchors-"));
		// Real git repo so getContextFiles() can run; auto-population tests
		// stage files into it to drive the heuristic.
		execSync("git init -q", { cwd: tmpDir });
		execSync("git config user.email t@t && git config user.name t", { cwd: tmpDir });
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
		await createExpertiseFile(getExpertisePath("cli", tmpDir));
	});

	afterEach(async () => {
		resetRegistry();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("--dir-anchor flag round-trips through write/read (sorted, deduped)", async () => {
		const r = spawnSync(
			"bun",
			[
				cliPath,
				"record",
				"cli",
				"--type",
				"pattern",
				"--name",
				"shared-dir",
				"--description",
				"applies to src/utils/",
				"--dir-anchor",
				"src/utils",
				"--dir-anchor",
				"src/commands/",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		const records = await readExpertiseFile(getExpertisePath("cli", tmpDir));
		expect(records).toHaveLength(1);
		// Trailing slashes normalized away; sorted; deduped.
		expect(records[0]?.dir_anchors).toEqual(["src/commands", "src/utils"]);
	});

	it("normalizes 'src/foo/' to 'src/foo' on write", async () => {
		const r = spawnSync(
			"bun",
			[
				cliPath,
				"record",
				"cli",
				"--type",
				"convention",
				"normalize test",
				"--dir-anchor",
				"src/foo/",
			],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		const records = await readExpertiseFile(getExpertisePath("cli", tmpDir));
		expect(records[0]?.dir_anchors).toEqual(["src/foo"]);
	});

	it("auto-populates dir_anchors from common parent of 3+ changed files", async () => {
		execSync("mkdir -p src/utils", { cwd: tmpDir });
		await writeFile(join(tmpDir, "src/utils/a.ts"), "// a", "utf-8");
		await writeFile(join(tmpDir, "src/utils/b.ts"), "// b", "utf-8");
		await writeFile(join(tmpDir, "src/utils/c.ts"), "// c", "utf-8");
		execSync("git add src/utils", { cwd: tmpDir });

		const r = spawnSync(
			"bun",
			[cliPath, "record", "cli", "--type", "convention", "auto-pop test"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		const records = await readExpertiseFile(getExpertisePath("cli", tmpDir));
		expect(records[0]?.dir_anchors).toEqual(["src/utils"]);
	});

	it("does NOT auto-populate when only 2 files share a parent dir", async () => {
		execSync("mkdir -p src/utils", { cwd: tmpDir });
		await writeFile(join(tmpDir, "src/utils/a.ts"), "// a", "utf-8");
		await writeFile(join(tmpDir, "src/utils/b.ts"), "// b", "utf-8");
		execSync("git add src/utils", { cwd: tmpDir });

		const r = spawnSync("bun", [cliPath, "record", "cli", "--type", "convention", "no auto-pop"], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 8000,
		});
		expect(r.status).toBe(0);
		const records = await readExpertiseFile(getExpertisePath("cli", tmpDir));
		expect(records[0]?.dir_anchors).toBeUndefined();
	});

	it("explicit --dir-anchor wins over auto-population", async () => {
		execSync("mkdir -p src/utils", { cwd: tmpDir });
		await writeFile(join(tmpDir, "src/utils/a.ts"), "// a", "utf-8");
		await writeFile(join(tmpDir, "src/utils/b.ts"), "// b", "utf-8");
		await writeFile(join(tmpDir, "src/utils/c.ts"), "// c", "utf-8");
		execSync("git add src/utils", { cwd: tmpDir });

		const r = spawnSync(
			"bun",
			[cliPath, "record", "cli", "--type", "convention", "explicit wins", "--dir-anchor", "docs"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		const records = await readExpertiseFile(getExpertisePath("cli", tmpDir));
		expect(records[0]?.dir_anchors).toEqual(["docs"]);
	});

	it("validates dir_anchors via stdin JSON path", async () => {
		const result = await processStdinRecords(
			"cli",
			false,
			false,
			false,
			JSON.stringify({
				type: "pattern",
				name: "stdin dir-anchor",
				description: "test",
				dir_anchors: ["src/foo", "src/bar"],
				classification: "tactical",
			}),
			tmpDir,
		);
		expect(result.errors).toEqual([]);
		expect(result.created).toBe(1);
		const records = await readExpertiseFile(getExpertisePath("cli", tmpDir));
		expect(records[0]?.dir_anchors).toEqual(["src/foo", "src/bar"]);
	});

	it("schema rejects non-array dir_anchors", () => {
		const ajv = new Ajv({ allErrors: true });
		const validate = ajv.compile(recordSchema);
		const ok = validate({
			type: "convention",
			content: "x",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			dir_anchors: "not-an-array",
		});
		expect(ok).toBe(false);
	});
});
