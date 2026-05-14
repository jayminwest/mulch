import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import yaml from "js-yaml";
import type { DomainConfig, MulchConfig } from "../schemas/config.ts";
import { DEFAULT_CONFIG } from "../schemas/config.ts";
import { createExpertiseFile } from "./expertise.ts";

const MULCH_DIR = ".mulch";
const CONFIG_FILE = "mulch.config.yaml";
const EXPERTISE_DIR = "expertise";

export const GITATTRIBUTES_LINE = ".mulch/expertise/*.jsonl merge=union";

const INIT_CONFIG_HEADER = `# Mulch configuration. See https://github.com/jayminwest/mulch for docs.
#
# Required fields below. Optional knobs are commented out at the bottom — uncomment
# to enable. Note: commands that mutate this file (e.g. \`ml add <domain>\`,
# \`ml record\` auto-creating a domain) rewrite it via the YAML serializer and
# strip these comments.

`;

const INIT_CONFIG_OPTIONAL_KNOBS = `
# ─── Optional knobs (uncomment to enable) ────────────────────────────────────
#
# prime:
#   # Pin \`ml prime\`'s unscoped output shape. When unset (recommended), prime
#   # auto-flips to manifest above 100 records or 5 domains and renders full
#   # records otherwise. Set explicitly to override both directions:
#   #   - full     → always emit full records (skip the auto-flip)
#   #   - manifest → always emit the domain index
#   # --full / --manifest / scoping flags always override this on a per-call basis.
#   default_mode: full        # one of: full, manifest
#
# search:
#   # Multiplier applied to BM25 scores so records with more confirmed outcomes
#   # rank higher. 0 disables (pure BM25). Default 0.1: a record with N successes
#   # gets a (1 + 0.1*N) boost. Override per-call with \`ml search --no-boost\`.
#   boost_factor: 0.1
#
# disabled_types:
#   # Names of registered types (built-in or custom) that emit a deprecation
#   # warning on write. Reads still succeed; the type stays in CLI choices so
#   # peers in shared domains don't hard-fail. Use to retire a type gracefully.
#   - failure
#
# custom_types:
#   # Project-specific record types. Required + optional fields, dedup_key,
#   # and a summary template. See README for the full schema.
#   hypothesis:
#     required: [statement, prediction]
#     optional: [evidence_files]
#     dedup_key: statement
#     summary: "{statement}"   # tokens use single braces; {{statement}} also accepted
#     # aliases: rename a field while still reading legacy on-disk records.
#     # Map canonical (current) name → list of legacy names. At read time,
#     # legacy fields are rewritten to canonical and dropped from the record.
#     aliases:
#       statement: [claim]
#   # Inherit from a built-in type with extends:. Required/optional arrays
#   # merge with the parent's (union); dedup_key, summary, compact, section_title,
#   # extracts_files, and files_field override only when set, otherwise inherit.
#   # Custom-from-custom is not supported in v1.
#   adr:
#     extends: decision
#     required: [decision_status, deciders]   # added on top of decision's [title, rationale]
#     summary: "{decision_status}: {title}"   # tokens must be declared fields (parent's included)
#
# hooks:
#   # Lifecycle hook scripts. Each event maps to an ordered list of shell
#   # commands. Mulch invokes each with the relevant payload as JSON on stdin.
#   # Exit 0 = continue. Non-zero from a \`pre-*\` hook blocks the action; from
#   # a \`post-*\` hook emits a warning. Only \`pre-record\` and \`pre-prime\` may
#   # mutate the payload by printing modified JSON on stdout; \`pre-prune\` is
#   # block-or-allow only — its stdout is ignored.
#   #
#   # pre-record:    [./.mulch/hooks/scan-secrets.sh, ./.mulch/hooks/require-owner.sh]
#   # post-record:   [./.mulch/hooks/post-to-slack.sh]
#   # pre-prime:     [./.mulch/hooks/filter-by-team.sh]
#   # pre-prune:     [./.mulch/hooks/digest-then-confirm.sh]
#
# hook_settings:
#   # Per-hook execution timeout in milliseconds. Default 5000.
#   timeout_ms: 5000
`;

export function buildInitialConfigYaml(): string {
	const body = yaml.dump(DEFAULT_CONFIG, { lineWidth: -1 });
	return INIT_CONFIG_HEADER + body + INIT_CONFIG_OPTIONAL_KNOBS;
}

export const MULCH_README = `# .mulch/

This directory is managed by [mulch](https://github.com/jayminwest/mulch) — a structured expertise layer for coding agents.

## Key Commands

- \`ml init\`      — Initialize a .mulch directory
- \`ml add\`       — Add a new domain
- \`ml record\`    — Record an expertise record
- \`ml edit\`      — Edit an existing record
- \`ml query\`     — Query expertise records
- \`ml prime [domain]\` — Output a priming prompt (optionally scoped to one domain)
- \`ml search\`   — Search records across domains
- \`ml status\`    — Show domain statistics
- \`ml validate\`  — Validate all records against the schema
- \`ml prune\`     — Remove expired records

## Structure

- \`mulch.config.yaml\` — Configuration file
- \`expertise/\`        — JSONL files, one per domain

## Configuration

Optional knobs in \`mulch.config.yaml\`:

\`\`\`yaml
prime:
  default_mode: manifest   # or "full". Omit to let \`ml prime\` auto-flip:
                           # full output until the corpus exceeds 100 records
                           # or 5 domains, then manifest. Set explicitly to pin
                           # one mode. Scoping flags (\`--files\`, \`<domain>\`)
                           # always force full.

search:
  boost_factor: 0.1        # multiplier on BM25 scores for confirmed records.
                           # 0 disables (pure BM25). Override with
                           # \`ml search --no-boost\`.
\`\`\`
`;

function gitCommonDir(cwd: string): string | null {
	try {
		const raw = execFileSync("git", ["rev-parse", "--git-common-dir"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (!raw) return null;
		return resolve(cwd, raw);
	} catch {
		return null;
	}
}

function resolveWorktreeRoot(cwd: string): string {
	const common = gitCommonDir(cwd);
	if (!common) return cwd;

	// .git/worktrees/<name> → strip to repo root; .git → already main
	const mainRoot = common.endsWith(".git") ? dirname(common) : dirname(dirname(common));
	const mainResolved = resolve(mainRoot);

	if (mainResolved === resolve(cwd)) return cwd;

	// Only redirect if main repo has a .mulch/ with config
	const mainMulchConfig = join(mainResolved, MULCH_DIR, CONFIG_FILE);
	if (existsSync(mainMulchConfig)) {
		return mainResolved;
	}

	return cwd;
}

export function isInsideWorktree(cwd: string = process.cwd()): boolean {
	const common = gitCommonDir(cwd);
	if (!common) return false;

	// For actual worktrees, --git-common-dir always returns the main .git dir
	// (ends with ".git"). Submodules return /parent/.git/modules/<name> which
	// does NOT end with ".git" — those are not worktrees, avoid false positive.
	if (!common.endsWith(".git")) return false;

	const mainRoot = dirname(common);
	return resolve(mainRoot) !== resolve(cwd);
}

export function getMulchDir(cwd: string = process.cwd()): string {
	return join(resolveWorktreeRoot(cwd), MULCH_DIR);
}

export function getConfigPath(cwd: string = process.cwd()): string {
	return join(getMulchDir(cwd), CONFIG_FILE);
}

export function getExpertiseDir(cwd: string = process.cwd()): string {
	return join(getMulchDir(cwd), EXPERTISE_DIR);
}

export function validateDomainName(domain: string): void {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(domain)) {
		throw new Error(
			`Invalid domain name: "${domain}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
		);
	}
}

export function getExpertisePath(domain: string, cwd: string = process.cwd()): string {
	validateDomainName(domain);
	return join(getExpertiseDir(cwd), `${domain}.jsonl`);
}

// Legacy on-disk shape was `domains: [a, b]`; current shape is
// `domains: { a: {}, b: {} }`. Normalize both to the object map at read time so
// older configs keep working without user migration.
function normalizeDomains(raw: unknown): Record<string, DomainConfig> {
	if (Array.isArray(raw)) {
		const map: Record<string, DomainConfig> = {};
		for (const name of raw) {
			if (typeof name === "string") map[name] = {};
		}
		return map;
	}
	if (raw && typeof raw === "object") return raw as Record<string, DomainConfig>;
	return {};
}

// Backfill required-by-type top-level sections that a hand-written minimal
// config may omit. Schema marks `governance` and `classification_defaults` as
// required, but consumers (doctor, prune, status, compact, prime) destructure
// them directly and would otherwise crash with a TypeError on a config that
// only declares `domains:`. Shallow-merge so partial user overrides
// (e.g. `governance: { max_entries: 50 }`) keep the other defaults.
function applyConfigDefaults(parsed: MulchConfig): MulchConfig {
	const userGov = (parsed.governance ?? {}) as Partial<MulchConfig["governance"]>;
	const userCD = (parsed.classification_defaults ?? {}) as Partial<
		MulchConfig["classification_defaults"]
	>;
	const userShelf = (userCD.shelf_life ?? {}) as Partial<
		MulchConfig["classification_defaults"]["shelf_life"]
	>;
	parsed.governance = { ...DEFAULT_CONFIG.governance, ...userGov };
	parsed.classification_defaults = {
		shelf_life: { ...DEFAULT_CONFIG.classification_defaults.shelf_life, ...userShelf },
	};
	return parsed;
}

export async function readConfig(cwd: string = process.cwd()): Promise<MulchConfig> {
	const configPath = getConfigPath(cwd);
	let content: string;
	try {
		content = await readFile(configPath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error("No .mulch/ directory found. Run `mulch init` to set up this project.");
		}
		throw err;
	}
	let parsed: MulchConfig;
	try {
		parsed = (yaml.load(content) ?? {}) as MulchConfig;
	} catch (err) {
		throw new Error(
			`Failed to parse mulch.config.yaml: ${(err as Error).message}. Check the YAML syntax.`,
		);
	}
	if (!parsed || typeof parsed !== "object") {
		// Empty file or scalar at top level — treat as empty object so defaults apply.
		parsed = {} as MulchConfig;
	}
	parsed.domains = normalizeDomains(parsed.domains);
	return applyConfigDefaults(parsed);
}

export async function addDomain(domain: string, cwd: string = process.cwd()): Promise<void> {
	validateDomainName(domain);
	const config = await readConfig(cwd);
	if (!(domain in config.domains)) {
		config.domains[domain] = {};
		await writeConfig(config, cwd);
	}
	const filePath = getExpertisePath(domain, cwd);
	if (!existsSync(filePath)) {
		await createExpertiseFile(filePath);
	}
}

export async function removeDomain(domain: string, cwd: string = process.cwd()): Promise<void> {
	validateDomainName(domain);
	const config = await readConfig(cwd);
	if (!(domain in config.domains)) {
		throw new Error(`Domain "${domain}" not found in config.`);
	}
	delete config.domains[domain];
	await writeConfig(config, cwd);
	const filePath = getExpertisePath(domain, cwd);
	if (existsSync(filePath)) {
		await rm(filePath);
	}
}

export async function writeConfig(config: MulchConfig, cwd: string = process.cwd()): Promise<void> {
	const configPath = getConfigPath(cwd);
	const content = yaml.dump(config, { lineWidth: -1 });
	await writeFile(configPath, content, "utf-8");
}

export async function initMulchDir(cwd: string = process.cwd()): Promise<void> {
	const mulchDir = getMulchDir(cwd);
	const expertiseDir = getExpertiseDir(cwd);
	await mkdir(mulchDir, { recursive: true });
	await mkdir(expertiseDir, { recursive: true });

	// Only write default config if none exists — preserve user customizations.
	// Use the templated YAML (with commented-out optional knobs) for discoverability;
	// subsequent writes via writeConfig() round-trip through yaml.dump and lose comments.
	const configPath = getConfigPath(cwd);
	if (!existsSync(configPath)) {
		await writeFile(configPath, buildInitialConfigYaml(), "utf-8");
	}

	// Create or append .gitattributes with merge=union for JSONL files
	const gitattributesPath = join(cwd, ".gitattributes");
	let existing = "";
	try {
		existing = await readFile(gitattributesPath, "utf-8");
	} catch {
		// File doesn't exist yet — will create it
	}
	if (!existing.includes(GITATTRIBUTES_LINE)) {
		const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
		await writeFile(gitattributesPath, `${existing + separator + GITATTRIBUTES_LINE}\n`, "utf-8");
	}

	// Create .mulch/README.md if missing
	const readmePath = join(mulchDir, "README.md");
	if (!existsSync(readmePath)) {
		await writeFile(readmePath, MULCH_README, "utf-8");
	}
}
