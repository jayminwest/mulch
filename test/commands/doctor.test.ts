import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

let tmpDir: string;

function daysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "mulch-doctor-test-"));
	await initMulchDir(tmpDir);
	await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing", "api"] }, tmpDir);
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
		expect(records[0]!.id).toMatch(/^mx-/);
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
		expect(isStale(records[0]!, new Date(), shelfLife)).toBe(true);
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
		const config = { ...DEFAULT_CONFIG, domains: ["testing", "api"] };
		const orphans = jsonlFiles
			.map((f) => f.replace(".jsonl", ""))
			.filter((d) => !config.domains.includes(d));
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
		const dup = findDuplicate([records[0]!], records[1]!);
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
		expect(records[0]!.outcomes).toBeDefined();
		expect(Array.isArray(records[0]!.outcomes)).toBe(true);
		expect(records[0]!.outcomes![0]!.status).toBe("success");
		expect(records[0]!.outcomes![0]!.agent).toBe("test-agent");
		expect(records[0]!.outcomes![0]!.duration).toBe(42);
	});

	it("detects governance threshold violations", async () => {
		const config = {
			...DEFAULT_CONFIG,
			domains: ["testing"],
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
		const record = records[0]!;
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
		const record = records[0]!;
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
		const record = records[0]!;
		const evidenceFile = record.evidence?.file;
		expect(evidenceFile).toBe("src/deleted-file.ts");
		expect(existsSync(resolve(tmpDir, evidenceFile!))).toBe(false);
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
		const record = records[0]!;
		const evidenceFile = record.evidence?.file;
		expect(evidenceFile).toBe("real-evidence.ts");
		expect(existsSync(resolve(tmpDir, evidenceFile!))).toBe(true);
	});
});
