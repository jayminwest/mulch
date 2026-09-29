// Injection half of `ml hook` (Claude Code PreToolUse on Read/Edit/Write/
// MultiEdit/NotebookEdit). When the agent touches a file, the records anchored
// to that file (files[] / dir_anchors[]) arrive as additionalContext next to
// the tool result: failures first, ~500-token budget, stale records last.
// Unanchored records are left to the SessionStart `ml prime` index, so a file
// with no anchored records produces no output at all.
//
// State lives in `.mulch/state/` (self-gitignored with a `*` .gitignore):
//   sessions/<session_id>.txt  ids already injected this session, one per line
//                              (no record is injected twice per session)
//   usage.jsonl                one line per injection:
//     {"ts":"<ISO>","session":"<id>|null","tool":"Read","files":["src/a.ts"],"ids":["mx-1a2b3c"]}
// The usage log is passive telemetry for ranking / warren; nothing reads it on
// the hook path.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { estimateRecordText } from "../commands/prime.ts";
import { collectSupersededIds } from "../commands/prune.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { applyBudget, type DomainRecords } from "./budget.ts";
import { getExpertisePath, getMulchDir, readConfig } from "./config.ts";
import { readExpertiseFile } from "./expertise.ts";
import { formatIndexLine } from "./format.ts";
import { matchesFileAnchors } from "./git.ts";
import { findStaleRecords, primeStaleIds } from "./staleness.ts";

export const HOOK_BUDGET = 500;
const SESSION_TTL_MS = 7 * 86_400_000;

export interface InjectRequest {
	/** Absolute or cwd-relative path of the file the tool touches. */
	file: string;
	cwd: string;
	session?: string;
	tool: string;
	now?: Date;
}

/** Nearest ancestor of `cwd` holding `.git` (file or dir); `cwd` if none. */
export function findRepoRoot(cwd: string): string {
	let dir = resolve(cwd);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(cwd);
		dir = parent;
	}
}

function stateDir(cwd: string): string {
	return join(getMulchDir(cwd), "state");
}

function sessionFile(cwd: string, session: string): string {
	return join(stateDir(cwd), "sessions", `${session.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`);
}

async function readSeen(cwd: string, session: string | undefined): Promise<Set<string>> {
	if (!session) return new Set();
	try {
		const raw = await readFile(sessionFile(cwd, session), "utf-8");
		return new Set(raw.split("\n").filter(Boolean));
	} catch {
		return new Set();
	}
}

async function pruneOldSessions(dir: string, now: number): Promise<void> {
	for (const name of await readdir(dir)) {
		const p = join(dir, name);
		const s = await stat(p);
		if (now - s.mtimeMs > SESSION_TTL_MS) await unlink(p);
	}
}

async function recordInjection(req: InjectRequest, rel: string, ids: string[]): Promise<void> {
	const dir = stateDir(req.cwd);
	await mkdir(join(dir, "sessions"), { recursive: true });
	const ignore = join(dir, ".gitignore");
	if (!existsSync(ignore)) await writeFile(ignore, "*\n", "utf-8");
	const now = req.now ?? new Date();
	if (req.session) {
		const file = sessionFile(req.cwd, req.session);
		if (!existsSync(file)) await pruneOldSessions(dirname(file), now.getTime());
		await appendFile(file, `${ids.join("\n")}\n`, "utf-8");
	}
	const line = {
		ts: now.toISOString(),
		session: req.session ?? null,
		tool: req.tool,
		files: [rel],
		ids,
	};
	await appendFile(join(dir, "usage.jsonl"), `${JSON.stringify(line)}\n`, "utf-8");
}

/** Repo-relative path for anchor matching, or null when outside the repo. */
function repoRelative(file: string, cwd: string): string | null {
	const root = findRepoRoot(cwd);
	const rel = relative(root, resolve(cwd, file));
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
	return rel.split(sep).join("/");
}

async function loadAnchored(
	cwd: string,
	domainNames: string[],
	rel: string,
	seen: Set<string>,
): Promise<DomainRecords[]> {
	const loaded: DomainRecords[] = [];
	for (const domain of domainNames) {
		loaded.push({ domain, records: await readExpertiseFile(getExpertisePath(domain, cwd)) });
	}
	const { supersededIds } = collectSupersededIds(loaded);
	return loaded
		.map(({ domain, records }) => ({
			domain,
			records: records.filter(
				(r) =>
					!!r.id && !supersededIds.has(r.id) && !seen.has(r.id) && matchesFileAnchors(r, [rel]),
			),
		}))
		.filter((d) => d.records.length > 0);
}

/**
 * The additionalContext for a file touch, or "" when nothing new is anchored
 * to it. Records what it injected (session dedup + usage log).
 */
export async function injectForFile(req: InjectRequest): Promise<string> {
	if (!existsSync(join(getMulchDir(req.cwd), "mulch.config.yaml"))) return "";
	const rel = repoRelative(req.file, req.cwd);
	if (!rel || rel.startsWith(".mulch/")) return "";

	const config = await readConfig(req.cwd);
	const seen = await readSeen(req.cwd, req.session);
	const domains = await loadAnchored(req.cwd, Object.keys(config.domains), rel, seen);
	if (domains.length === 0) return "";

	const staleIds = primeStaleIds(
		findStaleRecords(
			domains.flatMap((d) => d.records),
			{
				cwd: findRepoRoot(req.cwd),
				now: req.now ?? new Date(),
				shelfLife: config.classification_defaults.shelf_life,
			},
		),
	);
	const isStale = (r: ExpertiseRecord) => !!(r.id && staleIds.has(r.id));
	const { kept } = applyBudget(domains, HOOK_BUDGET, estimateRecordText, () => true, isStale);
	// Failures first, stale last (applyBudget keeps file order).
	const rank = (r: ExpertiseRecord) => (r.type === "failure" ? 0 : 1) + (isStale(r) ? 2 : 0);
	const records = kept.flatMap((d) => d.records).sort((a, b) => rank(a) - rank(b));
	if (records.length === 0) return "";

	await recordInjection(
		req,
		rel,
		records.map((r) => r.id ?? ""),
	);
	const lines = records.map((r) => formatIndexLine(r, isStale(r)));
	return `mulch: records anchored to ${rel} (\`ml show <id>\` for the full record)\n${lines.join("\n")}`;
}
