import { getRegistry } from "../registry/type-registry.ts";
import type { HookEvent, MulchConfig } from "../schemas/config.ts";
import { HOOK_EVENTS } from "../schemas/config.ts";
import type { BuiltinRecordType, ExpertiseRecord } from "../schemas/record.ts";
import { formatLinks, formatTimeAgo, xmlAttrEscape, xmlEscape } from "./format-helpers.ts";

export { formatTimeAgo };

export function getRecordSummary(record: ExpertiseRecord): string {
	const def = getRegistry().get(record.type);
	if (!def) {
		throw new Error(`Unknown record type: ${record.type}`);
	}
	return def.summary(record);
}

export function formatDomainExpertiseCompact(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
): string {
	const registry = getRegistry();
	const updatedStr = lastUpdated ? `, updated ${formatTimeAgo(lastUpdated)}` : "";
	const lines: string[] = [];

	lines.push(`## ${domain} (${records.length} records${updatedStr})`);
	for (const r of records) {
		const def = registry.get(r.type);
		if (!def) continue;
		lines.push(def.formatCompactLine(r));
	}

	return lines.join("\n");
}

export function formatPrimeOutputCompact(domainSections: string[]): string {
	const lines: string[] = [];

	lines.push("# Project Expertise (via Mulch)");
	lines.push("");

	if (domainSections.length === 0) {
		lines.push(
			"No expertise recorded yet. Use `ml add <domain>` to create a domain, then `ml record` to add records.",
		);
	} else {
		lines.push(domainSections.join("\n\n"));
	}

	lines.push("");
	lines.push("## Quick Reference");
	lines.push("");
	lines.push('- `ml search "query"` — find relevant records before implementing');
	lines.push(
		"- `ml prime --files src/foo.ts` — prime **before** editing a file, not just at session start",
	);
	lines.push("- `ml prime --context` — load records for git-changed files");
	lines.push('- `ml record <domain> --type <type> --description "..."`');
	lines.push(
		"  - Evidence: commit + files auto-populate from git. Trackers: `--evidence-seeds` / `--evidence-gh` / `--evidence-linear` / `--evidence-bead`. Override commit: `--evidence-commit <sha>`. Link records: `--relates-to <mx-id>`",
	);
	lines.push("- `ml doctor` — check record health");
	lines.push("");
	lines.push("**Record types and required flags:**");
	lines.push("");
	lines.push("| Type | Required flags |");
	lines.push("|------|----------------|");
	lines.push('| `convention` | `"<content>"` (positional) |');
	lines.push('| `pattern` | `--name "..." --description "..."` |');
	lines.push('| `failure` | `--description "..." --resolution "..."` |');
	lines.push('| `decision` | `--title "..." --rationale "..."` |');
	lines.push('| `reference` | `--name "..." --description "..."` |');
	lines.push('| `guide` | `--name "..." --description "..."` |');

	return lines.join("\n");
}

export function formatDomainExpertise(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
	options: { full?: boolean } = {},
): string {
	const full = options.full ?? false;
	const registry = getRegistry();
	const updatedStr = lastUpdated ? `, updated ${formatTimeAgo(lastUpdated)}` : "";
	const lines: string[] = [];

	lines.push(`## ${domain} (${records.length} records${updatedStr})`);
	lines.push("");

	const sections: string[] = [];
	for (const def of registry.enabled()) {
		const subset = records.filter((r) => r.type === def.name);
		const block = def.formatMarkdown(subset, full);
		if (block.length > 0) sections.push(block);
	}

	lines.push(sections.join("\n\n"));

	return lines.join("\n");
}

export function formatPrimeOutput(domainSections: string[]): string {
	const lines: string[] = [];

	lines.push("# Project Expertise (via Mulch)");
	lines.push("");
	lines.push("> **Context Recovery**: Run `ml prime` after compaction, clear, or new session");
	lines.push("");
	lines.push("## Rules");
	lines.push("");
	lines.push(
		"- **Record learnings**: When you discover a pattern, fix a bug, or make a design decision — record it with `ml record`",
	);
	lines.push(
		"- **Check expertise first**: Before implementing, check if relevant expertise exists with `ml search` or `ml prime --context`",
	);
	lines.push(
		"- **Targeted priming**: Use `ml prime --files src/foo.ts` to load only records relevant to specific files",
	);
	lines.push(
		"- **Do NOT** store expertise in code comments, markdown files, or memory tools — use `ml record`",
	);
	lines.push("- Run `ml doctor` if you are unsure whether records are healthy");
	lines.push("");

	if (domainSections.length === 0) {
		lines.push(
			"No expertise recorded yet. Use `ml add <domain>` to create a domain, then `ml record` to add records.",
		);
		lines.push("");
	} else {
		lines.push(domainSections.join("\n\n"));
		lines.push("");
	}

	lines.push("");
	lines.push("## Recording New Learnings");
	lines.push("");
	lines.push(
		"When you discover a pattern, convention, failure, or make an architectural decision:",
	);
	lines.push("");
	lines.push("```bash");
	lines.push('ml record <domain> --type convention "description"');
	lines.push('ml record <domain> --type failure --description "..." --resolution "..."');
	lines.push('ml record <domain> --type decision --title "..." --rationale "..."');
	lines.push('ml record <domain> --type pattern --name "..." --description "..." --files "..."');
	lines.push('ml record <domain> --type reference --name "..." --description "..." --files "..."');
	lines.push('ml record <domain> --type guide --name "..." --description "..."');
	lines.push("```");
	lines.push("");
	lines.push("**Required fields by type:**");
	lines.push("");
	lines.push("| Type | Required flags |");
	lines.push("|------|----------------|");
	lines.push('| `convention` | `"<content>"` (positional) |');
	lines.push('| `pattern` | `--name "..." --description "..."` |');
	lines.push('| `failure` | `--description "..." --resolution "..."` |');
	lines.push('| `decision` | `--title "..." --rationale "..."` |');
	lines.push('| `reference` | `--name "..." --description "..."` |');
	lines.push('| `guide` | `--name "..." --description "..."` |');
	lines.push("");
	lines.push(
		"**Link evidence** to records. The current commit and changed files auto-populate from git; link trackers or related records explicitly:",
	);
	lines.push("");
	lines.push("```bash");
	lines.push(
		'ml record <domain> --type pattern --name "..." --description "..." --evidence-seeds SEED-123',
	);
	lines.push(
		'ml record <domain> --type decision --title "..." --rationale "..." --evidence-gh 42 --evidence-linear ENG-9',
	);
	lines.push(
		'ml record <domain> --type convention "..." --relates-to mx-abc  # link to related records',
	);
	lines.push("```");
	lines.push("");
	lines.push("**Batch record** multiple records at once:");
	lines.push("");
	lines.push("```bash");
	lines.push("ml record <domain> --batch records.json  # from file");
	lines.push(
		'echo \'[{"type":"convention","content":"..."}]\' | ml record <domain> --stdin  # from stdin',
	);
	lines.push("```");
	lines.push("");
	lines.push("## Searching Expertise");
	lines.push("");
	lines.push(
		"Use `ml search` to find relevant records across all domains. Results are ranked by relevance (BM25):",
	);
	lines.push("");
	lines.push("```bash");
	lines.push('ml search "file locking"              # multi-word queries ranked by relevance');
	lines.push('ml search "atomic" --domain cli        # limit to a specific domain');
	lines.push('ml search "ESM" --type convention      # filter by record type');
	lines.push('ml search "concurrency" --tag safety   # filter by tag');
	lines.push("```");
	lines.push("");
	lines.push("Search before implementing — existing expertise may already cover your use case.");
	lines.push("");
	lines.push("## Domain Maintenance");
	lines.push("");
	lines.push("When a domain grows large, compact it to keep expertise focused:");
	lines.push("");
	lines.push("```bash");
	lines.push("ml compact --auto --dry-run     # preview what would be merged");
	lines.push("ml compact --auto               # merge same-type record groups");
	lines.push("```");
	lines.push("");
	lines.push("Use `ml diff` to review what expertise changed:");
	lines.push("");
	lines.push("```bash");
	lines.push("ml diff HEAD~3                  # see record changes over last 3 commits");
	lines.push("```");
	lines.push("");
	lines.push("## Session End");
	lines.push("");
	lines.push("**IMPORTANT**: Before ending your session, record what you learned and sync:");
	lines.push("");
	lines.push("```");
	lines.push("[ ] ml learn          # see what files changed — decide what to record");
	lines.push("[ ] ml record ...     # record learnings (see above)");
	lines.push("[ ] ml sync           # validate, stage, and commit .mulch/ changes");
	lines.push("```");
	lines.push("");
	lines.push("Do NOT skip this. Unrecorded learnings are lost for the next session.");

	return lines.join("\n");
}

export type PrimeFormat = "markdown" | "compact" | "xml" | "plain";

// --- XML format (optimized for Claude) ---

export function formatDomainExpertiseXml(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
): string {
	const registry = getRegistry();
	const updatedStr = lastUpdated ? ` updated="${formatTimeAgo(lastUpdated)}"` : "";
	const lines: string[] = [];

	lines.push(`<domain name="${xmlEscape(domain)}" entries="${records.length}"${updatedStr}>`);

	for (const r of records) {
		const def = registry.get(r.type);
		if (!def) continue;
		const idAttr = r.id ? ` id="${xmlEscape(r.id)}"` : "";
		lines.push(`  <${r.type}${idAttr} classification="${r.classification}">`);

		for (const inner of def.formatXml(r)) {
			lines.push(inner);
		}

		if (r.tags && r.tags.length > 0) {
			lines.push(`    <tags>${r.tags.map(xmlEscape).join(", ")}</tags>`);
		}
		if (r.relates_to && r.relates_to.length > 0) {
			lines.push(`    <relates_to>${r.relates_to.join(", ")}</relates_to>`);
		}
		if (r.supersedes && r.supersedes.length > 0) {
			lines.push(`    <supersedes>${r.supersedes.join(", ")}</supersedes>`);
		}
		if (r.outcomes && r.outcomes.length > 0) {
			for (const outcome of r.outcomes) {
				const durationAttr =
					outcome.duration !== undefined ? ` duration="${outcome.duration}"` : "";
				const agentAttr = outcome.agent ? ` agent="${xmlEscape(outcome.agent)}"` : "";
				const testResultsContent = outcome.test_results ? `${xmlEscape(outcome.test_results)}` : "";
				lines.push(
					`    <outcome status="${outcome.status}"${durationAttr}${agentAttr}>${testResultsContent}</outcome>`,
				);
			}
		}
		lines.push(`  </${r.type}>`);
	}

	lines.push("</domain>");
	return lines.join("\n");
}

export function formatPrimeOutputXml(domainSections: string[]): string {
	const lines: string[] = [];
	lines.push("<expertise>");

	if (domainSections.length === 0) {
		lines.push(
			"  <empty>No expertise recorded yet. Use ml add and ml record to get started.</empty>",
		);
	} else {
		lines.push(domainSections.join("\n"));
	}

	lines.push("</expertise>");
	return lines.join("\n");
}

// --- Plain text format (optimized for Codex) ---

// Bespoke per-type body kept inline since TypeDefinition (Phase 1) doesn't
// expose a formatPlain hook. Iteration order comes from registry.enabled() so
// Phase 2 custom types can be plugged in by extending this switch (or by
// adding formatPlain to TypeDefinition).
function plainSection(
	def: { name: string; sectionTitle: string },
	records: ExpertiseRecord[],
): string[] {
	const out: string[] = [];
	switch (def.name) {
		case "convention": {
			out.push("Conventions:");
			for (const r of records as Array<ExpertiseRecord & { type: "convention" }>) {
				const id = r.id ? `[${r.id}] ` : "";
				out.push(`  - ${id}${r.content}${formatLinks(r)}`);
			}
			out.push("");
			return out;
		}
		case "pattern": {
			out.push("Patterns:");
			for (const r of records as Array<ExpertiseRecord & { type: "pattern" }>) {
				const id = r.id ? `[${r.id}] ` : "";
				let line = `  - ${id}${r.name}: ${r.description}`;
				if (r.files && r.files.length > 0) {
					line += ` (${r.files.join(", ")})`;
				}
				line += formatLinks(r);
				out.push(line);
			}
			out.push("");
			return out;
		}
		case "failure": {
			out.push("Known Failures:");
			for (const r of records as Array<ExpertiseRecord & { type: "failure" }>) {
				const id = r.id ? `[${r.id}] ` : "";
				out.push(`  - ${id}${r.description}${formatLinks(r)}`);
				out.push(`    Fix: ${r.resolution}`);
			}
			out.push("");
			return out;
		}
		case "decision": {
			out.push("Decisions:");
			for (const r of records as Array<ExpertiseRecord & { type: "decision" }>) {
				const id = r.id ? `[${r.id}] ` : "";
				out.push(`  - ${id}${r.title}: ${r.rationale}${formatLinks(r)}`);
			}
			out.push("");
			return out;
		}
		case "reference": {
			out.push("References:");
			for (const r of records as Array<ExpertiseRecord & { type: "reference" }>) {
				const id = r.id ? `[${r.id}] ` : "";
				let line = `  - ${id}${r.name}: ${r.description}`;
				if (r.files && r.files.length > 0) {
					line += ` (${r.files.join(", ")})`;
				}
				line += formatLinks(r);
				out.push(line);
			}
			out.push("");
			return out;
		}
		case "guide": {
			out.push("Guides:");
			for (const r of records as Array<ExpertiseRecord & { type: "guide" }>) {
				const id = r.id ? `[${r.id}] ` : "";
				out.push(`  - ${id}${r.name}: ${r.description}${formatLinks(r)}`);
			}
			out.push("");
			return out;
		}
		default:
			return out;
	}
}

export function formatDomainExpertisePlain(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
): string {
	const registry = getRegistry();
	const updatedStr = lastUpdated ? ` (updated ${formatTimeAgo(lastUpdated)})` : "";
	const lines: string[] = [];

	lines.push(`[${domain}] ${records.length} records${updatedStr}`);
	lines.push("");

	for (const def of registry.enabled()) {
		const subset = records.filter((r) => r.type === def.name);
		if (subset.length === 0) continue;
		for (const line of plainSection(def, subset)) lines.push(line);
	}

	return lines.join("\n").trimEnd();
}

// Plain format is the spawn-injection contract: clean text suitable for
// concatenation into another tool's system prompt. No decorative document
// title, no underlines, no markdown — only the per-domain sections (which
// already lead with `[domain] N records` metadata). Empty-state stays as a
// single bare line.
export function formatPrimeOutputPlain(domainSections: string[]): string {
	if (domainSections.length === 0) {
		return "No expertise recorded yet. Use `ml add <domain>` and `ml record` to get started.";
	}
	return domainSections.join("\n\n");
}

export interface JsonDomain {
	domain: string;
	entry_count: number;
	records: ExpertiseRecord[];
}

export function formatJsonOutput(domains: JsonDomain[]): string {
	return JSON.stringify({ type: "expertise", domains }, null, 2);
}

// Conditional close-session prose. Audit (V1_PLAN §3) found 70-80% of conventions
// were ritual restatements driven by the prior "you MUST run this checklist" prose;
// reframing to "if you discovered ..." suppresses filler without losing the
// memory-anchor function of the 🚨 marker (which V1_PLAN §5.2 keeps in the prime
// footer for agents whose context has filled with file edits since session start).
// Single helper feeds the prime footer (markdown/compact/xml/plain) and the
// onboard/cursor/codex snippets ("embedded").
export type SessionCloseStyle = PrimeFormat | "embedded";

export function getSessionEndReminder(format: SessionCloseStyle): string {
	switch (format) {
		case "xml":
			return [
				"<session_close>",
				"  <instruction>If you discovered insights worth preserving — a new convention, a pattern that worked, a decision made, a failure encountered — record them before closing this session.</instruction>",
				"  <commands>",
				"    <command>ml learn — see what files changed</command>",
				"    <command>ml record &lt;domain&gt; --type &lt;type&gt; --description &quot;...&quot;</command>",
				"    <command>ml sync — validate, stage, commit</command>",
				"  </commands>",
				"  <note>Skip if no insight surfaced. Unrecorded learnings are lost; ritual filler records are also noise.</note>",
				"</session_close>",
			].join("\n");
		case "plain":
			return [
				"=== \u{1F6A8} SESSION CLOSE \u{1F6A8} ===",
				"",
				"If you discovered insights worth preserving — a new convention, a pattern that worked,",
				"a decision made, a failure encountered — record them before closing this session:",
				"",
				"  ml learn                              (see what files changed)",
				"  ml record <domain> --type <type> ...  (record the insight)",
				"  ml sync                               (validate, stage, commit)",
				"",
				"Skip if no insight surfaced. Unrecorded learnings are lost; ritual filler records are also noise.",
			].join("\n");
		case "embedded":
			return [
				"### Before You Finish",
				"",
				"If you discovered conventions, patterns, decisions, or failures worth preserving during",
				"this session, record them before closing:",
				"",
				"```bash",
				"ml learn                                                                    # see what files changed",
				'ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."',
				"ml sync                                                                     # validate, stage, commit",
				"```",
				"",
				"Skip if no insight surfaced. Unrecorded learnings are lost; ritual filler records are also noise.",
			].join("\n");
		default:
			return [
				"# \u{1F6A8} SESSION CLOSE \u{1F6A8}",
				"",
				"**If you discovered insights worth preserving** — a new convention, a pattern that worked, a decision made, a failure encountered — record them before closing this session:",
				"",
				"```bash",
				"ml learn                              # see what files changed",
				"ml record <domain> --type <type> ...  # record the insight",
				"ml sync                               # validate, stage, commit",
				"```",
				"",
				"Skip if no insight surfaced. Unrecorded learnings are lost; ritual filler records are also noise.",
			].join("\n");
	}
}

export interface StatusDomainStat {
	domain: string;
	count: number;
	lastUpdated: Date | null;
	oldestRecorded?: Date | null;
	newestRecorded?: Date | null;
	rotting?: boolean;
	rottingDays?: number | null;
}

export function formatStatusOutput(
	domainStats: StatusDomainStat[],
	governance: { max_entries: number; warn_entries: number; hard_limit: number },
): string {
	const lines: string[] = [];
	lines.push("Mulch Status");
	lines.push("============");
	lines.push("");

	if (domainStats.length === 0) {
		lines.push("No domains configured. Run `ml add <domain>` to get started.");
		return lines.join("\n");
	}

	for (const stat of domainStats) {
		const { domain, count, lastUpdated, oldestRecorded, newestRecorded, rotting, rottingDays } =
			stat;
		const updatedStr = lastUpdated ? formatTimeAgo(lastUpdated) : "never";
		let governanceStatus = "";
		if (count >= governance.hard_limit) {
			governanceStatus = " ⚠ OVER HARD LIMIT — must decompose";
		} else if (count >= governance.warn_entries) {
			governanceStatus = " ⚠ consider splitting domain";
		} else if (count >= governance.max_entries) {
			governanceStatus = " — approaching limit";
		}

		let rangeStr = "";
		if (oldestRecorded && newestRecorded) {
			const oldestAgo = formatTimeAgo(oldestRecorded);
			const newestAgo = formatTimeAgo(newestRecorded);
			rangeStr =
				oldestAgo === newestAgo
					? ` — recorded ${oldestAgo}`
					: ` — recorded ${oldestAgo} → ${newestAgo}`;
		}

		let rottingStr = "";
		if (rotting) {
			rottingStr =
				typeof rottingDays === "number"
					? ` ⚠ ROTTING (no writes in ${rottingDays}d)`
					: " ⚠ ROTTING";
		}

		lines.push(
			`  ${domain}: ${count} records (updated ${updatedStr})${rangeStr}${governanceStatus}${rottingStr}`,
		);
	}

	return lines.join("\n");
}

// --- Manifest mode ---

export interface ManifestDomain {
	domain: string;
	count: number;
	lastUpdated: Date | null;
	typeCounts: Record<string, number>;
}

export interface ManifestGovernance {
	max_entries: number;
	warn_entries: number;
	hard_limit: number;
}

interface QuickRef {
	command: string;
	description: string;
}

const MANIFEST_QUICK_REF: QuickRef[] = [
	{ command: "ml prime <domain>", description: "load full records for one domain" },
	{ command: "ml prime --files <path>", description: "load records relevant to specific files" },
	{ command: 'ml search "<query>"', description: "search records across domains" },
	{
		command: 'ml record <domain> --type <type> --description "..."',
		description: "store an insight",
	},
	{ command: "ml learn", description: "discover what to record from changed files" },
	{ command: "ml sync", description: "validate, stage, and commit .mulch/ changes" },
];

function manifestStatusSuffix(count: number, governance: ManifestGovernance): string {
	if (count >= governance.hard_limit) return " ⚠ OVER HARD LIMIT — must decompose";
	if (count >= governance.warn_entries) return " ⚠ consider splitting domain";
	if (count >= governance.max_entries) return " — approaching limit";
	return "";
}

const TYPE_COUNT_ORDER: BuiltinRecordType[] = [
	"pattern",
	"convention",
	"failure",
	"decision",
	"reference",
	"guide",
];

function pluralize(n: number, singular: string): string {
	return n === 1 ? singular : `${singular}s`;
}

function formatTypeCounts(typeCounts: Record<string, number>): string {
	const parts: string[] = [];
	const seen = new Set<string>();
	// Built-ins in canonical order first, then any custom-type counts (Phase 2).
	for (const t of TYPE_COUNT_ORDER) {
		const n = typeCounts[t];
		if (n && n > 0) parts.push(`${n} ${pluralize(n, t)}`);
		seen.add(t);
	}
	for (const [t, n] of Object.entries(typeCounts)) {
		if (seen.has(t)) continue;
		if (n && n > 0) parts.push(`${n} ${pluralize(n, t)}`);
	}
	return parts.join(", ");
}

export function formatPrimeManifest(
	domains: ManifestDomain[],
	governance: ManifestGovernance,
	format: PrimeFormat,
): string {
	switch (format) {
		case "xml":
			return formatPrimeManifestXml(domains, governance);
		case "plain":
			return formatPrimeManifestPlain(domains, governance);
		default:
			return formatPrimeManifestMarkdown(domains, governance);
	}
}

function formatPrimeManifestMarkdown(
	domains: ManifestDomain[],
	governance: ManifestGovernance,
): string {
	const lines: string[] = [];
	lines.push("# Project Expertise Manifest (via Mulch)");
	lines.push("");
	lines.push(
		"> Manifest mode lists available domains. Load records on demand with `ml prime <domain>` or `ml prime --files <path>`.",
	);
	lines.push("");
	lines.push("## Quick Reference");
	lines.push("");
	for (const { command, description } of MANIFEST_QUICK_REF) {
		lines.push(`- \`${command}\` — ${description}`);
	}
	lines.push("");
	lines.push("## Available Domains");
	lines.push("");
	if (domains.length === 0) {
		lines.push(
			"No expertise recorded yet. Use `ml add <domain>` to create a domain, then `ml record` to add records.",
		);
	} else {
		for (const { domain, count, lastUpdated, typeCounts } of domains) {
			const typeStr = formatTypeCounts(typeCounts);
			const typeSuffix = typeStr ? ` (${typeStr})` : "";
			const updatedStr = lastUpdated ? ` — updated ${formatTimeAgo(lastUpdated)}` : "";
			const status = manifestStatusSuffix(count, governance);
			lines.push(
				`- **${domain}**: ${count} ${pluralize(count, "record")}${typeSuffix}${updatedStr}${status}`,
			);
		}
	}
	return lines.join("\n");
}

function formatPrimeManifestPlain(
	domains: ManifestDomain[],
	governance: ManifestGovernance,
): string {
	const lines: string[] = [];
	lines.push("Project Expertise Manifest (via Mulch)");
	lines.push("======================================");
	lines.push("");
	lines.push(
		"Manifest mode lists available domains. Load records on demand with `ml prime <domain>` or `ml prime --files <path>`.",
	);
	lines.push("");
	lines.push("Quick Reference:");
	for (const { command, description } of MANIFEST_QUICK_REF) {
		lines.push(`  - ${command} — ${description}`);
	}
	lines.push("");
	lines.push("Available Domains:");
	if (domains.length === 0) {
		lines.push(
			"  No expertise recorded yet. Use `ml add <domain>` and `ml record` to get started.",
		);
	} else {
		for (const { domain, count, lastUpdated, typeCounts } of domains) {
			const typeStr = formatTypeCounts(typeCounts);
			const typeSuffix = typeStr ? ` (${typeStr})` : "";
			const updatedStr = lastUpdated ? ` — updated ${formatTimeAgo(lastUpdated)}` : "";
			const status = manifestStatusSuffix(count, governance);
			lines.push(
				`  - ${domain}: ${count} ${pluralize(count, "record")}${typeSuffix}${updatedStr}${status}`,
			);
		}
	}
	return lines.join("\n");
}

function formatPrimeManifestXml(domains: ManifestDomain[], governance: ManifestGovernance): string {
	const lines: string[] = [];
	lines.push("<manifest>");
	lines.push(
		"  <description>Manifest mode lists available domains. Load records on demand with `ml prime &lt;domain&gt;` or `ml prime --files &lt;path&gt;`.</description>",
	);
	lines.push("  <quick_reference>");
	for (const { command, description } of MANIFEST_QUICK_REF) {
		lines.push(`    <command name="${xmlAttrEscape(command)}">${xmlEscape(description)}</command>`);
	}
	lines.push("  </quick_reference>");
	lines.push("  <domains>");
	for (const { domain, count, lastUpdated, typeCounts } of domains) {
		const updatedAttr = lastUpdated ? ` updated="${formatTimeAgo(lastUpdated)}"` : "";
		const status = manifestStatusSuffix(count, governance).trim();
		const statusAttr = status ? ` status="${xmlAttrEscape(status)}"` : "";
		lines.push(
			`    <domain name="${xmlAttrEscape(domain)}" entries="${count}"${updatedAttr}${statusAttr}>`,
		);
		for (const t of TYPE_COUNT_ORDER) {
			const n = typeCounts[t];
			if (n && n > 0) lines.push(`      <type_count type="${t}" count="${n}" />`);
		}
		lines.push("    </domain>");
	}
	lines.push("  </domains>");
	lines.push("</manifest>");
	return lines.join("\n");
}

export interface ManifestPayload {
	type: "manifest";
	quick_reference: QuickRef[];
	domains: Array<{
		domain: string;
		count: number;
		lastUpdated: string | null;
		type_counts: Record<string, number>;
		health: {
			status: "ok" | "approaching_limit" | "over_warn_threshold" | "over_hard_limit";
			max_entries: number;
			warn_entries: number;
			hard_limit: number;
		};
	}>;
}

function manifestHealthStatus(
	count: number,
	governance: ManifestGovernance,
): ManifestPayload["domains"][number]["health"]["status"] {
	if (count >= governance.hard_limit) return "over_hard_limit";
	if (count >= governance.warn_entries) return "over_warn_threshold";
	if (count >= governance.max_entries) return "approaching_limit";
	return "ok";
}

export function buildManifestPayload(
	domains: ManifestDomain[],
	governance: ManifestGovernance,
): ManifestPayload {
	return {
		type: "manifest",
		quick_reference: MANIFEST_QUICK_REF,
		domains: domains.map(({ domain, count, lastUpdated, typeCounts }) => ({
			domain,
			count,
			lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
			type_counts: typeCounts,
			health: {
				status: manifestHealthStatus(count, governance),
				max_entries: governance.max_entries,
				warn_entries: governance.warn_entries,
				hard_limit: governance.hard_limit,
			},
		})),
	};
}

export function computeTypeCounts(records: ExpertiseRecord[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const r of records) {
		counts[r.type] = (counts[r.type] ?? 0) + 1;
	}
	return counts;
}

// --- Project Contract block (write-side gates from config) ---
//
// Slice 1 of the v0.10 prime overhaul leads with this so agents see the
// project's write-side rules (`ml record` will enforce them) before any
// record content. Surfaces custom types, disabled types, per-domain
// allowed_types / required_fields, and active hooks. Returns null when the
// project has no contract content worth surfacing — keeps minimal configs
// clutter-free.

export interface ContractDomainEntry {
	domain: string;
	allowedTypes: string[];
	requiredFields: string[];
}

export interface ContractCustomType {
	name: string;
	extends: string | null;
	required: string[];
	optional: string[];
}

export interface ProjectContract {
	customTypes: ContractCustomType[];
	disabledTypes: string[];
	domains: ContractDomainEntry[];
	hooks: HookEvent[];
}

export function buildProjectContract(config: MulchConfig): ProjectContract {
	const registry = getRegistry();
	const customTypes: ContractCustomType[] = registry.customDefs().map((def) => ({
		name: def.name,
		extends: config.custom_types?.[def.name]?.extends ?? null,
		required: [...def.required],
		optional: [...def.optional],
	}));
	const disabledTypes = [...(config.disabled_types ?? [])];
	const domains: ContractDomainEntry[] = [];
	for (const [name, dconf] of Object.entries(config.domains ?? {})) {
		const allowed = dconf?.allowed_types ?? [];
		const required = dconf?.required_fields ?? [];
		if (allowed.length > 0 || required.length > 0) {
			domains.push({
				domain: name,
				allowedTypes: [...allowed],
				requiredFields: [...required],
			});
		}
	}
	const hooks: HookEvent[] = [];
	for (const event of HOOK_EVENTS) {
		const scripts = config.hooks?.[event] ?? [];
		if (scripts.length > 0) hooks.push(event);
	}
	return { customTypes, disabledTypes, domains, hooks };
}

export function hasContractContent(c: ProjectContract): boolean {
	return (
		c.customTypes.length > 0 ||
		c.disabledTypes.length > 0 ||
		c.domains.length > 0 ||
		c.hooks.length > 0
	);
}

function customTypeFieldsSuffix(t: ContractCustomType): string {
	const parts: string[] = [];
	if (t.required.length > 0) parts.push(`required: ${t.required.join(", ")}`);
	if (t.optional.length > 0) parts.push(`optional: ${t.optional.join(", ")}`);
	return parts.length > 0 ? `; ${parts.join("; ")}` : "";
}

function formatProjectContractMarkdown(c: ProjectContract): string {
	const lines: string[] = [];
	lines.push("## Project Contract");
	lines.push("");
	lines.push("Write-side gates `ml record` enforces in this project.");
	lines.push("");

	if (c.customTypes.length > 0) {
		lines.push("**Custom types**:");
		for (const t of c.customTypes) {
			const ext = t.extends ? ` (extends \`${t.extends}\`)` : "";
			lines.push(`- \`${t.name}\`${ext}${customTypeFieldsSuffix(t)}`);
		}
		lines.push("");
	}

	if (c.disabledTypes.length > 0) {
		const names = c.disabledTypes.map((t) => `\`${t}\``).join(", ");
		lines.push(`**Disabled types**: ${names} (writes emit a deprecation warning)`);
		lines.push("");
	}

	if (c.domains.length > 0) {
		lines.push("**Per-domain rules**:");
		for (const d of c.domains) {
			const parts: string[] = [];
			if (d.allowedTypes.length > 0) parts.push(`allowed types — ${d.allowedTypes.join(", ")}`);
			if (d.requiredFields.length > 0)
				parts.push(`required fields — ${d.requiredFields.join(", ")}`);
			lines.push(`- \`${d.domain}\`: ${parts.join("; ")}`);
		}
		lines.push("");
	}

	if (c.hooks.length > 0) {
		lines.push(`**Active hooks**: ${c.hooks.join(", ")}`);
	}

	return lines.join("\n").trimEnd();
}

function formatProjectContractPlain(c: ProjectContract): string {
	const lines: string[] = [];
	lines.push("Project Contract (write-side gates)");
	lines.push("===================================");

	if (c.customTypes.length > 0) {
		lines.push("");
		lines.push("Custom types:");
		for (const t of c.customTypes) {
			const ext = t.extends ? ` (extends ${t.extends})` : "";
			lines.push(`  - ${t.name}${ext}${customTypeFieldsSuffix(t)}`);
		}
	}

	if (c.disabledTypes.length > 0) {
		lines.push("");
		lines.push(`Disabled types: ${c.disabledTypes.join(", ")} (writes emit a deprecation warning)`);
	}

	if (c.domains.length > 0) {
		lines.push("");
		lines.push("Per-domain rules:");
		for (const d of c.domains) {
			const parts: string[] = [];
			if (d.allowedTypes.length > 0) parts.push(`allowed: ${d.allowedTypes.join(", ")}`);
			if (d.requiredFields.length > 0) parts.push(`required: ${d.requiredFields.join(", ")}`);
			lines.push(`  - ${d.domain}: ${parts.join("; ")}`);
		}
	}

	if (c.hooks.length > 0) {
		lines.push("");
		lines.push(`Active hooks: ${c.hooks.join(", ")}`);
	}

	return lines.join("\n");
}

function formatProjectContractXml(c: ProjectContract): string {
	const lines: string[] = [];
	lines.push("<contract>");
	if (c.customTypes.length > 0) {
		lines.push("  <custom_types>");
		for (const t of c.customTypes) {
			const extAttr = t.extends ? ` extends="${xmlAttrEscape(t.extends)}"` : "";
			lines.push(`    <type name="${xmlAttrEscape(t.name)}"${extAttr}>`);
			if (t.required.length > 0)
				lines.push(`      <required>${xmlEscape(t.required.join(", "))}</required>`);
			if (t.optional.length > 0)
				lines.push(`      <optional>${xmlEscape(t.optional.join(", "))}</optional>`);
			lines.push("    </type>");
		}
		lines.push("  </custom_types>");
	}
	if (c.disabledTypes.length > 0) {
		lines.push(`  <disabled_types>${xmlEscape(c.disabledTypes.join(", "))}</disabled_types>`);
	}
	if (c.domains.length > 0) {
		lines.push("  <domains>");
		for (const d of c.domains) {
			const allowedAttr =
				d.allowedTypes.length > 0 ? ` allowed="${xmlAttrEscape(d.allowedTypes.join(", "))}"` : "";
			const reqAttr =
				d.requiredFields.length > 0
					? ` required="${xmlAttrEscape(d.requiredFields.join(", "))}"`
					: "";
			lines.push(`    <domain name="${xmlAttrEscape(d.domain)}"${allowedAttr}${reqAttr} />`);
		}
		lines.push("  </domains>");
	}
	if (c.hooks.length > 0) {
		lines.push(`  <hooks>${xmlEscape(c.hooks.join(", "))}</hooks>`);
	}
	lines.push("</contract>");
	return lines.join("\n");
}

export function formatProjectContract(config: MulchConfig, format: PrimeFormat): string | null {
	const contract = buildProjectContract(config);
	if (!hasContractContent(contract)) return null;
	switch (format) {
		case "xml":
			return formatProjectContractXml(contract);
		case "plain":
			return formatProjectContractPlain(contract);
		default:
			return formatProjectContractMarkdown(contract);
	}
}

// Auto-flip thresholds for the `ml prime` default mode. When the project has
// not declared `prime.default_mode` and the invocation isn't scoped, prime
// flips to manifest output above either threshold so unscoped output doesn't
// blow the context window. Strict greater-than: 100 records is full, 101 is
// manifest; 5 domains is full, 6 is manifest.
export const AUTO_MANIFEST_RECORD_THRESHOLD = 100;
export const AUTO_MANIFEST_DOMAIN_THRESHOLD = 5;

export function shouldAutoFlipToManifest(totalRecords: number, totalDomains: number): boolean {
	return (
		totalRecords > AUTO_MANIFEST_RECORD_THRESHOLD || totalDomains > AUTO_MANIFEST_DOMAIN_THRESHOLD
	);
}
