import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerMoveCommand } from "../../src/commands/move.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile, readExpertiseFile } from "../../src/utils/expertise.ts";

async function runMove(
	tmpDir: string,
	args: string[],
	json = false,
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | undefined;
	json: Record<string, unknown> | null;
}> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];

	const logSpy = spyOn(console, "log").mockImplementation((...a) => {
		stdoutLines.push(a.map(String).join(" "));
	});
	const errSpy = spyOn(console, "error").mockImplementation((...a) => {
		stderrLines.push(a.map(String).join(" "));
	});

	const prevExitCode = process.exitCode;
	process.exitCode = 0;

	const origCwd = process.cwd();
	process.chdir(tmpDir);

	try {
		const program = new Command();
		program.option("--json", "output JSON");
		program.exitOverride();
		registerMoveCommand(program);
		const argv = ["node", "mulch"];
		if (json) argv.push("--json");
		argv.push("move", ...args);
		await program.parseAsync(argv);
	} catch {
		// commander exitOverride
	} finally {
		process.chdir(origCwd);
		logSpy.mockRestore();
		errSpy.mockRestore();
	}

	const exitCode = process.exitCode as number | undefined;
	process.exitCode = prevExitCode;

	const stdout = stdoutLines.join("\n");
	let parsed: Record<string, unknown> | null = null;
	if (json) {
		try {
			parsed = JSON.parse(stdout) as Record<string, unknown>;
		} catch {
			parsed = null;
		}
	}

	return { stdout, stderr: stderrLines.join("\n"), exitCode, json: parsed };
}

describe("move command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-move-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { source: {}, target: {} } }, tmpDir);
		await createExpertiseFile(getExpertisePath("source", tmpDir));
		await createExpertiseFile(getExpertisePath("target", tmpDir));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("moves a record from source to target preserving ID and fields", async () => {
		const sourcePath = getExpertisePath("source", tmpDir);
		const targetPath = getExpertisePath("target", tmpDir);
		const recordedAt = new Date().toISOString();
		await appendRecord(sourcePath, {
			type: "convention",
			content: "Keep me",
			classification: "foundational",
			recorded_at: recordedAt,
			evidence: { commit: "abc123" },
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");

		const res = await runMove(tmpDir, ["source", id, "target"]);
		expect(res.exitCode).toBe(0);

		const sourceAfter = await readExpertiseFile(sourcePath);
		const targetAfter = await readExpertiseFile(targetPath);
		expect(sourceAfter).toHaveLength(0);
		expect(targetAfter).toHaveLength(1);
		const moved = targetAfter[0];
		expect(moved?.id).toBe(id);
		expect(moved?.classification).toBe("foundational");
		expect(moved?.recorded_at).toBe(recordedAt);
		expect(moved?.evidence?.commit).toBe("abc123");
		if (moved?.type === "convention") {
			expect(moved.content).toBe("Keep me");
		}
	});

	it("rejects same-domain moves", async () => {
		const sourcePath = getExpertisePath("source", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "source"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr).toContain("same");
	});

	it("rejects unknown target domain", async () => {
		const sourcePath = getExpertisePath("source", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "nope"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr).toContain('"nope"');
	});

	it("rejects unknown record id", async () => {
		const res = await runMove(tmpDir, ["source", "mx-deadbe", "target"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr.toLowerCase()).toContain("not found");
	});

	it("dry-run does not modify either file", async () => {
		const sourcePath = getExpertisePath("source", tmpDir);
		const targetPath = getExpertisePath("target", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "target", "--dry-run"]);
		expect(res.exitCode).toBe(0);
		expect(res.stdout).toContain("DRY RUN");
		expect(await readExpertiseFile(sourcePath)).toHaveLength(1);
		expect(await readExpertiseFile(targetPath)).toHaveLength(0);
	});

	it("blocks moves whose type is not in target allowed_types", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { source: {}, target: { allowed_types: ["pattern"] } },
			},
			tmpDir,
		);
		const sourcePath = getExpertisePath("source", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "target"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr).toContain("allowed_types");
		expect(res.stderr).toContain("--force");
		expect(await readExpertiseFile(sourcePath)).toHaveLength(1);
	});

	it("--force bypasses allowed_types but not required_fields", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { source: {}, target: { allowed_types: ["pattern"] } },
			},
			tmpDir,
		);
		const sourcePath = getExpertisePath("source", tmpDir);
		const targetPath = getExpertisePath("target", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "target", "--force"]);
		expect(res.exitCode).toBe(0);
		expect(await readExpertiseFile(sourcePath)).toHaveLength(0);
		expect(await readExpertiseFile(targetPath)).toHaveLength(1);
	});

	it("rejects when target required_fields are missing", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { source: {}, target: { required_fields: ["owner"] } },
			},
			tmpDir,
		);
		const sourcePath = getExpertisePath("source", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "target"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr).toContain("owner");
	});

	it("passes required_fields gate when record has the field", async () => {
		await writeConfig(
			{
				...DEFAULT_CONFIG,
				domains: { source: {}, target: { required_fields: ["owner"] } },
			},
			tmpDir,
		);
		const sourcePath = getExpertisePath("source", tmpDir);
		const targetPath = getExpertisePath("target", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			owner: "alice",
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "target"]);
		expect(res.exitCode).toBe(0);
		expect(await readExpertiseFile(targetPath)).toHaveLength(1);
		expect((await readExpertiseFile(targetPath))[0]?.owner).toBe("alice");
		expect(await readExpertiseFile(sourcePath)).toHaveLength(0);
	});

	it("rejects archived records", async () => {
		const sourcePath = getExpertisePath("source", tmpDir);
		await appendRecord(sourcePath, {
			type: "convention",
			content: "X",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			status: "archived",
		});
		const id = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!id) throw new Error("expected id");
		const res = await runMove(tmpDir, ["source", id, "target"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr.toLowerCase()).toContain("archived");
	});

	it("emits JSON output including incoming references", async () => {
		const sourcePath = getExpertisePath("source", tmpDir);
		await writeConfig(
			{ ...DEFAULT_CONFIG, domains: { source: {}, target: {}, other: {} } },
			tmpDir,
		);
		const otherPath = getExpertisePath("other", tmpDir);
		await createExpertiseFile(otherPath);

		await appendRecord(sourcePath, {
			type: "convention",
			content: "Anchor",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		const movedId = (await readExpertiseFile(sourcePath))[0]?.id;
		if (!movedId) throw new Error("expected id");

		await appendRecord(otherPath, {
			type: "convention",
			content: "Refers",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			relates_to: [movedId],
		});

		const res = await runMove(tmpDir, ["source", movedId, "target"], true);
		expect(res.exitCode).toBe(0);
		expect(res.json?.success).toBe(true);
		const refs = res.json?.incomingReferences as Array<{
			domain: string;
			field: string;
		}>;
		expect(refs).toBeDefined();
		expect(refs.length).toBeGreaterThan(0);
		expect(refs[0]?.domain).toBe("other");
		expect(refs[0]?.field).toBe("relates_to");
	});
});
