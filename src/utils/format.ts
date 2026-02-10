import type {
  ExpertiseRecord,
  ConventionRecord,
  PatternRecord,
  FailureRecord,
  DecisionRecord,
  ReferenceRecord,
  GuideRecord,
} from "../schemas/record.js";

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
  return " " + parts.join(" ") + formatLinks(r);
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
  return text.slice(0, maxLen) + "...";
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

function compactId(r: ExpertiseRecord): string {
  return r.id ? ` (${r.id})` : "";
}

function compactLine(r: ExpertiseRecord): string {
  const links = formatLinks(r);
  const id = compactId(r);
  switch (r.type) {
    case "convention":
      return `- [convention] ${truncate(r.content)}${id}${links}`;
    case "pattern": {
      const files = r.files && r.files.length > 0 ? ` (${r.files.join(", ")})` : "";
      return `- [pattern] ${r.name}: ${truncate(r.description)}${files}${id}${links}`;
    }
    case "failure":
      return `- [failure] ${truncate(r.description)} → ${truncate(r.resolution)}${id}${links}`;
    case "decision":
      return `- [decision] ${r.title}: ${truncate(r.rationale)}${id}${links}`;
    case "reference": {
      const refFiles = r.files && r.files.length > 0 ? `: ${r.files.join(", ")}` : `: ${truncate(r.description)}`;
      return `- [reference] ${r.name}${refFiles}${id}${links}`;
    }
    case "guide":
      return `- [guide] ${r.name}: ${truncate(r.description)}${id}${links}`;
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

export function formatPrimeOutputCompact(
  domainSections: string[],
): string {
  const lines: string[] = [];

  lines.push("# Project Expertise (via Mulch)");
  lines.push("");

  if (domainSections.length === 0) {
    lines.push("No expertise recorded yet. Use `mulch add <domain>` to create a domain, then `mulch record` to add records.");
  } else {
    lines.push(domainSections.join("\n\n"));
  }

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

  const conventions = records.filter(
    (r): r is ConventionRecord => r.type === "convention",
  );
  const patterns = records.filter(
    (r): r is PatternRecord => r.type === "pattern",
  );
  const failures = records.filter(
    (r): r is FailureRecord => r.type === "failure",
  );
  const decisions = records.filter(
    (r): r is DecisionRecord => r.type === "decision",
  );
  const references = records.filter(
    (r): r is ReferenceRecord => r.type === "reference",
  );
  const guides = records.filter(
    (r): r is GuideRecord => r.type === "guide",
  );

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

export function formatPrimeOutput(
  domainSections: string[],
): string {
  const lines: string[] = [];

  lines.push("# Project Expertise (via Mulch)");
  lines.push("");
  lines.push("> **Context Recovery**: Run `mulch prime` after compaction, clear, or new session");
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  lines.push("- **Record learnings**: When you discover a pattern, fix a bug, or make a design decision — record it with `mulch record`");
  lines.push("- **Check expertise first**: Before implementing, check if relevant expertise exists with `mulch search` or `mulch prime --context`");
  lines.push("- **Do NOT** store expertise in code comments, markdown files, or memory tools — use `mulch record`");
  lines.push("- Run `mulch doctor` if you are unsure whether records are healthy");
  lines.push("");

  if (domainSections.length === 0) {
    lines.push("No expertise recorded yet. Use `mulch add <domain>` to create a domain, then `mulch record` to add records.");
    lines.push("");
  } else {
    lines.push(domainSections.join("\n\n"));
    lines.push("");
  }

  lines.push("");
  lines.push("## Recording New Learnings");
  lines.push("");
  lines.push("When you discover a pattern, convention, failure, or make an architectural decision:");
  lines.push("");
  lines.push('```bash');
  lines.push('mulch record <domain> --type convention "description"');
  lines.push('mulch record <domain> --type failure --description "..." --resolution "..."');
  lines.push('mulch record <domain> --type decision --title "..." --rationale "..."');
  lines.push('mulch record <domain> --type pattern --name "..." --description "..." --files "..."');
  lines.push('mulch record <domain> --type reference --name "..." --description "..." --files "..."');
  lines.push('mulch record <domain> --type guide --name "..." --description "..."');
  lines.push("```");
  lines.push("");
  lines.push("## Session End");
  lines.push("");
  lines.push("**IMPORTANT**: Before ending your session, record what you learned and sync:");
  lines.push("");
  lines.push("```");
  lines.push("[ ] mulch learn          # see what files changed — decide what to record");
  lines.push("[ ] mulch doctor         # verify records are healthy");
  lines.push("[ ] mulch sync           # validate, stage, and commit .mulch/ changes");
  lines.push("```");
  lines.push("");
  lines.push("Do NOT skip this. Unrecorded learnings are lost for the next session.");

  return lines.join("\n");
}

export type PrimeFormat = "markdown" | "xml" | "plain";

// --- XML format (optimized for Claude) ---

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    lines.push(`  </${r.type}>`);
  }

  lines.push("</domain>");
  return lines.join("\n");
}

export function formatPrimeOutputXml(
  domainSections: string[],
): string {
  const lines: string[] = [];
  lines.push("<expertise>");

  if (domainSections.length === 0) {
    lines.push("  <empty>No expertise recorded yet. Use mulch add and mulch record to get started.</empty>");
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

  const conventions = records.filter(
    (r): r is ConventionRecord => r.type === "convention",
  );
  const patterns = records.filter(
    (r): r is PatternRecord => r.type === "pattern",
  );
  const failures = records.filter(
    (r): r is FailureRecord => r.type === "failure",
  );
  const decisions = records.filter(
    (r): r is DecisionRecord => r.type === "decision",
  );

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

  const references = records.filter(
    (r): r is ReferenceRecord => r.type === "reference",
  );
  const guides = records.filter(
    (r): r is GuideRecord => r.type === "guide",
  );

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

export function formatPrimeOutputPlain(
  domainSections: string[],
): string {
  const lines: string[] = [];
  lines.push("Project Expertise (via Mulch)");
  lines.push("============================");
  lines.push("");

  if (domainSections.length === 0) {
    lines.push("No expertise recorded yet. Use `mulch add <domain>` and `mulch record` to get started.");
  } else {
    lines.push(domainSections.join("\n\n"));
  }

  return lines.join("\n");
}

export interface McpDomain {
  domain: string;
  entry_count: number;
  records: ExpertiseRecord[];
}

export function formatMcpOutput(
  domains: McpDomain[],
): string {
  return JSON.stringify({ type: "expertise", domains }, null, 2);
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
    lines.push("No domains configured. Run `mulch add <domain>` to get started.");
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
