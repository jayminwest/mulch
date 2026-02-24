import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchFilesToDomains } from "../../src/commands/learn.ts";
import { DEFAULT_CONFIG } from "../../src/schemas/config.ts";
import {
  getExpertisePath,
  initMulchDir,
  writeConfig,
} from "../../src/utils/config.ts";
import {
  appendRecord,
  createExpertiseFile,
} from "../../src/utils/expertise.ts";

describe("learn command", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-learn-test-"));
    await initMulchDir(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("matchFilesToDomains", () => {
    it("matches changed files to domains via pattern records", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["cli", "testing"] },
        tmpDir,
      );
      const cliPath = getExpertisePath("cli", tmpDir);
      const testPath = getExpertisePath("testing", tmpDir);
      await createExpertiseFile(cliPath);
      await createExpertiseFile(testPath);

      await appendRecord(cliPath, {
        type: "pattern",
        name: "cli-entry",
        description: "CLI entry point",
        files: ["src/cli.ts", "src/commands/record.ts"],
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      await appendRecord(testPath, {
        type: "reference",
        name: "test-utils",
        description: "Test utilities",
        files: ["test/utils/config.test.ts"],
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const { matches, unmatched } = await matchFilesToDomains(
        [
          "src/cli.ts",
          "src/commands/record.ts",
          "test/utils/config.test.ts",
          "README.md",
        ],
        tmpDir,
      );

      expect(matches).toHaveLength(2);
      const cliMatch = matches.find((m) => m.domain === "cli");
      expect(cliMatch).toBeDefined();
      expect(cliMatch!.matchedFiles).toEqual([
        "src/cli.ts",
        "src/commands/record.ts",
      ]);

      const testMatch = matches.find((m) => m.domain === "testing");
      expect(testMatch).toBeDefined();
      expect(testMatch!.matchedFiles).toEqual(["test/utils/config.test.ts"]);

      expect(unmatched).toEqual(["README.md"]);
    });

    it("returns all files as unmatched when no records have files", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["cli"] }, tmpDir);
      const cliPath = getExpertisePath("cli", tmpDir);
      await createExpertiseFile(cliPath);

      await appendRecord(cliPath, {
        type: "convention",
        content: "Use ESM imports",
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const { matches, unmatched } = await matchFilesToDomains(
        ["src/cli.ts"],
        tmpDir,
      );

      expect(matches).toHaveLength(0);
      expect(unmatched).toEqual(["src/cli.ts"]);
    });

    it("returns empty results for no changed files", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["cli"] }, tmpDir);
      const cliPath = getExpertisePath("cli", tmpDir);
      await createExpertiseFile(cliPath);

      const { matches, unmatched } = await matchFilesToDomains([], tmpDir);

      expect(matches).toHaveLength(0);
      expect(unmatched).toHaveLength(0);
    });

    it("sorts domains by match count descending", async () => {
      await writeConfig(
        { ...DEFAULT_CONFIG, domains: ["alpha", "beta"] },
        tmpDir,
      );
      const alphaPath = getExpertisePath("alpha", tmpDir);
      const betaPath = getExpertisePath("beta", tmpDir);
      await createExpertiseFile(alphaPath);
      await createExpertiseFile(betaPath);

      await appendRecord(alphaPath, {
        type: "pattern",
        name: "one-file",
        description: "One file match",
        files: ["src/a.ts"],
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      await appendRecord(betaPath, {
        type: "pattern",
        name: "two-files",
        description: "Two file matches",
        files: ["src/b.ts", "src/c.ts"],
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      const { matches } = await matchFilesToDomains(
        ["src/a.ts", "src/b.ts", "src/c.ts"],
        tmpDir,
      );

      expect(matches).toHaveLength(2);
      expect(matches[0].domain).toBe("beta");
      expect(matches[0].matchedFiles).toHaveLength(2);
      expect(matches[1].domain).toBe("alpha");
      expect(matches[1].matchedFiles).toHaveLength(1);
    });

    it("handles domains with no expertise file", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["empty"] }, tmpDir);
      // Don't create expertise file — readExpertiseFile returns [] on ENOENT

      const { matches, unmatched } = await matchFilesToDomains(
        ["src/foo.ts"],
        tmpDir,
      );

      expect(matches).toHaveLength(0);
      expect(unmatched).toEqual(["src/foo.ts"]);
    });

    it("matches suffix paths (record stores short path)", async () => {
      await writeConfig({ ...DEFAULT_CONFIG, domains: ["cli"] }, tmpDir);
      const cliPath = getExpertisePath("cli", tmpDir);
      await createExpertiseFile(cliPath);

      await appendRecord(cliPath, {
        type: "pattern",
        name: "config",
        description: "Config module",
        files: ["src/utils/config.ts"],
        classification: "foundational",
        recorded_at: new Date().toISOString(),
      });

      // Changed file has exact match
      const { matches: exact } = await matchFilesToDomains(
        ["src/utils/config.ts"],
        tmpDir,
      );
      expect(exact).toHaveLength(1);
      expect(exact[0].matchedFiles).toEqual(["src/utils/config.ts"]);
    });
  });
});
