import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TrackerName = "seeds" | "gh" | "linear" | "bead";

export const TRACKERS: readonly TrackerName[] = ["seeds", "gh", "linear", "bead"];

export interface ResolverHit {
	tracker: TrackerName;
	matches: string[];
	source: string;
}

export type Resolver = (cwd: string) => ResolverHit;

export interface ActiveWorkResult {
	seeds?: string;
	gh?: string;
	linear?: string;
	bead?: string;
	warnings: string[];
}

export interface ActiveWorkOptions {
	cwd?: string;
	resolvers?: Resolver[];
	// Explicit overrides (e.g. from `--evidence-seeds`). When set, the resolver
	// chain for that tracker is short-circuited and the override is used as-is.
	// Empty string is treated as "not set".
	overrides?: Partial<Record<TrackerName, string | undefined>>;
}

function getCurrentBranch(cwd: string): string {
	try {
		const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return branch === "HEAD" ? "" : branch;
	} catch {
		return "";
	}
}

function readJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}
	const out: T[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		try {
			out.push(JSON.parse(trimmed) as T);
		} catch {
			// skip malformed lines — caller may have other valid rows
		}
	}
	return out;
}

// Seeds: <project>-<4–8 hex>. e.g. "mulch-f3d0", "seeds-a051".
const SEEDS_ID_RE = /\b([a-z][a-z0-9]*-[a-f0-9]{4,8})\b/g;
// Linear: <UPPER>-<digits>. e.g. "WEB-123", "ENG-4567". Two+ leading uppercase
// chars so single-letter prefixes don't collide with branch nicknames.
const LINEAR_ID_RE = /\b([A-Z]{2,}[A-Z0-9]*-\d+)\b/g;
// Bead: bd-<digits> or bead-<digits>.
const BEAD_ID_RE = /\b((?:bd|bead)-\d+)\b/gi;
// GH: gh-<digits> or #<digits>.
const GH_ID_RE = /(?:^|[^a-zA-Z0-9])(?:gh-|#)(\d+)\b/gi;

function matchAll(re: RegExp, text: string, group = 1): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(re)) {
		const val = m[group];
		if (val) out.add(val);
	}
	return [...out].sort();
}

export const seedsResolver: Resolver = (cwd) => {
	type SeedsIssue = { id?: unknown; status?: unknown };
	const issues = readJsonl<SeedsIssue>(join(cwd, ".seeds", "issues.jsonl"));
	const inProgress: string[] = [];
	for (const i of issues) {
		if (i.status === "in_progress" && typeof i.id === "string") inProgress.push(i.id);
	}
	if (inProgress.length > 0) {
		return {
			tracker: "seeds",
			matches: [...new Set(inProgress)].sort(),
			source: "in_progress",
		};
	}
	const branch = getCurrentBranch(cwd);
	const branchMatches = matchAll(SEEDS_ID_RE, branch);
	if (branchMatches.length > 0) {
		return { tracker: "seeds", matches: branchMatches, source: "branch" };
	}
	return { tracker: "seeds", matches: [], source: "none" };
};

export const ghResolver: Resolver = (cwd) => {
	const branch = getCurrentBranch(cwd);
	if (branch) {
		try {
			const out = execFileSync("gh", ["pr", "view", "--json", "number", "--jq", ".number"], {
				cwd,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
			if (out && /^\d+$/.test(out)) {
				return { tracker: "gh", matches: [`#${out}`], source: "gh-cli" };
			}
		} catch {
			// gh missing, unauthenticated, or no PR linked — fall through
		}
	}
	const branchMatches = matchAll(GH_ID_RE, branch).map((n) => `#${n}`);
	if (branchMatches.length > 0) {
		return { tracker: "gh", matches: branchMatches, source: "branch" };
	}
	return { tracker: "gh", matches: [], source: "none" };
};

export const linearResolver: Resolver = (cwd) => {
	const branch = getCurrentBranch(cwd);
	const branchMatches = matchAll(LINEAR_ID_RE, branch);
	if (branchMatches.length > 0) {
		return { tracker: "linear", matches: branchMatches, source: "branch" };
	}
	return { tracker: "linear", matches: [], source: "none" };
};

export const beadResolver: Resolver = (cwd) => {
	type BeadIssue = { id?: unknown; status?: unknown };
	const issues = readJsonl<BeadIssue>(join(cwd, ".beads", "issues.jsonl"));
	const inProgress: string[] = [];
	for (const i of issues) {
		if (i.status === "in_progress" && typeof i.id === "string") inProgress.push(i.id);
	}
	if (inProgress.length > 0) {
		return {
			tracker: "bead",
			matches: [...new Set(inProgress)].sort(),
			source: "in_progress",
		};
	}
	const branch = getCurrentBranch(cwd);
	const branchMatches = matchAll(BEAD_ID_RE, branch).map((s) => s.toLowerCase());
	if (branchMatches.length > 0) {
		return {
			tracker: "bead",
			matches: [...new Set(branchMatches)].sort(),
			source: "branch",
		};
	}
	return { tracker: "bead", matches: [], source: "none" };
};

export const DEFAULT_RESOLVERS: Resolver[] = [
	seedsResolver,
	ghResolver,
	linearResolver,
	beadResolver,
];

export function resolveActiveWork(options: ActiveWorkOptions = {}): ActiveWorkResult {
	const cwd = options.cwd ?? process.cwd();
	const resolvers = options.resolvers ?? DEFAULT_RESOLVERS;
	const overrides = options.overrides ?? {};
	const result: ActiveWorkResult = { warnings: [] };

	const hitsByTracker = new Map<TrackerName, ResolverHit>();
	for (const resolver of resolvers) {
		const hit = resolver(cwd);
		// First resolver to claim a tracker wins; later ones for the same tracker
		// are ignored so callers can prepend a custom resolver to override.
		if (!hitsByTracker.has(hit.tracker)) hitsByTracker.set(hit.tracker, hit);
	}

	for (const tracker of TRACKERS) {
		const override = overrides[tracker];
		if (typeof override === "string" && override !== "") {
			result[tracker] = override;
			continue;
		}
		const hit = hitsByTracker.get(tracker);
		if (!hit) continue;
		if (hit.matches.length === 1) {
			result[tracker] = hit.matches[0];
		} else if (hit.matches.length > 1) {
			result.warnings.push(
				`active-work: multiple ${tracker} candidates [${hit.matches.join(", ")}] from ${hit.source}; pass --evidence-${tracker} <id> to disambiguate`,
			);
		}
	}
	return result;
}
