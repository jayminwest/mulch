import type {
  ExpertiseRecord,
  ConventionRecord,
  PatternRecord,
  FailureRecord,
  DecisionRecord,
} from "../schemas/record.js";

function formatTimeAgo(date: Date): string {
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

function formatConventions(records: ConventionRecord[]): string {
  if (records.length === 0) return "";
  const lines = ["### Conventions"];
  for (const r of records) {
    lines.push(`- ${r.content}`);
  }
  return lines.join("\n");
}

function formatPatterns(records: PatternRecord[]): string {
  if (records.length === 0) return "";
  const lines = ["### Patterns"];
  for (const r of records) {
    let line = `- **${r.name}**: ${r.description}`;
    if (r.files && r.files.length > 0) {
      line += ` (${r.files.join(", ")})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function formatFailures(records: FailureRecord[]): string {
  if (records.length === 0) return "";
  const lines = ["### Known Failures"];
  for (const r of records) {
    lines.push(`- ${r.description}`);
    lines.push(`  → ${r.resolution}`);
  }
  return lines.join("\n");
}

function formatDecisions(records: DecisionRecord[]): string {
  if (records.length === 0) return "";
  const lines = ["### Decisions"];
  for (const r of records) {
    lines.push(`- **${r.title}**: ${r.rationale}`);
  }
  return lines.join("\n");
}

export function formatDomainExpertise(
  domain: string,
  records: ExpertiseRecord[],
  lastUpdated: Date | null,
): string {
  const updatedStr = lastUpdated ? `, updated ${formatTimeAgo(lastUpdated)}` : "";
  const lines: string[] = [];

  lines.push(`## ${domain} (${records.length} entries${updatedStr})`);
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

  const sections = [
    formatConventions(conventions),
    formatPatterns(patterns),
    formatFailures(failures),
    formatDecisions(decisions),
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

  if (domainSections.length === 0) {
    lines.push("No expertise recorded yet. Use `mulch add <domain>` to create a domain, then `mulch record` to add entries.");
    lines.push("");
  } else {
    lines.push(domainSections.join("\n\n"));
    lines.push("");
  }

  lines.push("## Recording New Learnings");
  lines.push("");
  lines.push("When you discover a pattern, convention, failure, or make an architectural decision:");
  lines.push("");
  lines.push('```bash');
  lines.push('mulch record <domain> --type convention "description"');
  lines.push('mulch record <domain> --type failure --description "..." --resolution "..."');
  lines.push('mulch record <domain> --type decision --title "..." --rationale "..."');
  lines.push('mulch record <domain> --type pattern --name "..." --description "..." --files "..."');
  lines.push("```");

  return lines.join("\n");
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
    lines.push(`  ${domain}: ${count} entries (updated ${updatedStr})${status}`);
  }

  return lines.join("\n");
}
