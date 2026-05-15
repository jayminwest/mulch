import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import {
	buildPrimeCommandRegistration,
	composePrimeCommandMessage,
	listConfiguredDomains,
	PRIME_COMMAND_BANNER_END,
	PRIME_COMMAND_BANNER_START,
	PRIME_COMMAND_CUSTOM_TYPE,
	type PrimeCommandDeps,
	parsePrimeArgs,
	runPrimeCommand,
} from "../../extensions/pi/lib/commands.ts";

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

interface CapturedMessage {
	message: { customType: string; content: string; display: boolean; details?: unknown };
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };
}

function makeSendMessage(): {
	sent: CapturedMessage[];
	send: PrimeCommandDeps["sendMessage"];
} {
	const sent: CapturedMessage[] = [];
	return {
		sent,
		send: (message, options) => sent.push({ message, options }),
	};
}

interface CapturedNotify {
	message: string;
	type?: "info" | "warning" | "error";
}

function makeNotify(): {
	notes: CapturedNotify[];
	notify: NonNullable<PrimeCommandDeps["notify"]>;
} {
	const notes: CapturedNotify[] = [];
	return {
		notes,
		notify: (message, type) => notes.push({ message, type }),
	};
}

describe("commands: parsePrimeArgs", () => {
	it("returns empty domain when args is blank", () => {
		expect(parsePrimeArgs("")).toEqual({});
		expect(parsePrimeArgs("   ")).toEqual({});
	});
	it("trims and returns the single token as a domain", () => {
		expect(parsePrimeArgs("  cli  ")).toEqual({ domain: "cli" });
	});
	it("rejects multi-token input with a usage error", () => {
		const out = parsePrimeArgs("cli architecture");
		expect(out.domain).toBeUndefined();
		expect(out.error).toMatch(/Usage:/);
	});
});

describe("commands: composePrimeCommandMessage", () => {
	it("wraps the body in stable banners and labels the scope", () => {
		const out = composePrimeCommandMessage("cli", "# records");
		expect(out).toContain(PRIME_COMMAND_BANNER_START);
		expect(out).toContain(PRIME_COMMAND_BANNER_END);
		expect(out).toContain("/ml:prime cli");
		expect(out).toContain("# records");
	});
});

describe("commands: listConfiguredDomains", () => {
	let tmpDir: string;
	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-pi-cmd-"));
		await mkdir(join(tmpDir, ".mulch", "expertise"), { recursive: true });
	});
	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns sorted domain names from mulch.config.yaml", async () => {
		await writeFile(
			join(tmpDir, ".mulch", "mulch.config.yaml"),
			["version: '1'", "domains:", "  cli: {}", "  architecture: {}", "  testing: {}", ""].join(
				"\n",
			),
			"utf-8",
		);
		const out = await listConfiguredDomains(tmpDir);
		expect(out).toEqual(["architecture", "cli", "testing"]);
	});

	it("returns an empty list when config is missing", async () => {
		const out = await listConfiguredDomains(tmpDir);
		expect(out).toEqual([]);
	});
});

describe("commands: runPrimeCommand", () => {
	const FIXED_CWD = "/tmp/mulch-pi-cmd";

	it("invokes `ml prime <domain>` and forwards stdout via sendMessage as a steer", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "# primed cli", code: 0 }));
		const { sent, send } = makeSendMessage();
		const { notes, notify } = makeNotify();
		const result = await runPrimeCommand(
			{ exec, cwd: FIXED_CWD, sendMessage: send, notify },
			"cli",
		);
		expect(result).toEqual({ ok: true, scope: "cli", exitCode: 0 });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("ml");
		expect(calls[0]?.args).toEqual(["prime", "cli"]);
		expect(calls[0]?.cwd).toBe(FIXED_CWD);
		expect(sent).toHaveLength(1);
		const message = sent[0]?.message;
		expect(message?.customType).toBe(PRIME_COMMAND_CUSTOM_TYPE);
		expect(message?.display).toBe(false);
		expect(message?.content).toContain("# primed cli");
		expect(sent[0]?.options).toEqual({ deliverAs: "steer" });
		expect(notes.some((n) => n.message.includes("re-injected"))).toBe(true);
	});

	it("invokes `ml prime` with no domain when scope is omitted", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "# primed all", code: 0 }));
		const { sent, send } = makeSendMessage();
		const result = await runPrimeCommand({ exec, cwd: FIXED_CWD, sendMessage: send }, undefined);
		expect(result.ok).toBe(true);
		expect(result.scope).toBe("(all)");
		expect(calls[0]?.args).toEqual(["prime"]);
		expect(sent).toHaveLength(1);
	});

	it("does not send a message when ml prime exits non-zero", async () => {
		const { exec } = fakeExec(() => ({ stdout: "", stderr: "boom", code: 1 }));
		const { sent, send } = makeSendMessage();
		const { notes, notify } = makeNotify();
		const result = await runPrimeCommand(
			{ exec, cwd: FIXED_CWD, sendMessage: send, notify },
			"cli",
		);
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		expect(sent).toHaveLength(0);
		expect(notes.some((n) => n.type === "error")).toBe(true);
	});

	it("does not send a message when stdout is empty on a clean exit", async () => {
		const { exec } = fakeExec(() => ({ stdout: "  \n", code: 0 }));
		const { sent, send } = makeSendMessage();
		const result = await runPrimeCommand({ exec, cwd: FIXED_CWD, sendMessage: send }, "cli");
		expect(result.ok).toBe(true);
		expect(sent).toHaveLength(0);
	});

	it("swallows exec errors and notifies", async () => {
		const { exec } = fakeExec(() => new Error("ENOENT"));
		const { sent, send } = makeSendMessage();
		const { notes, notify } = makeNotify();
		const result = await runPrimeCommand(
			{ exec, cwd: FIXED_CWD, sendMessage: send, notify },
			"cli",
		);
		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(-1);
		expect(sent).toHaveLength(0);
		expect(notes.some((n) => n.type === "error")).toBe(true);
	});
});

describe("commands: buildPrimeCommandRegistration", () => {
	let tmpDir: string;
	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-pi-cmd-reg-"));
		await mkdir(join(tmpDir, ".mulch", "expertise"), { recursive: true });
		await writeFile(
			join(tmpDir, ".mulch", "mulch.config.yaml"),
			["version: '1'", "domains:", "  cli: {}", "  architecture: {}", ""].join("\n"),
			"utf-8",
		);
	});
	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("uses ml:prime as the registration name", () => {
		const reg = buildPrimeCommandRegistration(() => undefined);
		expect(reg.name).toBe("ml:prime");
	});

	it("autocompletes domains by prefix", async () => {
		const { exec } = fakeExec(() => ({ stdout: "", code: 0 }));
		const { send } = makeSendMessage();
		const reg = buildPrimeCommandRegistration(() => ({
			exec,
			cwd: tmpDir,
			sendMessage: send,
		}));
		const all = await reg.options.getArgumentCompletions("");
		expect(all).toEqual([
			{
				value: "architecture",
				label: "architecture",
				description: "Re-prime the architecture domain",
			},
			{ value: "cli", label: "cli", description: "Re-prime the cli domain" },
		]);
		const filtered = await reg.options.getArgumentCompletions("c");
		expect(filtered).toEqual([
			{ value: "cli", label: "cli", description: "Re-prime the cli domain" },
		]);
	});

	it("returns no completions when deps are unavailable (between sessions)", async () => {
		const reg = buildPrimeCommandRegistration(() => undefined);
		const out = await reg.options.getArgumentCompletions("");
		expect(out).toEqual([]);
	});

	it("handler short-circuits when deps are unavailable", async () => {
		const reg = buildPrimeCommandRegistration(() => undefined);
		// Should not throw.
		await reg.options.handler("cli");
	});

	it("handler shells out and forwards to sendMessage", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "# primed cli", code: 0 }));
		const { sent, send } = makeSendMessage();
		const reg = buildPrimeCommandRegistration(() => ({ exec, cwd: tmpDir, sendMessage: send }));
		await reg.options.handler("cli");
		expect(calls[0]?.args).toEqual(["prime", "cli"]);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.message.customType).toBe(PRIME_COMMAND_CUSTOM_TYPE);
	});

	it("handler notifies and skips exec when args are malformed", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "", code: 0 }));
		const { sent, send } = makeSendMessage();
		const { notes, notify } = makeNotify();
		const reg = buildPrimeCommandRegistration(() => ({
			exec,
			cwd: tmpDir,
			sendMessage: send,
			notify,
		}));
		await reg.options.handler("cli architecture");
		expect(calls).toHaveLength(0);
		expect(sent).toHaveLength(0);
		expect(notes.some((n) => n.type === "warning" && n.message.includes("Usage:"))).toBe(true);
	});
});
