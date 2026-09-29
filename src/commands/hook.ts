// `ml hook`: the Claude Code PreToolUse handler installed by `ml setup claude`.
//
// Reads the hook JSON ({session_id, cwd, hook_event_name, tool_name,
// tool_input}) on stdin and prints at most one line of hook JSON:
//   deny    Write/Edit/MultiEdit/NotebookEdit/Bash writing .mulch/expertise/*.jsonl
//           {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//            "permissionDecision":"deny","permissionDecisionReason":"..."}}
//   inject  Read/Edit/Write/MultiEdit/NotebookEdit on a file with anchored records
//           {"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}
// Otherwise it prints nothing (normal permission flow continues). Every error
// fails open and silent: a broken hook must not block or clutter tool calls.

import type { Command } from "commander";
import { FILE_TOOLS, guardDecision } from "../utils/hook-guard.ts";
import { injectForFile } from "../utils/hook-inject.ts";

const INJECT_TOOLS: Record<string, string> = { Read: "file_path", ...FILE_TOOLS };

function field(obj: unknown, key: string): unknown {
	return typeof obj === "object" && obj !== null
		? (obj as Record<string, unknown>)[key]
		: undefined;
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v !== "" ? v : undefined;
}

function output(extra: Record<string, string>): string {
	return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...extra } })}\n`;
}

/** Hook stdout for raw stdin: deny JSON, additionalContext JSON, or "". */
export async function hookOutput(raw: string, fallbackCwd: string): Promise<string> {
	try {
		const input: unknown = JSON.parse(raw);
		const event = str(field(input, "hook_event_name"));
		if (event !== undefined && event !== "PreToolUse") return "";
		const cwd = str(field(input, "cwd")) ?? fallbackCwd;
		const reason = guardDecision(input, cwd);
		if (reason) return output({ permissionDecision: "deny", permissionDecisionReason: reason });

		const tool = str(field(input, "tool_name")) ?? "";
		const key = INJECT_TOOLS[tool];
		const file = key ? str(field(field(input, "tool_input"), key)) : undefined;
		if (!file) return "";
		const session = str(field(input, "session_id"));
		const context = await injectForFile({ file, cwd, tool, ...(session ? { session } : {}) });
		return context ? output({ additionalContext: context }) : "";
	} catch {
		return "";
	}
}

export function registerHookCommand(program: Command): void {
	program
		.command("hook")
		.description(
			"Claude Code PreToolUse handler (installed by `ml setup claude`): injects file-anchored records, denies hand edits of .mulch/expertise/*.jsonl; reads hook JSON on stdin",
		)
		.action(async () => {
			const raw = process.stdin.isTTY ? "" : await Bun.stdin.text();
			process.stdout.write(await hookOutput(raw, process.cwd()));
		});
}
