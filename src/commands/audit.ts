import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import {
	type AuditReport,
	buildSuggestions,
	computeAudit,
	type SuggestPayload,
	type Verdict,
} from "../utils/audit.ts";
import { getMulchDir, readConfig } from "../utils/config.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { brand, muted } from "../utils/palette.ts";

interface AuditCommandOptions {
	ci?: boolean;
	suggest?: boolean;
	domain?: string;
	ignoreDomains?: string;
}

function verdictTag(v: Verdict): string {
	if (v === "PASS") return chalk.green("PASS");
	if (v === "WARN") return chalk.yellow("WARN");
	return chalk.red("FAIL");
}

function pct(n: number): string {
	return `${Math.round(n * 100)}%`;
}

function formatHuman(report: AuditReport): string {
	const lines: string[] = [];
	lines.push(`${brand.bold(`=== mulch-audit: ${report.repo} ===`)}`);
	lines.push("");
	lines.push(`total records: ${report.total_records}`);
	if (report.ignored_domains.length > 0) {
		lines.push(muted(`(ignoring domains: ${report.ignored_domains.join(", ")})`));
	}
	if (report.total_records === 0) {
		lines.push("");
		lines.push(muted("no records — skipping metric computation"));
		return lines.join("\n");
	}

	lines.push("");
	lines.push("type mix:");
	for (const t of report.type_mix) {
		lines.push(`  ${t.type}: ${t.count} (${t.pct}%)`);
	}

	lines.push("");
	lines.push("evidence coverage:");
	const ev = report.evidence;
	const total = report.total_records;
	const p = (n: number) => `${Math.floor((100 * n) / total)}%`;
	lines.push(`  with seeds-ev: ${ev.with_seeds} (${p(ev.with_seeds)})`);
	lines.push(
		`  with any tracker (seeds/gh/linear/bead): ${ev.with_any_tracker} (${p(ev.with_any_tracker)})`,
	);
	lines.push(`  with commit-ev: ${ev.with_commit} (${p(ev.with_commit)})`);
	lines.push(`  with relates_to: ${ev.with_relates}`);
	lines.push(`  FLOATERS (no seeds/tracker/relates/commit): ${ev.floaters}`);

	const refs = report.seed_citations;
	if (refs.unique > 0) {
		lines.push("");
		lines.push(`seed-citation (unique seeds cited: ${refs.unique}):`);
		for (const [status, count] of Object.entries(refs.status_counts).sort((a, b) => b[1] - a[1])) {
			lines.push(`  ${status}: ${count}`);
		}
		if (refs.missing_in_seeds > 0) {
			lines.push(`  not-found-in-seeds.jsonl: ${refs.missing_in_seeds}`);
		}
		const closed = refs.status_counts.closed ?? 0;
		lines.push(`  closed-citation rate: ${Math.floor((100 * closed) / refs.unique)}%`);
	}

	if (report.convention_quality) {
		const cq = report.convention_quality;
		const rate = cq.total > 0 ? Math.floor((100 * cq.with_rule_signal) / cq.total) : 0;
		lines.push("");
		lines.push("convention quality:");
		lines.push(`  total conventions: ${cq.total}`);
		lines.push(`  with rule-signal word: ${cq.with_rule_signal} (${rate}%)`);
		lines.push(`  likely code-restatement: ${cq.likely_code_restatement} (${100 - rate}%)`);
	}

	lines.push("");
	lines.push("per-domain mix (sorted by record count):");
	lines.push(
		`  ${"domain".padEnd(22)} ${"total".padStart(5)} ${"fail".padStart(4)} ${"dec".padStart(4)} ${"pat".padStart(4)} ${"conv".padStart(4)}  high-value%`,
	);
	for (const d of report.by_domain) {
		const c = d.type_counts;
		lines.push(
			`  ${d.domain.padEnd(22)} ${String(d.total).padStart(5)} ${String(c.failure ?? 0).padStart(4)} ${String(c.decision ?? 0).padStart(4)} ${String(c.pattern ?? 0).padStart(4)} ${String(c.convention ?? 0).padStart(4)}  ${String(d.high_value_pct).padStart(3)}%`,
		);
	}

	if (report.seed_citations.top_cited.length > 0) {
		lines.push("");
		lines.push("top-cited seeds:");
		for (const t of report.seed_citations.top_cited) {
			lines.push(`  ${t.id} cited=${t.count} status=${t.status}  ${t.title}`);
		}
	}

	const dated = report.by_domain.filter((d) => d.first_recorded_at);
	if (dated.length > 0) {
		lines.push("");
		lines.push("domain age (first → last recorded_at):");
		for (const d of [...dated].sort((a, b) => a.domain.localeCompare(b.domain))) {
			const first = (d.first_recorded_at ?? "").slice(0, 10);
			const last = (d.last_recorded_at ?? "").slice(0, 10);
			lines.push(`  ${d.domain.padEnd(22)} ${first} → ${last}  (${d.total} records)`);
		}
	}

	lines.push("");
	lines.push(brand("--- summary signals ---"));
	const s = report.signals;
	lines.push(
		`evidence coverage: ${pct(s.evidence_coverage.value)}  ${verdictTag(s.evidence_coverage.verdict)} (target ≥${pct(s.evidence_coverage.threshold)})`,
	);
	if (s.rule_density) {
		lines.push(
			`convention rule-density: ${pct(s.rule_density.value)}  ${verdictTag(s.rule_density.verdict)} (target ≥${pct(s.rule_density.threshold)})`,
		);
	}
	lines.push(
		`floater rate: ${pct(s.floater_rate.value)}  ${verdictTag(s.floater_rate.verdict)} (target ≤${pct(s.floater_rate.threshold)})`,
	);
	const warnRecords = s.per_domain_max_records.filter((r) => r.verdict !== "PASS");
	const warnStale = s.per_domain_max_stale.filter((r) => r.verdict !== "PASS");
	if (warnRecords.length > 0) {
		lines.push(
			`max_records_per_domain: ${warnRecords.length} over (${warnRecords.map((r) => `${r.domain}=${r.count}`).join(", ")})  ${verdictTag("WARN")}`,
		);
	}
	if (warnStale.length > 0) {
		lines.push(
			`max_stale: ${warnStale.length} over (${warnStale.map((r) => `${r.domain}=${r.count}`).join(", ")})  ${verdictTag("WARN")}`,
		);
	}
	lines.push(
		`weak-domains (≥5 records, high-value <20%): ${report.weak_domains.length}  -> ${JSON.stringify(report.weak_domains)}`,
	);

	if (report.failures.length === 0 && report.warnings.length === 0) {
		lines.push("");
		lines.push(chalk.green("✓ all signals PASS"));
	} else {
		lines.push("");
		if (report.failures.length > 0) {
			lines.push(`${chalk.red("✗ FAIL:")} ${report.failures.join(", ")}`);
		}
		if (report.warnings.length > 0) {
			lines.push(`${chalk.yellow("! WARN:")} ${report.warnings.join(", ")}`);
		}
	}
	return lines.join("\n");
}

function formatSuggest(payload: SuggestPayload): string {
	if (payload.groups.length === 0) {
		return chalk.green("✓ no remediation suggestions — corpus looks clean");
	}
	const lines: string[] = [];
	for (const g of payload.groups) {
		lines.push("");
		lines.push(brand.bold(`[${g.action.toUpperCase()}] ${g.headline}`));
		lines.push(muted(g.rationale));
		lines.push("");
		lines.push("  record ids:");
		const ids = g.record_ids;
		const preview = ids.slice(0, 12);
		lines.push(
			`    ${preview.join(", ")}${ids.length > preview.length ? ` … (+${ids.length - preview.length} more)` : ""}`,
		);
		lines.push("");
		lines.push("  copy-paste commands:");
		for (const cmd of g.commands) {
			lines.push(`    ${chalk.cyan(cmd)}`);
		}
	}
	return lines.join("\n");
}

export function registerAuditCommand(program: Command): void {
	program
		.command("audit")
		.description("Audit corpus health (evidence coverage, rule density, floaters, per-domain mix)")
		.option("--ci", "Exit 1 if any signal is in FAIL band; output JSON")
		.option("--suggest", "Emit specific record IDs to archive/revise/attribute")
		.option("--domain <name>", "Scope all metrics to one domain")
		.option(
			"--ignore-domains <list>",
			"Comma-separated domain names excluded from audit (merged with audit.ignore_domains from config)",
		)
		.action(async (opts: AuditCommandOptions) => {
			const jsonMode = program.opts().json === true;
			const mulchDir = getMulchDir();
			if (!existsSync(mulchDir)) {
				const msg = "No .mulch/ directory found. Run `mulch init` first.";
				if (jsonMode || opts.ci) {
					outputJsonError("audit", msg);
				} else {
					console.error(chalk.red(msg));
				}
				process.exitCode = 1;
				return;
			}

			const config = await readConfig();
			const ignoreDomains = opts.ignoreDomains
				? opts.ignoreDomains
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean)
				: undefined;

			if (opts.domain && !(opts.domain in config.domains)) {
				const msg = `Domain "${opts.domain}" not found in config.`;
				if (jsonMode || opts.ci) outputJsonError("audit", msg);
				else console.error(chalk.red(msg));
				process.exitCode = 1;
				return;
			}

			const report = await computeAudit(config, {
				domain: opts.domain,
				ignoreDomains,
			});

			let suggestPayload: SuggestPayload | undefined;
			if (opts.suggest) {
				suggestPayload = await buildSuggestions(config, {
					domain: opts.domain,
					ignoreDomains,
				});
			}

			// --ci implies JSON regardless of the global --json flag, and sets exit code.
			if (opts.ci) {
				outputJson({
					success: report.failures.length === 0,
					command: "audit",
					report,
					...(suggestPayload ? { suggestions: suggestPayload } : {}),
				});
				if (report.failures.length > 0) {
					process.exitCode = 1;
				}
				return;
			}

			if (jsonMode) {
				outputJson({
					success: true,
					command: "audit",
					report,
					...(suggestPayload ? { suggestions: suggestPayload } : {}),
				});
				return;
			}

			console.log(formatHuman(report));
			if (suggestPayload) {
				console.log("");
				console.log(brand.bold("=== suggested remediations ==="));
				console.log(formatSuggest(suggestPayload));
			}
		});
}
