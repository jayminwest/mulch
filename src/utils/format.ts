import type {
	ConventionRecord,
	DecisionRecord,
	ExpertiseRecord,
	FailureRecord,
	GuideRecord,
	Outcome,
	PatternRecord,
	RecordType,
	ReferenceRecord,
} from "../schemas/record.ts";
import { computeConfirmationScore } from "./scoring.ts";

export function formatTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	return `${diffDays}d ago`;
}

function formatEvidence(evidence: ConventionRecord["evidence"]): string {
	if (!evidence) return "";
	const parts: string[] = [];
	if (evidence.commit) parts.push(`commit: ${evidence.commit}`);
	if (evidence.date) parts.push(`date: ${evidence.date}`);
	if (evidence.issue) parts.push(`issue: ${evidence.issue}`);
	if (evidence.file) parts.push(`file: ${evidence.file}`);
	return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

function formatOutcome(outcomes: Outcome[] | undefined): string {
	if (!outcomes || outcomes.length === 0) return "";
	const latest = outcomes.at(-1);
	if (!latest) return "";
	const statusSymbol = latest.status === "success" ? "✓" : latest.status === "partial" ? "~" : "✗";
	const parts: string[] = [statusSymbol];
	if (latest.duration !== undefined) parts.push(`${latest.duration}ms`);
	if (latest.agent) parts.push(`@${latest.agent}`);
	if (outcomes.length > 1) parts.push(`(${outcomes.length}x)`);
	return ` [${parts.join(" ")}]`;
}

function formatLinks(r: ExpertiseRecord): string {
	const parts: string[] = [];
	if (r.relates_to && r.relates_to.length > 0) {
		parts.push(`relates to: ${r.relates_to.join(", ")}`);
	}
	if (r.supersedes && r.supersedes.length > 0) {
		parts.push(`supersedes: ${r.supersedes.join(", ")}`);
	}
	return parts.length > 0 ? ` [${parts.join("; ")}]` : "";
}

function formatRecordMeta(r: ExpertiseRecord, full: boolean): string {
	if (!full) return formatLinks(r);
	const parts = [`(${r.classification})${formatEvidence(r.evidence)}`];
	if (r.tags && r.tags.length > 0) {
		parts.push(`[tags: ${r.tags.join(", ")}]`);
	}
	return ` ${parts.join(" ")}${formatLinks(r)}`;
}

function idTag(r: ExpertiseRecord): string {
	return r.id ? `[${r.id}] ` : "";
}

function formatConventions(records: ConventionRecord[], full = false): string {
	if (records.length === 0) return "";
	const lines = ["### Conventions"];
	for (const r of records) {
		lines.push(`- ${idTag(r)}${r.content}${formatRecordMeta(r, full)}`);
	}
	return lines.join("\n");
}

function formatPatterns(records: PatternRecord[], full = false): string {
	if (records.length === 0) return "";
	const lines = ["### Patterns"];
	for (const r of records) {
		let line = `- ${idTag(r)}**${r.name}**: ${r.description}`;
		if (r.files && r.files.length > 0) {
			line += ` (${r.files.join(", ")})`;
		}
		line += formatRecordMeta(r, full);
		lines.push(line);
	}
	return lines.join("\n");
}

function formatFailures(records: FailureRecord[], full = false): string {
	if (records.length === 0) return "";
	const lines = ["### Known Failures"];
	for (const r of records) {
		lines.push(`- ${idTag(r)}${r.description}${formatRecordMeta(r, full)}`);
		lines.push(`  → ${r.resolution}`);
	}
	return lines.join("\n");
}

function formatDecisions(records: DecisionRecord[], full = false): string {
	if (records.length === 0) return "";
	const lines = ["### Decisions"];
	for (const r of records) {
		lines.push(`- ${idTag(r)}**${r.title}**: ${r.rationale}${formatRecordMeta(r, full)}`);
	}
	return lines.join("\n");
}

function formatReferences(records: ReferenceRecord[], full = false): string {
	if (records.length === 0) return "";
	const lines = ["### References"];
	for (const r of records) {
		let line = `- ${idTag(r)}**${r.name}**: ${r.description}`;
		if (r.files && r.files.length > 0) {
			line += ` (${r.files.join(", ")})`;
		}
		line += formatRecordMeta(r, full);
		lines.push(line);
	}
	return lines.join("\n");
}

function formatGuides(records: GuideRecord[], full = false): string {
	if (records.length === 0) return "";
	const lines = ["### Guides"];
	for (const r of records) {
		lines.push(`- ${idTag(r)}**${r.name}**: ${r.description}${formatRecordMeta(r, full)}`);
	}
	return lines.join("\n");
}

function truncate(text: string, maxLen = 100): string {
	if (text.length <= maxLen) return text;
	// Try to cut at first sentence boundary within limit
	const sentenceEnd = text.search(/[.!?]\s/);
	if (sentenceEnd > 0 && sentenceEnd < maxLen) {
		return text.slice(0, sentenceEnd + 1);
	}
	return `${text.slice(0, maxLen)}...`;
}

export function getRecordSummary(record: ExpertiseRecord): string {
	switch (record.type) {
		case "convention":
			return truncate(record.content, 60);
		case "pattern":
			return record.name;
		case "failure":
			return truncate(record.description, 60);
		case "decision":
			return record.title;
		case "reference":
			return record.name;
		case "guide":
			return record.name;
	}
}

function formatClassificationAge(r: ExpertiseRecord): string {
	const c = r.classification;
	if (c === "foundational") return c;
	// tactical/observational: show age so agents can gauge staleness
	const age = formatTimeAgo(new Date(r.recorded_at));
	return `${c} ${age}`;
}

function compactMeta(r: ExpertiseRecord): string {
	const parts: string[] = [];
	if (r.id) parts.push(r.id);
	parts.push(formatClassificationAge(r));
	const score = computeConfirmationScore(r);
	if (score > 0) {
		parts.push(Number.isInteger(score) ? `★${score}` : `★${score.toFixed(1)}`);
	}
	return ` (${parts.join(", ")})`;
}

function compactLine(r: ExpertiseRecord): string {
	const links = formatLinks(r);
	const meta = compactMeta(r);
	const outcome = formatOutcome(r.outcomes);
	switch (r.type) {
		case "convention":
			return `- [convention] ${truncate(r.content)}${meta}${outcome}${links}`;
		case "pattern": {
			const files = r.files && r.files.length > 0 ? ` (${r.files.join(", ")})` : "";
			return `- [pattern] ${r.name}: ${truncate(r.description)}${files}${meta}${outcome}${links}`;
		}
		case "failure":
			return `- [failure] ${truncate(r.description)} → ${truncate(r.resolution)}${meta}${outcome}${links}`;
		case "decision":
			return `- [decision] ${r.title}: ${truncate(r.rationale)}${meta}${outcome}${links}`;
		case "reference": {
			const refFiles =
				r.files && r.files.length > 0 ? `: ${r.files.join(", ")}` : `: ${truncate(r.description)}`;
			return `- [reference] ${r.name}${refFiles}${meta}${outcome}${links}`;
		}
		case "guide":
			return `- [guide] ${r.name}: ${truncate(r.description)}${meta}${outcome}${links}`;
	}
}

export function formatDomainExpertiseCompact(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
): string {
	const updatedStr = lastUpdated ? `, updated ${formatTimeAgo(lastUpdated)}` : "";
	const lines: string[] = [];

	lines.push(`## ${domain} (${records.length} records${updatedStr})`);
	for (const r of records) {
		lines.push(compactLine(r));
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
	const updatedStr = lastUpdated ? `, updated ${formatTimeAgo(lastUpdated)}` : "";
	const lines: string[] = [];

	lines.push(`## ${domain} (${records.length} records${updatedStr})`);
	lines.push("");

	const conventions = records.filter((r): r is ConventionRecord => r.type === "convention");
	const patterns = records.filter((r): r is PatternRecord => r.type === "pattern");
	const failures = records.filter((r): r is FailureRecord => r.type === "failure");
	const decisions = records.filter((r): r is DecisionRecord => r.type === "decision");
	const references = records.filter((r): r is ReferenceRecord => r.type === "reference");
	const guides = records.filter((r): r is GuideRecord => r.type === "guide");

	const sections = [
		formatConventions(conventions, full),
		formatPatterns(patterns, full),
		formatFailures(failures, full),
		formatDecisions(decisions, full),
		formatReferences(references, full),
		formatGuides(guides, full),
	].filter((s) => s.length > 0);

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

export type PrimeFormat = "markdown" | "xml" | "plain";

// --- XML format (optimized for Claude) ---

function xmlEscape(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlAttrEscape(str: string): string {
	return xmlEscape(str).replace(/"/g, "&quot;");
}

export function formatDomainExpertiseXml(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
): string {
	const updatedStr = lastUpdated ? ` updated="${formatTimeAgo(lastUpdated)}"` : "";
	const lines: string[] = [];

	lines.push(`<domain name="${xmlEscape(domain)}" entries="${records.length}"${updatedStr}>`);

	for (const r of records) {
		const idAttr = r.id ? ` id="${xmlEscape(r.id)}"` : "";
		lines.push(`  <${r.type}${idAttr} classification="${r.classification}">`);

		switch (r.type) {
			case "convention":
				lines.push(`    ${xmlEscape(r.content)}`);
				break;
			case "pattern":
				lines.push(`    <name>${xmlEscape(r.name)}</name>`);
				lines.push(`    <description>${xmlEscape(r.description)}</description>`);
				if (r.files && r.files.length > 0) {
					lines.push(`    <files>${r.files.map(xmlEscape).join(", ")}</files>`);
				}
				break;
			case "failure":
				lines.push(`    <description>${xmlEscape(r.description)}</description>`);
				lines.push(`    <resolution>${xmlEscape(r.resolution)}</resolution>`);
				break;
			case "decision":
				lines.push(`    <title>${xmlEscape(r.title)}</title>`);
				lines.push(`    <rationale>${xmlEscape(r.rationale)}</rationale>`);
				break;
			case "reference":
				lines.push(`    <name>${xmlEscape(r.name)}</name>`);
				lines.push(`    <description>${xmlEscape(r.description)}</description>`);
				if (r.files && r.files.length > 0) {
					lines.push(`    <files>${r.files.map(xmlEscape).join(", ")}</files>`);
				}
				break;
			case "guide":
				lines.push(`    <name>${xmlEscape(r.name)}</name>`);
				lines.push(`    <description>${xmlEscape(r.description)}</description>`);
				break;
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

export function formatDomainExpertisePlain(
	domain: string,
	records: ExpertiseRecord[],
	lastUpdated: Date | null,
): string {
	const updatedStr = lastUpdated ? ` (updated ${formatTimeAgo(lastUpdated)})` : "";
	const lines: string[] = [];

	lines.push(`[${domain}] ${records.length} records${updatedStr}`);
	lines.push("");

	const conventions = records.filter((r): r is ConventionRecord => r.type === "convention");
	const patterns = records.filter((r): r is PatternRecord => r.type === "pattern");
	const failures = records.filter((r): r is FailureRecord => r.type === "failure");
	const decisions = records.filter((r): r is DecisionRecord => r.type === "decision");

	if (conventions.length > 0) {
		lines.push("Conventions:");
		for (const r of conventions) {
			const id = r.id ? `[${r.id}] ` : "";
			lines.push(`  - ${id}${r.content}${formatLinks(r)}`);
		}
		lines.push("");
	}
	if (patterns.length > 0) {
		lines.push("Patterns:");
		for (const r of patterns) {
			const id = r.id ? `[${r.id}] ` : "";
			let line = `  - ${id}${r.name}: ${r.description}`;
			if (r.files && r.files.length > 0) {
				line += ` (${r.files.join(", ")})`;
			}
			line += formatLinks(r);
			lines.push(line);
		}
		lines.push("");
	}
	if (failures.length > 0) {
		lines.push("Known Failures:");
		for (const r of failures) {
			const id = r.id ? `[${r.id}] ` : "";
			lines.push(`  - ${id}${r.description}${formatLinks(r)}`);
			lines.push(`    Fix: ${r.resolution}`);
		}
		lines.push("");
	}
	if (decisions.length > 0) {
		lines.push("Decisions:");
		for (const r of decisions) {
			const id = r.id ? `[${r.id}] ` : "";
			lines.push(`  - ${id}${r.title}: ${r.rationale}${formatLinks(r)}`);
		}
		lines.push("");
	}

	const references = records.filter((r): r is ReferenceRecord => r.type === "reference");
	const guides = records.filter((r): r is GuideRecord => r.type === "guide");

	if (references.length > 0) {
		lines.push("References:");
		for (const r of references) {
			const id = r.id ? `[${r.id}] ` : "";
			let line = `  - ${id}${r.name}: ${r.description}`;
			if (r.files && r.files.length > 0) {
				line += ` (${r.files.join(", ")})`;
			}
			line += formatLinks(r);
			lines.push(line);
		}
		lines.push("");
	}
	if (guides.length > 0) {
		lines.push("Guides:");
		for (const r of guides) {
			const id = r.id ? `[${r.id}] ` : "";
			lines.push(`  - ${id}${r.name}: ${r.description}${formatLinks(r)}`);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

export function formatPrimeOutputPlain(domainSections: string[]): string {
	const lines: string[] = [];
	lines.push("Project Expertise (via Mulch)");
	lines.push("============================");
	lines.push("");

	if (domainSections.length === 0) {
		lines.push("No expertise recorded yet. Use `ml add <domain>` and `ml record` to get started.");
	} else {
		lines.push(domainSections.join("\n\n"));
	}

	return lines.join("\n");
}

export interface JsonDomain {
	domain: string;
	entry_count: number;
	records: ExpertiseRecord[];
}

export function formatJsonOutput(domains: JsonDomain[]): string {
	return JSON.stringify({ type: "expertise", domains }, null, 2);
}

export function getSessionEndReminder(format: PrimeFormat): string {
	switch (format) {
		case "xml":
			return [
				'<session_close_protocol priority="critical">',
				"  <instruction>Before saying done or complete, you MUST run this checklist:</instruction>",
				"  <checklist>",
				"    <step>ml learn — see what files changed, decide what to record</step>",
				"    <step>ml record &lt;domain&gt; --type &lt;type&gt; --description &quot;...&quot;</step>",
				"    <step>ml sync — validate, stage, and commit .mulch/ changes</step>",
				"  </checklist>",
				"  <warning>NEVER skip this. Unrecorded learnings are lost for the next session.</warning>",
				"</session_close_protocol>",
			].join("\n");
		case "plain":
			return [
				"=== SESSION CLOSE PROTOCOL (CRITICAL) ===",
				"",
				'Before saying "done" or "complete", you MUST run this checklist:',
				"",
				"[ ] 1. ml learn              (see what files changed — decide what to record)",
				'[ ] 2. ml record <domain> --type <type> --description "..."',
				"[ ] 3. ml sync               (validate, stage, and commit .mulch/ changes)",
				"",
				"NEVER skip this. Unrecorded learnings are lost for the next session.",
			].join("\n");
		default:
			return [
				"# \u{1F6A8} SESSION CLOSE PROTOCOL \u{1F6A8}",
				"",
				'**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:',
				"",
				"```",
				"[ ] 1. ml learn              # see what files changed — decide what to record",
				'[ ] 2. ml record <domain> --type <type> --description "..."',
				"[ ] 3. ml sync               # validate, stage, and commit .mulch/ changes",
				"```",
				"",
				"**NEVER skip this.** Unrecorded learnings are lost for the next session.",
			].join("\n");
	}
}

export function formatStatusOutput(
	domainStats: Array<{
		domain: string;
		count: number;
		lastUpdated: Date | null;
	}>,
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

	for (const { domain, count, lastUpdated } of domainStats) {
		const updatedStr = lastUpdated ? formatTimeAgo(lastUpdated) : "never";
		let status = "";
		if (count >= governance.hard_limit) {
			status = " ⚠ OVER HARD LIMIT — must decompose";
		} else if (count >= governance.warn_entries) {
			status = " ⚠ consider splitting domain";
		} else if (count >= governance.max_entries) {
			status = " — approaching limit";
		}
		lines.push(`  ${domain}: ${count} records (updated ${updatedStr})${status}`);
	}

	return lines.join("\n");
}

// --- Manifest mode ---

export interface ManifestDomain {
	domain: string;
	count: number;
	lastUpdated: Date | null;
	typeCounts: Partial<Record<RecordType, number>>;
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

const TYPE_COUNT_ORDER: RecordType[] = [
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

function formatTypeCounts(typeCounts: Partial<Record<RecordType, number>>): string {
	const parts: string[] = [];
	for (const t of TYPE_COUNT_ORDER) {
		const n = typeCounts[t];
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
		type_counts: Partial<Record<RecordType, number>>;
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

export function computeTypeCounts(records: ExpertiseRecord[]): Partial<Record<RecordType, number>> {
	const counts: Partial<Record<RecordType, number>> = {};
	for (const r of records) {
		counts[r.type] = (counts[r.type] ?? 0) + 1;
	}
	return counts;
}
