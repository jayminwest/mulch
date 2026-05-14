import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG, type MulchConfig } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import { buildSuggestions, computeAudit, hasRuleSignal } from "../../src/utils/audit.ts";
import { getExpertisePath, initMulchDir, writeConfig } from "../../src/utils/config.ts";
import { appendRecord, createExpertiseFile } from "../../src/utils/expertise.ts";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");

function runCli(args: string[], cwd: string) {
	return Bun.spawnSync(["bun", CLI_PATH, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
}

function nowIso(): string {
	return new Date().toISOString();
}

function daysAgoIso(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return d.toISOString();
}

async function seedDomain(
	tmpDir: string,
	domain: string,
	records: ExpertiseRecord[],
): Promise<void> {
	const filePath = getExpertisePath(domain, tmpDir);
	await createExpertiseFile(filePath);
	for (const r of records) {
		await appendRecord(filePath, r);
	}
}

function convention(opts: {
	content: string;
	classification?: "foundational" | "tactical" | "observational";
	withSeed?: string;
	withGh?: string;
	withLinear?: string;
	withBead?: string;
	withCommit?: string;
	relates?: string[];
	id?: string;
	recordedAt?: string;
}): ExpertiseRecord {
	const r: ExpertiseRecord = {
		type: "convention",
		content: opts.content,
		classification: opts.classification ?? "foundational",
		recorded_at: opts.recordedAt ?? nowIso(),
	};
	if (opts.id) r.id = opts.id;
	if (opts.withSeed || opts.withGh || opts.withLinear || opts.withBead || opts.withCommit) {
		r.evidence = {};
		if (opts.withSeed) r.evidence.seeds = opts.withSeed;
		if (opts.withGh) r.evidence.gh = opts.withGh;
		if (opts.withLinear) r.evidence.linear = opts.withLinear;
		if (opts.withBead) r.evidence.bead = opts.withBead;
		if (opts.withCommit) r.evidence.commit = opts.withCommit;
	}
	if (opts.relates) r.relates_to = opts.relates;
	return r;
}

describe("audit utility", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-audit-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("hasRuleSignal recognizes rule-signal words case-insensitively", () => {
		expect(hasRuleSignal("BECAUSE foo")).toBe(true);
		expect(hasRuleSignal("avoid this pattern")).toBe(true);
		expect(hasRuleSignal("rationale: keep it small")).toBe(true);
		expect(hasRuleSignal("just restates module layout")).toBe(false);
		expect(hasRuleSignal(undefined)).toBe(false);
		expect(hasRuleSignal("")).toBe(false);
	});

	it("computes evidence coverage, floater count, and rule density", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, testing: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "Always use 'records' not 'entries'", withSeed: "mulch-001" }),
			convention({ content: "Never call process.exit", withCommit: "abc123" }),
			convention({ content: "Module layout: src/foo/bar" }), // floater + no rule signal
			convention({ content: "Module layout: test/", relates: ["mx-aaa"] }), // not a floater (relates)
		]);
		await seedDomain(tmpDir, "testing", [
			convention({ content: "Always use mkdtemp because real fs", withSeed: "mulch-002" }),
		]);

		const report = await computeAudit(config, { cwd: tmpDir });
		expect(report.total_records).toBe(5);
		expect(report.evidence.with_seeds).toBe(2);
		expect(report.evidence.with_any_tracker).toBe(3); // 2 seeds + 1 commit
		expect(report.evidence.floaters).toBe(1); // only the bare module-layout one
		expect(report.convention_quality?.total).toBe(5);
		expect(report.convention_quality?.with_rule_signal).toBe(3); // always, never, always-because
		expect(report.signals.rule_density?.verdict).toBe("PASS"); // 3/5 = 0.6 ≥ 0.25
		expect(report.signals.evidence_coverage.verdict).toBe("PASS"); // 3/5 = 0.6 ≥ 0.5
		// floater 1/5 = 0.2 → PASS at default floater_max=0.2
		expect(report.signals.floater_rate.verdict).toBe("PASS");
		expect(report.failures).toEqual([]);
	});

	it("FAIL when evidence_coverage drops below evidence_coverage_warn", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
			audit: {
				thresholds: {
					evidence_coverage: 0.8,
					evidence_coverage_warn: 0.5,
				},
			},
		};
		await writeConfig(config, tmpDir);
		// 5 records, 0 with tracker → 0% coverage → FAIL
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a" }),
			convention({ content: "b" }),
			convention({ content: "c" }),
			convention({ content: "d" }),
			convention({ content: "e" }),
		]);
		const report = await computeAudit(config, { cwd: tmpDir });
		expect(report.signals.evidence_coverage.verdict).toBe("FAIL");
		expect(report.failures).toContain("evidence_coverage");
	});

	it("--domain scopes metrics to one domain", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, testing: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [convention({ content: "a", withSeed: "x" })]);
		await seedDomain(tmpDir, "testing", [convention({ content: "b" })]);

		const scoped = await computeAudit(config, { cwd: tmpDir, domain: "cli" });
		expect(scoped.total_records).toBe(1);
		expect(scoped.domains).toEqual(["cli"]);
		expect(scoped.evidence.with_any_tracker).toBe(1);
	});

	it("--ignore-domains drops domains from compute", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, docs: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [convention({ content: "a", withSeed: "x" })]);
		await seedDomain(tmpDir, "docs", [convention({ content: "b" }), convention({ content: "c" })]);

		const report = await computeAudit(config, {
			cwd: tmpDir,
			ignoreDomains: ["docs"],
		});
		expect(report.total_records).toBe(1);
		expect(report.ignored_domains).toEqual(["docs"]);
	});

	it("config.audit.ignore_domains merges with CLI ignore_domains", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, docs: {}, notes: {} },
			audit: { ignore_domains: ["docs"] },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [convention({ content: "a" })]);
		await seedDomain(tmpDir, "docs", [convention({ content: "b" })]);
		await seedDomain(tmpDir, "notes", [convention({ content: "c" })]);

		const report = await computeAudit(config, {
			cwd: tmpDir,
			ignoreDomains: ["notes"],
		});
		expect(report.total_records).toBe(1);
		expect(new Set(report.ignored_domains)).toEqual(new Set(["docs", "notes"]));
	});

	it("per-domain threshold override surfaces in per_domain_thresholds", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, docs: {} },
			audit: {
				thresholds: { rule_density_min: 0.25 },
				per_domain: {
					docs: { rule_density_min: 0.05 },
				},
			},
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [convention({ content: "always do X" })]);
		await seedDomain(tmpDir, "docs", [convention({ content: "just docs" })]);

		const report = await computeAudit(config, { cwd: tmpDir });
		expect(report.per_domain_thresholds.cli?.rule_density_min).toBe(0.25);
		expect(report.per_domain_thresholds.docs?.rule_density_min).toBe(0.05);
	});

	it("buildSuggestions groups records by remediation action", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			// floater + likely code-restatement
			convention({
				content: "src/foo.ts module",
				id: "mx-aaaa00",
				classification: "tactical",
				recordedAt: nowIso(),
			}),
			// stale + tactical → archive candidate
			convention({
				content: "Always foo because bar",
				id: "mx-bbbb00",
				classification: "tactical",
				recordedAt: daysAgoIso(60),
				withSeed: "x",
			}),
			// foundational with rule signal + attribution → no suggestions
			convention({
				content: "Never block on hooks",
				id: "mx-cccc00",
				withSeed: "y",
			}),
		]);

		const payload = await buildSuggestions(config, { cwd: tmpDir });
		const actions = payload.groups.map((g) => g.action).sort();
		expect(actions).toEqual(["archive", "attribute", "revise"]);

		const byAction = Object.fromEntries(payload.groups.map((g) => [g.action, g]));
		expect(byAction.archive?.record_ids).toContain("mx-bbbb00");
		expect(byAction.revise?.record_ids).toContain("mx-aaaa00");
		expect(byAction.attribute?.record_ids).toContain("mx-aaaa00");
		expect(byAction.attribute?.record_ids).not.toContain("mx-cccc00");
	});

	it("breaks evidence coverage down per-tracker (with_tracker)", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a", withSeed: "mulch-001" }),
			convention({ content: "b", withGh: "42" }),
			convention({ content: "c", withGh: "43" }),
			convention({ content: "d", withLinear: "ENG-123" }),
			convention({ content: "e", withBead: "b-abc123" }),
			convention({ content: "f" }), // floater
		]);
		const report = await computeAudit(config, { cwd: tmpDir });
		expect(report.evidence.with_tracker).toEqual({
			seeds: 1,
			gh: 2,
			linear: 1,
			bead: 1,
		});
		// Back-compat: with_seeds mirrors with_tracker.seeds.
		expect(report.evidence.with_seeds).toBe(1);
		// 5 records carry at least one tracker; 1 is a floater.
		expect(report.evidence.with_any_tracker).toBe(5);
		expect(report.evidence.floaters).toBe(1);
	});

	it("tracker_citations buckets gh/linear/bead refs as unresolved", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a", withGh: "42" }),
			convention({ content: "b", withGh: "42" }),
			convention({ content: "c", withGh: "43" }),
			convention({ content: "d", withLinear: "ENG-9" }),
			convention({ content: "e", withBead: "b-abc123" }),
		]);
		// No .seeds/issues.jsonl on disk — gh/linear/bead never resolve locally.
		const report = await computeAudit(config, { cwd: tmpDir });
		// Unique tracker citations: gh#42, gh#43, linear:ENG-9, bead:b-abc123.
		expect(report.tracker_citations.unique).toBe(4);
		expect(report.tracker_citations.status_counts.unresolved).toBe(4);
		expect(report.tracker_citations.missing_in_index).toBe(0);
		const byId = Object.fromEntries(report.tracker_citations.top_cited.map((t) => [t.id, t]));
		expect(byId["gh#42"]?.count).toBe(2);
		expect(byId["gh#42"]?.tracker).toBe("gh");
		expect(byId["gh#42"]?.status).toBe("unresolved");
		expect(byId["gh#43"]?.count).toBe(1);
		expect(byId["linear:ENG-9"]).toBeDefined();
		expect(byId["bead:b-abc123"]).toBeDefined();
		// Back-compat: seed_citations stays empty in a gh-only repo so old
		// consumers reading report.seed_citations don't see foreign tracker data.
		expect(report.seed_citations.unique).toBe(0);
		expect(report.seed_citations.top_cited).toEqual([]);
	});

	it("tracker_citations mixes seeds (resolved) with gh/linear/bead (unresolved)", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a", withSeed: "mulch-007" }),
			convention({ content: "b", withSeed: "mulch-007" }),
			convention({ content: "c", withGh: "42" }),
		]);
		await mkdir(join(tmpDir, ".seeds"), { recursive: true });
		await writeFile(
			join(tmpDir, ".seeds", "issues.jsonl"),
			`${JSON.stringify({ id: "mulch-007", status: "closed", title: "Fix stdin" })}\n`,
		);

		const report = await computeAudit(config, { cwd: tmpDir });
		expect(report.tracker_citations.unique).toBe(2); // mulch-007 + gh#42
		expect(report.tracker_citations.status_counts.closed).toBe(1);
		expect(report.tracker_citations.status_counts.unresolved).toBe(1);
		// Back-compat: seed_citations still only counts seeds entries.
		expect(report.seed_citations.unique).toBe(1);
		expect(report.seed_citations.top_cited[0]).toMatchObject({
			id: "mulch-007",
			count: 2,
			status: "closed",
		});
	});

	it("resolves seed citations against .seeds/issues.jsonl", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a", withSeed: "mulch-007" }),
			convention({ content: "b", withSeed: "mulch-007" }),
			convention({ content: "c", withSeed: "mulch-missing" }),
		]);
		await mkdir(join(tmpDir, ".seeds"), { recursive: true });
		await writeFile(
			join(tmpDir, ".seeds", "issues.jsonl"),
			`${JSON.stringify({ id: "mulch-007", status: "closed", title: "Fix stdin" })}\n`,
		);

		const report = await computeAudit(config, { cwd: tmpDir });
		expect(report.seed_citations.unique).toBe(2);
		expect(report.seed_citations.status_counts.closed).toBe(1);
		expect(report.seed_citations.missing_in_seeds).toBe(1);
		expect(report.seed_citations.top_cited[0]).toMatchObject({
			id: "mulch-007",
			count: 2,
			status: "closed",
		});
	});
});

describe("audit CLI", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-audit-cli-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("exits 0 and renders human output by default", async () => {
		const config: MulchConfig = { ...DEFAULT_CONFIG, domains: { cli: {} } };
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [convention({ content: "Always use mkdtemp", withSeed: "x" })]);

		const result = runCli(["audit"], tmpDir);
		expect(result.exitCode).toBe(0);
		const stdout = result.stdout.toString();
		expect(stdout).toContain("=== mulch-audit:");
		expect(stdout).toContain("total records: 1");
		expect(stdout).toContain("--- summary signals ---");
	});

	it("human output omits the seeds line for gh-only repos and renders tracker-prefixed top-cited ids", async () => {
		const config: MulchConfig = { ...DEFAULT_CONFIG, domains: { cli: {} } };
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a", withGh: "42" }),
			convention({ content: "b", withGh: "42" }),
		]);

		const result = runCli(["audit"], tmpDir);
		expect(result.exitCode).toBe(0);
		const stdout = result.stdout.toString();
		// Per-tracker breakdown: gh present, seeds/linear/bead omitted (0).
		expect(stdout).toContain("- gh: 2");
		expect(stdout).not.toContain("- seeds:");
		expect(stdout).not.toContain("- linear:");
		expect(stdout).not.toContain("- bead:");
		// Old "seeds-ev" line is gone in favor of the per-tracker breakdown.
		expect(stdout).not.toContain("with seeds-ev");
		// Citation block renders under the generalized header.
		expect(stdout).toContain("tracker-citation");
		expect(stdout).toContain("top-cited tracker ids:");
		expect(stdout).toContain("gh#42 cited=2 status=unresolved");
	});

	it("--ci emits JSON and exits 0 when no FAIL signals", async () => {
		const config: MulchConfig = { ...DEFAULT_CONFIG, domains: { cli: {} } };
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "always use foo because bar", withSeed: "x" }),
		]);

		const result = runCli(["audit", "--ci"], tmpDir);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout.toString()) as {
			success: boolean;
			report: { signals: { evidence_coverage: { verdict: string } } };
		};
		expect(payload.success).toBe(true);
		expect(payload.report.signals.evidence_coverage.verdict).toBe("PASS");
	});

	it("--ci exits 1 when a signal is in FAIL band", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {} },
			audit: {
				thresholds: { evidence_coverage: 0.9, evidence_coverage_warn: 0.8 },
			},
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [convention({ content: "a" }), convention({ content: "b" })]);

		const result = runCli(["audit", "--ci"], tmpDir);
		expect(result.exitCode).toBe(1);
		const payload = JSON.parse(result.stdout.toString()) as { success: boolean };
		expect(payload.success).toBe(false);
	});

	it("--suggest emits actionable remediation commands", async () => {
		const config: MulchConfig = { ...DEFAULT_CONFIG, domains: { cli: {} } };
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({
				content: "src/foo.ts layout",
				id: "mx-flotr0",
				classification: "tactical",
			}),
		]);

		const result = runCli(["audit", "--suggest"], tmpDir);
		expect(result.exitCode).toBe(0);
		const stdout = result.stdout.toString();
		expect(stdout).toContain("[REVISE]");
		expect(stdout).toContain("[ATTRIBUTE]");
		expect(stdout).toContain("mx-flotr0");
		expect(stdout).toContain("ml edit mx-flotr0");
	});

	it("--domain scopes audit to one domain", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, testing: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "always use mkdtemp because real fs", withSeed: "x" }),
		]);
		await seedDomain(tmpDir, "testing", [convention({ content: "b" })]);

		const result = runCli(["audit", "--domain", "cli", "--ci"], tmpDir);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout.toString()) as {
			report: { total_records: number; domains: string[] };
		};
		expect(payload.report.total_records).toBe(1);
		expect(payload.report.domains).toEqual(["cli"]);
	});

	it("--ignore-domains drops domains from the metric set", async () => {
		const config: MulchConfig = {
			...DEFAULT_CONFIG,
			domains: { cli: {}, docs: {} },
		};
		await writeConfig(config, tmpDir);
		await seedDomain(tmpDir, "cli", [
			convention({ content: "always use mkdtemp because real fs", withSeed: "x" }),
		]);
		await seedDomain(tmpDir, "docs", [convention({ content: "b" }), convention({ content: "c" })]);

		const result = runCli(["audit", "--ignore-domains", "docs", "--ci"], tmpDir);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout.toString()) as {
			report: { total_records: number; ignored_domains: string[] };
		};
		expect(payload.report.total_records).toBe(1);
		expect(payload.report.ignored_domains).toContain("docs");
	});

	it("rejects unknown --domain with an error and non-zero exit", async () => {
		const config: MulchConfig = { ...DEFAULT_CONFIG, domains: { cli: {} } };
		await writeConfig(config, tmpDir);

		const result = runCli(["audit", "--domain", "nope"], tmpDir);
		expect(result.exitCode).toBe(1);
		const stderr = result.stderr.toString();
		expect(stderr).toContain("nope");
	});

	it("global --json emits JSON without forcing exit-code on warnings", async () => {
		const config: MulchConfig = { ...DEFAULT_CONFIG, domains: { cli: {} } };
		await writeConfig(config, tmpDir);
		// 4 records, 0 evidence → 0% coverage. With default thresholds (PASS≥0.5,
		// WARN≥0.3), 0% is FAIL — but without --ci the exit code stays 0.
		await seedDomain(tmpDir, "cli", [
			convention({ content: "a" }),
			convention({ content: "b" }),
			convention({ content: "c" }),
			convention({ content: "d" }),
		]);

		const result = runCli(["--json", "audit"], tmpDir);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout.toString()) as {
			report: { signals: { evidence_coverage: { verdict: string } } };
		};
		expect(payload.report.signals.evidence_coverage.verdict).toBe("FAIL");
	});
});
