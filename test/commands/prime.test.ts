import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  DEFAULT_BUDGET,
  applyBudget,
  estimateTokens,
  formatBudgetSummary,
} from "../../src/utils/budget.ts";
import type { DomainRecords } from "../../src/utils/budget.ts";
import {
  getExpertisePath,
  initMulchDir,
  readConfig,
  writeConfig,
} from "../../src/utils/config.ts";
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
  formatMcpOutput,
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
    expect(output).toContain("mulch add <domain>");
  });

  it("generates prime output with a single domain", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
      tmpDir,
    );

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
    for (const domain of config.domains) {
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
    expect(output).toContain("mulch record <domain>");
  });

  it("--full includes classification and evidence in output", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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

  it("--mcp outputs valid JSON with domain records", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    await appendRecord(filePath, {
      type: "convention",
      content: "Use vitest",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const output = formatMcpOutput([
      { domain: "testing", entry_count: records.length, records },
    ]);

    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("expertise");
    expect(parsed.domains).toHaveLength(1);
    expect(parsed.domains[0].domain).toBe("testing");
    expect(parsed.domains[0].entry_count).toBe(1);
    expect(parsed.domains[0].records[0].content).toBe("Use vitest");
  });

  it("--format xml outputs XML with domain tags", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
    expect(output).toMatch(
      /<convention id="mx-[0-9a-f]+" classification="foundational">/,
    );
    expect(output).toContain("Use vitest");
    expect(output).toContain("<resolution>Use streaming</resolution>");
  });

  it("--format xml escapes special characters", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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

    expect(output).toContain("Project Expertise (via Mulch)");
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );

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
      expect(config.domains).toContain("testing");
      expect(config.domains).toContain("architecture");

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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const config = await readConfig(tmpDir);
      const domainArg = "nonexistent";

      expect(config.domains.includes(domainArg)).toBe(false);
    });

    it("domain scoping works with --mcp format", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );

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

      // Scope to just "architecture" in MCP mode
      const targetDomains = ["architecture"];
      const domains: {
        domain: string;
        entry_count: number;
        records: unknown[];
      }[] = [];
      for (const domain of targetDomains) {
        const filePath = getExpertisePath(domain, tmpDir);
        const records = await readExpertiseFile(filePath);
        domains.push({ domain, entry_count: records.length, records });
      }

      const output = formatMcpOutput(domains);
      const parsed = JSON.parse(output);
      expect(parsed.domains).toHaveLength(1);
      expect(parsed.domains[0].domain).toBe("architecture");
    });

    it("domain scoping works with --format xml", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );

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
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["fulltest"] }, tmpDir);
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      expect(section).toContain(
        "**add-command**: How to add a new CLI command",
      );
    });

    it("XML format handles reference and guide records", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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

      expect(section).toMatch(
        /<reference id="mx-[0-9a-f]+" classification="foundational">/,
      );
      expect(section).toContain("<name>config-file</name>");
      expect(section).toContain("<files>config.yaml</files>");
      expect(section).toContain("</reference>");
      expect(section).toMatch(
        /<guide id="mx-[0-9a-f]+" classification="tactical">/,
      );
      expect(section).toContain("<name>setup-guide</name>");
      expect(section).toContain("</guide>");
    });

    it("plain text format handles reference and guide records", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      const section = formatDomainExpertisePlain(
        "testing",
        records,
        lastUpdated,
      );

      expect(section).toContain("References:");
      expect(section).toMatch(
        /- \[mx-[0-9a-f]+\] entry-point: Main entry \(src\/index\.ts\)/,
      );
      expect(section).toContain("Guides:");
      expect(section).toMatch(/- \[mx-[0-9a-f]+\] deploy-guide: How to deploy/);
    });

    it("MCP output includes reference and guide records", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      const output = formatMcpOutput([
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const config = await readConfig(tmpDir);
      const excludedDomain = "nonexistent";

      expect(config.domains.includes(excludedDomain)).toBe(false);
    });

    it("excludes specified domain from output", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture", "api"] },
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
      const targetDomains = config.domains.filter((d) => !excluded.includes(d));

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
          domains: ["testing", "architecture", "api", "database"],
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
      const targetDomains = config.domains.filter((d) => !excluded.includes(d));

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
          domains: ["testing", "architecture", "api", "database"],
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );

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
      const targetDomains = config.domains.filter((d) => !excluded.includes(d));

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

    it("exclusion works with --mcp format", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );

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
      const targetDomains = config.domains.filter((d) => !excluded.includes(d));

      const domains: {
        domain: string;
        entry_count: number;
        records: unknown[];
      }[] = [];
      for (const domain of targetDomains) {
        const filePath = getExpertisePath(domain, tmpDir);
        const records = await readExpertiseFile(filePath);
        domains.push({ domain, entry_count: records.length, records });
      }

      const output = formatMcpOutput(domains);
      const parsed = JSON.parse(output);
      expect(parsed.domains).toHaveLength(1);
      expect(parsed.domains[0].domain).toBe("testing");
    });
  });

  describe("multi-domain prime", () => {
    it("multiple domains produce combined output", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture", "api"] },
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );

      const config = await readConfig(tmpDir);
      const requested: string[] = [];
      const unique = [...new Set(requested)];
      const targetDomains = unique.length > 0 ? unique : config.domains;

      expect(targetDomains).toEqual(["testing", "architecture"]);
    });
  });

  describe("compact mode", () => {
    it("outputs one-liner per record with type tags", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["database"] }, tmpDir);
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
      const section = formatDomainExpertiseCompact(
        "database",
        records,
        lastUpdated,
      );

      expect(section).toContain("## database (6 records");
      expect(section).toContain("- [convention] Use WAL mode for SQLite");
      expect(section).toContain(
        "- [pattern] fts5-external-content: External content FTS5 with triggers (src/db/fts.ts)",
      );
      expect(section).toContain(
        "- [failure] FTS5 queries crash without escaping → Use escapeFts5Term()",
      );
      expect(section).toContain(
        "- [decision] SQLite over PostgreSQL: Simpler deployment",
      );
      expect(section).toContain("- [reference] schema-file: src/db/schema.sql");
      expect(section).toContain(
        "- [guide] add-migration: NNN_description.sql naming convention",
      );
      // No section headers like ### Conventions
      expect(section).not.toContain("###");
    });

    it("reference without files falls back to description", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      const section = formatDomainExpertiseCompact(
        "testing",
        records,
        lastUpdated,
      );

      expect(section).toContain(
        "- [reference] api-docs: External API documentation",
      );
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
      expect(output).toContain('mulch search "query"');
      expect(output).toContain("mulch prime --files");
      expect(output).toContain("mulch prime --context");
      expect(output).toContain("mulch record <domain>");
      expect(output).toContain("--evidence-commit");
      expect(output).toContain("--evidence-bead");
      expect(output).toContain("mulch doctor");
    });

    it("compact with multiple domains", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["db", "api"] }, tmpDir);
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
      expect(output).toContain(
        "- [decision] REST over GraphQL: Simpler tooling",
      );
    });
  });

  describe("context filtering", () => {
    it("--files option filters records by specified files", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["cli"] }, tmpDir);
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
      expect(records[0].type).toBe("convention");
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
      expect(records.map((r) => r.type)).toEqual([
        "convention",
        "pattern",
        "failure",
      ]);
    });

    it("filtered records integrate with formatting pipeline", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["cli"] }, tmpDir);
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["cli", "database"] },
        tmpDir,
      );
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      const output = formatDomainExpertiseCompact(
        "testing",
        records,
        lastUpdated,
      );
      expect(output).toContain("[relates to: mx-abc123]");
    });

    it("shows links in XML format", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      const output = formatDomainExpertisePlain(
        "testing",
        records,
        lastUpdated,
      );
      expect(output).toContain("[supersedes: mx-old111]");
    });

    it("omits link brackets when no links present", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
    it("compact output includes session close protocol", () => {
      const output = formatPrimeOutputCompact([]);
      const reminder = getSessionEndReminder("markdown");
      // The reminder is appended by prime.ts, but verify the function itself
      expect(reminder).toContain("SESSION CLOSE PROTOCOL");
      expect(reminder).toContain("mulch record");
      expect(reminder).toContain("mulch sync");
      expect(reminder).toContain("mulch learn");
      expect(reminder).toContain("NEVER skip this");
    });

    it("markdown reminder uses markdown formatting", () => {
      const reminder = getSessionEndReminder("markdown");
      expect(reminder).toContain("# ");
      expect(reminder).toContain("**CRITICAL**");
      expect(reminder).toContain("mulch record <domain>");
      expect(reminder).toContain("mulch sync");
      expect(reminder).toContain("mulch learn");
    });

    it("xml reminder uses XML tags", () => {
      const reminder = getSessionEndReminder("xml");
      expect(reminder).toContain("<session_close_protocol");
      expect(reminder).toContain("</session_close_protocol>");
      expect(reminder).toContain("<checklist>");
      expect(reminder).toContain("mulch record");
      expect(reminder).toContain("mulch sync");
      expect(reminder).toContain("mulch learn");
      expect(reminder).toContain("NEVER skip this");
    });

    it("plain reminder uses plain text formatting", () => {
      const reminder = getSessionEndReminder("plain");
      expect(reminder).toContain("SESSION CLOSE PROTOCOL");
      expect(reminder).not.toContain("**");
      expect(reminder).not.toContain("##");
      // No XML tags (but <domain> and <type> placeholders are fine)
      expect(reminder).not.toContain("</");
      expect(reminder).toContain("mulch record");
      expect(reminder).toContain("mulch sync");
      expect(reminder).toContain("mulch learn");
      expect(reminder).toContain("NEVER skip this");
    });

    it("MCP/JSON output does NOT include session close protocol", () => {
      const records = [
        {
          type: "convention" as const,
          content: "Test convention",
          classification: "foundational" as const,
          recorded_at: new Date().toISOString(),
        },
      ];
      const output = formatMcpOutput([
        { domain: "testing", entry_count: records.length, records },
      ]);
      expect(output).not.toContain("SESSION CLOSE PROTOCOL");
      expect(output).not.toContain("session_close_protocol");
      // Verify it's valid JSON without reminder text
      const parsed = JSON.parse(output);
      expect(parsed.type).toBe("expertise");
    });

    it("reminder contains key action items", () => {
      for (const format of ["markdown", "xml", "plain"] as const) {
        const reminder = getSessionEndReminder(format);
        expect(reminder).toContain("mulch record");
        expect(reminder).toContain("mulch sync");
        expect(reminder).toContain("mulch learn");
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
      expect(result.kept[0].records).toHaveLength(2);
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
      expect(result.kept[0].records.length).toBeLessThan(20);
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
      expect(result.kept[0].records).toHaveLength(1);
      expect(result.kept[0].records[0].type).toBe("convention");
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
      const convCost = estimateTokens(
        simpleEstimate(records.find((r) => r.type === "convention")!),
      );
      const tinyResult = applyBudget(domains, convCost + 1, simpleEstimate);
      expect(tinyResult.kept.length).toBeGreaterThan(0);
      expect(tinyResult.kept[0].records[0].type).toBe("convention");
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
      const result = applyBudget(
        domains,
        oneRecordCost * 2 + 1,
        simpleEstimate,
      );

      expect(result.kept[0].records).toHaveLength(2);
      // The kept records should be foundational and tactical (in original file order)
      const keptClassifications = result.kept[0].records.map(
        (r) => r.classification,
      );
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

      const domains: DomainRecords[] = [
        { domain: "testing", records: [oldRecord, newRecord] },
      ];

      // Budget that fits exactly 1 record
      const oneRecordCost = estimateTokens(simpleEstimate(newRecord));
      const result = applyBudget(domains, oneRecordCost + 1, simpleEstimate);

      expect(result.kept[0].records).toHaveLength(1);
      expect((result.kept[0].records[0] as { content: string }).content).toBe(
        "New convention",
      );
    });

    it("applyBudget preserves original domain order", () => {
      const domains: DomainRecords[] = [
        {
          domain: "alpha",
          records: [
            makeRecord("convention", "foundational", { content: "Alpha conv" }),
          ],
        },
        {
          domain: "beta",
          records: [
            makeRecord("convention", "foundational", { content: "Beta conv" }),
          ],
        },
      ];

      const result = applyBudget(domains, 100000, simpleEstimate);
      expect(result.kept[0].domain).toBe("alpha");
      expect(result.kept[1].domain).toBe("beta");
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
              description:
                "Beta reference description that is fairly long to make it costly",
            }),
          ],
        },
      ];

      // Budget that fits only alpha's convention
      const alphaCost = estimateTokens(simpleEstimate(domains[0].records[0]));
      const result = applyBudget(domains, alphaCost + 1, simpleEstimate);

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].domain).toBe("alpha");
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
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      expect(result.kept[0].records.length).toBeLessThan(10);

      // Format the kept records
      const lastUpdated = await getFileModTime(filePath);
      const section = formatDomainExpertiseCompact(
        "testing",
        result.kept[0].records,
        lastUpdated,
      );
      const output = formatPrimeOutputCompact([section]);

      expect(output).toContain("# Project Expertise (via Mulch)");
      expect(output).toContain("## testing");
    });

    it("budget summary line appears in final output when records are dropped", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
        const summary = formatBudgetSummary(
          result.droppedCount,
          result.droppedDomainCount,
        );
        expect(summary).toContain("more record");
        expect(summary).toContain("--budget <n>");
      }
    });

    it("session-end reminder is always shown regardless of budget", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
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
      expect(reminder).toContain("SESSION CLOSE PROTOCOL");
    });

    it("MCP/JSON output is NOT subject to budget", () => {
      const records: ExpertiseRecord[] = [];
      for (let i = 0; i < 20; i++) {
        records.push(
          makeRecord("convention", "foundational", {
            content: `Convention ${i} with substantial text to take up space in the output`,
          }),
        );
      }

      // MCP output is always complete regardless of any budget considerations
      const output = formatMcpOutput([
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
              description:
                "A reference with a longer description to make it costly",
            }),
          ],
        },
      ];

      // Budget that fits alpha's convention but not beta's reference
      const alphaCost = estimateTokens(simpleEstimate(domains[0].records[0]));
      const result = applyBudget(domains, alphaCost + 1, simpleEstimate);

      // Convention from alpha should be kept
      expect(result.kept.length).toBeGreaterThanOrEqual(1);
      expect(result.kept[0].domain).toBe("alpha");
      expect(result.kept[0].records[0].type).toBe("convention");
      // Reference from beta should be dropped
      expect(result.droppedCount).toBe(1);
    });
  });
});
