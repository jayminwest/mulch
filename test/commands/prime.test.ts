import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
