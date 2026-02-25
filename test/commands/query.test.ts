import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerQueryCommand } from "../../src/commands/query.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import type { ExpertiseRecord } from "../../src/schemas/record.ts";
import {
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  createExpertiseFile,
  filterByClassification,
  filterByFile,
  filterByType,
  readExpertiseFile,
} from "../../src/utils/expertise.ts";
import {
  type Outcome,
  type ScoredRecord,
  sortByConfirmationScore,
} from "../../src/utils/scoring.ts";

describe("query command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-query-test-"));
    await initMulchDir(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads records from a single domain", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const record: ExpertiseRecord = {
      type: "convention",
      content: "Use vitest for all tests",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    await appendRecord(filePath, record);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("convention");
    expect((records[0] as { content: string }).content).toBe(
      "Use vitest for all tests",
    );
  });

  it("filters records by type", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    const filePath = getExpertisePath("testing", tmpDir);
    await createExpertiseFile(filePath);

    const convention: ExpertiseRecord = {
      type: "convention",
      content: "Always write tests",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    };
    const failure: ExpertiseRecord = {
      type: "failure",
      description: "Tests timed out",
      resolution: "Increase timeout",
      classification: "tactical",
      recorded_at: new Date().toISOString(),
    };
    await appendRecord(filePath, convention);
    await appendRecord(filePath, failure);

    const allRecords = await readExpertiseFile(filePath);
    expect(allRecords).toHaveLength(2);

    const failures = filterByType(allRecords, "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe("failure");

    const conventions = filterByType(allRecords, "convention");
    expect(conventions).toHaveLength(1);
    expect(conventions[0].type).toBe("convention");
  });

  it("returns empty array for domain with no records", async () => {
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["empty-domain"] }, tmpDir);
    const filePath = getExpertisePath("empty-domain", tmpDir);
    await createExpertiseFile(filePath);

    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(0);
  });

  it("queries multiple domains", async () => {
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

    const testingRecords = await readExpertiseFile(testingPath);
    const archRecords = await readExpertiseFile(archPath);
    expect(testingRecords).toHaveLength(1);
    expect(archRecords).toHaveLength(1);
  });

  it("returns empty for non-existent expertise file", async () => {
    const filePath = getExpertisePath("nonexistent", tmpDir);
    const records = await readExpertiseFile(filePath);
    expect(records).toHaveLength(0);
  });

  it("filterByType returns empty when no records match", async () => {
    const filePath = getExpertisePath("testing", tmpDir);
    await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
    await createExpertiseFile(filePath);

    await appendRecord(filePath, {
      type: "convention",
      content: "Some convention",
      classification: "foundational",
      recorded_at: new Date().toISOString(),
    });

    const records = await readExpertiseFile(filePath);
    const decisions = filterByType(records, "decision");
    expect(decisions).toHaveLength(0);
  });

  describe("classification filtering", () => {
    it("filters by foundational classification", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Foundational rule",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Tactical note",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Observational failure",
        resolution: "Fixed it",
        classification: "observational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      expect(records).toHaveLength(3);

      const foundational = filterByClassification(records, "foundational");
      expect(foundational).toHaveLength(1);
      expect(foundational[0].classification).toBe("foundational");

      const tactical = filterByClassification(records, "tactical");
      expect(tactical).toHaveLength(1);
      expect(tactical[0].classification).toBe("tactical");

      const observational = filterByClassification(records, "observational");
      expect(observational).toHaveLength(1);
      expect(observational[0].classification).toBe("observational");
    });

    it("returns empty when no records match classification", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Only foundational",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const tactical = filterByClassification(records, "tactical");
      expect(tactical).toHaveLength(0);
    });

    it("combines classification filter with type filter", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Foundational convention",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Foundational failure",
        resolution: "Fixed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Tactical convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const foundational = filterByClassification(records, "foundational");
      const foundationalConventions = filterByType(foundational, "convention");
      expect(foundationalConventions).toHaveLength(1);
      expect((foundationalConventions[0] as { content: string }).content).toBe(
        "Foundational convention",
      );
    });
  });

  describe("--json output mode", () => {
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
        .exitOverride();
      registerQueryCommand(program);
      return program;
    }

    it("returns JSON with success and domains array for a valid domain", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);
      await appendRecord(filePath, {
        type: "convention",
        content: "Use vitest for all tests",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          command: string;
          domains: Array<{ domain: string; records: unknown[] }>;
        };
        expect(output.success).toBe(true);
        expect(output.command).toBe("query");
        expect(output.domains).toHaveLength(1);
        expect(output.domains[0].domain).toBe("testing");
        expect(output.domains[0].records).toHaveLength(1);
      } finally {
        logSpy.mockRestore();
      }
    });

    it("returns JSON for --all with multiple domains", async () => {
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
        content: "Always write tests",
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

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "query", "--all"]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          command: string;
          domains: Array<{ domain: string; records: unknown[] }>;
        };
        expect(output.success).toBe(true);
        expect(output.command).toBe("query");
        expect(output.domains).toHaveLength(2);
        const domainNames = output.domains.map((d) => d.domain);
        expect(domainNames).toContain("testing");
        expect(domainNames).toContain("architecture");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("returns JSON with empty domains array when --all and no domains configured", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: [] }, tmpDir);

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "query", "--all"]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          command: string;
          domains: unknown[];
        };
        expect(output.success).toBe(true);
        expect(output.command).toBe("query");
        expect(output.domains).toHaveLength(0);
      } finally {
        logSpy.mockRestore();
      }
    });

    it("returns JSON error for unknown domain", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);

      process.chdir(tmpDir);
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "nonexistent",
        ]);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(errorSpy.mock.calls[0][0] as string) as {
          success: boolean;
          command: string;
          error: string;
        };
        expect(output.success).toBe(false);
        expect(output.command).toBe("query");
        expect(output.error).toContain("nonexistent");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("shows hint when domain not found (text mode)", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);

      process.chdir(tmpDir);
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "query", "nonexistent"]);

        expect(errorSpy).toHaveBeenCalledTimes(2);
        expect(errorSpy.mock.calls[0][0] as string).toContain("nonexistent");
        expect(errorSpy.mock.calls[1][0] as string).toContain(
          "mulch add nonexistent",
        );
        expect(errorSpy.mock.calls[1][0] as string).toContain(
          ".mulch/mulch.config.yaml",
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("returns JSON error when no domain and no --all flag", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);

      process.chdir(tmpDir);
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "query"]);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(errorSpy.mock.calls[0][0] as string) as {
          success: boolean;
          command: string;
          error: string;
        };
        expect(output.success).toBe(false);
        expect(output.command).toBe("query");
        expect(output.error).toContain("domain");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("returns JSON error when no .mulch/ directory exists", async () => {
      // Do not call initMulchDir — use a bare tmpDir
      const bareTmpDir = await mkdtemp(join(tmpdir(), "mulch-query-bare-"));
      process.chdir(bareTmpDir);
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync(["node", "mulch", "--json", "query", "--all"]);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(errorSpy.mock.calls[0][0] as string) as {
          success: boolean;
          command: string;
          error: string;
        };
        expect(output.success).toBe(false);
        expect(output.command).toBe("query");
        expect(output.error).toContain(".mulch/");
      } finally {
        errorSpy.mockRestore();
        await rm(bareTmpDir, { recursive: true, force: true });
      }
    });

    it("filters records by type in JSON mode", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);
      await appendRecord(filePath, {
        type: "convention",
        content: "Convention record",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Failure record",
        resolution: "Fixed",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--type",
          "convention",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{ domain: string; records: Array<{ type: string }> }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(1);
        expect(output.domains[0].records[0].type).toBe("convention");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("filters records by classification in JSON mode", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);
      await appendRecord(filePath, {
        type: "convention",
        content: "Foundational rule",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Tactical note",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--classification",
          "foundational",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{
            domain: string;
            records: Array<{ classification: string }>;
          }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(1);
        expect(output.domains[0].records[0].classification).toBe(
          "foundational",
        );
      } finally {
        logSpy.mockRestore();
      }
    });

    it("filters records by file path in JSON mode", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);
      await appendRecord(filePath, {
        type: "pattern",
        name: "query-helper",
        description: "Query helper pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/commands/query.ts"],
      });
      await appendRecord(filePath, {
        type: "pattern",
        name: "other-pattern",
        description: "Unrelated",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/utils/config.ts"],
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--file",
          "commands/query",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{
            domain: string;
            records: Array<{ name: string }>;
          }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(1);
        expect(output.domains[0].records[0].name).toBe("query-helper");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("returns empty records array for domain with no records in JSON mode", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{ domain: string; records: unknown[] }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(0);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("file filtering", () => {
    it("filters pattern records by file path", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "test-helper",
        description: "Testing helper pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["test/helpers/setup.ts"],
      });
      await appendRecord(filePath, {
        type: "pattern",
        name: "other-pattern",
        description: "Unrelated pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/utils/other.ts"],
      });

      const records = await readExpertiseFile(filePath);
      const filtered = filterByFile(records, "test/helpers");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("test-helper");
    });

    it("filters reference records by file path", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "reference",
        name: "api-ref",
        description: "API reference",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/api/routes.ts"],
      });

      const records = await readExpertiseFile(filePath);
      const filtered = filterByFile(records, "api/routes");
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as { name: string }).name).toBe("api-ref");
    });

    it("records without files field are excluded", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "No files here",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendRecord(filePath, {
        type: "failure",
        description: "Failure without files",
        resolution: "Fixed",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
      });

      const records = await readExpertiseFile(filePath);
      const filtered = filterByFile(records, "src");
      expect(filtered).toHaveLength(0);
    });

    it("file filter across domains isolates correctly", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["testing", "architecture"] },
        tmpDir,
      );
      const testingPath = getExpertisePath("testing", tmpDir);
      const archPath = getExpertisePath("architecture", tmpDir);
      await createExpertiseFile(testingPath);
      await createExpertiseFile(archPath);

      await appendRecord(testingPath, {
        type: "pattern",
        name: "test-pattern",
        description: "Testing pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/shared/utils.ts"],
      });
      await appendRecord(archPath, {
        type: "pattern",
        name: "arch-pattern",
        description: "Architecture pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        files: ["src/shared/utils.ts"],
      });

      const testingRecords = await readExpertiseFile(testingPath);
      const archRecords = await readExpertiseFile(archPath);

      const filteredTesting = filterByFile(testingRecords, "src/shared");
      const filteredArch = filterByFile(archRecords, "src/shared");

      expect(filteredTesting).toHaveLength(1);
      expect((filteredTesting[0] as { name: string }).name).toBe(
        "test-pattern",
      );
      expect(filteredArch).toHaveLength(1);
      expect((filteredArch[0] as { name: string }).name).toBe("arch-pattern");
    });
  });

  describe("outcome-status filtering", () => {
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
        .exitOverride();
      registerQueryCommand(program);
      return program;
    }

    it("filters records with outcomes containing success", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "Successful approach",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Failed approach",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "failure" }],
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "No outcome",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--outcome-status",
          "success",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{
            domain: string;
            records: Array<{ content: string }>;
          }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(1);
        expect(output.domains[0].records[0].content).toBe(
          "Successful approach",
        );
      } finally {
        logSpy.mockRestore();
      }
    });

    it("filters records with outcomes containing failure", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "failure",
        description: "Something broke",
        resolution: "Use alternative",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "failure", agent: "build-agent" }],
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Worked fine",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--outcome-status",
          "failure",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{ domain: string; records: Array<{ type: string }> }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(1);
        expect(output.domains[0].records[0].type).toBe("failure");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("excludes records without outcomes when filtering by outcome status", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "convention",
        content: "No outcome here",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--outcome-status",
          "success",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{ domain: string; records: unknown[] }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(0);
      } finally {
        logSpy.mockRestore();
      }
    });

    it("outcome-status combined with type filter narrows results", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendRecord(filePath, {
        type: "pattern",
        name: "successful-pattern",
        description: "Pattern that worked",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });
      await appendRecord(filePath, {
        type: "convention",
        content: "Successful convention",
        classification: "tactical",
        recorded_at: new Date().toISOString(),
        outcomes: [{ status: "success" }],
      });

      process.chdir(tmpDir);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      try {
        const program = makeProgram();
        await program.parseAsync([
          "node",
          "mulch",
          "--json",
          "query",
          "testing",
          "--outcome-status",
          "success",
          "--type",
          "pattern",
        ]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(logSpy.mock.calls[0][0] as string) as {
          success: boolean;
          domains: Array<{ domain: string; records: Array<{ name: string }> }>;
        };
        expect(output.success).toBe(true);
        expect(output.domains[0].records).toHaveLength(1);
        expect(output.domains[0].records[0].name).toBe("successful-pattern");
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("sort-by-score", () => {
    function makeOutcome(status: Outcome["status"]): Outcome {
      return { status, recorded_at: new Date().toISOString() };
    }

    async function appendScoredRecord(
      filePath: string,
      record: ScoredRecord,
    ): Promise<void> {
      await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
    }

    it("sortByConfirmationScore places high-score records first", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "low-confirm",
        description: "Rarely confirmed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "high-confirm",
        description: "Highly confirmed",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      expect(sorted).toHaveLength(2);
      expect((sorted[0] as { name: string }).name).toBe("high-confirm");
      expect((sorted[1] as { name: string }).name).toBe("low-confirm");
    });

    it("records without outcomes sort to the end", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "no-outcomes",
        description: "No outcome data",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "with-outcomes",
        description: "Has outcome data",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      expect((sorted[0] as { name: string }).name).toBe("with-outcomes");
      expect((sorted[sorted.length - 1] as { name: string }).name).toBe(
        "no-outcomes",
      );
    });

    it("sort combined with type filter works correctly", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "a-pattern",
        description: "A pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "convention",
        content: "A convention with many confirmations",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [
          makeOutcome("success"),
          makeOutcome("success"),
          makeOutcome("success"),
        ],
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "b-pattern",
        description: "A better pattern",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const sorted = sortByConfirmationScore(patterns as ScoredRecord[]);

      // Only patterns; convention excluded
      expect(sorted.every((r) => r.type === "pattern")).toBe(true);
      // b-pattern (2 successes) before a-pattern (1 success)
      expect((sorted[0] as { name: string }).name).toBe("b-pattern");
      expect((sorted[1] as { name: string }).name).toBe("a-pattern");
    });

    it("does not mutate original record array order", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["testing"] }, tmpDir);
      const filePath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(filePath);

      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "first",
        description: "First appended",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success")],
      });
      await appendScoredRecord(filePath, {
        type: "pattern",
        name: "second",
        description: "Second appended",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
        outcomes: [makeOutcome("success"), makeOutcome("success")],
      });

      const records = await readExpertiseFile(filePath);
      const patterns = filterByType(records, "pattern");
      const originalFirst = (patterns[0] as { name: string }).name;

      sortByConfirmationScore(patterns as ScoredRecord[]); // not reassigned

      expect((patterns[0] as { name: string }).name).toBe(originalFirst);
    });
  });
});
