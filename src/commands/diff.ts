import { execFileSync } from "node:child_process";
import chalk from "chalk";
import type { Command } from "commander";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getRecordSummary } from "../utils/format.ts";
import { isGitRepo } from "../utils/git.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

export interface DiffEntry {
  domain: string;
  added: ExpertiseRecord[];
  removed: ExpertiseRecord[];
}

export function parseExpertiseDiff(diffOutput: string): DiffEntry[] {
  const lines = diffOutput.split("\n");
  const entriesMap = new Map<string, DiffEntry>();
  let currentDomain: string | null = null;

  for (const line of lines) {
    // Extract domain from 'diff --git' headers
    if (line.startsWith("diff --git")) {
      const match = line.match(/\.mulch\/expertise\/([^/]+)\.jsonl/);
      if (match) {
        currentDomain = match[1];
        if (!entriesMap.has(currentDomain)) {
          entriesMap.set(currentDomain, {
            domain: currentDomain,
            added: [],
            removed: [],
          });
        }
      }
      continue;
    }

    // Skip file metadata lines
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("@@")
    ) {
      continue;
    }

    // Parse added records (lines starting with '+')
    if (line.startsWith("+") && currentDomain) {
      const jsonStr = line.slice(1);
      try {
        const record = JSON.parse(jsonStr) as ExpertiseRecord;
        const entry = entriesMap.get(currentDomain);
        if (entry) {
          entry.added.push(record);
        }
      } catch {
        // Skip lines that fail JSON.parse (context lines, hunk headers, etc.)
      }
      continue;
    }

    // Parse removed records (lines starting with '-')
    if (line.startsWith("-") && currentDomain) {
      const jsonStr = line.slice(1);
      try {
        const record = JSON.parse(jsonStr) as ExpertiseRecord;
        const entry = entriesMap.get(currentDomain);
        if (entry) {
          entry.removed.push(record);
        }
      } catch {
        // Skip lines that fail JSON.parse (context lines, hunk headers, etc.)
      }
    }
  }

  // Return entries sorted by domain, filtered to non-empty
  return [...entriesMap.values()]
    .filter((entry) => entry.added.length > 0 || entry.removed.length > 0)
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export function formatDiffOutput(entries: DiffEntry[], since: string): string {
  const lines: string[] = [];
  lines.push(`Expertise changes since ${since}`);
  lines.push("");

  for (const entry of entries) {
    const changeCount = entry.added.length + entry.removed.length;
    const plural = changeCount === 1 ? "change" : "changes";
    lines.push(`${entry.domain} (${changeCount} ${plural}):`);

    for (const record of entry.added) {
      const summary = getRecordSummary(record);
      lines.push(`  + [${record.type}] ${record.id} ${summary}`);
    }

    for (const record of entry.removed) {
      const summary = getRecordSummary(record);
      lines.push(`  - [${record.type}] ${record.id} ${summary}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Show expertise record changes since a git ref")
    .option("--since <ref>", "git ref to diff against", "HEAD~1")
    .action(async (options: { since: string }) => {
      const jsonMode = program.opts().json === true;
      const cwd = process.cwd();

      if (!isGitRepo(cwd)) {
        if (jsonMode) {
          outputJsonError(
            "diff",
            "Not in a git repository. Run this command from within a git repository.",
          );
        } else {
          console.error(chalk.red("Error: not in a git repository."));
        }
        process.exitCode = 1;
        return;
      }

      try {
        let diffOutput: string;
        try {
          diffOutput = execFileSync(
            "git",
            ["diff", options.since, "--", ".mulch/expertise/"],
            {
              cwd,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
        } catch {
          // ref doesn't exist or no changes, treat as empty diff
          diffOutput = "";
        }

        const entries = parseExpertiseDiff(diffOutput);

        if (entries.length === 0) {
          if (jsonMode) {
            outputJson({
              success: true,
              command: "diff",
              since: options.since,
              domains: [],
              message: "No expertise changes found.",
            });
          } else {
            console.log("No expertise changes found.");
          }
          return;
        }

        if (jsonMode) {
          outputJson({
            success: true,
            command: "diff",
            since: options.since,
            domains: entries,
          });
          return;
        }

        // Plain text output with colors
        console.log(chalk.bold(`\nExpertise changes since ${options.since}\n`));

        for (const entry of entries) {
          const changeCount = entry.added.length + entry.removed.length;
          const plural = changeCount === 1 ? "change" : "changes";
          console.log(
            chalk.cyan(`${entry.domain} (${changeCount} ${plural}):`),
          );

          for (const record of entry.added) {
            const summary = getRecordSummary(record);
            console.log(
              chalk.green(`  + [${record.type}] ${record.id} ${summary}`),
            );
          }

          for (const record of entry.removed) {
            const summary = getRecordSummary(record);
            console.log(
              chalk.red(`  - [${record.type}] ${record.id} ${summary}`),
            );
          }

          console.log("");
        }
      } catch (err) {
        if (jsonMode) {
          outputJsonError("diff", (err as Error).message);
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exitCode = 1;
      }
    });
}
