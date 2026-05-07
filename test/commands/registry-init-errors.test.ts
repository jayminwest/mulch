import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src/cli.ts");

async function runIn(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

describe("registry init error UX", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-init-error-"));
		await mkdir(join(tmpDir, ".mulch", "expertise"), { recursive: true });
		await writeFile(join(tmpDir, ".mulch", "expertise", "cli.jsonl"), "", "utf-8");
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	test("custom type extending a disabled type prints formatted error, not a stack trace", async () => {
		const yaml = `domains:
  cli: {}
disabled_types:
  - decision
custom_types:
  adr:
    extends: decision
    required: [decision_status]
`;
		await writeFile(join(tmpDir, ".mulch", "mulch.config.yaml"), yaml, "utf-8");

		const { stderr, exitCode } = await runIn(tmpDir, ["doctor"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Config error:");
		expect(stderr).toContain('Custom type "adr" extends "decision"');
		// No raw Bun stack trace surfacing internal source paths.
		expect(stderr).not.toContain("at buildRegistryWithCustomTypes");
		expect(stderr).not.toContain("at initRegistryFromConfig");
		expect(stderr).not.toContain("Bun v");
	});

	test("disabled_types referencing an unregistered type prints formatted error", async () => {
		const yaml = `domains:
  cli: {}
disabled_types:
  - nonexistent_type
`;
		await writeFile(join(tmpDir, ".mulch", "mulch.config.yaml"), yaml, "utf-8");

		const { stderr, exitCode } = await runIn(tmpDir, ["status"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Config error:");
		expect(stderr).toContain('disabled_types references unregistered type "nonexistent_type"');
		expect(stderr).not.toContain("at buildRegistryWithCustomTypes");
	});

	test("--json mode emits structured config-error JSON", async () => {
		const yaml = `domains:
  cli: {}
disabled_types:
  - decision
custom_types:
  adr:
    extends: decision
    required: [decision_status]
`;
		await writeFile(join(tmpDir, ".mulch", "mulch.config.yaml"), yaml, "utf-8");

		const { stderr, exitCode } = await runIn(tmpDir, ["--json", "doctor"]);
		expect(exitCode).toBe(1);
		const parsed = JSON.parse(stderr) as {
			success: boolean;
			command: string;
			error: string;
		};
		expect(parsed.success).toBe(false);
		expect(parsed.error).toContain("Config error:");
		expect(parsed.error).toContain('Custom type "adr"');
	});

	test("doctor on a minimal config (only domains) does not crash", async () => {
		const yaml = `domains:
  cli: {}
`;
		await writeFile(join(tmpDir, ".mulch", "mulch.config.yaml"), yaml, "utf-8");

		const { stdout, stderr, exitCode } = await runIn(tmpDir, ["doctor"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Config is valid");
		expect(stdout).toContain("All domains within governance limits");
		expect(stdout).toContain("No stale records");
		expect(stderr).not.toContain("TypeError");
	});

	test("status on a minimal config does not crash", async () => {
		const yaml = `domains:
  cli: {}
`;
		await writeFile(join(tmpDir, ".mulch", "mulch.config.yaml"), yaml, "utf-8");

		const { stderr, exitCode } = await runIn(tmpDir, ["status"]);
		expect(exitCode).toBe(0);
		expect(stderr).not.toContain("TypeError");
	});
});
