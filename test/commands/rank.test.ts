import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerRankCommand } from "../../src/commands/rank.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord, Outcome } from "../../src/schemas/record.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../../src/utils/expertise.ts";

function outcome(status: Outcome["status"], iso = new Date().toISOString()): Outcome {
	return { status, recorded_at: iso };
}

function makeProgram(): Command {
	const program = new Command();
	program.name("mulch").option("--json", "output as structured JSON").exitOverride();
	registerRankCommand(program);
	return program;
}

describe("rank command", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-rank-test-"));
		await initMulchDir(tmpDir);
		await writeConfig({ ...DEFAULT_CONFIG, domains: { api: {}, db: {} } }, tmpDir);
		const apiPath = getExpertisePath("api", tmpDir);
		const dbPath = getExpertisePath("db", tmpDir);
		await createExpertiseFile(apiPath);
		await createExpertiseFile(dbPath);

		// 3 successes — top score 3
		await appendRecord(apiPath, {
			id: "mx-top",
			type: "pattern",
			name: "top-pattern",
			description: "highest scoring",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			outcomes: [outcome("success"), outcome("success"), outcome("success")],
		} as ExpertiseRecord);

		// 1 success + 1 partial — score 1.5
		await appendRecord(apiPath, {
			id: "mx-mid",
			type: "convention",
			content: "mid scoring",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [outcome("success"), outcome("partial")],
		} as ExpertiseRecord);

		// only failures — score 0
		await appendRecord(dbPath, {
			id: "mx-fail",
			type: "failure",
			description: "failed thing",
			resolution: "do otherwise",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
			outcomes: [outcome("failure"), outcome("failure")],
		} as ExpertiseRecord);

		// no outcomes — score 0
		await appendRecord(dbPath, {
			id: "mx-none",
			type: "convention",
			content: "untested",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		} as ExpertiseRecord);

		// 2 successes — score 2 (in db domain)
		await appendRecord(dbPath, {
			id: "mx-db2",
			type: "decision",
			title: "use postgres",
			rationale: "richer types",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			outcomes: [outcome("success"), outcome("success")],
		} as ExpertiseRecord);

		originalCwd = process.cwd();
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.exitCode = 0;
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("ranks records across all domains by score desc (text mode)", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank"]);

			const lines = logSpy.mock.calls.map((c) => String(c[0] ?? ""));
			const body = lines.join("\n");
			// Header counts the records returned
			expect(lines[0]).toMatch(/^Top \d+ records by confirmation score \(all domains\)/);
			// Order: mx-top (3) > mx-db2 (2) > mx-mid (1.5) > mx-fail (0) / mx-none (0)
			const topIdx = body.indexOf("mx-top");
			const db2Idx = body.indexOf("mx-db2");
			const midIdx = body.indexOf("mx-mid");
			const failIdx = body.indexOf("mx-fail");
			const noneIdx = body.indexOf("mx-none");
			expect(topIdx).toBeGreaterThan(-1);
			expect(topIdx).toBeLessThan(db2Idx);
			expect(db2Idx).toBeLessThan(midIdx);
			expect(midIdx).toBeLessThan(failIdx);
			expect(midIdx).toBeLessThan(noneIdx);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("scopes to a single domain when [domain] is given", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "api"]);

			const body = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
			expect(body).toContain("(api)");
			expect(body).toContain("mx-top");
			expect(body).toContain("mx-mid");
			expect(body).not.toContain("mx-db2");
			expect(body).not.toContain("mx-fail");
			expect(body).not.toContain("mx-none");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("--limit truncates the result set", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "--limit", "2"]);

			const body = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
			expect(body).toContain("mx-top");
			expect(body).toContain("mx-db2");
			expect(body).not.toContain("mx-mid");
			expect(body).not.toContain("mx-fail");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("--min-score filters out records below the threshold (zeros)", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "--min-score", "1"]);

			const body = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
			expect(body).toContain("mx-top");
			expect(body).toContain("mx-db2");
			expect(body).toContain("mx-mid");
			expect(body).not.toContain("mx-fail");
			expect(body).not.toContain("mx-none");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("--type filters to a single record type", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "--type", "convention"]);

			const body = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
			expect(body).toContain("mx-mid");
			expect(body).toContain("mx-none");
			expect(body).not.toContain("mx-top");
			expect(body).not.toContain("mx-db2");
			expect(body).not.toContain("mx-fail");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("--json emits structured ranking", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "--json", "rank", "--min-score", "1"]);

			expect(logSpy).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? ""));
			expect(payload.success).toBe(true);
			expect(payload.command).toBe("rank");
			expect(payload.count).toBe(3);
			const ids = payload.records.map((r: { id: string }) => r.id);
			expect(ids).toEqual(["mx-top", "mx-db2", "mx-mid"]);
			const scores = payload.records.map((r: { score: number }) => r.score);
			expect(scores).toEqual([3, 2, 1.5]);
			expect(payload.records[0].domain).toBe("api");
			expect(payload.records[0].record.outcomes).toHaveLength(3);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("prints a friendly message when nothing matches", async () => {
		process.chdir(tmpDir);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "--min-score", "1000"]);
			expect(logSpy.mock.calls[0]?.[0]).toContain("No records match the ranking criteria.");
		} finally {
			logSpy.mockRestore();
		}
	});

	it("rejects invalid --limit", async () => {
		process.chdir(tmpDir);
		const errSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "--limit", "0"]);
			expect(errSpy.mock.calls[0]?.[0]).toContain("--limit must be a positive integer");
			expect(process.exitCode).toBe(1);
		} finally {
			errSpy.mockRestore();
		}
	});

	it("rejects invalid --min-score", async () => {
		process.chdir(tmpDir);
		const errSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "--min-score", "-1"]);
			expect(errSpy.mock.calls[0]?.[0]).toContain("--min-score must be a non-negative number");
			expect(process.exitCode).toBe(1);
		} finally {
			errSpy.mockRestore();
		}
	});

	it("hints at `ml add` when [domain] is unknown", async () => {
		process.chdir(tmpDir);
		const errSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const program = makeProgram();
			await program.parseAsync(["node", "mulch", "rank", "nonexistent"]);
			expect(errSpy.mock.calls.length).toBe(2);
			expect(errSpy.mock.calls[0]?.[0]).toContain("nonexistent");
			expect(errSpy.mock.calls[1]?.[0]).toContain("ml add nonexistent");
			expect(process.exitCode).toBe(1);
		} finally {
			errSpy.mockRestore();
		}
	});
});
