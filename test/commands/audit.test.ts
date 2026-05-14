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
	if (opts.withSeed || opts.withCommit) {
		r.evidence = {};
		if (opts.withSeed) r.evidence.seeds = opts.withSeed;
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
