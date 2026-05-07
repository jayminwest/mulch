import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type MulchConfig } from "../../src/schemas/config.ts";
import { initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { runHooks } from "../../src/utils/hooks.ts";

async function writeScript(dir: string, name: string, body: string): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, `#!/bin/sh\n${body}\n`, "utf-8");
	await chmod(path, 0o755);
	return path;
}

async function setHooks(cwd: string, hooks: MulchConfig["hooks"]): Promise<void> {
	await writeConfig({ ...DEFAULT_CONFIG, hooks }, cwd);
}

describe("runHooks", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-hooks-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("noop when no .mulch config exists", async () => {
		const fresh = await mkdtemp(join(tmpdir(), "mulch-no-config-"));
		try {
			const res = await runHooks(
				"pre-record",
				{ domain: "x", record: { type: "convention" } },
				{
					cwd: fresh,
				},
			);
			expect(res.ranAny).toBe(false);
			expect(res.blocked).toBe(false);
		} finally {
			await rm(fresh, { recursive: true, force: true });
		}
	});

	it("noop when hooks key is absent", async () => {
		await writeConfig(DEFAULT_CONFIG, tmpDir);
		const res = await runHooks("pre-record", { hello: "world" }, { cwd: tmpDir });
		expect(res.ranAny).toBe(false);
		expect(res.blocked).toBe(false);
	});

	it("noop when hook list for the event is empty", async () => {
		await setHooks(tmpDir, { "pre-record": [] });
		const res = await runHooks("pre-record", { x: 1 }, { cwd: tmpDir });
		expect(res.ranAny).toBe(false);
	});

	it("runs a passing pre-record hook and preserves payload", async () => {
		const script = await writeScript(tmpDir, "pass.sh", "exit 0");
		await setHooks(tmpDir, { "pre-record": [script] });
		const payload = { domain: "x", record: { type: "convention", content: "hi" } };
		const res = await runHooks("pre-record", payload, { cwd: tmpDir });
		expect(res.ranAny).toBe(true);
		expect(res.blocked).toBe(false);
		expect(res.payload).toEqual(payload);
		expect(res.executions).toHaveLength(1);
		expect(res.executions[0]?.exitCode).toBe(0);
	});

	it("blocks on non-zero exit for pre-* events", async () => {
		const script = await writeScript(tmpDir, "block.sh", "echo 'rejected by policy' >&2; exit 1");
		await setHooks(tmpDir, { "pre-record": [script] });
		const res = await runHooks("pre-record", { x: 1 }, { cwd: tmpDir, forwardStderr: false });
		expect(res.blocked).toBe(true);
		expect(res.blockReason).toContain("exited with code 1");
		expect(res.executions[0]?.stderr).toContain("rejected by policy");
	});

	it("warns instead of blocking on non-zero exit for post-* events", async () => {
		const script = await writeScript(tmpDir, "fail.sh", "exit 7");
		await setHooks(tmpDir, { "post-record": [script] });
		const res = await runHooks("post-record", { x: 1 }, { cwd: tmpDir, forwardStderr: false });
		expect(res.blocked).toBe(false);
		expect(res.warnings).toHaveLength(1);
		expect(res.warnings[0]).toContain("exited with code 7");
	});

	it("post-* runs all scripts even when one fails", async () => {
		const a = await writeScript(tmpDir, "a.sh", "exit 1");
		const marker = join(tmpDir, "ran-b");
		const b = await writeScript(tmpDir, "b.sh", `touch '${marker}'; exit 0`);
		await setHooks(tmpDir, { "post-record": [a, b] });
		const res = await runHooks("post-record", {}, { cwd: tmpDir, forwardStderr: false });
		expect(res.warnings).toHaveLength(1);
		expect(res.executions).toHaveLength(2);
		const { existsSync } = await import("node:fs");
		expect(existsSync(marker)).toBe(true);
	});

	it("pre-* short-circuits after first non-zero exit", async () => {
		const a = await writeScript(tmpDir, "a.sh", "exit 1");
		const marker = join(tmpDir, "should-not-exist");
		const b = await writeScript(tmpDir, "b.sh", `touch '${marker}'; exit 0`);
		await setHooks(tmpDir, { "pre-record": [a, b] });
		const res = await runHooks("pre-record", {}, { cwd: tmpDir, forwardStderr: false });
		expect(res.blocked).toBe(true);
		expect(res.executions).toHaveLength(1);
		const { existsSync } = await import("node:fs");
		expect(existsSync(marker)).toBe(false);
	});

	it("pre-record can mutate payload via stdout JSON", async () => {
		const script = await writeScript(
			tmpDir,
			"mutate.sh",
			`cat > /dev/null
echo '{"domain":"x","record":{"type":"convention","content":"mutated","classification":"tactical","recorded_at":"2026-01-01T00:00:00Z"}}'`,
		);
		await setHooks(tmpDir, { "pre-record": [script] });
		const res = await runHooks<{ domain: string; record: { content: string } }>(
			"pre-record",
			{
				domain: "x",
				record: {
					content: "original",
				},
			},
			{ cwd: tmpDir },
		);
		expect(res.blocked).toBe(false);
		expect(res.payload.record.content).toBe("mutated");
	});

	it("pre-record stdout in nested {payload: ...} envelope is unwrapped", async () => {
		const script = await writeScript(
			tmpDir,
			"mutate-env.sh",
			`cat > /dev/null
echo '{"event":"pre-record","payload":{"domain":"y","record":{"type":"convention","content":"wrapped","classification":"tactical","recorded_at":"2026-01-01T00:00:00Z"}}}'`,
		);
		await setHooks(tmpDir, { "pre-record": [script] });
		const res = await runHooks<{ domain: string; record: { content: string } }>(
			"pre-record",
			{
				domain: "y",
				record: {
					content: "before",
				},
			},
			{ cwd: tmpDir },
		);
		expect(res.payload.record.content).toBe("wrapped");
	});

	it("empty stdout from a mutable hook leaves payload unchanged", async () => {
		const script = await writeScript(tmpDir, "silent.sh", "cat > /dev/null; exit 0");
		await setHooks(tmpDir, { "pre-record": [script] });
		const before = { x: 42 };
		const res = await runHooks("pre-record", before, { cwd: tmpDir });
		expect(res.payload).toEqual(before);
		expect(res.warnings).toHaveLength(0);
	});

	it("non-JSON stdout from a mutable hook records a warning and keeps payload", async () => {
		const script = await writeScript(tmpDir, "bad-json.sh", "cat > /dev/null; echo 'not json'");
		await setHooks(tmpDir, { "pre-record": [script] });
		const before = { x: 1 };
		const res = await runHooks("pre-record", before, { cwd: tmpDir });
		expect(res.payload).toEqual(before);
		expect(res.warnings).toHaveLength(1);
		expect(res.warnings[0]).toContain("non-JSON");
	});

	it("chains mutations across multiple pre-record hooks", async () => {
		const a = await writeScript(
			tmpDir,
			"step1.sh",
			`cat > /dev/null
echo '{"value":2}'`,
		);
		const b = await writeScript(
			tmpDir,
			"step2.sh",
			`v=$(cat | sed -n 's/.*"value":\\([0-9]*\\).*/\\1/p')
echo "{\\"value\\": $((v * 10))}"`,
		);
		await setHooks(tmpDir, { "pre-record": [a, b] });
		const res = await runHooks<{ value: number }>("pre-record", { value: 1 }, { cwd: tmpDir });
		expect(res.payload.value).toBe(20);
	});

	it("post-* events do not mutate payload even with stdout JSON", async () => {
		const script = await writeScript(
			tmpDir,
			"post-attempt-mutate.sh",
			`cat > /dev/null
echo '{"value":99}'`,
		);
		await setHooks(tmpDir, { "post-record": [script] });
		const before = { value: 1 };
		const res = await runHooks("post-record", before, { cwd: tmpDir });
		expect(res.payload).toEqual(before);
	});

	it("times out and blocks when a pre-* hook exceeds the configured timeout", async () => {
		// Busy-loop in shell builtins so killing the parent shell terminates the
		// whole hook (kept as the original smoke case; the subprocess-orphan
		// case below is the real regression guard).
		const script = await writeScript(tmpDir, "slow.sh", "while :; do :; done");
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				hooks: { "pre-record": [script] },
				hook_settings: { timeout_ms: 200 },
			},
			tmpDir,
		);
		const start = Date.now();
		const res = await runHooks("pre-record", {}, { cwd: tmpDir, forwardStderr: false });
		const elapsed = Date.now() - start;
		expect(res.blocked).toBe(true);
		expect(res.blockReason).toContain("timed out");
		expect(elapsed).toBeLessThan(3000);
	});

	it("times out cleanly even when the hook backgrounds a forked exec that holds stdout open", async () => {
		// Regression for mulch-9c81 (PR #21 stress finding): `sleep` is a forked
		// exec, not a shell builtin. Bun.spawn's `timeout` only signals the
		// direct `sh` child, leaving the orphaned `sleep` to keep the inherited
		// stdout fd open — which made `Promise.all([Response.text(), …])` hang
		// indefinitely. Running the hook in its own process group and calling
		// `process.kill(-pid, "SIGKILL")` on timeout reaches every descendant.
		const script = await writeScript(tmpDir, "background-sleep.sh", "sleep 30 & wait");
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				hooks: { "pre-record": [script] },
				hook_settings: { timeout_ms: 300 },
			},
			tmpDir,
		);
		const start = Date.now();
		const res = await runHooks("pre-record", {}, { cwd: tmpDir, forwardStderr: false });
		const elapsed = Date.now() - start;
		expect(res.blocked).toBe(true);
		expect(res.blockReason).toContain("timed out");
		// If the orphan sleep kept stdout open, this would block until either
		// `sleep` exits (30s) or the test runner times out.
		expect(elapsed).toBeLessThan(2000);
	});

	it("pre-prune blocks but never mutates payload", async () => {
		const script = await writeScript(
			tmpDir,
			"prune-attempt-mutate.sh",
			`cat > /dev/null
echo '{"candidates":[]}'`,
		);
		await setHooks(tmpDir, { "pre-prune": [script] });
		const before = { candidates: [{ domain: "x", records: [] }] };
		const res = await runHooks("pre-prune", before, { cwd: tmpDir });
		expect(res.blocked).toBe(false);
		expect(res.payload).toEqual(before);
	});

	it("rejects unknown hook events", async () => {
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
			runHooks("not-a-real-event" as any, {}, { cwd: tmpDir }),
		).rejects.toThrow(/Unknown hook event/);
	});
});
