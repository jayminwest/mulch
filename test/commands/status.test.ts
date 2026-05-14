import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
	getExpertisePath,
	getMulchDir,
	initMulchDir,
	readConfig,
	writeConfig,
} from "../../src/utils/config.ts";
import {
	appendRecord,
	calculateDomainHealth,
	countRecords,
	createExpertiseFile,
	getFileModTime,
	readExpertiseFile,
} from "../../src/utils/expertise.ts";
import { formatStatusOutput } from "../../src/utils/format.ts";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");

function runCli(args: string[], cwd: string) {
	return Bun.spawnSync(["bun", CLI_PATH, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
}

function daysAgoIso(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

describe("status command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-status-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("detects .mulch/ directory exists", () => {
		expect(existsSync(getMulchDir(tmpDir))).toBe(true);
	});

	it("detects missing .mulch/ directory", async () => {
		const emptyDir = await mkdtemp(join(tmpdir(), "mulch-status-empty-"));
		expect(existsSync(getMulchDir(emptyDir))).toBe(false);
		await rm(emptyDir, { recursive: true, force: true });
	});

	it("shows status with no domains configured", () => {
		const output = formatStatusOutput([], DEFAULT_CONFIG.governance);
		expect(output).toContain("Mulch Status");
		expect(output).toContain("No domains configured");
	});

	it("shows status with a domain and entries", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const record: ExpertiseRecord = {
			type: "convention",
			content: "Always test",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		};
		await appendRecord(filePath, record);

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const count = countRecords(records);

		const output = formatStatusOutput(
			[{ domain: "testing", count, lastUpdated }],
			DEFAULT_CONFIG.governance,
		);

		expect(output).toContain("Mulch Status");
		expect(output).toContain("testing");
		expect(output).toContain("1 records");
	});

	it("shows multiple domains in status", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

		const testingPath = getExpertisePath("testing", tmpDir);
		const archPath = getExpertisePath("architecture", tmpDir);
		await createExpertiseFile(testingPath);
		await createExpertiseFile(archPath);

		await appendRecord(testingPath, {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(archPath, {
			type: "decision",
			title: "Use ESM",
			rationale: "Better tree-shaking",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(archPath, {
			type: "pattern",
			name: "Service Layer",
			description: "Business logic isolation",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const config = await readConfig(tmpDir);
		const domainStats = await Promise.all(
			Object.keys(config.domains).map(async (domain) => {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				return { domain, count: countRecords(records), lastUpdated };
			}),
		);

		const output = formatStatusOutput(domainStats, config.governance);
		expect(output).toContain("testing");
		expect(output).toContain("1 records");
		expect(output).toContain("architecture");
		expect(output).toContain("2 records");
	});

	it("shows warning when entries reach max_entries threshold", () => {
		const output = formatStatusOutput(
			[{ domain: "testing", count: 100, lastUpdated: new Date() }],
			DEFAULT_CONFIG.governance,
		);
		expect(output).toContain("approaching limit");
	});

	it("shows warning when entries reach warn_entries threshold", () => {
		const output = formatStatusOutput(
			[{ domain: "testing", count: 150, lastUpdated: new Date() }],
			DEFAULT_CONFIG.governance,
		);
		expect(output).toContain("consider splitting domain");
	});

	it("shows hard limit warning", () => {
		const output = formatStatusOutput(
			[{ domain: "testing", count: 200, lastUpdated: new Date() }],
			DEFAULT_CONFIG.governance,
		);
		expect(output).toContain("OVER HARD LIMIT");
	});

	it("countRecords returns correct count", () => {
		const records: ExpertiseRecord[] = [
			{
				type: "convention",
				content: "Test 1",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			},
			{
				type: "convention",
				content: "Test 2",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			},
		];
		expect(countRecords(records)).toBe(2);
	});

	it("countRecords returns zero for empty array", () => {
		expect(countRecords([])).toBe(0);
	});

	it("calculateDomainHealth returns correct metrics for empty domain", () => {
		const health = calculateDomainHealth([], 100, {
			tactical: 14,
			observational: 30,
		});
		expect(health.governance_utilization).toBe(0);
		expect(health.stale_count).toBe(0);
		expect(health.type_distribution).toEqual({
			convention: 0,
			pattern: 0,
			failure: 0,
			decision: 0,
			reference: 0,
			guide: 0,
		});
		expect(health.classification_distribution).toEqual({
			foundational: 0,
			tactical: 0,
			observational: 0,
		});
		expect(health.oldest_timestamp).toBeNull();
		expect(health.newest_timestamp).toBeNull();
	});

	it("calculateDomainHealth returns correct metrics with mixed records", () => {
		const now = new Date();
		const oldDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
		const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

		const records: ExpertiseRecord[] = [
			{
				type: "convention",
				content: "Always test",
				classification: "foundational",
				recorded_at: oldDate.toISOString(),
			},
			{
				type: "pattern",
				name: "Service Layer",
				description: "Business logic isolation",
				classification: "tactical",
				recorded_at: oldDate.toISOString(), // Stale (20 days > 14 days)
			},
			{
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "observational",
				recorded_at: recentDate.toISOString(), // Not stale
			},
			{
				type: "failure",
				description: "Bug in parser",
				resolution: "Fixed regex",
				classification: "tactical",
				recorded_at: recentDate.toISOString(), // Not stale
			},
			{
				type: "reference",
				name: "API Docs",
				description: "Link to API documentation",
				classification: "foundational",
				recorded_at: now.toISOString(),
			},
			{
				type: "guide",
				name: "Setup Guide",
				description: "How to set up the project",
				classification: "foundational",
				recorded_at: now.toISOString(),
			},
		];

		const health = calculateDomainHealth(records, 100, {
			tactical: 14,
			observational: 30,
		});

		expect(health.governance_utilization).toBe(6); // 6/100 = 6%
		expect(health.stale_count).toBe(1); // Only the tactical record from 20 days ago
		expect(health.type_distribution).toEqual({
			convention: 1,
			pattern: 1,
			failure: 1,
			decision: 1,
			reference: 1,
			guide: 1,
		});
		expect(health.classification_distribution).toEqual({
			foundational: 3,
			tactical: 2,
			observational: 1,
		});
		expect(health.oldest_timestamp).toBe(oldDate.toISOString());
		expect(health.newest_timestamp).toBe(now.toISOString());
	});

	it("calculateDomainHealth calculates governance utilization correctly", () => {
		const records: ExpertiseRecord[] = Array.from({ length: 75 }, (_, i) => ({
			type: "convention",
			content: `Test ${i}`,
			classification: "foundational" as const,
			recorded_at: new Date().toISOString(),
		}));

		const health = calculateDomainHealth(records, 100, {
			tactical: 14,
			observational: 30,
		});
		expect(health.governance_utilization).toBe(75); // 75/100 = 75%
	});

	it("calculateDomainHealth identifies all stale tactical records", () => {
		const now = new Date();
		const staleDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
		const freshDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

		const records: ExpertiseRecord[] = [
			{
				type: "pattern",
				name: "Stale Pattern",
				description: "Old pattern",
				classification: "tactical",
				recorded_at: staleDate.toISOString(), // Stale
			},
			{
				type: "pattern",
				name: "Fresh Pattern",
				description: "New pattern",
				classification: "tactical",
				recorded_at: freshDate.toISOString(), // Not stale
			},
			{
				type: "convention",
				content: "Old but foundational",
				classification: "foundational",
				recorded_at: staleDate.toISOString(), // Never stale
			},
		];

		const health = calculateDomainHealth(records, 100, {
			tactical: 14,
			observational: 30,
		});
		expect(health.stale_count).toBe(1);
	});

	it("surfaces oldest→newest recorded range per domain", () => {
		const now = new Date();
		const old = new Date(now.getTime() - 90 * 86400000);
		const recent = new Date(now.getTime() - 2 * 86400000);
		const output = formatStatusOutput(
			[
				{
					domain: "testing",
					count: 5,
					lastUpdated: now,
					oldestRecorded: old,
					newestRecorded: recent,
					rotting: false,
				},
			],
			DEFAULT_CONFIG.governance,
		);
		expect(output).toContain("recorded 90d ago → 2d ago");
		expect(output).not.toContain("ROTTING");
	});

	it("flags rotting domains when newest record is older than observational shelf life", () => {
		const now = new Date();
		const old = new Date(now.getTime() - 100 * 86400000);
		const stale = new Date(now.getTime() - 45 * 86400000); // 45d > 30d observational
		const output = formatStatusOutput(
			[
				{
					domain: "legacy",
					count: 3,
					lastUpdated: stale,
					oldestRecorded: old,
					newestRecorded: stale,
					rotting: true,
					rottingDays: 45,
				},
			],
			DEFAULT_CONFIG.governance,
		);
		expect(output).toContain("ROTTING");
		expect(output).toContain("no writes in 45d");
	});

	it("collapses range to single timestamp when oldest equals newest", () => {
		const now = new Date();
		const only = new Date(now.getTime() - 3 * 86400000);
		const output = formatStatusOutput(
			[
				{
					domain: "solo",
					count: 1,
					lastUpdated: only,
					oldestRecorded: only,
					newestRecorded: only,
					rotting: false,
				},
			],
			DEFAULT_CONFIG.governance,
		);
		expect(output).toContain("recorded 3d ago");
		expect(output).not.toContain("→");
	});

	it("omits range when range fields are not provided (back-compat)", () => {
		const output = formatStatusOutput(
			[{ domain: "testing", count: 1, lastUpdated: new Date() }],
			DEFAULT_CONFIG.governance,
		);
		expect(output).not.toContain("recorded");
		expect(output).not.toContain("ROTTING");
	});

	it("does not flag empty domains as rotting", () => {
		const output = formatStatusOutput(
			[
				{
					domain: "empty",
					count: 0,
					lastUpdated: null,
					oldestRecorded: null,
					newestRecorded: null,
					rotting: false,
				},
			],
			DEFAULT_CONFIG.governance,
		);
		expect(output).not.toContain("ROTTING");
		expect(output).not.toContain("recorded");
	});

	it("ml status (CLI) flags a rotting domain and surfaces range", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { legacy: {} } }, tmpDir);
		const filePath = getExpertisePath("legacy", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "Old convention",
			classification: "foundational",
			recorded_at: daysAgoIso(90),
		});
		await appendRecord(filePath, {
			type: "convention",
			content: "Slightly newer convention",
			classification: "foundational",
			recorded_at: daysAgoIso(45),
		});

		const result = runCli(["status"], tmpDir);
		const out = result.stdout.toString();
		expect(out).toContain("legacy:");
		expect(out).toContain("recorded 90d ago → 45d ago");
		expect(out).toContain("ROTTING");
		expect(out).toContain("no writes in 45d");
	});

	it("ml status (CLI) does not flag fresh domains as rotting", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { fresh: {} } }, tmpDir);
		const filePath = getExpertisePath("fresh", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "Recent convention",
			classification: "foundational",
			recorded_at: daysAgoIso(5),
		});

		const result = runCli(["status"], tmpDir);
		const out = result.stdout.toString();
		expect(out).toContain("fresh:");
		expect(out).not.toContain("ROTTING");
	});

	it("ml status --json exposes oldest/newest/rotting per domain", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { mixed: {} } }, tmpDir);
		const filePath = getExpertisePath("mixed", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "Old",
			classification: "foundational",
			recorded_at: daysAgoIso(60),
		});
		await appendRecord(filePath, {
			type: "convention",
			content: "Newer",
			classification: "foundational",
			recorded_at: daysAgoIso(40),
		});

		const result = runCli(["--json", "status"], tmpDir);
		const parsed = JSON.parse(result.stdout.toString()) as {
			domains: Array<{
				domain: string;
				oldest_recorded: string | null;
				newest_recorded: string | null;
				rotting: boolean;
				rotting_days: number | null;
			}>;
			shelf_life: { observational: number };
		};
		expect(parsed.shelf_life.observational).toBe(30);
		const mixed = parsed.domains.find((d) => d.domain === "mixed");
		expect(mixed).toBeDefined();
		expect(mixed?.oldest_recorded).not.toBeNull();
		expect(mixed?.newest_recorded).not.toBeNull();
		expect(mixed?.rotting).toBe(true);
		expect(mixed?.rotting_days).toBeGreaterThanOrEqual(40);
	});

	it("calculateDomainHealth identifies all stale observational records", () => {
		const now = new Date();
		const staleDate = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
		const freshDate = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000); // 25 days ago

		const records: ExpertiseRecord[] = [
			{
				type: "decision",
				title: "Stale Decision",
				rationale: "Old decision",
				classification: "observational",
				recorded_at: staleDate.toISOString(), // Stale (35 days > 30 days)
			},
			{
				type: "decision",
				title: "Fresh Decision",
				rationale: "Recent decision",
				classification: "observational",
				recorded_at: freshDate.toISOString(), // Not stale (25 days <= 30 days)
			},
		];

		const health = calculateDomainHealth(records, 100, {
			tactical: 14,
			observational: 30,
		});
		expect(health.stale_count).toBe(1);
	});
});
