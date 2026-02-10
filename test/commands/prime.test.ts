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
  formatMcpOutput,
} from "../../src/utils/format.js";

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
    expect(output).toContain('<convention classification="foundational">');
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
    expect(output).toContain("  - Use vitest");
    expect(output).toContain("Decisions:");
    expect(output).toContain("  - Use ESM: Better tree-shaking");
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
});
