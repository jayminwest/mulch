import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { processStdinRecords } from "../../src/commands/record.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { resetRegistry } from "../../src/registry/type-registry.ts";
import { DEFAULT_CONFIG, type MulchConfig } from "../../src/schemas/config.ts";
import {
	getExpertisePath,
	initMulchDir,
	writeConfig as writeMulchConfig,
} from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

const CLI = resolve(__dirname, "../../src/cli.ts");

async function writeHookScript(dir: string, name: string, body: string): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, `#!/bin/sh\n${body}\n`, "utf-8");
	await chmod(path, 0o755);
	return path;
}

async function configureWith(cwd: string, hooks: MulchConfig["hooks"]): Promise<void> {
	await writeMulchConfig(
		{ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} }, hooks },
		cwd,
	);
	await initRegistryFromConfig(cwd);
}

describe("record + hooks (processStdinRecords)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-hooks-rec-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
		resetRegistry();
	});

	it("pre-record blocking hook drops the record and reports an error", async () => {
		const block = await writeHookScript(tmpDir, "block.sh", "echo blocked >&2; exit 1");
		await configureWith(tmpDir, { "pre-record": [block] });

		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify({
				type: "convention",
				content: "should be blocked",
				classification: "tactical",
			}),
			tmpDir,
		);

		expect(result.created).toBe(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatch(/pre-record hook blocked|exited with code 1/);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(0);
	});

	it("pre-record mutation rewrites the record before write", async () => {
		// Hook reads stdin (input payload), prints a payload with a mutated record.
		const mutate = await writeHookScript(
			tmpDir,
			"mutate.sh",
			`cat > /dev/null
echo '{"event":"pre-record","payload":{"domain":"testing","record":{"type":"convention","content":"REDACTED","classification":"tactical","recorded_at":"2026-05-05T00:00:00Z"}}}'`,
		);
		await configureWith(tmpDir, { "pre-record": [mutate] });

		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify({
				type: "convention",
				content: "secret-token-xyz",
				classification: "tactical",
				recorded_at: "2026-05-05T00:00:00Z",
			}),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ content: "REDACTED" });
	});

	it("post-record runs after a successful write", async () => {
		const marker = join(tmpDir, "post-marker");
		const post = await writeHookScript(tmpDir, "post.sh", `cat > /dev/null; touch '${marker}'`);
		await configureWith(tmpDir, { "post-record": [post] });

		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify({
				type: "convention",
				content: "with post hook",
				classification: "tactical",
			}),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(existsSync(marker)).toBe(true);
	});

	it("post-record does not fire on duplicate-skip", async () => {
		const marker = join(tmpDir, "skip-marker");
		const post = await writeHookScript(tmpDir, "post.sh", `cat > /dev/null; touch '${marker}'`);
		await configureWith(tmpDir, { "post-record": [post] });

		const filePath = getExpertisePath("testing", tmpDir);
		await appendRecord(filePath, {
			type: "convention",
			content: "duplicate",
			classification: "tactical",
			recorded_at: "2026-05-05T00:00:00Z",
		});

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			false,
			JSON.stringify({
				type: "convention",
				content: "duplicate",
				classification: "tactical",
				recorded_at: "2026-05-05T00:00:00Z",
			}),
			tmpDir,
		);

		expect(result.skipped).toBe(1);
		expect(result.created).toBe(0);
		expect(existsSync(marker)).toBe(false);
	});

	it("dry-run skips both pre-record and post-record hooks", async () => {
		const preMarker = join(tmpDir, "pre-marker");
		const postMarker = join(tmpDir, "post-marker");
		const pre = await writeHookScript(tmpDir, "pre.sh", `cat > /dev/null; touch '${preMarker}'`);
		const post = await writeHookScript(tmpDir, "post.sh", `cat > /dev/null; touch '${postMarker}'`);
		await configureWith(tmpDir, { "pre-record": [pre], "post-record": [post] });

		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		const result = await processStdinRecords(
			"testing",
			false,
			false,
			true, // dryRun
			JSON.stringify({ type: "convention", content: "preview", classification: "tactical" }),
			tmpDir,
		);

		expect(result.created).toBe(1);
		expect(existsSync(preMarker)).toBe(false);
		expect(existsSync(postMarker)).toBe(false);
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(0);
	});
});

describe("prime + hooks (CLI)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-hooks-prime-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("pre-prime can filter out records via stdout JSON", async () => {
		// Seed two records; hook drops the second by name.
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "keep-this",
			classification: "tactical",
			recorded_at: "2026-05-05T00:00:00Z",
		});
		await appendRecord(filePath, {
			type: "convention",
			content: "drop-this",
			classification: "tactical",
			recorded_at: "2026-05-05T00:00:00Z",
		});

		const filter = await writeHookScript(
			tmpDir,
			"filter.sh",
			`# Read payload, drop any record whose content matches 'drop-this'.
input=$(cat)
bun -e "
const j = JSON.parse(\\\`$input\\\`);
for (const d of j.payload.domains) {
  d.records = d.records.filter(r => r.content !== 'drop-this');
}
console.log(JSON.stringify(j));
"`,
		);
		await writeMulchConfig(
			{ ...DEFAULT_CONFIG, domains: { testing: {} }, hooks: { "pre-prime": [filter] } },
			tmpDir,
		);

		const proc = Bun.spawnSync(["bun", CLI, "prime", "--json"], {
			cwd: tmpDir,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, NO_COLOR: "1" },
		});
		const stdout = proc.stdout.toString();
		const parsed = JSON.parse(stdout) as {
			domains: Array<{ domain: string; records: Array<{ content: string }> }>;
		};
		const testing = parsed.domains.find((d) => d.domain === "testing");
		expect(testing).toBeDefined();
		const contents = testing?.records.map((r) => r.content) ?? [];
		expect(contents).toContain("keep-this");
		expect(contents).not.toContain("drop-this");
	});

	it("pre-prime non-zero exit blocks output", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		await appendRecord(filePath, {
			type: "convention",
			content: "anything",
			classification: "tactical",
			recorded_at: "2026-05-05T00:00:00Z",
		});

		const block = await writeHookScript(
			tmpDir,
			"block.sh",
			"echo 'team boundary violation' >&2; exit 2",
		);
		await writeMulchConfig(
			{ ...DEFAULT_CONFIG, domains: { testing: {} }, hooks: { "pre-prime": [block] } },
			tmpDir,
		);

		const proc = Bun.spawnSync(["bun", CLI, "prime", "--json"], {
			cwd: tmpDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(proc.exitCode).not.toBe(0);
		// stderr contains the hook's own stderr output (forwarded) followed by
		// the JSON error envelope from outputJsonError. Just check both parts.
		const stderr = proc.stderr.toString();
		expect(stderr).toContain("team boundary violation");
		expect(stderr).toMatch(/exited with code 2/);
	});
});

describe("prune + hooks (CLI)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-hooks-prune-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("pre-prune blocks the prune on non-zero exit", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		// Stale: tactical, > 14 days old.
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		await appendRecord(filePath, {
			type: "convention",
			content: "ancient",
			classification: "tactical",
			recorded_at: old,
		});

		const block = await writeHookScript(
			tmpDir,
			"refuse.sh",
			"echo 'human review required' >&2; exit 1",
		);
		await writeMulchConfig(
			{ ...DEFAULT_CONFIG, domains: { testing: {} }, hooks: { "pre-prune": [block] } },
			tmpDir,
		);

		const proc = Bun.spawnSync(["bun", CLI, "prune"], {
			cwd: tmpDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(proc.exitCode).not.toBe(0);

		// File should still contain the stale record.
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ type: "convention", content: "ancient" });
	});

	it("pre-prune passes (exit 0) and the prune proceeds", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		await appendRecord(filePath, {
			type: "convention",
			content: "delete-me",
			classification: "tactical",
			recorded_at: old,
		});

		const allow = await writeHookScript(tmpDir, "allow.sh", "cat > /dev/null; exit 0");
		await writeMulchConfig(
			{ ...DEFAULT_CONFIG, domains: { testing: {} }, hooks: { "pre-prune": [allow] } },
			tmpDir,
		);

		const proc = Bun.spawnSync(["bun", CLI, "prune"], {
			cwd: tmpDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(proc.exitCode).toBe(0);

		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(0);
	});

	it("pre-prune is skipped on --dry-run", async () => {
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		await appendRecord(filePath, {
			type: "convention",
			content: "dry-test",
			classification: "tactical",
			recorded_at: old,
		});

		const marker = join(tmpDir, "pre-prune-marker");
		const hook = await writeHookScript(
			tmpDir,
			"hook.sh",
			`cat > /dev/null; touch '${marker}'; exit 0`,
		);
		await writeMulchConfig(
			{ ...DEFAULT_CONFIG, domains: { testing: {} }, hooks: { "pre-prune": [hook] } },
			tmpDir,
		);

		const proc = Bun.spawnSync(["bun", CLI, "prune", "--dry-run"], {
			cwd: tmpDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(proc.exitCode).toBe(0);
		expect(existsSync(marker)).toBe(false);

		// Stale record still present.
		const records = await readExpertiseFile(filePath);
		expect(records).toHaveLength(1);
	});
});
