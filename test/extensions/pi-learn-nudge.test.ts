import { describe, expect, it } from "bun:test";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import {
	composeLearnWidgetLines,
	type LearnResult,
	parseLearnOutput,
	runMlLearn,
} from "../../extensions/pi/lib/learn-nudge.ts";

type ExecCall = { command: string; args: string[]; cwd?: string; timeout?: number };

function fakeExec(respond: (call: ExecCall) => Partial<ExecResult> | Error): {
	exec: (
		cmd: string,
		args: string[],
		opts?: { cwd?: string; timeout?: number },
	) => Promise<ExecResult>;
	calls: ExecCall[];
} {
	const calls: ExecCall[] = [];
	return {
		calls,
		exec: async (command, args, opts) => {
			const call: ExecCall = { command, args, cwd: opts?.cwd, timeout: opts?.timeout };
			calls.push(call);
			const r = respond(call);
			if (r instanceof Error) throw r;
			return {
				stdout: r.stdout ?? "",
				stderr: r.stderr ?? "",
				code: r.code ?? 0,
				killed: r.killed ?? false,
			};
		},
	};
}

describe("learn-nudge: parseLearnOutput", () => {
	it("returns the parsed shape for a successful run", () => {
		const json = JSON.stringify({
			success: true,
			command: "learn",
			changedFiles: ["a.ts", "b.ts"],
			suggestedDomains: [
				{ domain: "cli", matchCount: 2, files: ["a.ts", "b.ts"] },
				{ domain: "testing", matchCount: 1, files: ["b.ts"] },
			],
			unmatchedFiles: ["c.md"],
		});
		const out = parseLearnOutput(json);
		expect(out).toBeDefined();
		expect(out?.changedFiles).toEqual(["a.ts", "b.ts"]);
		expect(out?.suggestedDomains).toHaveLength(2);
		expect(out?.suggestedDomains[0]).toEqual({
			domain: "cli",
			matchCount: 2,
			files: ["a.ts", "b.ts"],
		});
		expect(out?.unmatchedFiles).toEqual(["c.md"]);
	});

	it("returns undefined for empty stdout", () => {
		expect(parseLearnOutput("")).toBeUndefined();
		expect(parseLearnOutput("  \n")).toBeUndefined();
	});

	it("returns undefined for invalid JSON", () => {
		expect(parseLearnOutput("not json")).toBeUndefined();
	});

	it("returns undefined when success is false", () => {
		const json = JSON.stringify({ success: false, error: "not in git repo" });
		expect(parseLearnOutput(json)).toBeUndefined();
	});

	it("filters out malformed suggestions", () => {
		const json = JSON.stringify({
			success: true,
			changedFiles: ["a.ts", 42, ""],
			suggestedDomains: [
				{ domain: "cli", matchCount: 1, files: ["a.ts"] },
				{ matchCount: 1 },
				null,
				{ domain: "testing", matchCount: "two", files: null },
			],
			unmatchedFiles: ["c.md", null],
		});
		const out = parseLearnOutput(json);
		expect(out?.changedFiles).toEqual(["a.ts"]);
		expect(out?.suggestedDomains).toHaveLength(2);
		expect(out?.suggestedDomains[0]?.domain).toBe("cli");
		expect(out?.suggestedDomains[1]?.domain).toBe("testing");
		expect(out?.suggestedDomains[1]?.matchCount).toBe(0);
		expect(out?.suggestedDomains[1]?.files).toEqual([]);
		expect(out?.unmatchedFiles).toEqual(["c.md"]);
	});
});

describe("learn-nudge: runMlLearn", () => {
	it("invokes `ml learn --json` with the session cwd and a default timeout", async () => {
		const json = JSON.stringify({
			success: true,
			changedFiles: ["a.ts"],
			suggestedDomains: [{ domain: "cli", matchCount: 1, files: ["a.ts"] }],
			unmatchedFiles: [],
		});
		const { exec, calls } = fakeExec(() => ({ stdout: json, code: 0 }));
		const out = await runMlLearn({ exec, cwd: "/tmp/ml" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("ml");
		expect(calls[0]?.args).toEqual(["learn", "--json"]);
		expect(calls[0]?.cwd).toBe("/tmp/ml");
		expect(calls[0]?.timeout).toBe(10_000);
		expect(out?.suggestedDomains).toHaveLength(1);
	});

	it("returns undefined when ml exits non-zero", async () => {
		const { exec } = fakeExec(() => ({ stdout: "", stderr: "fail", code: 1 }));
		expect(await runMlLearn({ exec, cwd: "." })).toBeUndefined();
	});

	it("returns undefined when exec throws", async () => {
		const { exec } = fakeExec(() => new Error("ENOENT"));
		expect(await runMlLearn({ exec, cwd: "." })).toBeUndefined();
	});

	it("honors caller timeout override", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "{}", code: 0 }));
		await runMlLearn({ exec, cwd: ".", timeoutMs: 500 });
		expect(calls[0]?.timeout).toBe(500);
	});
});

describe("learn-nudge: composeLearnWidgetLines", () => {
	it("returns undefined when the result is missing", () => {
		expect(composeLearnWidgetLines(undefined)).toBeUndefined();
	});

	it("returns undefined when there are no suggested domains", () => {
		const result: LearnResult = {
			changedFiles: ["a.ts"],
			suggestedDomains: [],
			unmatchedFiles: ["a.ts"],
		};
		expect(composeLearnWidgetLines(result)).toBeUndefined();
	});

	it("renders one Record line per suggested-domain plus a header and tail", () => {
		const result: LearnResult = {
			changedFiles: ["a.ts", "b.ts"],
			suggestedDomains: [
				{ domain: "cli", matchCount: 2, files: ["a.ts", "b.ts"] },
				{ domain: "testing", matchCount: 1, files: ["b.ts"] },
			],
			unmatchedFiles: [],
		};
		const lines = composeLearnWidgetLines(result);
		expect(lines).toBeDefined();
		expect(lines?.[0]).toContain("2 changed files");
		expect(lines?.[1]).toContain("Record: cli/<type>?");
		expect(lines?.[1]).toContain("2 matches");
		expect(lines?.[2]).toContain("Record: testing/<type>?");
		expect(lines?.[2]).toContain("1 match");
		expect(lines?.[lines.length - 1]).toContain("ml learn");
	});

	it("uses singular wording when there is exactly one changed file", () => {
		const result: LearnResult = {
			changedFiles: ["a.ts"],
			suggestedDomains: [{ domain: "cli", matchCount: 1, files: ["a.ts"] }],
			unmatchedFiles: [],
		};
		const lines = composeLearnWidgetLines(result);
		expect(lines?.[0]).toContain("1 changed file");
		expect(lines?.[0]).not.toContain("changed files");
	});
});
