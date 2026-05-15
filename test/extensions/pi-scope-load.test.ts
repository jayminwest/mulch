import { describe, expect, it } from "bun:test";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import {
	collectPersistedScopeLoadPaths,
	composeScopeLoadMessage,
	createScopeLoader,
	extractFilePathFromInput,
	SCOPE_LOAD_BANNER_END,
	SCOPE_LOAD_BANNER_START,
	SCOPE_LOAD_CUSTOM_TYPE,
	SCOPE_LOAD_TOOL_NAMES,
} from "../../extensions/pi/lib/scope-load.ts";

// Manual clock so debounce + exec assertions stay synchronous and the tests
// don't depend on real wall-clock timing. The harness mirrors setTimeout /
// clearTimeout semantics: each scheduled callback gets a numeric handle, and
// tick(ms) fires every callback whose target time is <= the advanced clock.
function createManualClock(): {
	setTimer: (fn: () => void, ms: number) => unknown;
	clearTimer: (handle: unknown) => void;
	tick: (ms: number) => void;
} {
	type Pending = { id: number; fireAt: number; fn: () => void };
	let now = 0;
	let nextId = 0;
	const pending = new Map<number, Pending>();
	return {
		setTimer: (fn, ms) => {
			const id = ++nextId;
			pending.set(id, { id, fireAt: now + ms, fn });
			return id;
		},
		clearTimer: (handle) => {
			if (typeof handle === "number") pending.delete(handle);
		},
		tick: (ms) => {
			now += ms;
			const ready = [...pending.values()]
				.filter((p) => p.fireAt <= now)
				.sort((a, b) => a.fireAt - b.fireAt);
			for (const p of ready) {
				pending.delete(p.id);
				p.fn();
			}
		},
	};
}

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
			const result = respond(call);
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

// Yield to the microtask queue so the fire() promise inside the debounced
// callback gets a chance to resolve before we assert. The exec result is a
// Promise, so a single Promise.resolve() round-trip isn't enough — we await
// twice to clear both the exec() and the awaiting `then` continuation.
async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

const FIXED_CWD = "/tmp/mulch-pi-scope";

describe("scope-load: extractFilePathFromInput", () => {
	it("returns input.path when present", () => {
		expect(extractFilePathFromInput({ path: "src/foo.ts" })).toBe("src/foo.ts");
	});
	it("falls back to file_path when path is missing", () => {
		expect(extractFilePathFromInput({ file_path: "src/bar.ts" })).toBe("src/bar.ts");
	});
	it("returns undefined for non-string path", () => {
		expect(extractFilePathFromInput({ path: 42 })).toBeUndefined();
	});
	it("returns undefined for empty/whitespace path", () => {
		expect(extractFilePathFromInput({ path: "   " })).toBeUndefined();
	});
	it("returns undefined for non-object input", () => {
		expect(extractFilePathFromInput(null)).toBeUndefined();
		expect(extractFilePathFromInput("string")).toBeUndefined();
	});
});

describe("scope-load: composeScopeLoadMessage", () => {
	it("wraps the primed body in stable banners and labels the path", () => {
		const out = composeScopeLoadMessage("/abs/foo.ts", "# records");
		expect(out).toContain(SCOPE_LOAD_BANNER_START);
		expect(out).toContain(SCOPE_LOAD_BANNER_END);
		expect(out).toContain("/abs/foo.ts");
		expect(out).toContain("# records");
	});
});

describe("scope-load: collectPersistedScopeLoadPaths", () => {
	it("extracts paths from custom mulch-scope-load entries", () => {
		const entries = [
			{ type: "custom", customType: SCOPE_LOAD_CUSTOM_TYPE, data: { path: "/a.ts" } },
			{ type: "custom", customType: "other-thing", data: { path: "/skip.ts" } },
			{ type: "message", customType: SCOPE_LOAD_CUSTOM_TYPE },
			{ type: "custom", customType: SCOPE_LOAD_CUSTOM_TYPE, data: { path: "/b.ts" } },
		];
		expect(collectPersistedScopeLoadPaths(entries)).toEqual(["/a.ts", "/b.ts"]);
	});
	it("ignores entries with missing or non-string path", () => {
		const entries = [
			{ type: "custom", customType: SCOPE_LOAD_CUSTOM_TYPE, data: {} },
			{ type: "custom", customType: SCOPE_LOAD_CUSTOM_TYPE, data: { path: 42 } },
			{ type: "custom", customType: SCOPE_LOAD_CUSTOM_TYPE, data: null },
			{ type: "custom", customType: SCOPE_LOAD_CUSTOM_TYPE },
		];
		expect(collectPersistedScopeLoadPaths(entries)).toEqual([]);
	});
});

describe("scope-load: createScopeLoader", () => {
	it("fires `ml prime --files <abs> --budget <n>` after debounce window", async () => {
		const clock = createManualClock();
		const { exec, calls } = fakeExec(() => ({ stdout: "# records", code: 0 }));
		const sent: Array<{ message: unknown; options: unknown }> = [];
		const entries: Array<{ customType: string; data: unknown }> = [];
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 1500,
			debounceMs: 500,
			sendMessage: (message, options) => sent.push({ message, options }),
			appendEntry: (customType, data) => entries.push({ customType, data }),
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});

		loader.register("src/foo.ts");
		clock.tick(499);
		expect(calls).toHaveLength(0);

		clock.tick(1);
		await flushMicrotasks();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("ml");
		expect(calls[0]?.args).toEqual([
			"prime",
			"--files",
			resolvePath(FIXED_CWD, "src/foo.ts"),
			"--budget",
			"1500",
		]);
		expect(calls[0]?.cwd).toBe(FIXED_CWD);

		expect(sent).toHaveLength(1);
		const message = sent[0]?.message as {
			customType: string;
			content: string;
			display: boolean;
			details: { path: string };
		};
		expect(message.customType).toBe(SCOPE_LOAD_CUSTOM_TYPE);
		expect(message.display).toBe(false);
		expect(message.content).toContain("# records");
		expect(message.details.path).toBe(resolvePath(FIXED_CWD, "src/foo.ts"));
		expect(sent[0]?.options).toEqual({ deliverAs: "steer" });

		expect(entries).toEqual([
			{
				customType: SCOPE_LOAD_CUSTOM_TYPE,
				data: { path: resolvePath(FIXED_CWD, "src/foo.ts") },
			},
		]);

		expect(loader.isPrimed("src/foo.ts")).toBe(true);
		expect(loader.isPrimed(resolvePath(FIXED_CWD, "src/foo.ts"))).toBe(true);
	});

	it("coalesces rapid repeat registers for the same path into one exec", async () => {
		const clock = createManualClock();
		const { exec, calls } = fakeExec(() => ({ stdout: "# r", code: 0 }));
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 500,
			debounceMs: 200,
			sendMessage: () => {},
			appendEntry: () => {},
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});

		loader.register("src/foo.ts");
		clock.tick(150);
		loader.register("src/foo.ts");
		clock.tick(150);
		loader.register("src/foo.ts");
		clock.tick(199);
		expect(calls).toHaveLength(0);
		clock.tick(1);
		await flushMicrotasks();
		expect(calls).toHaveLength(1);
	});

	it("skips re-prime when the path is already in primedPaths", async () => {
		const clock = createManualClock();
		const { exec, calls } = fakeExec(() => ({ stdout: "# r", code: 0 }));
		const sent: unknown[] = [];
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 50,
			sendMessage: (m) => sent.push(m),
			appendEntry: () => {},
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});

		loader.register("src/foo.ts");
		clock.tick(50);
		await flushMicrotasks();
		expect(calls).toHaveLength(1);

		loader.register("src/foo.ts");
		clock.tick(50);
		await flushMicrotasks();
		expect(calls).toHaveLength(1);
		expect(sent).toHaveLength(1);
	});

	it("restores primedPaths from prior session entries before any tool_call", async () => {
		const clock = createManualClock();
		const { exec, calls } = fakeExec(() => ({ stdout: "# r", code: 0 }));
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 50,
			sendMessage: () => {},
			appendEntry: () => {},
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});

		const absolutePath = resolvePath(FIXED_CWD, "src/foo.ts");
		loader.restore([absolutePath]);
		expect(loader.isPrimed("src/foo.ts")).toBe(true);

		loader.register("src/foo.ts");
		clock.tick(50);
		await flushMicrotasks();
		expect(calls).toHaveLength(0);
	});

	it("does not mark the path primed when exec exits non-zero", async () => {
		const clock = createManualClock();
		const { exec } = fakeExec(() => ({ stdout: "", code: 1, stderr: "boom" }));
		const sent: unknown[] = [];
		const entries: unknown[] = [];
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 50,
			sendMessage: (m) => sent.push(m),
			appendEntry: (t, d) => entries.push({ t, d }),
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});

		loader.register("src/foo.ts");
		clock.tick(50);
		await flushMicrotasks();
		expect(loader.isPrimed("src/foo.ts")).toBe(false);
		expect(sent).toHaveLength(0);
		expect(entries).toHaveLength(0);
	});

	it("does not send a message when exec succeeds with empty stdout", async () => {
		const clock = createManualClock();
		const { exec } = fakeExec(() => ({ stdout: "   \n", code: 0 }));
		const sent: unknown[] = [];
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 50,
			sendMessage: (m) => sent.push(m),
			appendEntry: () => {},
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});
		loader.register("src/foo.ts");
		clock.tick(50);
		await flushMicrotasks();
		expect(loader.isPrimed("src/foo.ts")).toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("swallows exec errors and invokes onError", async () => {
		const clock = createManualClock();
		const { exec } = fakeExec(() => new Error("ENOENT"));
		const errors: Array<{ err: unknown; path: string }> = [];
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 10,
			sendMessage: () => {},
			appendEntry: () => {},
			onError: (err, path) => errors.push({ err, path }),
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});
		loader.register("src/foo.ts");
		clock.tick(10);
		await flushMicrotasks();
		expect(errors).toHaveLength(1);
		expect(errors[0]?.path).toBe(resolvePath(FIXED_CWD, "src/foo.ts"));
		expect(loader.isPrimed("src/foo.ts")).toBe(false);
	});

	it("cancelPending clears scheduled timers without firing exec", async () => {
		const clock = createManualClock();
		const { exec, calls } = fakeExec(() => ({ stdout: "# r", code: 0 }));
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 100,
			sendMessage: () => {},
			appendEntry: () => {},
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});
		loader.register("src/foo.ts");
		loader.register("src/bar.ts");
		loader.cancelPending();
		clock.tick(500);
		await flushMicrotasks();
		expect(calls).toHaveLength(0);
	});

	it("treats absolute and cwd-relative paths as the same primed key", async () => {
		const clock = createManualClock();
		const { exec, calls } = fakeExec(() => ({ stdout: "# r", code: 0 }));
		const loader = createScopeLoader({
			exec,
			cwd: FIXED_CWD,
			budget: 100,
			debounceMs: 50,
			sendMessage: () => {},
			appendEntry: () => {},
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
		});
		const abs = resolvePath(FIXED_CWD, "src/foo.ts");
		expect(isAbsolute(abs)).toBe(true);

		loader.register(abs);
		clock.tick(50);
		await flushMicrotasks();
		expect(calls).toHaveLength(1);

		loader.register("src/foo.ts");
		clock.tick(50);
		await flushMicrotasks();
		expect(calls).toHaveLength(1);
	});
});

describe("scope-load: SCOPE_LOAD_TOOL_NAMES", () => {
	it("includes the built-in file tools", () => {
		expect(SCOPE_LOAD_TOOL_NAMES.has("read")).toBe(true);
		expect(SCOPE_LOAD_TOOL_NAMES.has("edit")).toBe(true);
		expect(SCOPE_LOAD_TOOL_NAMES.has("write")).toBe(true);
	});
	it("excludes tools that don't target a single file", () => {
		expect(SCOPE_LOAD_TOOL_NAMES.has("grep")).toBe(false);
		expect(SCOPE_LOAD_TOOL_NAMES.has("find")).toBe(false);
		expect(SCOPE_LOAD_TOOL_NAMES.has("bash")).toBe(false);
	});
});
