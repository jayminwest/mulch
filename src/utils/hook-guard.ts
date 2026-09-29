// Guard half of `ml hook` (Claude Code PreToolUse). Denies hand edits of
// .mulch/expertise/*.jsonl: they skip the lock, schema validation, and dedup
// that `ml record` / `ml edit` / `ml delete` do.
//
//   Write | Edit | MultiEdit   tool_input.file_path
//   NotebookEdit               tool_input.notebook_path
//   Bash                       tool_input.command (best effort, see below)
//
// Bash is best effort, like roots' guard. The command is split into segments
// on ; && || | and newlines; a segment is denied when it mentions
// .mulch/expertise and
//   - redirects output (>, >>, &>) to an expertise .jsonl, or
//   - runs tee/rm/mv/truncate/touch/unlink/shred/sponge on one, or
//   - runs cp/ln/install/rsync with the last argument inside expertise/, or
//   - runs sed/perl with -i (in place), or dd with of=... .
// Reads (cat, grep, jq without a redirect), git, and `ml`/`mulch` itself pass.
// A shell can always evade this (cd first, variables, scripts); the goal is
// catching the accidental hand edit, not a determined one.

import { resolve } from "node:path";

export const FILE_TOOLS: Record<string, string> = {
	Write: "file_path",
	Edit: "file_path",
	MultiEdit: "file_path",
	NotebookEdit: "notebook_path",
};

export const GUARD_REASON =
	"mulch: do not edit .mulch/expertise/*.jsonl by hand. Use `ml record <domain> --type <t> --description ...` to add, " +
	"`ml edit <id>` to change, `ml delete <id>` to remove (they lock, validate, and dedup the store).";

const EXPERTISE_FILE = /(^|[\\/])\.mulch[\\/]+expertise[\\/]+[^\\/]+\.jsonl$/;
const EXPERTISE_MENTION = /\.mulch[\\/]+expertise/;

const WRITES_ARGS = new Set(["tee", "rm", "mv", "truncate", "touch", "unlink", "shred", "sponge"]);
const COPY_TO_LAST = new Set(["cp", "ln", "install", "rsync"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nohup", "time", "xargs"]);

function field(obj: unknown, key: string): unknown {
	return typeof obj === "object" && obj !== null
		? (obj as Record<string, unknown>)[key]
		: undefined;
}

function unquote(t: string): string {
	return t.replace(/^['"]|['"]$/g, "");
}

/** True when `p` (relative to `cwd`) is a `.mulch/expertise/<domain>.jsonl` file. */
export function isExpertiseFile(p: string, cwd: string): boolean {
	return EXPERTISE_FILE.test(resolve(cwd, p));
}

function commandWords(segment: string): string[] {
	const words = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
	while (words.length > 0) {
		const w = words[0] ?? "";
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w)) words.shift();
		else break;
	}
	return words;
}

function redirectsIntoExpertise(segment: string): boolean {
	const re = /(?:^|[^0-9<])(?:&?>>?|[0-9]>>?)\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/g;
	for (const m of segment.matchAll(re)) {
		if (EXPERTISE_MENTION.test(unquote(m[1] ?? ""))) return true;
	}
	return false;
}

function segmentWrites(segment: string): boolean {
	const [cmd = "", ...args] = commandWords(segment);
	const name = cmd.split("/").pop() ?? cmd;
	if (name === "ml" || name === "mulch") return false;
	if (redirectsIntoExpertise(segment)) return true;
	const paths = args.filter((a) => !a.startsWith("-"));
	const anyExpertise = paths.some((a) => EXPERTISE_MENTION.test(a));
	if (WRITES_ARGS.has(name)) return anyExpertise;
	if (COPY_TO_LAST.has(name)) return EXPERTISE_MENTION.test(paths[paths.length - 1] ?? "");
	if (name === "sed" || name === "perl") {
		return anyExpertise && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"));
	}
	if (name === "dd") return args.some((a) => a.startsWith("of=") && EXPERTISE_MENTION.test(a));
	return false;
}

/** Best effort: does this shell command look like it writes .mulch/expertise? */
export function bashWritesExpertise(command: string): boolean {
	if (!EXPERTISE_MENTION.test(command)) return false;
	return command.split(/\n|;|&&|\|\||\|/).some(segmentWrites);
}

/** The deny reason for a PreToolUse input, or null to allow. */
export function guardDecision(input: unknown, cwd: string): string | null {
	const tool = field(input, "tool_name");
	const toolInput = field(input, "tool_input");
	if (tool === "Bash") {
		const cmd = field(toolInput, "command");
		return typeof cmd === "string" && bashWritesExpertise(cmd) ? GUARD_REASON : null;
	}
	const key = typeof tool === "string" ? FILE_TOOLS[tool] : undefined;
	if (!key) return null;
	const target = field(toolInput, key);
	if (typeof target !== "string" || target === "") return null;
	return isExpertiseFile(target, cwd) ? GUARD_REASON : null;
}
