import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initMulchDir,
  writeConfig,
  getExpertisePath,
  readConfig,
} from "../../src/utils/config.js";
import {
  appendRecord,
  readExpertiseFile,
  createExpertiseFile,
  getFileModTime,
} from "../../src/utils/expertise.js";
import { DEFAULT_CONFIG } from "../../src/schemas/config.js";
import {
  formatDomainExpertise,
  formatPrimeOutput,
  formatDomainExpertiseXml,
  formatPrimeOutputXml,
  formatDomainExpertisePlain,
  formatPrimeOutputPlain,
  formatDomainExpertiseCompact,
  formatPrimeOutputCompact,
  formatMcpOutput,
} from "../../src/utils/format.js";
import { filterByContext, fileMatchesAny } from "../../src/utils/git.js";

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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["testing"] },
      tmpDir,
    );
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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
      const domains: { domain: string; entry_count: number; records: unknown[] }[] = [];
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
    await writeConfig(
      { ...DEFAULT_CONFIG, domains: ["fulltest"] },
      tmpDir,
    );
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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

    it("MCP output includes reference and guide records", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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
      expect(output).toContain('--type reference');
      expect(output).toContain('--type guide');
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
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["database"] },
        tmpDir,
      );
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
      expect(section).toContain("- [pattern] fts5-external-content: External content FTS5 with triggers (src/db/fts.ts)");
      expect(section).toContain("- [failure] FTS5 queries crash without escaping → Use escapeFts5Term()");
      expect(section).toContain("- [decision] SQLite over PostgreSQL: Simpler deployment");
      expect(section).toContain("- [reference] schema-file: src/db/schema.sql");
      expect(section).toContain("- [guide] add-migration: NNN_description.sql naming convention");
      // No section headers like ### Conventions
      expect(section).not.toContain("###");
    });

    it("reference without files falls back to description", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing"] },
        tmpDir,
      );
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

    it("compact wrapper omits recording instructions", () => {
      const output = formatPrimeOutputCompact([]);
      expect(output).toContain("# Project Expertise (via Mulch)");
      expect(output).toContain("No expertise recorded yet");
      expect(output).not.toContain("## Recording New Learnings");
    });

    it("compact with multiple domains", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["db", "api"] },
        tmpDir,
      );
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
      expect(records.map((r) => r.type)).toEqual(["convention", "pattern", "failure"]);
    });

    it("filtered records integrate with formatting pipeline", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["cli"] },
        tmpDir,
      );
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
      const output = formatDomainExpertiseCompact("testing", records, lastUpdated);
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
      const output = formatDomainExpertisePlain("testing", records, lastUpdated);
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
});
