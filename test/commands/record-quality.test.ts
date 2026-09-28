// Write-time quality gate on `ml record` (mulch-a378): exact-duplicate
// hard block, near-duplicate detection, and quality.level warnings.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG, type QualityLevel } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, readExpertiseFile } from "../../src/utils/expertise.ts";

const cliPath = resolve(process.cwd(), "src/cli.ts");

const EXISTING =
	"Prefer withFileLock for every expertise write because concurrent agents otherwise race on the JSONL file";
const REWORDED =
	"Prefer withFileLock for each expertise write because concurrent agents race on the JSONL file otherwise";

describe("ml record quality gate", () => {
	let tmpDir: string;

	async function setup(level?: QualityLevel): Promise<void> {
		await writeConfig(
			{ ...DEFAULT_CONFIG, domains: { backend: {} }, ...(level ? { quality: { level } } : {}) },
			tmpDir,
		);
		await appendRecord(getExpertisePath("backend", tmpDir), {
			type: "convention",
			content: EXISTING,
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			dir_anchors: ["src/utils"],
		} as ExpertiseRecord);
	}

	function record(...args: string[]) {
		return spawnSync("bun", [cliPath, "record", "backend", ...args], {
			cwd: tmpDir,
			encoding: "utf-8",
			timeout: 8000,
		});
	}

	async function count(): Promise<number> {
		return (await readExpertiseFile(getExpertisePath("backend", tmpDir))).length;
	}

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-record-quality-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("hard-blocks a normalized exact duplicate even with --force", async () => {
		await setup();
		const variant = `  ${EXISTING.toUpperCase()}. `;
		for (const extra of [[], ["--force"]]) {
			const r = record(variant, "--type", "convention", ...extra);
			expect(r.status).toBe(1);
			expect(r.stderr).toMatch(/duplicate convention already exists in backend \(mx-[0-9a-f]+\)/);
			expect(r.stderr).toMatch(/ml outcome backend mx-/);
		}
		expect(await count()).toBe(1);
	});

	it("reports an exact duplicate as a JSON error", async () => {
		await setup();
		const r = spawnSync(
			"bun",
			[cliPath, "--json", "record", "backend", EXISTING, "--type", "convention"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(1);
		const out = JSON.parse(r.stderr) as { success: boolean; error: string };
		expect(out.success).toBe(false);
		expect(out.error).toMatch(/duplicate convention/);
	});

	it("blocks a near-duplicate and suggests --supersedes / --force", async () => {
		await setup();
		const r = record(REWORDED, "--type", "convention", "--dir-anchor", "src/utils");
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/similar record\(s\) already exist in backend/);
		expect(r.stderr).toMatch(/% similar, shares src\/utils/);
		expect(r.stderr).toMatch(/--supersedes mx-/);
		expect(r.stderr).toMatch(/--force/);
		expect(await count()).toBe(1);
	});

	it("records a near-duplicate that supersedes the match, or with --force", async () => {
		await setup();
		const [existing] = await readExpertiseFile(getExpertisePath("backend", tmpDir));
		const id = existing?.id ?? "";
		const r1 = record(REWORDED, "--type", "convention", "--supersedes", id);
		expect(r1.status).toBe(0);
		const r2 = record(`${REWORDED} too`, "--type", "convention", "--force");
		expect(r2.status).toBe(0);
		expect(await count()).toBe(3);
	});

	it("warns on quality issues by default but still writes", async () => {
		await setup();
		const r = record("cli.ts exports VERSION from package.json", "--type", "convention");
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Recorded convention/);
		expect(r.stderr).toMatch(/Warning: quality: convention has no file\/dir anchor or evidence/);
		expect(r.stderr).toMatch(/Warning: quality: convention reads like a restatement of code/);
		expect(await count()).toBe(2);
	});

	it("includes quality warnings in JSON output", async () => {
		await setup();
		const r = spawnSync(
			"bun",
			[cliPath, "--json", "record", "backend", "cli.ts exports VERSION", "--type", "convention"],
			{ cwd: tmpDir, encoding: "utf-8", timeout: 8000 },
		);
		expect(r.status).toBe(0);
		const out = JSON.parse(r.stdout) as { warnings?: string[] };
		expect(out.warnings?.some((w) => w.startsWith("quality:"))).toBe(true);
	});

	it("blocks quality issues when quality.level is error, unless --force", async () => {
		await setup("error");
		const r = record("cli.ts exports VERSION", "--type", "convention");
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/failed quality checks \(quality.level: error\)/);
		expect(await count()).toBe(1);
		const forced = record("cli.ts exports VERSION", "--type", "convention", "--force");
		expect(forced.status).toBe(0);
		expect(await count()).toBe(2);
	});

	it("skips near-dup and quality checks when quality.level is off", async () => {
		await setup("off");
		const r = record(REWORDED, "--type", "convention");
		expect(r.status).toBe(0);
		expect(r.stderr).not.toMatch(/quality:/);
		expect(await count()).toBe(2);
	});

	it("dry-run surfaces quality warnings without writing", async () => {
		await setup();
		const r = record("cli.ts exports VERSION", "--type", "convention", "--dry-run");
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Dry-run: Would create convention/);
		expect(r.stderr).toMatch(/Warning: quality:/);
		expect(await count()).toBe(1);
	});

	it("named records still upsert on a matching name", async () => {
		await setup();
		const args = ["--type", "pattern", "--name", "lock-helper", "--files", "src/utils/lock.ts"];
		expect(record(...args, "--description", "Use withFileLock around writes").status).toBe(0);
		const r = record(...args, "--description", "Use withFileLock around every write");
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(/Updated existing pattern/);
		expect(await count()).toBe(2);
	});
});
