import { describe, expect, it } from "bun:test";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import {
	composePrimedSystemPrompt,
	PRIMED_BANNER_END,
	PRIMED_BANNER_START,
	runMlPrime,
} from "../../extensions/pi/lib/prime.ts";

function fakeExec(result: Partial<ExecResult> | Error): {
	exec: (
		cmd: string,
		args: string[],
		opts?: { cwd?: string; timeout?: number },
	) => Promise<ExecResult>;
	calls: Array<{ command: string; args: string[]; cwd?: string; timeout?: number }>;
} {
	const calls: Array<{ command: string; args: string[]; cwd?: string; timeout?: number }> = [];
	return {
		calls,
		exec: async (command, args, opts) => {
			calls.push({ command, args, cwd: opts?.cwd, timeout: opts?.timeout });
			if (result instanceof Error) throw result;
			return {
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				code: result.code ?? 0,
				killed: result.killed ?? false,
			};
		},
	};
}

describe("runMlPrime", () => {
	it("invokes `ml prime` with the session cwd and a default timeout", async () => {
		const { exec, calls } = fakeExec({ stdout: "# primed", code: 0 });
		await runMlPrime({ exec, cwd: "/some/cwd" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("ml");
		expect(calls[0]?.args).toEqual(["prime"]);
		expect(calls[0]?.cwd).toBe("/some/cwd");
		expect(calls[0]?.timeout).toBe(15_000);
	});

	it("honors caller timeout override", async () => {
		const { exec, calls } = fakeExec({ stdout: "x", code: 0 });
		await runMlPrime({ exec, cwd: ".", timeoutMs: 500 });
		expect(calls[0]?.timeout).toBe(500);
	});

	it("returns trimmed stdout when ml prime exits clean", async () => {
		const { exec } = fakeExec({ stdout: "  # primed\n\n", code: 0 });
		const out = await runMlPrime({ exec, cwd: "." });
		expect(out).toBe("# primed");
	});

	it("returns undefined when ml prime exits non-zero", async () => {
		const { exec } = fakeExec({ stdout: "garbage", stderr: "not initialized", code: 1 });
		const out = await runMlPrime({ exec, cwd: "." });
		expect(out).toBeUndefined();
	});

	it("returns undefined when exec throws (e.g. `ml` not on PATH)", async () => {
		const { exec } = fakeExec(new Error("ENOENT"));
		const out = await runMlPrime({ exec, cwd: "." });
		expect(out).toBeUndefined();
	});

	it("returns undefined when ml prime stdout is empty", async () => {
		const { exec } = fakeExec({ stdout: "   \n\n", code: 0 });
		const out = await runMlPrime({ exec, cwd: "." });
		expect(out).toBeUndefined();
	});
});

describe("composePrimedSystemPrompt", () => {
	it("appends the primed payload inside a stable fence", () => {
		const out = composePrimedSystemPrompt("You are pi.", "## Project Contract\nrules");
		expect(out).toContain("You are pi.");
		expect(out).toContain(PRIMED_BANNER_START);
		expect(out).toContain("## Project Contract\nrules");
		expect(out).toContain(PRIMED_BANNER_END);
		// Banner must wrap the payload only — base prompt is preserved verbatim
		// at the head of the composed string.
		expect(out.startsWith("You are pi.")).toBe(true);
	});

	it("is idempotent: re-composing replaces the previous fenced payload", () => {
		const first = composePrimedSystemPrompt("base", "old payload");
		const second = composePrimedSystemPrompt(first, "new payload");
		expect(second).toContain("new payload");
		expect(second).not.toContain("old payload");
		// Exactly one banner pair survives.
		const startCount = second.split(PRIMED_BANNER_START).length - 1;
		const endCount = second.split(PRIMED_BANNER_END).length - 1;
		expect(startCount).toBe(1);
		expect(endCount).toBe(1);
	});

	it("handles an empty base prompt", () => {
		const out = composePrimedSystemPrompt("", "primed body");
		expect(out.startsWith(PRIMED_BANNER_START)).toBe(true);
		expect(out).toContain("primed body");
		expect(out.endsWith(PRIMED_BANNER_END)).toBe(true);
	});
});
