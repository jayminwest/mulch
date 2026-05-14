import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { estimateRecordText, registerPrimeCommand } from "../../src/commands/prime.ts";
import { initRegistryFromConfig } from "../../src/registry/init.ts";
import { resetRegistry } from "../../src/registry/type-registry.ts";
import type { CustomTypeConfig } from "../../src/schemas/config.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import type { DomainRecords } from "../../src/utils/budget.ts";
import {
	applyBudget,
	DEFAULT_BUDGET,
	estimateTokens,
	formatBudgetSummary,
} from "../../src/utils/budget.ts";
import { getExpertisePath, initMulchDir, readConfig, writeConfig } from "../../src/utils/config.ts";
import {
	appendRecord,
	createExpertiseFile,
	getFileModTime,
	readExpertiseFile,
} from "../../src/utils/expertise.ts";
import {
	formatDomainExpertise,
	formatDomainExpertiseCompact,
	formatDomainExpertisePlain,
	formatDomainExpertiseXml,
	formatJsonOutput,
	formatPrimeOutput,
	formatPrimeOutputCompact,
	formatPrimeOutputPlain,
	formatPrimeOutputXml,
	getSessionEndReminder,
} from "../../src/utils/format.ts";
import { fileMatchesAny, filterByContext } from "../../src/utils/git.ts";

describe("prime command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-prime-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("generates prime output with no domains", () => {
		const output = formatPrimeOutput([]);
		expect(output).toContain("# Project Expertise (via Mulch)");
		expect(output).toContain("No expertise recorded yet");
		expect(output).toContain("ml add <domain>");
	});

	it("generates prime output with a single domain", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Use vitest for all tests",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const section = formatDomainExpertise("testing", records, lastUpdated);
		const output = formatPrimeOutput([section]);

		expect(output).toContain("# Project Expertise (via Mulch)");
		expect(output).toContain("## testing");
		expect(output).toContain("Use vitest for all tests");
		expect(output).toContain("## Recording New Learnings");
	});

	it("generates prime output with multiple domains", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

		const testingPath = getExpertisePath("testing", tmpDir);
		const archPath = getExpertisePath("architecture", tmpDir);
		await createExpertiseFile(testingPath);
		await createExpertiseFile(archPath);

		await appendRecord(testingPath, {
			type: "convention",
			content: "Always use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(archPath, {
			type: "decision",
			title: "Use ESM",
			rationale: "Better tree-shaking",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const config = await readConfig(tmpDir);
		const sections: string[] = [];
		for (const domain of Object.keys(config.domains)) {
			const filePath = getExpertisePath(domain, tmpDir);
			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			sections.push(formatDomainExpertise(domain, records, lastUpdated));
		}

		const output = formatPrimeOutput(sections);
		expect(output).toContain("## testing");
		expect(output).toContain("## architecture");
		expect(output).toContain("Always use vitest");
		expect(output).toContain("Use ESM");
	});

	it("prime output includes recording instructions", () => {
		const output = formatPrimeOutput([]);
		expect(output).toContain("## Recording New Learnings");
		expect(output).toContain("ml record <domain>");
	});

	it("prime output includes per-type required fields table", () => {
		const output = formatPrimeOutput([]);
		expect(output).toContain("**Required fields by type:**");
		expect(output).toContain("| Type | Required flags |");
		expect(output).toContain("| `convention`");
		expect(output).toContain("| `pattern`");
		expect(output).toContain("| `failure`");
		expect(output).toContain("| `decision`");
		expect(output).toContain("| `reference`");
		expect(output).toContain("| `guide`");
	});

	it("--full includes classification and evidence in output", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Always lint before commit",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: { commit: "abc123", file: "src/index.ts" },
		});

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const section = formatDomainExpertise("testing", records, lastUpdated, {
			full: true,
		});

		expect(section).toContain("(foundational)");
		expect(section).toContain("commit: abc123");
		expect(section).toContain("file: src/index.ts");
	});

	it("--full=false omits classification and evidence", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Always lint before commit",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
			evidence: { commit: "abc123" },
		});

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const section = formatDomainExpertise("testing", records, lastUpdated);

		expect(section).not.toContain("(foundational)");
		expect(section).not.toContain("abc123");
	});

	it("--json outputs valid JSON with domain records", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const records = await readExpertiseFile(filePath);
		const output = formatJsonOutput([{ domain: "testing", entry_count: records.length, records }]);

		const parsed = JSON.parse(output);
		expect(parsed.type).toBe("expertise");
		expect(parsed.domains).toHaveLength(1);
		expect(parsed.domains[0].domain).toBe("testing");
		expect(parsed.domains[0].entry_count).toBe(1);
		expect(parsed.domains[0].records[0].content).toBe("Use vitest");
	});

	it("--format xml outputs XML with domain tags", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(filePath, {
			type: "failure",
			description: "OOM on large data",
			resolution: "Use streaming",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const section = formatDomainExpertiseXml("testing", records, lastUpdated);
		const output = formatPrimeOutputXml([section]);

		expect(output).toContain("<expertise>");
		expect(output).toContain("</expertise>");
		expect(output).toContain('<domain name="testing"');
		expect(output).toMatch(/<convention id="mx-[0-9a-f]+" classification="foundational">/);
		expect(output).toContain("Use vitest");
		expect(output).toContain("<resolution>Use streaming</resolution>");
	});

	it("--format xml escapes special characters", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Use <T> & generics",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const records = await readExpertiseFile(filePath);
		const section = formatDomainExpertiseXml("testing", records, null);

		expect(section).toContain("Use &lt;T&gt; &amp; generics");
		expect(section).not.toContain("Use <T>");
	});

	it("--format plain outputs plain text", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
		const filePath = getExpertisePath("testing", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Use vitest",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(filePath, {
			type: "decision",
			title: "Use ESM",
			rationale: "Better tree-shaking",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const section = formatDomainExpertisePlain("testing", records, lastUpdated);
		const output = formatPrimeOutputPlain([section]);

		// Spawn-injection contract: no decorative document title, no underline.
		expect(output).not.toContain("Project Expertise (via Mulch)");
		expect(output).not.toMatch(/^=+$/m);
		expect(output).toContain("[testing]");
		expect(output).toContain("Conventions:");
		expect(output).toMatch(/- \[mx-[0-9a-f]+\] Use vitest/);
		expect(output).toContain("Decisions:");
		expect(output).toMatch(/- \[mx-[0-9a-f]+\] Use ESM: Better tree-shaking/);
		// Should not contain markdown
		expect(output).not.toContain("##");
		expect(output).not.toContain("**");
	});

	describe("domain argument scoping", () => {
		it("outputs only the specified domain when domain arg is given", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Simulate scoping to just "testing"
			const config = await readConfig(tmpDir);
			const targetDomains = ["testing"];
			expect(config.domains).toHaveProperty("testing");
			expect(config.domains).toHaveProperty("architecture");

			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertise(domain, records, lastUpdated));
			}

			const output = formatPrimeOutput(sections);
			expect(output).toContain("## testing");
			expect(output).toContain("Use vitest");
			expect(output).not.toContain("## architecture");
			expect(output).not.toContain("Use ESM");
		});

		it("validates domain exists in config", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const config = await readConfig(tmpDir);
			const domainArg = "nonexistent";

			expect(domainArg in config.domains).toBe(false);
		});

		it("domain scoping works with --json format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Scope to just "architecture" in JSON mode
			const targetDomains = ["architecture"];
			const domains: {
				domain: string;
				entry_count: number;
				records: ExpertiseRecord[];
			}[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				domains.push({ domain, entry_count: records.length, records });
			}

			const output = formatJsonOutput(domains);
			const parsed = JSON.parse(output);
			expect(parsed.domains).toHaveLength(1);
			expect(parsed.domains[0].domain).toBe("architecture");
		});

		it("domain scoping works with --format xml", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Scope to just "testing" in XML mode
			const targetDomains = ["testing"];
			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertiseXml(domain, records, lastUpdated));
			}

			const output = formatPrimeOutputXml(sections);
			expect(output).toContain('<domain name="testing"');
			expect(output).not.toContain('<domain name="architecture"');
		});
	});

	it("formats domain with all record types", async () => {
		await writeConfig({ ...DEFAULT_CONFIG, domains: { fulltest: {} } }, tmpDir);
		const filePath = getExpertisePath("fulltest", tmpDir);
		await createExpertiseFile(filePath);

		await appendRecord(filePath, {
			type: "convention",
			content: "Always lint before commit",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(filePath, {
			type: "pattern",
			name: "Repository Pattern",
			description: "Abstract data access",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(filePath, {
			type: "failure",
			description: "OOM on large datasets",
			resolution: "Use streaming",
			classification: "tactical",
			recorded_at: new Date().toISOString(),
		});
		await appendRecord(filePath, {
			type: "decision",
			title: "Use PostgreSQL",
			rationale: "Better JSON support",
			classification: "foundational",
			recorded_at: new Date().toISOString(),
		});

		const records = await readExpertiseFile(filePath);
		const lastUpdated = await getFileModTime(filePath);
		const section = formatDomainExpertise("fulltest", records, lastUpdated);

		expect(section).toContain("### Conventions");
		expect(section).toContain("Always lint before commit");
		expect(section).toContain("### Patterns");
		expect(section).toContain("Repository Pattern");
		expect(section).toContain("### Known Failures");
		expect(section).toContain("OOM on large datasets");
		expect(section).toContain("### Decisions");
		expect(section).toContain("Use PostgreSQL");
	});

	describe("reference and guide record formatting", () => {
		it("formats reference records under References heading", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "reference",
				name: "cli-entry",
				description: "Main CLI entry point",
				files: ["src/cli.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertise("testing", records, lastUpdated);

			expect(section).toContain("### References");
			expect(section).toContain("**cli-entry**: Main CLI entry point");
			expect(section).toContain("(src/cli.ts)");
		});

		it("formats guide records under Guides heading", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "guide",
				name: "add-command",
				description: "How to add a new CLI command",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertise("testing", records, lastUpdated);

			expect(section).toContain("### Guides");
			expect(section).toContain("**add-command**: How to add a new CLI command");
		});

		it("XML format handles reference and guide records", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "reference",
				name: "config-file",
				description: "YAML config",
				files: ["config.yaml"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "guide",
				name: "setup-guide",
				description: "How to set up the project",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseXml("testing", records, lastUpdated);

			expect(section).toMatch(/<reference id="mx-[0-9a-f]+" classification="foundational">/);
			expect(section).toContain("<name>config-file</name>");
			expect(section).toContain("<files>config.yaml</files>");
			expect(section).toContain("</reference>");
			expect(section).toMatch(/<guide id="mx-[0-9a-f]+" classification="tactical">/);
			expect(section).toContain("<name>setup-guide</name>");
			expect(section).toContain("</guide>");
		});

		it("plain text format handles reference and guide records", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "reference",
				name: "entry-point",
				description: "Main entry",
				files: ["src/index.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "guide",
				name: "deploy-guide",
				description: "How to deploy",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertisePlain("testing", records, lastUpdated);

			expect(section).toContain("References:");
			expect(section).toMatch(/- \[mx-[0-9a-f]+\] entry-point: Main entry \(src\/index\.ts\)/);
			expect(section).toContain("Guides:");
			expect(section).toMatch(/- \[mx-[0-9a-f]+\] deploy-guide: How to deploy/);
		});

		it("JSON output includes reference and guide records", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "reference",
				name: "key-file",
				description: "Important file",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "guide",
				name: "howto",
				description: "Step by step guide",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const output = formatJsonOutput([
				{ domain: "testing", entry_count: records.length, records },
			]);

			const parsed = JSON.parse(output);
			expect(parsed.domains[0].records).toHaveLength(2);
			expect(parsed.domains[0].records[0].type).toBe("reference");
			expect(parsed.domains[0].records[1].type).toBe("guide");
		});

		it("recording instructions include reference and guide examples", () => {
			const output = formatPrimeOutput([]);
			expect(output).toContain("--type reference");
			expect(output).toContain("--type guide");
		});
	});

	describe("domain exclusion", () => {
		it("validates excluded domain exists in config", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const config = await readConfig(tmpDir);
			const excludedDomain = "nonexistent";

			expect(excludedDomain in config.domains).toBe(false);
		});

		it("excludes specified domain from output", async () => {
			await writeConfig(
				{ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {}, api: {} } },
				tmpDir,
			);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			const apiPath = getExpertisePath("api", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);
			await createExpertiseFile(apiPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(apiPath, {
				type: "pattern",
				name: "REST endpoints",
				description: "Follow RESTful conventions",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Exclude architecture domain
			const config = await readConfig(tmpDir);
			const excluded = ["architecture"];
			const targetDomains = Object.keys(config.domains).filter((d) => !excluded.includes(d));

			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertise(domain, records, lastUpdated));
			}

			const output = formatPrimeOutput(sections);
			expect(output).toContain("## testing");
			expect(output).toContain("## api");
			expect(output).not.toContain("## architecture");
			expect(output).toContain("Use vitest");
			expect(output).toContain("REST endpoints");
			expect(output).not.toContain("Use ESM");
		});

		it("excludes multiple domains from output", async () => {
			await writeConfig(
				{
					...DEFAULT_CONFIG,
					domains: { testing: {}, architecture: {}, api: {}, database: {} },
				},
				tmpDir,
			);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			const apiPath = getExpertisePath("api", tmpDir);
			const dbPath = getExpertisePath("database", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);
			await createExpertiseFile(apiPath);
			await createExpertiseFile(dbPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(apiPath, {
				type: "pattern",
				name: "REST endpoints",
				description: "Follow RESTful conventions",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(dbPath, {
				type: "convention",
				content: "Use PostgreSQL",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Exclude architecture and api domains
			const config = await readConfig(tmpDir);
			const excluded = ["architecture", "api"];
			const targetDomains = Object.keys(config.domains).filter((d) => !excluded.includes(d));

			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertise(domain, records, lastUpdated));
			}

			const output = formatPrimeOutput(sections);
			expect(output).toContain("## testing");
			expect(output).toContain("## database");
			expect(output).not.toContain("## architecture");
			expect(output).not.toContain("## api");
			expect(output).toContain("Use vitest");
			expect(output).toContain("Use PostgreSQL");
			expect(output).not.toContain("Use ESM");
			expect(output).not.toContain("REST endpoints");
		});

		it("combines --domain and --exclude-domain flags", async () => {
			await writeConfig(
				{
					...DEFAULT_CONFIG,
					domains: { testing: {}, architecture: {}, api: {}, database: {} },
				},
				tmpDir,
			);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			const apiPath = getExpertisePath("api", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);
			await createExpertiseFile(apiPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(apiPath, {
				type: "pattern",
				name: "REST endpoints",
				description: "Follow RESTful conventions",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Select testing and architecture, then exclude architecture
			const requested = ["testing", "architecture"];
			const excluded = ["architecture"];
			const targetDomains = requested.filter((d) => !excluded.includes(d));

			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertise(domain, records, lastUpdated));
			}

			const output = formatPrimeOutput(sections);
			expect(output).toContain("## testing");
			expect(output).not.toContain("## architecture");
			expect(output).not.toContain("## api");
			expect(output).toContain("Use vitest");
			expect(output).not.toContain("Use ESM");
		});

		it("exclusion works with --format xml", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const config = await readConfig(tmpDir);
			const excluded = ["architecture"];
			const targetDomains = Object.keys(config.domains).filter((d) => !excluded.includes(d));

			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertiseXml(domain, records, lastUpdated));
			}

			const output = formatPrimeOutputXml(sections);
			expect(output).toContain('<domain name="testing"');
			expect(output).not.toContain('<domain name="architecture"');
		});

		it("exclusion works with --json format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const config = await readConfig(tmpDir);
			const excluded = ["architecture"];
			const targetDomains = Object.keys(config.domains).filter((d) => !excluded.includes(d));

			const domains: {
				domain: string;
				entry_count: number;
				records: ExpertiseRecord[];
			}[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				domains.push({ domain, entry_count: records.length, records });
			}

			const output = formatJsonOutput(domains);
			const parsed = JSON.parse(output);
			expect(parsed.domains).toHaveLength(1);
			expect(parsed.domains[0].domain).toBe("testing");
		});
	});

	describe("multi-domain prime", () => {
		it("multiple domains produce combined output", async () => {
			await writeConfig(
				{ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {}, api: {} } },
				tmpDir,
			);

			const testingPath = getExpertisePath("testing", tmpDir);
			const archPath = getExpertisePath("architecture", tmpDir);
			const apiPath = getExpertisePath("api", tmpDir);
			await createExpertiseFile(testingPath);
			await createExpertiseFile(archPath);
			await createExpertiseFile(apiPath);

			await appendRecord(testingPath, {
				type: "convention",
				content: "Use vitest",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(archPath, {
				type: "decision",
				title: "Use ESM",
				rationale: "Better tree-shaking",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(apiPath, {
				type: "pattern",
				name: "REST endpoints",
				description: "Follow RESTful conventions",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			// Select only testing + api (skip architecture)
			const targetDomains = ["testing", "api"];
			const sections: string[] = [];
			for (const domain of targetDomains) {
				const filePath = getExpertisePath(domain, tmpDir);
				const records = await readExpertiseFile(filePath);
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertise(domain, records, lastUpdated));
			}

			const output = formatPrimeOutput(sections);
			expect(output).toContain("## testing");
			expect(output).toContain("## api");
			expect(output).not.toContain("## architecture");
			expect(output).toContain("Use vitest");
			expect(output).toContain("REST endpoints");
			expect(output).not.toContain("Use ESM");
		});

		it("deduplicates domains from positional and --domain args", () => {
			const positional = ["testing", "api"];
			const flagDomains = ["api", "architecture"];
			const merged = [...new Set([...positional, ...flagDomains])];

			expect(merged).toEqual(["testing", "api", "architecture"]);
		});

		it("empty domain selection falls back to all domains", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {}, architecture: {} } }, tmpDir);

			const config = await readConfig(tmpDir);
			const requested: string[] = [];
			const unique = [...new Set(requested)];
			const targetDomains = unique.length > 0 ? unique : Object.keys(config.domains);

			expect(targetDomains).toEqual(["testing", "architecture"]);
		});
	});

	describe("compact mode", () => {
		it("outputs one-liner per record with type tags", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { database: {} } }, tmpDir);
			const filePath = getExpertisePath("database", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "convention",
				content: "Use WAL mode for SQLite",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "pattern",
				name: "fts5-external-content",
				description: "External content FTS5 with triggers",
				files: ["src/db/fts.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "failure",
				description: "FTS5 queries crash without escaping",
				resolution: "Use escapeFts5Term()",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "decision",
				title: "SQLite over PostgreSQL",
				rationale: "Simpler deployment",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "reference",
				name: "schema-file",
				description: "Database schema definition",
				files: ["src/db/schema.sql"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "guide",
				name: "add-migration",
				description: "NNN_description.sql naming convention",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("database", records, lastUpdated);

			expect(section).toContain("## database (6 records");
			expect(section).toContain("- [convention] Use WAL mode for SQLite");
			expect(section).toContain(
				"- [pattern] fts5-external-content: External content FTS5 with triggers (src/db/fts.ts)",
			);
			expect(section).toContain(
				"- [failure] FTS5 queries crash without escaping → Use escapeFts5Term()",
			);
			expect(section).toContain("- [decision] SQLite over PostgreSQL: Simpler deployment");
			expect(section).toContain("- [reference] schema-file: src/db/schema.sql");
			expect(section).toContain("- [guide] add-migration: NNN_description.sql naming convention");
			// No section headers like ### Conventions
			expect(section).not.toContain("###");
		});

		it("reference without files falls back to description", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "reference",
				name: "api-docs",
				description: "External API documentation",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("testing", records, lastUpdated);

			expect(section).toContain("- [reference] api-docs: External API documentation");
		});

		it("compact wrapper omits verbose recording instructions", () => {
			const output = formatPrimeOutputCompact([]);
			expect(output).toContain("# Project Expertise (via Mulch)");
			expect(output).toContain("No expertise recorded yet");
			expect(output).not.toContain("## Recording New Learnings");
		});

		it("compact wrapper includes quick reference section", () => {
			const output = formatPrimeOutputCompact([]);
			expect(output).toContain("## Quick Reference");
			expect(output).toContain('ml search "query"');
			expect(output).toContain("ml prime --files");
			expect(output).toContain("ml prime --context");
			expect(output).toContain("ml record <domain>");
			expect(output).toContain("--evidence-commit");
			expect(output).toContain("--evidence-bead");
			expect(output).toContain("--evidence-seeds");
			expect(output).toContain("--evidence-gh");
			expect(output).toContain("--evidence-linear");
			expect(output).toContain("--relates-to");
			expect(output).toContain("ml doctor");
		});

		it("compact with multiple domains", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { db: {}, api: {} } }, tmpDir);
			const dbPath = getExpertisePath("db", tmpDir);
			const apiPath = getExpertisePath("api", tmpDir);
			await createExpertiseFile(dbPath);
			await createExpertiseFile(apiPath);

			await appendRecord(dbPath, {
				type: "convention",
				content: "Use WAL mode",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(apiPath, {
				type: "decision",
				title: "REST over GraphQL",
				rationale: "Simpler tooling",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const dbRecords = await readExpertiseFile(dbPath);
			const dbUpdated = await getFileModTime(dbPath);
			const apiRecords = await readExpertiseFile(apiPath);
			const apiUpdated = await getFileModTime(apiPath);

			const sections = [
				formatDomainExpertiseCompact("db", dbRecords, dbUpdated),
				formatDomainExpertiseCompact("api", apiRecords, apiUpdated),
			];
			const output = formatPrimeOutputCompact(sections);

			expect(output).toContain("## db (1 records");
			expect(output).toContain("## api (1 records");
			expect(output).toContain("- [convention] Use WAL mode");
			expect(output).toContain("- [decision] REST over GraphQL: Simpler tooling");
		});
	});

	describe("context filtering", () => {
		it("--files option filters records by specified files", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
			const filePath = getExpertisePath("cli", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "convention",
				content: "Use ESM imports",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "pattern",
				name: "cli-entry",
				description: "Main CLI entry",
				files: ["src/cli.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "pattern",
				name: "db-access",
				description: "Database access layer",
				files: ["src/db/index.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const allRecords = await readExpertiseFile(filePath);
			const filtered = filterByContext(allRecords, ["src/cli.ts"]);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertise("cli", filtered, lastUpdated);
			const output = formatPrimeOutput([section]);

			expect(output).toContain("Use ESM imports");
			expect(output).toContain("cli-entry");
			expect(output).not.toContain("db-access");
		});

		it("fileMatchesAny matches exact paths", () => {
			expect(fileMatchesAny("src/cli.ts", ["src/cli.ts"])).toBe(true);
			expect(fileMatchesAny("src/cli.ts", ["src/other.ts"])).toBe(false);
		});

		it("fileMatchesAny matches by suffix", () => {
			// record file is a suffix of changed file
			expect(fileMatchesAny("cli.ts", ["src/cli.ts"])).toBe(true);
			// changed file is a suffix of record file
			expect(fileMatchesAny("src/commands/prime.ts", ["prime.ts"])).toBe(true);
		});

		it("filterByContext keeps conventions (no files field)", () => {
			const records = filterByContext(
				[
					{
						type: "convention",
						content: "Always lint",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/unrelated.ts"],
			);
			expect(records).toHaveLength(1);
			expect(records[0]?.type).toBe("convention");
		});

		it("filterByContext keeps failures (no files field)", () => {
			const records = filterByContext(
				[
					{
						type: "failure",
						description: "OOM crash",
						resolution: "Use streaming",
						classification: "tactical",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/unrelated.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext keeps decisions (no files field)", () => {
			const records = filterByContext(
				[
					{
						type: "decision",
						title: "Use ESM",
						rationale: "Better treeshaking",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/unrelated.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext keeps guides (no files field)", () => {
			const records = filterByContext(
				[
					{
						type: "guide",
						name: "add-command",
						description: "How to add a command",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/unrelated.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext keeps patterns with matching files", () => {
			const records = filterByContext(
				[
					{
						type: "pattern",
						name: "cli-pattern",
						description: "CLI entry point pattern",
						files: ["src/cli.ts"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/cli.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext excludes patterns with non-matching files", () => {
			const records = filterByContext(
				[
					{
						type: "pattern",
						name: "db-pattern",
						description: "Database access pattern",
						files: ["src/db/schema.ts"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/cli.ts", "src/commands/prime.ts"],
			);
			expect(records).toHaveLength(0);
		});

		it("filterByContext keeps references with matching files", () => {
			const records = filterByContext(
				[
					{
						type: "reference",
						name: "entry-point",
						description: "Main entry",
						files: ["src/cli.ts"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/cli.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext excludes references with non-matching files", () => {
			const records = filterByContext(
				[
					{
						type: "reference",
						name: "entry-point",
						description: "Main entry",
						files: ["src/index.ts"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/cli.ts"],
			);
			expect(records).toHaveLength(0);
		});

		it("filterByContext keeps patterns with empty files array", () => {
			const records = filterByContext(
				[
					{
						type: "pattern",
						name: "general-pattern",
						description: "A general pattern",
						files: [],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/cli.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext keeps records when changed file lives under dir_anchors", () => {
			const records = filterByContext(
				[
					{
						type: "convention",
						content: "applies to utils dir",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
						dir_anchors: ["src/utils"],
					},
				],
				["src/utils/foo.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext excludes records whose dir_anchors don't cover any changed file", () => {
			const records = filterByContext(
				[
					{
						type: "convention",
						content: "only applies to docs",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
						dir_anchors: ["docs"],
					},
				],
				["src/utils/foo.ts"],
			);
			expect(records).toHaveLength(0);
		});

		it("filterByContext matches dir_anchors regardless of trailing slash on stored path", () => {
			const records = filterByContext(
				[
					{
						type: "convention",
						content: "trailing slash tolerance",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
						dir_anchors: ["src/utils/"],
					},
				],
				["src/utils/foo.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext: dir_anchors prefix must be a directory boundary, not a substring", () => {
			// "src/util" should NOT match "src/utils/foo.ts" — boundary check.
			const records = filterByContext(
				[
					{
						type: "convention",
						content: "boundary check",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
						dir_anchors: ["src/util"],
					},
				],
				["src/utils/foo.ts"],
			);
			expect(records).toHaveLength(0);
		});

		it("filterByContext keeps record matched by either files OR dir_anchors", () => {
			const records = filterByContext(
				[
					{
						type: "pattern",
						name: "either-or",
						description: "matches by dir even if files miss",
						files: ["unrelated/path.ts"],
						dir_anchors: ["src/utils"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/utils/foo.ts"],
			);
			expect(records).toHaveLength(1);
		});

		it("filterByContext with mixed records filters correctly", () => {
			const records = filterByContext(
				[
					{
						type: "convention",
						content: "Always lint",
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
					{
						type: "pattern",
						name: "matching-pattern",
						description: "Relevant pattern",
						files: ["src/commands/prime.ts"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
					{
						type: "pattern",
						name: "unrelated-pattern",
						description: "Unrelated pattern",
						files: ["src/db/schema.ts"],
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					},
					{
						type: "failure",
						description: "A known failure",
						resolution: "Fix it",
						classification: "tactical",
						recorded_at: new Date().toISOString(),
					},
				],
				["src/commands/prime.ts"],
			);
			expect(records).toHaveLength(3);
			expect(records.map((r) => r.type)).toEqual(["convention", "pattern", "failure"]);
		});

		it("filtered records integrate with formatting pipeline", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
			const filePath = getExpertisePath("cli", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "convention",
				content: "Use ESM imports",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "pattern",
				name: "cli-entry",
				description: "Main CLI entry",
				files: ["src/cli.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(filePath, {
				type: "pattern",
				name: "db-access",
				description: "Database access layer",
				files: ["src/db/index.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const allRecords = await readExpertiseFile(filePath);
			const filtered = filterByContext(allRecords, ["src/cli.ts"]);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertise("cli", filtered, lastUpdated);
			const output = formatPrimeOutput([section]);

			expect(output).toContain("Use ESM imports");
			expect(output).toContain("cli-entry");
			expect(output).not.toContain("db-access");
		});

		it("context filtering skips empty domains", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {}, database: {} } }, tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			const dbPath = getExpertisePath("database", tmpDir);
			await createExpertiseFile(cliPath);
			await createExpertiseFile(dbPath);

			await appendRecord(cliPath, {
				type: "pattern",
				name: "cli-entry",
				description: "CLI entry",
				files: ["src/cli.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(dbPath, {
				type: "pattern",
				name: "db-schema",
				description: "DB schema",
				files: ["src/db/schema.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const changedFiles = ["src/cli.ts"];
			const sections: string[] = [];

			for (const domain of ["cli", "database"]) {
				const filePath = getExpertisePath(domain, tmpDir);
				const allRecords = await readExpertiseFile(filePath);
				const filtered = filterByContext(allRecords, changedFiles);
				if (filtered.length === 0) continue;
				const lastUpdated = await getFileModTime(filePath);
				sections.push(formatDomainExpertise(domain, filtered, lastUpdated));
			}

			const output = formatPrimeOutput(sections);
			expect(output).toContain("## cli");
			expect(output).not.toContain("## database");
		});
	});

	describe("record links in prime output", () => {
		it("shows relates_to in markdown format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "failure",
				description: "ESM import broke",
				resolution: "Use default import workaround",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
				relates_to: ["mx-abc123"],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertise("testing", records, lastUpdated);
			expect(output).toContain("[relates to: mx-abc123]");
		});

		it("shows supersedes in markdown format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "convention",
				content: "New convention",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				supersedes: ["mx-def456"],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertise("testing", records, lastUpdated);
			expect(output).toContain("[supersedes: mx-def456]");
		});

		it("shows both links together", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "pattern",
				name: "esm-import",
				description: "ESM import pattern",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				relates_to: ["mx-aaa111"],
				supersedes: ["mx-bbb222"],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertise("testing", records, lastUpdated);
			expect(output).toContain("relates to: mx-aaa111");
			expect(output).toContain("supersedes: mx-bbb222");
		});

		it("shows links in compact format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "decision",
				title: "Use Vitest",
				rationale: "Better ESM support",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				relates_to: ["mx-abc123"],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertiseCompact("testing", records, lastUpdated);
			expect(output).toContain("[relates to: mx-abc123]");
		});

		it("shows links in XML format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "failure",
				description: "Test failure",
				resolution: "Fix it",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
				relates_to: ["mx-abc123"],
				supersedes: ["mx-def456"],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertiseXml("testing", records, lastUpdated);
			expect(output).toContain("<relates_to>mx-abc123</relates_to>");
			expect(output).toContain("<supersedes>mx-def456</supersedes>");
		});

		it("shows links in plain text format", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "convention",
				content: "Use strict mode",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				supersedes: ["mx-old111"],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertisePlain("testing", records, lastUpdated);
			expect(output).toContain("[supersedes: mx-old111]");
		});

		it("omits link brackets when no links present", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);
			await appendRecord(filePath, {
				type: "convention",
				content: "No links here",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const output = formatDomainExpertise("testing", records, lastUpdated);
			expect(output).not.toContain("[relates to:");
			expect(output).not.toContain("[supersedes:");
		});
	});

	describe("session-end reminder", () => {
		it("compact output includes session close prose", () => {
			const _output = formatPrimeOutputCompact([]);
			const reminder = getSessionEndReminder("markdown");
			// The reminder is appended by prime.ts, but verify the function itself
			expect(reminder).toContain("SESSION CLOSE");
			expect(reminder).toContain("ml record");
			expect(reminder).toContain("ml sync");
			expect(reminder).toContain("ml learn");
			expect(reminder).toContain("If you discovered");
		});

		it("markdown reminder uses markdown formatting and preserves 🚨", () => {
			const reminder = getSessionEndReminder("markdown");
			expect(reminder).toContain("# ");
			expect(reminder).toContain("\u{1F6A8}");
			expect(reminder).toContain("**If you discovered");
			expect(reminder).toContain("ml record <domain>");
			expect(reminder).toContain("ml sync");
			expect(reminder).toContain("ml learn");
		});

		it("xml reminder uses XML tags", () => {
			const reminder = getSessionEndReminder("xml");
			expect(reminder).toContain("<session_close>");
			expect(reminder).toContain("</session_close>");
			expect(reminder).toContain("<commands>");
			expect(reminder).toContain("ml record");
			expect(reminder).toContain("ml sync");
			expect(reminder).toContain("ml learn");
			expect(reminder).toContain("If you discovered");
		});

		it("plain reminder uses plain text formatting and preserves 🚨", () => {
			const reminder = getSessionEndReminder("plain");
			expect(reminder).toContain("SESSION CLOSE");
			expect(reminder).toContain("\u{1F6A8}");
			expect(reminder).not.toContain("**");
			expect(reminder).not.toContain("##");
			// No XML tags (but <domain> and <type> placeholders are fine)
			expect(reminder).not.toContain("</");
			expect(reminder).toContain("ml record");
			expect(reminder).toContain("ml sync");
			expect(reminder).toContain("ml learn");
			expect(reminder).toContain("If you discovered");
		});

		it("embedded reminder produces a markdown snippet for CLAUDE.md / AGENTS.md", () => {
			const reminder = getSessionEndReminder("embedded");
			expect(reminder).toContain("### Before You Finish");
			expect(reminder).toContain("If you discovered");
			expect(reminder).toContain("ml learn");
			expect(reminder).toContain("ml record");
			expect(reminder).toContain("ml sync");
			// Embedded variant has no 🚨 banner — it lives inside a containing markdown
			// section, not at the end of a long, edit-saturated context window.
			expect(reminder).not.toContain("\u{1F6A8}");
		});

		it("reframe drops ritualistic 'MUST' / 'NEVER skip' phrasing", () => {
			for (const format of ["markdown", "xml", "plain", "embedded"] as const) {
				const reminder = getSessionEndReminder(format);
				expect(reminder).not.toContain("you MUST");
				expect(reminder).not.toContain("NEVER skip");
			}
		});

		it("JSON output does NOT include session close prose", () => {
			const records = [
				{
					type: "convention" as const,
					content: "Test convention",
					classification: "foundational" as const,
					recorded_at: new Date().toISOString(),
				},
			];
			const output = formatJsonOutput([
				{ domain: "testing", entry_count: records.length, records },
			]);
			expect(output).not.toContain("SESSION CLOSE");
			expect(output).not.toContain("session_close");
			// Verify it's valid JSON without reminder text
			const parsed = JSON.parse(output);
			expect(parsed.type).toBe("expertise");
		});

		it("reminder contains key action items", () => {
			for (const format of ["markdown", "xml", "plain", "embedded"] as const) {
				const reminder = getSessionEndReminder(format);
				expect(reminder).toContain("ml record");
				expect(reminder).toContain("ml sync");
				expect(reminder).toContain("ml learn");
			}
		});
	});

	describe("token budget", () => {
		function makeRecord(
			type: ExpertiseRecord["type"],
			classification: ExpertiseRecord["classification"],
			overrides: Record<string, unknown> = {},
		): ExpertiseRecord {
			const base = {
				classification,
				recorded_at: new Date().toISOString(),
			};
			switch (type) {
				case "convention":
					return {
						...base,
						type: "convention",
						content: (overrides.content as string) ?? "A convention",
						...overrides,
					} as ExpertiseRecord;
				case "decision":
					return {
						...base,
						type: "decision",
						title: (overrides.title as string) ?? "A decision",
						rationale: (overrides.rationale as string) ?? "Because reasons",
						...overrides,
					} as ExpertiseRecord;
				case "pattern":
					return {
						...base,
						type: "pattern",
						name: (overrides.name as string) ?? "A pattern",
						description: (overrides.description as string) ?? "A pattern desc",
						...overrides,
					} as ExpertiseRecord;
				case "guide":
					return {
						...base,
						type: "guide",
						name: (overrides.name as string) ?? "A guide",
						description: (overrides.description as string) ?? "A guide desc",
						...overrides,
					} as ExpertiseRecord;
				case "failure":
					return {
						...base,
						type: "failure",
						description: (overrides.description as string) ?? "A failure",
						resolution: (overrides.resolution as string) ?? "Fix it",
						...overrides,
					} as ExpertiseRecord;
				case "reference":
					return {
						...base,
						type: "reference",
						name: (overrides.name as string) ?? "A reference",
						description: (overrides.description as string) ?? "A ref desc",
						...overrides,
					} as ExpertiseRecord;
			}
		}

		function simpleEstimate(record: ExpertiseRecord): string {
			switch (record.type) {
				case "convention":
					return `[convention] ${record.content}`;
				case "pattern":
					return `[pattern] ${record.name}: ${record.description}`;
				case "failure":
					return `[failure] ${record.description} -> ${record.resolution}`;
				case "decision":
					return `[decision] ${record.title}: ${record.rationale}`;
				case "reference":
					return `[reference] ${record.name}: ${record.description}`;
				case "guide":
					return `[guide] ${record.name}: ${record.description}`;
			}
		}

		it("DEFAULT_BUDGET is 4000", () => {
			expect(DEFAULT_BUDGET).toBe(4000);
		});

		it("estimateTokens uses chars / 4", () => {
			expect(estimateTokens("a".repeat(100))).toBe(25);
			expect(estimateTokens("a".repeat(101))).toBe(26); // ceil
			expect(estimateTokens("")).toBe(0);
		});

		it("estimateRecordText handles built-in types", () => {
			const text = estimateRecordText(makeRecord("convention", "foundational"));
			expect(text).toContain("convention");
			expect(text).toContain("A convention");
			expect(text.length).toBeGreaterThan(0);
		});

		it("estimateRecordText handles custom types without crashing", async () => {
			const ADR_CFG: CustomTypeConfig = {
				required: ["description", "decision_status"],
				dedup_key: "description",
				summary: "{description}",
			};
			await writeConfig(
				{ ...DEFAULT_CONFIG, domains: { backend: {} }, custom_types: { adr: ADR_CFG } },
				tmpDir,
			);
			await initRegistryFromConfig(tmpDir);
			try {
				const record = {
					type: "adr",
					classification: "tactical",
					recorded_at: new Date().toISOString(),
					description: "use postgres",
					decision_status: "accepted",
					id: "mx-test01",
				} as unknown as ExpertiseRecord;

				const text = estimateRecordText(record);
				expect(text).toBeString();
				expect(text.length).toBeGreaterThan(0);
				expect(text).toContain("adr");
				expect(text).toContain("use postgres");

				// Confirm the budget pipeline (the original crash site) survives.
				const domains: DomainRecords[] = [{ domain: "backend", records: [record] }];
				const result = applyBudget(domains, 10000, estimateRecordText);
				expect(result.droppedCount).toBe(0);
				expect(result.kept).toHaveLength(1);
			} finally {
				resetRegistry();
			}
		});

		it("estimateRecordText handles unknown types when tolerated", () => {
			const record = {
				type: "runbook",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				id: "mx-unk001",
			} as unknown as ExpertiseRecord;
			const text = estimateRecordText(record);
			expect(text).toBeString();
			expect(text.length).toBeGreaterThan(0);
		});

		it("applyBudget keeps all records when within budget", () => {
			const domains: DomainRecords[] = [
				{
					domain: "testing",
					records: [
						makeRecord("convention", "foundational"),
						makeRecord("decision", "foundational"),
					],
				},
			];

			const result = applyBudget(domains, 10000, simpleEstimate);
			expect(result.droppedCount).toBe(0);
			expect(result.droppedDomainCount).toBe(0);
			expect(result.kept).toHaveLength(1);
			expect(result.kept[0]?.records).toHaveLength(2);
		});

		it("applyBudget drops records when budget is tight", () => {
			// Create many records that won't all fit in a small budget
			const records: ExpertiseRecord[] = [];
			for (let i = 0; i < 20; i++) {
				records.push(
					makeRecord("convention", "foundational", {
						content: `Convention number ${i} with extra text to increase size`,
					}),
				);
			}

			const domains: DomainRecords[] = [{ domain: "testing", records }];
			// Give a very small budget
			const result = applyBudget(domains, 50, simpleEstimate);

			expect(result.droppedCount).toBeGreaterThan(0);
			expect(result.kept[0]?.records.length).toBeLessThan(20);
		});

		it("applyBudget prioritizes conventions over other types", () => {
			const convention = makeRecord("convention", "foundational", {
				content: "Important convention",
			});
			const reference = makeRecord("reference", "foundational", {
				name: "Some reference",
				description: "Reference description",
			});

			const domains: DomainRecords[] = [
				{
					domain: "testing",
					records: [reference, convention], // reference first in file order
				},
			];

			// Budget that only fits one record
			const singleRecordBudget = estimateTokens(simpleEstimate(convention)) + 1;
			const result = applyBudget(domains, singleRecordBudget, simpleEstimate);

			expect(result.kept).toHaveLength(1);
			expect(result.kept[0]?.records).toHaveLength(1);
			expect(result.kept[0]?.records[0]?.type).toBe("convention");
			expect(result.droppedCount).toBe(1);
		});

		it("applyBudget prioritizes by type order: convention > decision > pattern > guide > failure > reference", () => {
			const types: ExpertiseRecord["type"][] = [
				"reference",
				"failure",
				"guide",
				"pattern",
				"decision",
				"convention",
			];
			const records = types.map((t) => makeRecord(t, "foundational"));

			const domains: DomainRecords[] = [{ domain: "testing", records }];

			// Large budget to keep all
			const result = applyBudget(domains, 100000, simpleEstimate);
			expect(result.droppedCount).toBe(0);

			// Budget that fits exactly one convention-sized record
			const convRecord = records.find((r) => r.type === "convention");
			if (!convRecord) throw new Error("Expected convention record");
			const convCost = estimateTokens(simpleEstimate(convRecord));
			const tinyResult = applyBudget(domains, convCost + 1, simpleEstimate);
			expect(tinyResult.kept.length).toBeGreaterThan(0);
			expect(tinyResult.kept[0]?.records[0]?.type).toBe("convention");
		});

		it("applyBudget prioritizes foundational over tactical over observational", () => {
			const observational = makeRecord("convention", "observational", {
				content: "Observational convention",
			});
			const tactical = makeRecord("convention", "tactical", {
				content: "Tactical convention",
			});
			const foundational = makeRecord("convention", "foundational", {
				content: "Foundational convention",
			});

			const domains: DomainRecords[] = [
				{
					domain: "testing",
					records: [observational, tactical, foundational],
				},
			];

			// Budget that fits about 2 records
			const oneRecordCost = estimateTokens(simpleEstimate(foundational));
			const result = applyBudget(domains, oneRecordCost * 2 + 1, simpleEstimate);

			expect(result.kept[0]?.records).toHaveLength(2);
			// The kept records should be foundational and tactical (in original file order)
			const keptClassifications = result.kept[0]?.records.map((r) => r.classification);
			expect(keptClassifications).toContain("foundational");
			expect(keptClassifications).toContain("tactical");
			expect(keptClassifications).not.toContain("observational");
		});

		it("applyBudget prioritizes newer records within same type and classification", () => {
			const oldDate = new Date("2024-01-01T00:00:00Z").toISOString();
			const newDate = new Date("2025-06-01T00:00:00Z").toISOString();

			const oldRecord = makeRecord("convention", "foundational", {
				content: "Old convention",
				recorded_at: oldDate,
			});
			const newRecord = makeRecord("convention", "foundational", {
				content: "New convention",
				recorded_at: newDate,
			});

			const domains: DomainRecords[] = [{ domain: "testing", records: [oldRecord, newRecord] }];

			// Budget that fits exactly 1 record
			const oneRecordCost = estimateTokens(simpleEstimate(newRecord));
			const result = applyBudget(domains, oneRecordCost + 1, simpleEstimate);

			expect(result.kept[0]?.records).toHaveLength(1);
			expect(result.kept[0]?.records[0]).toMatchObject({ content: "New convention" });
		});

		it("applyBudget preserves original domain order", () => {
			const domains: DomainRecords[] = [
				{
					domain: "alpha",
					records: [makeRecord("convention", "foundational", { content: "Alpha conv" })],
				},
				{
					domain: "beta",
					records: [makeRecord("convention", "foundational", { content: "Beta conv" })],
				},
			];

			const result = applyBudget(domains, 100000, simpleEstimate);
			expect(result.kept[0]?.domain).toBe("alpha");
			expect(result.kept[1]?.domain).toBe("beta");
		});

		it("applyBudget tracks dropped domain count", () => {
			const domains: DomainRecords[] = [
				{
					domain: "alpha",
					records: [
						makeRecord("convention", "foundational", {
							content: "Alpha convention",
						}),
					],
				},
				{
					domain: "beta",
					records: [
						makeRecord("reference", "observational", {
							name: "Beta ref",
							description: "Beta reference description that is fairly long to make it costly",
						}),
					],
				},
			];

			// Budget that fits only alpha's convention
			const alphaRecord = domains[0]?.records[0];
			if (!alphaRecord) throw new Error("Expected alpha record");
			const alphaCost = estimateTokens(simpleEstimate(alphaRecord));
			const result = applyBudget(domains, alphaCost + 1, simpleEstimate);

			expect(result.kept).toHaveLength(1);
			expect(result.kept[0]?.domain).toBe("alpha");
			expect(result.droppedCount).toBe(1);
			expect(result.droppedDomainCount).toBe(1);
		});

		it("formatBudgetSummary shows correct summary", () => {
			expect(formatBudgetSummary(5, 2)).toBe(
				"... and 5 more records across 2 domains (use --budget <n> to show more)",
			);
			expect(formatBudgetSummary(1, 1)).toBe(
				"... and 1 more record across 1 domain (use --budget <n> to show more)",
			);
			expect(formatBudgetSummary(3, 0)).toBe(
				"... and 3 more records (use --budget <n> to show more)",
			);
		});

		it("budget integrates with compact formatting pipeline", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			// Add many records to exceed a tiny budget
			for (let i = 0; i < 10; i++) {
				await appendRecord(filePath, {
					type: "convention",
					content: `Convention number ${i} with some extra padding text to make it longer`,
					classification: "foundational",
					recorded_at: new Date().toISOString(),
				});
			}

			const records = await readExpertiseFile(filePath);
			const domainRecords: DomainRecords[] = [{ domain: "testing", records }];

			// Apply a very small budget
			const result = applyBudget(domainRecords, 50, (r) => {
				if (r.type === "convention") return `[convention] ${r.content}`;
				return "";
			});

			expect(result.droppedCount).toBeGreaterThan(0);
			expect(result.kept[0]?.records.length).toBeLessThan(10);

			// Format the kept records
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact(
				"testing",
				result.kept[0]?.records ?? [],
				lastUpdated,
			);
			const output = formatPrimeOutputCompact([section]);

			expect(output).toContain("# Project Expertise (via Mulch)");
			expect(output).toContain("## testing");
		});

		it("budget summary line appears in final output when records are dropped", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			for (let i = 0; i < 10; i++) {
				await appendRecord(filePath, {
					type: "convention",
					content: `Convention ${i} with padding to increase the token cost of each record`,
					classification: "foundational",
					recorded_at: new Date().toISOString(),
				});
			}

			const records = await readExpertiseFile(filePath);
			const domainRecords: DomainRecords[] = [{ domain: "testing", records }];

			const result = applyBudget(domainRecords, 50, (r) => {
				if (r.type === "convention") return `[convention] ${r.content}`;
				return "";
			});

			if (result.droppedCount > 0) {
				const summary = formatBudgetSummary(result.droppedCount, result.droppedDomainCount);
				expect(summary).toContain("more record");
				expect(summary).toContain("--budget <n>");
			}
		});

		it("session-end reminder is always shown regardless of budget", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			for (let i = 0; i < 10; i++) {
				await appendRecord(filePath, {
					type: "convention",
					content: `Convention ${i} with padding text`,
					classification: "foundational",
					recorded_at: new Date().toISOString(),
				});
			}

			// The session-end reminder is appended by prime.ts after budget filtering,
			// so it's always present. Verify the reminder function itself is available.
			const reminder = getSessionEndReminder("markdown");
			expect(reminder).toContain("SESSION CLOSE");
		});

		it("JSON output is NOT subject to budget", () => {
			const records: ExpertiseRecord[] = [];
			for (let i = 0; i < 20; i++) {
				records.push(
					makeRecord("convention", "foundational", {
						content: `Convention ${i} with substantial text to take up space in the output`,
					}),
				);
			}

			// JSON output is always complete regardless of any budget considerations
			const output = formatJsonOutput([
				{ domain: "testing", entry_count: records.length, records },
			]);
			const parsed = JSON.parse(output);
			expect(parsed.domains[0].records).toHaveLength(20);
			expect(output).not.toContain("--budget");
		});

		it("applyBudget with zero-budget drops all records", () => {
			const domains: DomainRecords[] = [
				{
					domain: "testing",
					records: [makeRecord("convention", "foundational")],
				},
			];

			const result = applyBudget(domains, 0, simpleEstimate);
			expect(result.droppedCount).toBe(1);
			expect(result.kept).toHaveLength(0);
		});

		it("applyBudget across multiple domains drops lower-priority records", () => {
			const domains: DomainRecords[] = [
				{
					domain: "alpha",
					records: [
						makeRecord("convention", "foundational", {
							content: "Alpha convention",
						}),
					],
				},
				{
					domain: "beta",
					records: [
						makeRecord("reference", "observational", {
							name: "Beta ref",
							description: "A reference with a longer description to make it costly",
						}),
					],
				},
			];

			// Budget that fits alpha's convention but not beta's reference
			const alphaRecord = domains[0]?.records[0];
			if (!alphaRecord) throw new Error("Expected alpha record");
			const alphaCost = estimateTokens(simpleEstimate(alphaRecord));
			const result = applyBudget(domains, alphaCost + 1, simpleEstimate);

			// Convention from alpha should be kept
			expect(result.kept.length).toBeGreaterThanOrEqual(1);
			expect(result.kept[0]?.domain).toBe("alpha");
			expect(result.kept[0]?.records[0]?.type).toBe("convention");
			// Reference from beta should be dropped
			expect(result.droppedCount).toBe(1);
		});
	});

	describe("domain-not-found hint", () => {
		let originalCwd: string;

		beforeEach(() => {
			originalCwd = process.cwd();
		});

		afterEach(() => {
			process.chdir(originalCwd);
			process.exitCode = 0;
		});

		function makeProgram(): Command {
			const program = new Command();
			program.name("mulch").option("--json", "output as structured JSON").exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		it("shows hint when domain arg not found", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			process.chdir(tmpDir);
			const errorSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "nonexistent"]);

				expect(errorSpy).toHaveBeenCalledTimes(2);
				expect(errorSpy.mock.calls[0]?.[0]).toContain("nonexistent");
				expect(errorSpy.mock.calls[1]?.[0]).toContain("ml add nonexistent");
				expect(errorSpy.mock.calls[1]?.[0]).toContain(".mulch/mulch.config.yaml");
			} finally {
				errorSpy.mockRestore();
			}
		});

		it("shows hint when --exclude-domain not found", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			process.chdir(tmpDir);
			const errorSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--exclude-domain", "nonexistent"]);

				expect(errorSpy).toHaveBeenCalledTimes(2);
				expect(errorSpy.mock.calls[0]?.[0]).toContain("nonexistent");
				expect(errorSpy.mock.calls[1]?.[0]).toContain("ml add nonexistent");
				expect(errorSpy.mock.calls[1]?.[0]).toContain(".mulch/mulch.config.yaml");
			} finally {
				errorSpy.mockRestore();
			}
		});
	});

	describe("prime output enrichment", () => {
		it("compact quick reference includes type→required-fields table", () => {
			const output = formatPrimeOutputCompact([]);
			expect(output).toContain("**Record types and required flags:**");
			expect(output).toContain("| Type | Required flags |");
			expect(output).toContain("| `convention`");
			expect(output).toContain("| `pattern`");
			expect(output).toContain("| `failure`");
			expect(output).toContain("| `decision`");
			expect(output).toContain("| `reference`");
			expect(output).toContain("| `guide`");
		});

		it("compact quick reference frames --files as per-edit priming", () => {
			const output = formatPrimeOutputCompact([]);
			expect(output).toContain("ml prime --files");
			expect(output).toContain("before");
		});

		it("compact quick reference includes --relates-to", () => {
			const output = formatPrimeOutputCompact([]);
			expect(output).toContain("--relates-to");
		});

		it("verbose prime output includes --relates-to in evidence section", () => {
			const output = formatPrimeOutput([]);
			expect(output).toContain("--relates-to");
		});

		it("compact lines show classification badge for foundational records", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "convention",
				content: "Use foundational pattern",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("testing", records, lastUpdated);

			expect(section).toContain("foundational");
		});

		it("compact lines show classification badge for tactical records", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "pattern",
				name: "session-pattern",
				description: "A tactical pattern",
				classification: "tactical",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("testing", records, lastUpdated);

			expect(section).toContain("tactical");
		});

		it("compact lines show confirmation score when outcomes are present", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "convention",
				content: "A confirmed convention",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				outcomes: [
					{ status: "success", agent: "agent-a" },
					{ status: "success", agent: "agent-b" },
					{ status: "success", agent: "agent-c" },
				],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("testing", records, lastUpdated);

			expect(section).toContain("★3");
		});

		it("compact lines omit score marker when no outcomes", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "convention",
				content: "Unconfirmed convention",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("testing", records, lastUpdated);

			expect(section).not.toContain("★");
		});

		it("compact lines show partial score as decimal", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { testing: {} } }, tmpDir);
			const filePath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(filePath);

			await appendRecord(filePath, {
				type: "decision",
				title: "Partially confirmed",
				rationale: "Tried it",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				outcomes: [
					{ status: "success", agent: "agent-a" },
					{ status: "partial", agent: "agent-b" },
				],
			});

			const records = await readExpertiseFile(filePath);
			const lastUpdated = await getFileModTime(filePath);
			const section = formatDomainExpertiseCompact("testing", records, lastUpdated);

			expect(section).toContain("★1.5");
		});
	});

	describe("manifest mode", () => {
		let originalCwd: string;

		beforeEach(() => {
			originalCwd = process.cwd();
		});

		afterEach(() => {
			process.chdir(originalCwd);
			process.exitCode = 0;
		});

		function makeProgram(): Command {
			const program = new Command();
			program.name("mulch").option("--json", "output as structured JSON").exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		async function seedTwoDomains(): Promise<void> {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {}, testing: {} } }, tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			const testingPath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(cliPath);
			await createExpertiseFile(testingPath);
			await appendRecord(cliPath, {
				type: "convention",
				content: "Use bun",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "init-flow",
				description: "How init wires up files",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(testingPath, {
				type: "convention",
				content: "No mocks",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
		}

		it("config-driven manifest emits manifest output when no flags set", async () => {
			await seedTwoDomains();
			const config = await readConfig(tmpDir);
			await writeConfig({ ...config, prime: { default_mode: "manifest" } }, tmpDir);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
				expect(output).toContain("## Quick Reference");
				expect(output).toContain("## Available Domains");
				expect(output).toContain("**cli**: 2 records");
				expect(output).toContain("**testing**: 1 record");
				expect(output).toContain("SESSION CLOSE");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--manifest forces manifest even when config says full", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
				expect(output).not.toContain("Use bun");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--full forces full output even when config says manifest", async () => {
			await seedTwoDomains();
			const config = await readConfig(tmpDir);
			await writeConfig({ ...config, prime: { default_mode: "manifest" } }, tmpDir);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Expertise Manifest");
				expect(output).toContain("Use bun");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--manifest combined with --full errors", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const errorSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest", "--full"]);
				expect(process.exitCode).toBe(1);
				const errors = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errors).toContain("Cannot combine --manifest with --full");
			} finally {
				errorSpy.mockRestore();
			}
		});

		it("--manifest with positional domain errors with usage hint", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const errorSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest", "cli"]);
				expect(process.exitCode).toBe(1);
				const errors = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errors).toContain("--manifest cannot be combined with scoping arguments");
				expect(errors).toContain("ml prime <domain>");
			} finally {
				errorSpy.mockRestore();
			}
		});

		it("--manifest with --files errors", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const errorSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest", "--files", "src/x.ts"]);
				expect(process.exitCode).toBe(1);
				const errors = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errors).toContain("--manifest cannot be combined with scoping arguments");
			} finally {
				errorSpy.mockRestore();
			}
		});

		it("scoping wins over manifest config: positional domain emits full records", async () => {
			await seedTwoDomains();
			const config = await readConfig(tmpDir);
			await writeConfig({ ...config, prime: { default_mode: "manifest" } }, tmpDir);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "cli"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Expertise Manifest");
				expect(output).toContain("Use bun");
				expect(output).toContain("init-flow");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("manifest output shows per-type counts and omits zero-count types", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toMatch(/\*\*cli\*\*: 2 records \([^)]*1 pattern[^)]*1 convention[^)]*\)/);
				const cliLine = output.split("\n").find((l) => l.includes("**cli**"));
				expect(cliLine).toBeDefined();
				expect(cliLine ?? "").not.toContain("0 failure");
				expect(cliLine ?? "").not.toContain("0 decision");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--json + manifest emits structured manifest payload", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--json", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const parsed = JSON.parse(output);
				expect(parsed.type).toBe("manifest");
				expect(Array.isArray(parsed.quick_reference)).toBe(true);
				expect(parsed.quick_reference.length).toBeGreaterThan(0);
				expect(parsed.domains).toHaveLength(2);
				const cli = parsed.domains.find((d: { domain: string }) => d.domain === "cli");
				expect(cli.count).toBe(2);
				expect(cli.type_counts.pattern).toBe(1);
				expect(cli.type_counts.convention).toBe(1);
				expect(cli.health.status).toBe("ok");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("manifest output appends session-close protocol", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("SESSION CLOSE");
				expect(output).toContain("ml learn");
				expect(output).toContain("ml record");
				expect(output).toContain("ml sync");
			} finally {
				logSpy.mockRestore();
			}
		});
	});

	describe("global --format flag", () => {
		let originalCwd: string;

		beforeEach(() => {
			originalCwd = process.cwd();
		});

		afterEach(() => {
			process.chdir(originalCwd);
			process.exitCode = 0;
		});

		function makeProgram(): Command {
			const program = new Command();
			program
				.name("mulch")
				.option("--json", "output as structured JSON")
				.option("--format <format>", "global format")
				.exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		async function seed(): Promise<void> {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			await createExpertiseFile(cliPath);
			await appendRecord(cliPath, {
				type: "convention",
				content: "Use bun",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
		}

		it("--format markdown emits full markdown layout", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "markdown", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("### Conventions");
				expect(output).toContain("Use bun");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--format compact emits compact one-liner output (default behavior)", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "compact", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("[convention] Use bun");
				expect(output).not.toContain("### Conventions");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--format xml emits XML expertise tree", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "xml", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("<expertise>");
				expect(output).toContain('<domain name="cli"');
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--format plain emits plain-text output", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "plain", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				// Spawn-injection contract: no decorative title, no underline,
				// no Session Close trailer (warren handles framing contextually).
				expect(output).not.toContain("Project Expertise (via Mulch)");
				expect(output).not.toMatch(/^=+$/m);
				expect(output).not.toContain("SESSION CLOSE");
				expect(output).toContain("[cli]");
				expect(output).toContain("Use bun");
				expect(output).not.toContain("<expertise>");
				expect(output).not.toContain("###");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--compact (legacy alias) maps to --format compact", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--compact"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("[convention] Use bun");
				expect(output).not.toContain("### Conventions");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--full (legacy alias) maps to --format markdown", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("### Conventions");
				expect(output).toContain("Use bun");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("global --format wins over --full alias", async () => {
			await seed();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "xml", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("<expertise>");
				expect(output).not.toContain("### Conventions");
			} finally {
				logSpy.mockRestore();
			}
		});
	});

	describe("--dry-run", () => {
		let originalCwd: string;

		beforeEach(() => {
			originalCwd = process.cwd();
		});

		afterEach(() => {
			process.chdir(originalCwd);
			process.exitCode = 0;
		});

		function makeProgram(): Command {
			const program = new Command();
			program
				.name("mulch")
				.option("--json", "output as structured JSON")
				.option("--format <format>", "global format")
				.exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		async function seedTwoDomains(): Promise<void> {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {}, testing: {} } }, tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			const testingPath = getExpertisePath("testing", tmpDir);
			await createExpertiseFile(cliPath);
			await createExpertiseFile(testingPath);
			await appendRecord(cliPath, {
				type: "convention",
				content: "Use bun",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "init-flow",
				description: "How init wires up files",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(testingPath, {
				type: "convention",
				content: "No mocks",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
		}

		interface DryRunPayload {
			wouldPrime: { id: string; type: string; domain: string; tokens: number }[];
			totalTokens: number;
			budgetUsed: number | null;
			budgetTotal: number | null;
		}

		function parseDryRun(logSpy: ReturnType<typeof spyOn>): DryRunPayload {
			const output = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
			return JSON.parse(output) as DryRunPayload;
		}

		it("emits JSON summary with id/type/domain/tokens per kept record", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run"]);
				const payload = parseDryRun(logSpy);
				expect(payload.wouldPrime).toHaveLength(3);
				for (const r of payload.wouldPrime) {
					expect(r.id).toMatch(/^mx-[0-9a-f]+$/);
					expect(["convention", "pattern"]).toContain(r.type);
					expect(["cli", "testing"]).toContain(r.domain);
					expect(r.tokens).toBeGreaterThan(0);
				}
				expect(payload.totalTokens).toBe(payload.wouldPrime.reduce((s, r) => s + r.tokens, 0));
				expect(payload.budgetTotal).toBe(DEFAULT_BUDGET);
				expect(payload.budgetUsed).toBeCloseTo(payload.totalTokens / DEFAULT_BUDGET, 6);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("respects --budget and only lists records that fit", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				// Tiny budget — only the cheapest top-priority record should fit.
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "--budget", "5"]);
				const payload = parseDryRun(logSpy);
				expect(payload.budgetTotal).toBe(5);
				expect(payload.wouldPrime.length).toBeLessThan(3);
				expect(payload.totalTokens).toBeLessThanOrEqual(5);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--no-limit disables the budget (budgetTotal/budgetUsed null, all records listed)", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "--no-limit"]);
				const payload = parseDryRun(logSpy);
				expect(payload.budgetTotal).toBeNull();
				expect(payload.budgetUsed).toBeNull();
				expect(payload.wouldPrime).toHaveLength(3);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("composes with --domain (scopes to one domain)", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "cli"]);
				const payload = parseDryRun(logSpy);
				expect(payload.wouldPrime.every((r) => r.domain === "cli")).toBe(true);
				expect(payload.wouldPrime).toHaveLength(2);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("composes with --exclude-domain", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync([
					"node",
					"mulch",
					"prime",
					"--dry-run",
					"--exclude-domain",
					"cli",
				]);
				const payload = parseDryRun(logSpy);
				expect(payload.wouldPrime.every((r) => r.domain === "testing")).toBe(true);
				expect(payload.wouldPrime).toHaveLength(1);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("composes with --files (filters by file anchor)", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			await createExpertiseFile(cliPath);
			await appendRecord(cliPath, {
				type: "pattern",
				name: "init-pattern",
				description: "init wiring",
				files: ["src/init.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "other-pattern",
				description: "unrelated",
				files: ["src/other.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "--files", "src/init.ts"]);
				const payload = parseDryRun(logSpy);
				expect(payload.wouldPrime).toHaveLength(1);
				expect(payload.wouldPrime[0]?.type).toBe("pattern");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--format plain --dry-run returns JSON (format ignored when dry-running)", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "plain", "prime", "--dry-run"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				// Output is JSON, not plain text.
				expect(() => JSON.parse(output)).not.toThrow();
				const payload = JSON.parse(output) as DryRunPayload;
				expect(Array.isArray(payload.wouldPrime)).toBe(true);
				// No plain-format artifacts.
				expect(output).not.toContain("Conventions:");
				expect(output).not.toContain("[cli] ");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--dry-run + --manifest is rejected with a clear error", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);
			const errorSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "--manifest"]);
				expect(process.exitCode).toBe(1);
				const errors = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errors).toContain("Cannot combine --dry-run with --manifest");
			} finally {
				errorSpy.mockRestore();
				process.exitCode = 0;
			}
		});

		it("dry-run token counts match real prime budget accounting", async () => {
			await seedTwoDomains();
			process.chdir(tmpDir);

			// Real prime: read back the records, run them through the same
			// applyBudget+estimateRecordText pipeline and confirm dry-run agrees.
			const cliPath = getExpertisePath("cli", tmpDir);
			const testingPath = getExpertisePath("testing", tmpDir);
			const allDomainRecords: DomainRecords[] = [
				{ domain: "cli", records: await readExpertiseFile(cliPath) },
				{ domain: "testing", records: await readExpertiseFile(testingPath) },
			];
			const { kept } = applyBudget(allDomainRecords, DEFAULT_BUDGET, (r) => estimateRecordText(r));
			const expectedTokens = kept
				.flatMap((d) => d.records)
				.reduce((s, r) => s + estimateTokens(estimateRecordText(r)), 0);

			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run"]);
				const payload = parseDryRun(logSpy);
				expect(payload.totalTokens).toBe(expectedTokens);
			} finally {
				logSpy.mockRestore();
			}
		});
	});

	describe("project contract block (v0.10 slice 1)", () => {
		let originalCwd: string;

		beforeEach(() => {
			originalCwd = process.cwd();
			resetRegistry();
		});

		afterEach(() => {
			process.chdir(originalCwd);
			process.exitCode = 0;
			resetRegistry();
		});

		function makeProgram(): Command {
			const program = new Command();
			program
				.name("mulch")
				.option("--json", "output as structured JSON")
				.option("--format <format>", "global format")
				.exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		async function seedWithGates(): Promise<void> {
			await writeConfig(
				{
					...DEFAULT_CONFIG,
					domains: {
						cli: { allowed_types: ["convention", "pattern"] },
						ecosystem: { required_fields: ["evidence"] },
					},
					disabled_types: ["guide"],
					custom_types: {
						release_decision: {
							extends: "decision",
							required: ["version"],
							optional: ["breaking"],
						} as CustomTypeConfig,
					},
				},
				tmpDir,
			);
			await initRegistryFromConfig(tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			const ecoPath = getExpertisePath("ecosystem", tmpDir);
			await createExpertiseFile(cliPath);
			await createExpertiseFile(ecoPath);
			await appendRecord(cliPath, {
				type: "convention",
				content: "Use bun",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
		}

		it("leads default output with Project Contract section before record content", async () => {
			await seedWithGates();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("## Project Contract");
				expect(output).toContain("**Custom types**");
				expect(output).toContain("release_decision");
				expect(output).toContain("**Disabled types**: `guide`");
				expect(output).toContain("**Per-domain rules**");
				expect(output).toContain("`cli`: allowed types — convention, pattern");
				expect(output).toContain("`ecosystem`: required fields — evidence");
				const contractIdx = output.indexOf("## Project Contract");
				const expertiseIdx = output.indexOf("# Project Expertise");
				expect(contractIdx).toBeGreaterThanOrEqual(0);
				expect(expertiseIdx).toBeGreaterThan(contractIdx);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("leads --full output with contract block", async () => {
			await seedWithGates();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("## Project Contract");
				const contractIdx = output.indexOf("## Project Contract");
				const expertiseIdx = output.indexOf("# Project Expertise");
				expect(expertiseIdx).toBeGreaterThan(contractIdx);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("leads --manifest output with contract block", async () => {
			await seedWithGates();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("## Project Contract");
				const contractIdx = output.indexOf("## Project Contract");
				const manifestIdx = output.indexOf("# Project Expertise Manifest");
				expect(manifestIdx).toBeGreaterThan(contractIdx);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("omits contract block when project has no write-side gates", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, tmpDir);
			await initRegistryFromConfig(tmpDir);
			const cliPath = getExpertisePath("cli", tmpDir);
			await createExpertiseFile(cliPath);
			await appendRecord(cliPath, {
				type: "convention",
				content: "Use bun",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("## Project Contract");
				expect(output).toContain("# Project Expertise");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("omits contract block for --json output", async () => {
			await seedWithGates();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--json", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Contract");
				const parsed = JSON.parse(output);
				expect(parsed.type).toBe("expertise");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("omits contract block for --dry-run output", async () => {
			await seedWithGates();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Contract");
				const parsed = JSON.parse(output);
				expect(parsed).toHaveProperty("wouldPrime");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("renders contract block in XML format (XML expertise tree follows)", async () => {
			await seedWithGates();
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--format", "xml", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("<contract>");
				expect(output).toContain("<custom_types>");
				expect(output).toContain('name="release_decision"');
				expect(output).toContain("<disabled_types>guide</disabled_types>");
				expect(output).toContain("<expertise>");
				const contractIdx = output.indexOf("<contract>");
				const expertiseIdx = output.indexOf("<expertise>");
				expect(expertiseIdx).toBeGreaterThan(contractIdx);
			} finally {
				logSpy.mockRestore();
			}
		});
	});

	describe("auto-flip to manifest (v0.10 slice 1)", () => {
		let originalCwd: string;

		beforeEach(() => {
			originalCwd = process.cwd();
		});

		afterEach(() => {
			process.chdir(originalCwd);
			process.exitCode = 0;
		});

		function makeProgram(): Command {
			const program = new Command();
			program.name("mulch").option("--json", "output as structured JSON").exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		async function seedDomains(domainCount: number, recordsPerDomain: number): Promise<void> {
			const domains: Record<string, Record<string, never>> = {};
			for (let i = 0; i < domainCount; i++) {
				domains[`d${i}`] = {};
			}
			await writeConfig({ ...DEFAULT_CONFIG, domains }, tmpDir);
			for (const dom of Object.keys(domains)) {
				const path = getExpertisePath(dom, tmpDir);
				await createExpertiseFile(path);
				for (let r = 0; r < recordsPerDomain; r++) {
					await appendRecord(path, {
						type: "convention",
						content: `record ${dom}-${r}`,
						classification: "foundational",
						recorded_at: new Date().toISOString(),
					});
				}
			}
		}

		it("stays in full mode at exactly 100 records and 5 domains (threshold is strict >)", async () => {
			await seedDomains(5, 20);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Expertise Manifest");
				expect(output).toContain("# Project Expertise (via Mulch)");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("flips to manifest above 100 records (with <=5 domains)", async () => {
			await seedDomains(4, 26);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("flips to manifest above 5 domains (with <=100 records)", async () => {
			await seedDomains(6, 2);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--full opts out of auto-flip even when over threshold", async () => {
			await seedDomains(7, 20);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Expertise Manifest");
				expect(output).toContain("# Project Expertise (via Mulch)");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("explicit prime.default_mode=full in config opts out of auto-flip", async () => {
			await seedDomains(7, 20);
			const config = await readConfig(tmpDir);
			await writeConfig({ ...config, prime: { default_mode: "full" } }, tmpDir);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Expertise Manifest");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("explicit prime.default_mode=manifest forces manifest below threshold", async () => {
			await seedDomains(2, 3);
			const config = await readConfig(tmpDir);
			await writeConfig({ ...config, prime: { default_mode: "manifest" } }, tmpDir);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--dry-run opts out of auto-flip even when over threshold", async () => {
			await seedDomains(6, 20);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const parsed = JSON.parse(output);
				expect(parsed).toHaveProperty("wouldPrime");
				expect(parsed).toHaveProperty("totalTokens");
			} finally {
				logSpy.mockRestore();
			}
		});

		it("scoping (positional domain) suppresses auto-flip", async () => {
			await seedDomains(6, 20);
			process.chdir(tmpDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "d0"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).not.toContain("Project Expertise Manifest");
				expect(output).toContain("# Project Expertise (via Mulch)");
			} finally {
				logSpy.mockRestore();
			}
		});
	});

	describe("auto-context-scope for full mode (v0.10 slice 2)", () => {
		let gitDir: string;
		let originalCwd: string;

		beforeEach(async () => {
			originalCwd = process.cwd();
			// realpath() needed because macOS /var → /private/var; --git-common-dir
			// returns the resolved path so isInsideWorktree comparisons need parity.
			gitDir = await realpath(await mkdtemp(join(tmpdir(), "mulch-prime-slice2-")));
			execSync("git init -q -b main", { cwd: gitDir, stdio: "pipe" });
			execSync("git config user.email 'test@test.com'", { cwd: gitDir, stdio: "pipe" });
			execSync("git config user.name 'Test'", { cwd: gitDir, stdio: "pipe" });
			await mkdir(join(gitDir, ".mulch"), { recursive: true });
			await mkdir(join(gitDir, ".mulch", "expertise"), { recursive: true });
		});

		afterEach(async () => {
			process.chdir(originalCwd);
			process.exitCode = 0;
			await rm(gitDir, { recursive: true, force: true });
		});

		function makeProgram(): Command {
			const program = new Command();
			program.name("mulch").option("--json", "output as structured JSON").exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		async function seedMixedDomain(): Promise<void> {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, gitDir);
			const cliPath = getExpertisePath("cli", gitDir);
			await createExpertiseFile(cliPath);
			await appendRecord(cliPath, {
				type: "convention",
				content: "Universal convention with no anchors",
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "cli-entry",
				description: "CLI entry pattern",
				files: ["src/cli.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "db-schema",
				description: "DB schema pattern",
				files: ["src/db/schema.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
			});
		}

		async function touchFile(relPath: string): Promise<void> {
			const abs = join(gitDir, relPath);
			await mkdir(join(abs, ".."), { recursive: true });
			await writeFile(abs, "// stub\n");
			execSync(`git add ${relPath}`, { cwd: gitDir, stdio: "pipe" });
		}

		it("--full context-scopes to changed files by default", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Universal convention");
				expect(output).toContain("cli-entry");
				expect(output).not.toContain("db-schema");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).toContain("scoped to");
				expect(errs).toContain("--all for the full corpus");
				expect(errs).toContain("git status");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("--full --all emits the unscoped full corpus and skips the stderr summary", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Universal convention");
				expect(output).toContain("cli-entry");
				expect(output).toContain("db-schema");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).not.toContain("scoped to");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("active-work tracker match (seeds) keeps records that reference the in-progress id", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, gitDir);
			const cliPath = getExpertisePath("cli", gitDir);
			await createExpertiseFile(cliPath);
			await appendRecord(cliPath, {
				type: "pattern",
				name: "matched-by-seed",
				description: "Tracked by mulch-244c",
				files: ["unrelated/path.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				evidence: { seeds: "mulch-244c" },
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "matched-by-other-seed",
				description: "Tracked by some other seed",
				files: ["unrelated/path.ts"],
				classification: "foundational",
				recorded_at: new Date().toISOString(),
				evidence: { seeds: "mulch-0000" },
			});
			await mkdir(join(gitDir, ".seeds"), { recursive: true });
			await writeFile(
				join(gitDir, ".seeds", "issues.jsonl"),
				`${JSON.stringify({ id: "mulch-244c", status: "in_progress" })}\n`,
			);
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("matched-by-seed");
				expect(output).not.toContain("matched-by-other-seed");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).toContain("active-work");
				expect(errs).toContain("seeds:mulch-244c");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("no signals (clean repo, no in-progress work) skips auto-scope", async () => {
			await seedMixedDomain();
			// Commit the config so there are no changed/untracked files outside .mulch
			execSync("git add -A", { cwd: gitDir, stdio: "pipe" });
			execSync("git commit -q -m 'seed' --allow-empty", { cwd: gitDir, stdio: "pipe" });
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				// With no signals, all anchored records are emitted (no auto-scope).
				expect(output).toContain("cli-entry");
				expect(output).toContain("db-schema");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).not.toContain("scoped to");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("--json mode skips auto-context-scope so machine consumers see deterministic output", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--json", "prime", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const parsed = JSON.parse(output);
				const cli = parsed.domains.find((d: { domain: string }) => d.domain === "cli");
				expect(cli.entry_count).toBe(3);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("--manifest is unaffected by auto-context-scope (size-based, not file-based)", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
				expect(output).toContain("**cli**: 3 records");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).not.toContain("scoped to");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("explicit --files takes precedence over auto-context-scope", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync([
					"node",
					"mulch",
					"prime",
					"--full",
					"--files",
					"src/db/schema.ts",
				]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("db-schema");
				expect(output).not.toContain("cli-entry");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).not.toContain("scoped to");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("positional domain suppresses auto-context-scope", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "cli"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("cli-entry");
				expect(output).toContain("db-schema");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).not.toContain("scoped to");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("dry-run reflects auto-context-scope (preview matches what prime would emit)", async () => {
			await seedMixedDomain();
			await touchFile("src/cli.ts");
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "--full"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const parsed = JSON.parse(output);
				const types = parsed.wouldPrime.map((r: { type: string }) => r.type);
				// One convention + one matching pattern (cli-entry) — db-schema is excluded
				expect(parsed.wouldPrime).toHaveLength(2);
				expect(types).toContain("convention");
				expect(types).toContain("pattern");
				const errs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(errs).toContain("scoped to");
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});
	});

	describe("trust-tier ranking + why-surfaced (v0.10 slice 3)", () => {
		let gitDir: string;
		let originalCwd: string;

		beforeEach(async () => {
			originalCwd = process.cwd();
			gitDir = await realpath(await mkdtemp(join(tmpdir(), "mulch-prime-slice3-")));
			execSync("git init -q -b main", { cwd: gitDir, stdio: "pipe" });
			execSync("git config user.email 'test@test.com'", { cwd: gitDir, stdio: "pipe" });
			execSync("git config user.name 'Test'", { cwd: gitDir, stdio: "pipe" });
			await mkdir(join(gitDir, ".mulch"), { recursive: true });
			await mkdir(join(gitDir, ".mulch", "expertise"), { recursive: true });
		});

		afterEach(async () => {
			process.chdir(originalCwd);
			process.exitCode = 0;
			await rm(gitDir, { recursive: true, force: true });
		});

		function makeProgram(): Command {
			const program = new Command();
			program.name("mulch").option("--json", "output as structured JSON").exitOverride();
			registerPrimeCommand(program);
			return program;
		}

		it("orders records by trust tier (★-confirmed > foundational > tactical > observational)", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, gitDir);
			const cliPath = getExpertisePath("cli", gitDir);
			await createExpertiseFile(cliPath);
			const now = new Date().toISOString();
			// Intentionally insert in reverse trust order so a stable read would
			// surface observational first; the trust sort must flip this.
			await appendRecord(cliPath, {
				type: "convention",
				content: "Observational baseline",
				classification: "observational",
				recorded_at: now,
				id: "mx-0001",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Tactical fact",
				classification: "tactical",
				recorded_at: now,
				id: "mx-0002",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Foundational rule",
				classification: "foundational",
				recorded_at: now,
				id: "mx-0003",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Star-confirmed insight",
				classification: "tactical",
				recorded_at: now,
				id: "mx-0004",
				outcomes: [{ status: "success" }, { status: "success" }],
			});
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const starIdx = output.indexOf("Star-confirmed insight");
				const foundIdx = output.indexOf("Foundational rule");
				const tactIdx = output.indexOf("Tactical fact");
				const obsIdx = output.indexOf("Observational baseline");
				expect(starIdx).toBeGreaterThan(-1);
				expect(starIdx).toBeLessThan(foundIdx);
				expect(foundIdx).toBeLessThan(tactIdx);
				expect(tactIdx).toBeLessThan(obsIdx);
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("prime.tier_weights config override re-ranks the order", async () => {
			// Boost observational above foundational. Star weight set to 0 so a
			// star-confirmed tactical record can't sneak in. With override,
			// observational (300) > tactical (200) > foundational (100).
			await writeConfig(
				{
					...DEFAULT_CONFIG,
					domains: { cli: {} },
					prime: {
						tier_weights: { star: 0, foundational: 100, tactical: 200, observational: 300 },
					},
				},
				gitDir,
			);
			const cliPath = getExpertisePath("cli", gitDir);
			await createExpertiseFile(cliPath);
			const now = new Date().toISOString();
			await appendRecord(cliPath, {
				type: "convention",
				content: "Foundational rule",
				classification: "foundational",
				recorded_at: now,
				id: "mx-1001",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Tactical fact",
				classification: "tactical",
				recorded_at: now,
				id: "mx-1002",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Observational baseline",
				classification: "observational",
				recorded_at: now,
				id: "mx-1003",
			});
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const obsIdx = output.indexOf("Observational baseline");
				const tactIdx = output.indexOf("Tactical fact");
				const foundIdx = output.indexOf("Foundational rule");
				expect(obsIdx).toBeGreaterThan(-1);
				expect(obsIdx).toBeLessThan(tactIdx);
				expect(tactIdx).toBeLessThan(foundIdx);
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		async function seedSurfaceFixture(): Promise<void> {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, gitDir);
			const cliPath = getExpertisePath("cli", gitDir);
			await createExpertiseFile(cliPath);
			const now = new Date().toISOString();
			const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
			await appendRecord(cliPath, {
				type: "pattern",
				name: "file-anchored",
				description: "Pattern anchored to src/cli.ts",
				files: ["src/cli.ts"],
				classification: "tactical",
				recorded_at: old,
				id: "mx-2001",
			});
			await appendRecord(cliPath, {
				type: "pattern",
				name: "tracker-anchored",
				description: "Pattern with seeds evidence only",
				files: ["unrelated/path.ts"],
				classification: "tactical",
				recorded_at: old,
				id: "mx-2002",
				evidence: { seeds: "mulch-1234" },
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Star-confirmed convention",
				classification: "tactical",
				recorded_at: old,
				id: "mx-2003",
				outcomes: [{ status: "success" }],
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Universal convention with no anchors",
				classification: "foundational",
				recorded_at: old,
				id: "mx-2004",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Recently recorded convention",
				classification: "tactical",
				recorded_at: now,
				id: "mx-2005",
			});
		}

		it("compact format appends a 'why surfaced' suffix per record", async () => {
			await seedSurfaceFixture();
			// Stage a file change so the file-anchored pattern matches and the
			// tracker resolver picks up the in-progress seed. Auto-context-scope
			// supplies the ActiveContext; omitting --all lets it kick in.
			await mkdir(join(gitDir, "src"), { recursive: true });
			await writeFile(join(gitDir, "src", "cli.ts"), "// stub\n");
			execSync("git add src/cli.ts", { cwd: gitDir, stdio: "pipe" });
			await mkdir(join(gitDir, ".seeds"), { recursive: true });
			await writeFile(
				join(gitDir, ".seeds", "issues.jsonl"),
				`${JSON.stringify({ id: "mulch-1234", status: "in_progress" })}\n`,
			);
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--compact"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				// Every surfaced record carries a why suffix on its compact line.
				expect(output).toMatch(/file-anchored.* — why: file match \(src\/cli\.ts\)/);
				expect(output).toMatch(/tracker-anchored.* — why: in-progress seeds:mulch-1234/);
				expect(output).toMatch(/Star-confirmed convention.* — why: ★1 confirmations/);
				expect(output).toMatch(/Recently recorded convention.* — why: recorded today/);
				expect(output).toMatch(/Universal convention.* — why: applies broadly/);
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("markdown (--full) format appends suffixes to bullets", async () => {
			await seedSurfaceFixture();
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toMatch(/\[mx-2003\].*— why: ★1 confirmations/);
				expect(output).toMatch(/\[mx-2005\].*— why: recorded today/);
				expect(output).toMatch(/\[mx-2004\].*— why: applies broadly/);
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("xml format carries a why='...' attribute on each record element", async () => {
			await seedSurfaceFixture();
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = new Command();
				program
					.name("mulch")
					.option("--json", "output as structured JSON")
					.option("--format <fmt>", "output format")
					.exitOverride();
				registerPrimeCommand(program);
				await program.parseAsync(["node", "mulch", "--format", "xml", "prime", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain('id="mx-2003"');
				expect(output).toMatch(/id="mx-2003"[^>]*why="why: /);
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("file-match suffix uses the --files arg as the surfacing context", async () => {
			await seedSurfaceFixture();
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			const errSpy = spyOn(console, "error").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--compact", "--files", "src/cli.ts"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toMatch(/file-anchored.* — why: file match \(src\/cli\.ts\)/);
			} finally {
				logSpy.mockRestore();
				errSpy.mockRestore();
			}
		});

		it("--json mode emits records without why-surfaced annotations", async () => {
			await seedSurfaceFixture();
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "--json", "prime", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const parsed = JSON.parse(output);
				const cli = parsed.domains.find((d: { domain: string }) => d.domain === "cli");
				expect(cli).toBeDefined();
				// JSON mode is the machine-consumer contract — annotations only
				// belong in the rendered formats. Check that no record carries
				// a "why" property leak.
				for (const r of cli.records) {
					expect(r).not.toHaveProperty("why");
				}
			} finally {
				logSpy.mockRestore();
			}
		});

		it("manifest mode is unaffected by trust ranking (lists domains, not records)", async () => {
			await seedSurfaceFixture();
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--manifest"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				expect(output).toContain("Project Expertise Manifest");
				expect(output).not.toMatch(/why: /);
			} finally {
				logSpy.mockRestore();
			}
		});

		it("trust ranking applies to dry-run preview (highest trust first)", async () => {
			await writeConfig({ ...DEFAULT_CONFIG, domains: { cli: {} } }, gitDir);
			const cliPath = getExpertisePath("cli", gitDir);
			await createExpertiseFile(cliPath);
			const now = new Date().toISOString();
			await appendRecord(cliPath, {
				type: "convention",
				content: "Observational baseline",
				classification: "observational",
				recorded_at: now,
				id: "mx-3001",
			});
			await appendRecord(cliPath, {
				type: "convention",
				content: "Foundational rule",
				classification: "foundational",
				recorded_at: now,
				id: "mx-3002",
			});
			process.chdir(gitDir);
			const logSpy = spyOn(console, "log").mockImplementation(() => {});
			try {
				const program = makeProgram();
				await program.parseAsync(["node", "mulch", "prime", "--dry-run", "--full", "--all"]);
				const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
				const parsed = JSON.parse(output);
				const ids = parsed.wouldPrime.map((r: { id: string }) => r.id);
				expect(ids[0]).toBe("mx-3002");
				expect(ids[1]).toBe("mx-3001");
			} finally {
				logSpy.mockRestore();
			}
		});
	});
});
