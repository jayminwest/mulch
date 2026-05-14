import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
	type AuditConfig,
	type AuditThresholds,
	type MulchConfig,
	resolveAuditThresholds,
} from "../schemas/config.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath } from "./config.ts";
import { isRecordStale, readExpertiseFile } from "./expertise.ts";

// Words that indicate a convention encodes a rule or rationale rather than
// restating code structure. Mirrors the Python prototype's RULE_SIGNALS so
// existing audit baselines transfer 1:1.
//
// Known limitation (V1_PLAN §7): the regex over-counts conventions about
// Bun-isms ("avoid `process.exit`") and under-counts "we …" phrasings.
// Threshold defaults assume this skew.
export const RULE_SIGNAL_WORDS = [
	"because",
	"must not",
	"do not",
	"don't",
	"avoid",
	"always ",
	"never ",
	"prefer",
	"required for",
	"reason:",
	"rationale",
	"so that",
	"otherwise",
] as const;

export function hasRuleSignal(text: string | undefined): boolean {
	if (!text) return false;
	const t = text.toLowerCase();
	return RULE_SIGNAL_WORDS.some((k) => t.includes(k));
}

export type Verdict = "PASS" | "WARN" | "FAIL";

export interface MetricVerdict {
	verdict: Verdict;
	value: number;
	threshold: number;
	warn_threshold?: number;
}

export interface DomainMix {
	domain: string;
	total: number;
	type_counts: Record<string, number>;
	high_value_pct: number; // (failure + decision) / total * 100
	first_recorded_at: string | null;
	last_recorded_at: string | null;
}

export interface AuditReport {
	repo: string;
	total_records: number;
	domains: string[];
	ignored_domains: string[];
	type_mix: Array<{ type: string; count: number; pct: number }>;
	evidence: {
		with_seeds: number;
		with_any_tracker: number;
		with_commit: number;
		with_relates: number;
		floaters: number;
	};
	convention_quality: {
		total: number;
		with_rule_signal: number;
		likely_code_restatement: number;
	} | null;
	seed_citations: {
		unique: number;
		status_counts: Record<string, number>;
		missing_in_seeds: number;
		top_cited: Array<{ id: string; count: number; status: string; title: string }>;
	};
	by_domain: DomainMix[];
	weak_domains: string[];
	thresholds: Required<AuditThresholds>;
	per_domain_thresholds: Record<string, Required<AuditThresholds>>;
	signals: {
		evidence_coverage: MetricVerdict;
		rule_density: MetricVerdict | null;
		floater_rate: MetricVerdict;
		per_domain_max_records: Array<{ domain: string; count: number; verdict: Verdict }>;
		per_domain_max_stale: Array<{ domain: string; count: number; verdict: Verdict }>;
	};
	failures: string[];
	warnings: string[];
}

export interface AuditOptions {
	cwd?: string;
	domain?: string;
	ignoreDomains?: string[];
}

interface RecordWithDomain {
	record: ExpertiseRecord;
	domain: string;
}

function extractSeedRefs(record: ExpertiseRecord): string[] {
	const seeds = record.evidence?.seeds;
	if (!seeds) return [];
	if (typeof seeds === "string") return [seeds];
	return [];
}

function recordHasTracker(record: ExpertiseRecord): boolean {
	const ev = record.evidence;
	if (!ev) return false;
	return Boolean(ev.seeds || ev.gh || ev.linear || ev.bead);
}

function recordIsFloater(record: ExpertiseRecord): boolean {
	const ev = record.evidence;
	if (!ev) {
		return !(record.relates_to && record.relates_to.length > 0);
	}
	if (ev.seeds || ev.gh || ev.linear || ev.bead || ev.commit) return false;
	if (record.relates_to && record.relates_to.length > 0) return false;
	return true;
}

interface SeedRow {
	id: string;
	status?: string;
	title?: string;
}

async function loadSeeds(cwd: string): Promise<Map<string, SeedRow>> {
	const seedsPath = join(cwd, ".seeds", "issues.jsonl");
	const seeds = new Map<string, SeedRow>();
	if (!existsSync(seedsPath)) return seeds;
	const content = await readFile(seedsPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		try {
			const row = JSON.parse(trimmed) as SeedRow;
			if (row && typeof row.id === "string") seeds.set(row.id, row);
		} catch {
			// Skip malformed seeds rows — the audit is read-only and best-effort here.
		}
	}
	return seeds;
}

function classifyEvidenceCoverage(
	value: number,
	thresholds: Required<AuditThresholds>,
): MetricVerdict {
	const verdict: Verdict =
		value >= thresholds.evidence_coverage
			? "PASS"
			: value >= thresholds.evidence_coverage_warn
				? "WARN"
				: "FAIL";
	return {
		verdict,
		value,
		threshold: thresholds.evidence_coverage,
		warn_threshold: thresholds.evidence_coverage_warn,
	};
}

function classifyRuleDensity(value: number, thresholds: Required<AuditThresholds>): MetricVerdict {
	const verdict: Verdict =
		value >= thresholds.rule_density_min
			? "PASS"
			: value >= thresholds.rule_density_warn
				? "WARN"
				: "FAIL";
	return {
		verdict,
		value,
		threshold: thresholds.rule_density_min,
		warn_threshold: thresholds.rule_density_warn,
	};
}

function classifyFloaterRate(value: number, thresholds: Required<AuditThresholds>): MetricVerdict {
	// Floater rate: PASS when ≤ floater_max. Above floater_max is WARN; above
	// 2× floater_max is FAIL. The 2× FAIL band is asymmetric on purpose — V1_PLAN
	// expects floaters to drop after attribution gates land in v0.11, so the
	// FAIL band should fire only for corpora that are *flagrantly* unattributed.
	const verdict: Verdict =
		value <= thresholds.floater_max
			? "PASS"
			: value <= thresholds.floater_max * 2
				? "WARN"
				: "FAIL";
	return {
		verdict,
		value,
		threshold: thresholds.floater_max,
	};
}

async function readDomainRecords(cwd: string, domains: string[]): Promise<RecordWithDomain[]> {
	const out: RecordWithDomain[] = [];
	for (const domain of domains) {
		const filePath = getExpertisePath(domain, cwd);
		if (!existsSync(filePath)) continue;
		const records = await readExpertiseFile(filePath, { allowUnknownTypes: true });
		for (const record of records) {
			out.push({ record, domain });
		}
	}
	return out;
}

export async function computeAudit(
	config: MulchConfig,
	options: AuditOptions = {},
): Promise<AuditReport> {
	const cwd = options.cwd ?? process.cwd();
	const auditCfg: AuditConfig | undefined = config.audit;

	const allDomains = Object.keys(config.domains);
	const cfgIgnored = new Set(auditCfg?.ignore_domains ?? []);
	const cliIgnored = new Set(options.ignoreDomains ?? []);
	const ignored = [...new Set([...cfgIgnored, ...cliIgnored])];

	let domains: string[];
	if (options.domain) {
		domains = allDomains.filter((d) => d === options.domain);
	} else {
		domains = allDomains.filter((d) => !cfgIgnored.has(d) && !cliIgnored.has(d));
	}

	const repo = basename(resolve(cwd)) || cwd;

	const items = await readDomainRecords(cwd, domains);
	const records = items.map((i) => i.record);
	const total = records.length;

	const thresholds = resolveAuditThresholds(auditCfg, options.domain);
	const perDomainThresholds: Record<string, Required<AuditThresholds>> = {};
	for (const d of domains) {
		perDomainThresholds[d] = resolveAuditThresholds(auditCfg, d);
	}

	// Type mix
	const typeCounts = new Map<string, number>();
	for (const r of records) {
		typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
	}
	const type_mix = Array.from(typeCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([type, count]) => ({
			type,
			count,
			pct: total > 0 ? Math.floor((100 * count) / total) : 0,
		}));

	// Evidence coverage
	let withSeeds = 0;
	let withCommit = 0;
	let withRelates = 0;
	let withAnyTracker = 0;
	let floaters = 0;
	for (const r of records) {
		if (extractSeedRefs(r).length > 0) withSeeds++;
		if (r.evidence?.commit) withCommit++;
		if (r.relates_to && r.relates_to.length > 0) withRelates++;
		if (recordHasTracker(r) || r.evidence?.commit) withAnyTracker++;
		if (recordIsFloater(r)) floaters++;
	}

	// Seed citations
	const seedsIndex = await loadSeeds(cwd);
	const refCounts = new Map<string, number>();
	for (const r of records) {
		for (const sid of extractSeedRefs(r)) {
			refCounts.set(sid, (refCounts.get(sid) ?? 0) + 1);
		}
	}
	const statusCounts: Record<string, number> = {};
	let missing = 0;
	for (const sid of refCounts.keys()) {
		const sj = seedsIndex.get(sid);
		if (sj) {
			const status = sj.status ?? "?";
			statusCounts[status] = (statusCounts[status] ?? 0) + 1;
		} else {
			missing++;
		}
	}
	const topCited = Array.from(refCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([id, count]) => {
			const sj = seedsIndex.get(id);
			return {
				id,
				count,
				status: sj?.status ?? "MISSING",
				title: (sj?.title ?? "MISSING").slice(0, 55),
			};
		});

	// Convention quality
	const conventions = records.filter((r) => r.type === "convention");
	let conv_quality: AuditReport["convention_quality"] = null;
	if (conventions.length > 0) {
		const withSignal = conventions.filter((r) =>
			hasRuleSignal((r as { content?: string }).content),
		).length;
		conv_quality = {
			total: conventions.length,
			with_rule_signal: withSignal,
			likely_code_restatement: conventions.length - withSignal,
		};
	}

	// Per-domain mix
	const byDomain = new Map<string, RecordWithDomain[]>();
	for (const item of items) {
		const list = byDomain.get(item.domain) ?? [];
		list.push(item);
		byDomain.set(item.domain, list);
	}
	const by_domain: DomainMix[] = [];
	for (const [domain, group] of byDomain.entries()) {
		const counts: Record<string, number> = {};
		let first: string | null = null;
		let last: string | null = null;
		for (const { record } of group) {
			counts[record.type] = (counts[record.type] ?? 0) + 1;
			const ts = record.recorded_at;
			if (ts) {
				if (!first || ts < first) first = ts;
				if (!last || ts > last) last = ts;
			}
		}
		const tot = group.length;
		const hv = (counts.failure ?? 0) + (counts.decision ?? 0);
		by_domain.push({
			domain,
			total: tot,
			type_counts: counts,
			high_value_pct: tot > 0 ? Math.floor((100 * hv) / tot) : 0,
			first_recorded_at: first,
			last_recorded_at: last,
		});
	}
	by_domain.sort((a, b) => b.total - a.total);

	const weak_domains = by_domain
		.filter((d) => d.total >= 5 && d.high_value_pct < 20)
		.map((d) => d.domain);

	// Verdicts
	const evidence_coverage_rate = total > 0 ? withAnyTracker / total : 0;
	const floater_rate = total > 0 ? floaters / total : 0;
	const rule_density_rate =
		conv_quality && conv_quality.total > 0 ? conv_quality.with_rule_signal / conv_quality.total : 0;

	const evidence_coverage = classifyEvidenceCoverage(evidence_coverage_rate, thresholds);
	const floater_rate_verdict = classifyFloaterRate(floater_rate, thresholds);
	const rule_density: MetricVerdict | null = conv_quality
		? classifyRuleDensity(rule_density_rate, thresholds)
		: null;

	const now = new Date();
	const shelfLife = config.classification_defaults.shelf_life;
	const per_domain_max_records = by_domain.map((d) => {
		const t = perDomainThresholds[d.domain] ?? thresholds;
		return {
			domain: d.domain,
			count: d.total,
			verdict: (d.total <= t.max_records_per_domain ? "PASS" : "WARN") as Verdict,
		};
	});
	const per_domain_max_stale = by_domain.map((d) => {
		const t = perDomainThresholds[d.domain] ?? thresholds;
		const group = byDomain.get(d.domain) ?? [];
		const stale = group.filter((i) => isRecordStale(i.record, now, shelfLife)).length;
		return {
			domain: d.domain,
			count: stale,
			verdict: (stale <= t.max_stale ? "PASS" : "WARN") as Verdict,
		};
	});

	const failures: string[] = [];
	const warnings: string[] = [];
	const trackVerdict = (label: string, v: MetricVerdict | null) => {
		if (!v) return;
		if (v.verdict === "FAIL") failures.push(label);
		else if (v.verdict === "WARN") warnings.push(label);
	};
	trackVerdict("evidence_coverage", evidence_coverage);
	trackVerdict("rule_density", rule_density);
	trackVerdict("floater_rate", floater_rate_verdict);
	for (const row of per_domain_max_records) {
		if (row.verdict === "WARN") warnings.push(`max_records_per_domain[${row.domain}]`);
	}
	for (const row of per_domain_max_stale) {
		if (row.verdict === "WARN") warnings.push(`max_stale[${row.domain}]`);
	}

	return {
		repo,
		total_records: total,
		domains,
		ignored_domains: ignored,
		type_mix,
		evidence: {
			with_seeds: withSeeds,
			with_any_tracker: withAnyTracker,
			with_commit: withCommit,
			with_relates: withRelates,
			floaters,
		},
		convention_quality: conv_quality,
		seed_citations: {
			unique: refCounts.size,
			status_counts: statusCounts,
			missing_in_seeds: missing,
			top_cited: topCited,
		},
		by_domain,
		weak_domains,
		thresholds,
		per_domain_thresholds: perDomainThresholds,
		signals: {
			evidence_coverage,
			rule_density,
			floater_rate: floater_rate_verdict,
			per_domain_max_records,
			per_domain_max_stale,
		},
		failures,
		warnings,
	};
}

// ---- Suggest helpers ----

export interface SuggestionGroup {
	action: "archive" | "revise" | "attribute";
	headline: string;
	rationale: string;
	record_ids: string[];
	commands: string[];
}

export interface SuggestPayload {
	groups: SuggestionGroup[];
}

export async function buildSuggestions(
	config: MulchConfig,
	options: AuditOptions = {},
): Promise<SuggestPayload> {
	const cwd = options.cwd ?? process.cwd();
	const auditCfg = config.audit;
	const cfgIgnored = new Set(auditCfg?.ignore_domains ?? []);
	const cliIgnored = new Set(options.ignoreDomains ?? []);
	let domains = Object.keys(config.domains);
	if (options.domain) {
		domains = domains.filter((d) => d === options.domain);
	} else {
		domains = domains.filter((d) => !cfgIgnored.has(d) && !cliIgnored.has(d));
	}

	const items = await readDomainRecords(cwd, domains);
	const now = new Date();
	const shelfLife = config.classification_defaults.shelf_life;

	const archive: string[] = [];
	const revise: string[] = [];
	const attribute: string[] = [];

	for (const { record } of items) {
		const id = record.id ?? "";
		if (!id) continue;

		if (record.classification !== "foundational" && isRecordStale(record, now, shelfLife)) {
			archive.push(id);
		}
		if (record.type === "convention") {
			const content = (record as { content?: string }).content;
			if (!hasRuleSignal(content)) revise.push(id);
		}
		if (recordIsFloater(record)) {
			attribute.push(id);
		}
	}

	const groups: SuggestionGroup[] = [];
	if (archive.length > 0) {
		groups.push({
			action: "archive",
			headline: `${archive.length} stale records past shelf life`,
			rationale:
				"These records are past their classification shelf life and are not foundational. Soft-archive them with `ml prune` (or `ml archive` once it lands in v0.10).",
			record_ids: archive,
			commands: [
				`ml prune --ids ${archive.join(",")} --dry-run`,
				`ml prune --ids ${archive.join(",")}`,
			],
		});
	}
	if (revise.length > 0) {
		groups.push({
			action: "revise",
			headline: `${revise.length} conventions lack rule-signal language`,
			rationale:
				"Conventions without rule-signal words (because, must not, avoid, always, never, …) often restate code rather than encode a rule. Revise the content or downgrade to a note.",
			record_ids: revise,
			commands: revise.slice(0, 10).map((id) => `ml edit ${id} --content "..."`),
		});
	}
	if (attribute.length > 0) {
		groups.push({
			action: "attribute",
			headline: `${attribute.length} records have no evidence or relates_to link`,
			rationale:
				"Floater records lack any tracker (seeds/gh/linear/bead), commit, or relates_to link. Attribute them so future audits and pruning can follow the trail.",
			record_ids: attribute,
			commands: attribute
				.slice(0, 10)
				.map(
					(id) =>
						`ml edit ${id} --evidence-seeds <id>   # or --evidence-commit <sha> / --relates-to <mx-id>`,
				),
		});
	}
	return { groups };
}
