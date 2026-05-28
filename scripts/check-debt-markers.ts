#!/usr/bin/env bun
/**
 * Debt-marker scanner (L5 toolkit ratchet).
 *
 * Walks every TypeScript file under the configured scan roots (default:
 * `src/`, `test/`, and `scripts/`) and flags any TODO / FIXME / HACK / XXX
 * marker that is not paired with a tracker reference on the same line.
 *
 * Tracker regex patterns are sourced from `scripts/debt-markers-budget.json`
 * under the `trackerPatterns` key. Patterns are JavaScript regex sources,
 * matched case-insensitively. Defaults cover mulch tracker prefixes
 * (`mulch-XXXX` seeds issues, `mx-XXXX` mulch records), GitHub-style
 * `#NNN` references, and any URL.
 *
 * Untracked markers must either be removed, paired with a tracker
 * reference, or — as an escape hatch — grandfathered in the budget's
 * `allowlist`. Each allowlist entry is a `path:line` string that must
 * match an existing untracked marker. The ratchet only goes DOWN: entries
 * should be removed as debt is paid off. This script never auto-edits its
 * own budget; loosening requires an explicit commit by a human.
 *
 * CLI:
 *   bun run scripts/check-debt-markers.ts                            # scan defaults
 *   bun run scripts/check-debt-markers.ts --budget P.json --root src --root scripts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SCRIPT_DIR = import.meta.dir;
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_BUDGET_PATH = resolve(SCRIPT_DIR, "debt-markers-budget.json");
const DEFAULT_SCAN_ROOTS = ["src", "test", "scripts"] as const;
const EXTENSIONS = [".ts", ".tsx"] as const;
const EXCLUDE_DIR_SEGMENTS = ["node_modules", "__golden__"] as const;
const DEFAULT_EXCLUDE_PATH_PREFIXES = ["src/ui/"] as const;
const SELF_EXCLUDE: ReadonlySet<string> = new Set([
	"scripts/check-debt-markers.ts",
	"scripts/check-debt-markers.test.ts",
]);

const MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b/;

export interface BudgetFile {
	trackerPatterns: string[];
	allowlist: string[];
}

export interface AllowlistEntry {
	path: string;
	line: number;
}

export interface Marker {
	path: string;
	line: number;
	marker: string;
	text: string;
}

export interface ScanOptions {
	repoRoot?: string;
	budgetPath?: string;
	scanRoots?: readonly string[];
	excludePathPrefixes?: readonly string[];
	selfExclude?: ReadonlySet<string>;
}

export interface ScanResult {
	untracked: Marker[];
	staleAllowlistEntries: string[];
	allowedSilenced: Marker[];
}

export function loadBudget(path: string): {
	trackerRegexes: RegExp[];
	allowlist: AllowlistEntry[];
	rawAllowlist: string[];
} {
	const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const patterns = raw.trackerPatterns;
	const allowlist = raw.allowlist;
	if (!Array.isArray(patterns)) {
		throw new Error(`${path}: "trackerPatterns" must be an array of regex source strings`);
	}
	const trackerRegexes: RegExp[] = [];
	for (const p of patterns) {
		if (typeof p !== "string") {
			throw new Error(`${path}: each trackerPatterns entry must be a string`);
		}
		trackerRegexes.push(new RegExp(p, "i"));
	}
	if (!Array.isArray(allowlist)) {
		throw new Error(`${path}: "allowlist" must be an array of "path:line" strings`);
	}
	const entries: AllowlistEntry[] = [];
	const rawAllowlist: string[] = [];
	for (const item of allowlist) {
		if (typeof item !== "string") {
			throw new Error(`${path}: allowlist entries must be strings ("path:line")`);
		}
		const idx = item.lastIndexOf(":");
		if (idx < 0) {
			throw new Error(`${path}: "${item}" is not formatted as "path:line"`);
		}
		const p = item.slice(0, idx);
		const lineNo = Number.parseInt(item.slice(idx + 1), 10);
		if (!p || !Number.isInteger(lineNo) || lineNo <= 0) {
			throw new Error(`${path}: "${item}" is not a valid "path:line" entry`);
		}
		entries.push({ path: p, line: lineNo });
		rawAllowlist.push(item);
	}
	return { trackerRegexes, allowlist: entries, rawAllowlist };
}

function* walk(dir: string): Generator<string> {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if ((EXCLUDE_DIR_SEGMENTS as readonly string[]).includes(entry)) continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			yield* walk(full);
		} else if (st.isFile()) {
			yield full;
		}
	}
}

function isTsFile(name: string): boolean {
	return EXTENSIONS.some((ext) => name.endsWith(ext));
}

function lineHasTracker(line: string, trackerRegexes: RegExp[]): boolean {
	for (const re of trackerRegexes) {
		if (re.test(line)) return true;
	}
	return false;
}

export function scan(options: ScanOptions = {}): ScanResult {
	const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
	const budgetPath = options.budgetPath ?? DEFAULT_BUDGET_PATH;
	const scanRoots = options.scanRoots ?? DEFAULT_SCAN_ROOTS;
	const excludePathPrefixes = options.excludePathPrefixes ?? DEFAULT_EXCLUDE_PATH_PREFIXES;
	const selfExclude = options.selfExclude ?? SELF_EXCLUDE;

	const { trackerRegexes, allowlist, rawAllowlist } = loadBudget(budgetPath);
	const allowSet = new Set(rawAllowlist);
	const matchedAllow = new Set<string>();

	const shouldExclude = (relPath: string): boolean => {
		if (selfExclude.has(relPath)) return true;
		for (const prefix of excludePathPrefixes) {
			if (relPath.startsWith(prefix)) return true;
		}
		return false;
	};

	const allFiles: string[] = [];
	for (const r of scanRoots) {
		for (const f of walk(resolve(repoRoot, r))) allFiles.push(f);
	}

	const untracked: Marker[] = [];
	const allowedSilenced: Marker[] = [];

	for (const abs of allFiles) {
		const rel = relative(repoRoot, abs).replaceAll("\\", "/");
		if (!isTsFile(rel)) continue;
		if (shouldExclude(rel)) continue;

		const content = readFileSync(abs, "utf8");
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const match = line.match(MARKER_RE);
			if (!match) continue;
			if (lineHasTracker(line, trackerRegexes)) continue;
			const lineNo = i + 1;
			const key = `${rel}:${lineNo}`;
			const marker: Marker = {
				path: rel,
				line: lineNo,
				marker: match[1] ?? match[0],
				text: line.trim(),
			};
			if (allowSet.has(key)) {
				matchedAllow.add(key);
				allowedSilenced.push(marker);
			} else {
				untracked.push(marker);
			}
		}
	}

	const staleAllowlistEntries: string[] = [];
	for (const entry of allowlist) {
		const key = `${entry.path}:${entry.line}`;
		if (!matchedAllow.has(key)) staleAllowlistEntries.push(key);
	}

	return { untracked, staleAllowlistEntries, allowedSilenced };
}

interface ParsedArgs {
	budgetPath?: string;
	repoRoot?: string;
	scanRoots: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const out: ParsedArgs = { scanRoots: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--budget") {
			out.budgetPath = argv[++i];
		} else if (a === "--root") {
			const v = argv[++i];
			if (v) out.scanRoots.push(v);
		} else if (a === "--repo-root") {
			out.repoRoot = argv[++i];
		}
	}
	return out;
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const options: ScanOptions = {};
	if (args.budgetPath) options.budgetPath = resolve(args.budgetPath);
	if (args.repoRoot) options.repoRoot = resolve(args.repoRoot);
	if (args.scanRoots.length > 0) options.scanRoots = args.scanRoots;

	const { untracked, staleAllowlistEntries } = scan(options);

	if (staleAllowlistEntries.length > 0) {
		console.error("debt-markers allowlist has entries that no longer match an untracked marker:");
		for (const k of staleAllowlistEntries) console.error(`  - ${k}`);
		console.error("Remove these entries — the ratchet only goes down.");
		console.error("");
	}

	if (untracked.length > 0) {
		console.error("Untracked debt markers found:");
		for (const m of untracked) {
			console.error(`  ${m.path}:${m.line}  ${m.marker}: ${m.text}`);
		}
		console.error("");
		console.error(
			"Pair each marker with a tracker reference on the same line, remove it, " +
				"or — only with justification — add it to the budget's allowlist.",
		);
		process.exit(1);
	}

	if (staleAllowlistEntries.length > 0) process.exit(1);

	console.log("Debt-marker guard ok.");
}

if (import.meta.main) main();
