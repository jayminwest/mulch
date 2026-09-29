// `ml setup claude` settings merge (mulch-7164).
import { describe, expect, it } from "bun:test";
import { CLAUDE_HOOKS, missingMulchHooks, syncMulchHooks } from "../../src/utils/claude-hooks.ts";

const other = { matcher: "Bash", hooks: [{ type: "command", command: "other-guard" }] };

describe("syncMulchHooks", () => {
	it("installs SessionStart prime + PreToolUse hook and keeps unrelated hooks", () => {
		const { settings, changed } = syncMulchHooks(
			{ model: "x", hooks: { PreToolUse: [other] } },
			false,
		);
		expect(changed).toBe(true);
		expect(settings.model).toBe("x");
		const hooks = settings.hooks as Record<string, unknown[]>;
		expect(hooks.PreToolUse).toEqual([
			other,
			{
				matcher: "Read|Edit|Write|MultiEdit|NotebookEdit|Bash",
				hooks: [{ type: "command", command: "ml hook" }],
			},
		]);
		expect(hooks.SessionStart).toEqual([
			{ matcher: "", hooks: [{ type: "command", command: "ml prime" }] },
		]);
		expect(missingMulchHooks(settings)).toEqual([]);
		expect(syncMulchHooks(settings, false).changed).toBe(false);
	});

	it("replaces stale mulch handlers instead of duplicating them", () => {
		const old = {
			hooks: {
				SessionStart: [
					{
						matcher: "",
						hooks: [
							{ type: "command", command: "ml prime --full" },
							{ type: "command", command: "keep-me" },
						],
					},
				],
			},
		};
		expect(missingMulchHooks(old)).toEqual(["SessionStart", "PreToolUse"]);
		const { settings } = syncMulchHooks(old, false);
		const start = (settings.hooks as Record<string, unknown[]>).SessionStart;
		expect(start).toEqual([
			{ matcher: "", hooks: [{ type: "command", command: "keep-me" }] },
			{ matcher: "", hooks: [{ type: "command", command: "ml prime" }] },
		]);
	});

	it("remove strips mulch handlers everywhere and drops empty events", () => {
		const installed = syncMulchHooks({ hooks: { PreToolUse: [other] } }, false).settings;
		const withLegacy = {
			...installed,
			hooks: {
				...(installed.hooks as object),
				PreCompact: [{ matcher: "", hooks: [{ type: "command", command: "mulch prime" }] }],
			},
		};
		const { settings, changed } = syncMulchHooks(withLegacy, true);
		expect(changed).toBe(true);
		expect(settings.hooks).toEqual({ PreToolUse: [other] });
		expect(syncMulchHooks({}, true)).toEqual({ settings: {}, changed: false });
		expect(syncMulchHooks(syncMulchHooks({}, false).settings, true).settings).toEqual({});
	});

	it("refuses malformed hook shapes", () => {
		expect(() => syncMulchHooks({ hooks: [] }, false)).toThrow("not an object");
		expect(() => syncMulchHooks({ hooks: { PreToolUse: {} } }, false)).toThrow("not an array");
		expect(() => missingMulchHooks({ hooks: "x" })).toThrow("not an object");
	});

	it("ships exactly two handlers", () => {
		expect(CLAUDE_HOOKS.map((h) => h.command)).toEqual(["ml prime", "ml hook"]);
	});
});
