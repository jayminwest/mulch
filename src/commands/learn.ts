import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { getExpertisePath, getMulchDir, readConfig } from "../utils/config.ts";
import { readExpertiseFile } from "../utils/expertise.ts";
import { getChangedFiles, isGitRepo } from "../utils/git.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

interface DomainMatch {
  domain: string;
  matchedFiles: string[];
}

export async function matchFilesToDomains(
  changedFiles: string[],
  cwd?: string,
): Promise<{ matches: DomainMatch[]; unmatched: string[] }> {
  const config = await readConfig(cwd);
  const matched = new Set<string>();
  const matches: DomainMatch[] = [];

  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    const records = await readExpertiseFile(filePath);

    // Collect all file paths from pattern and reference records
    const domainFiles = new Set<string>();
    for (const record of records) {
      if (
        (record.type === "pattern" || record.type === "reference") &&
        record.files
      ) {
        for (const f of record.files) {
          domainFiles.add(f);
        }
      }
    }

    // Match changed files against domain file paths
    const domainMatched: string[] = [];
    for (const changedFile of changedFiles) {
      for (const domainFile of domainFiles) {
        if (
          changedFile === domainFile ||
          changedFile.endsWith(domainFile) ||
          domainFile.endsWith(changedFile)
        ) {
          domainMatched.push(changedFile);
          matched.add(changedFile);
          break;
        }
      }
    }

    if (domainMatched.length > 0) {
      matches.push({ domain, matchedFiles: domainMatched });
    }
  }

  // Sort by match count descending
  matches.sort((a, b) => b.matchedFiles.length - a.matchedFiles.length);

  const unmatched = changedFiles.filter((f) => !matched.has(f));
  return { matches, unmatched };
}

export function registerLearnCommand(program: Command): void {
  program
    .command("learn")
    .description(
      "Show changed files and suggest domains for recording learnings",
    )
    .option("--since <ref>", "git ref to diff against", "HEAD~1")
    .action(async (options: { since: string }) => {
      const jsonMode = program.opts().json === true;
      const cwd = process.cwd();

      if (!isGitRepo(cwd)) {
        if (jsonMode) {
          outputJsonError(
            "learn",
            "Not in a git repository. Run this command from within a git repository.",
          );
        } else {
          console.error(chalk.red("Error: not in a git repository."));
        }
        process.exitCode = 1;
        return;
      }

      // No .mulch/ directory — exit cleanly (supports hook usage in non-mulch projects)
      if (!existsSync(getMulchDir(cwd))) {
        if (jsonMode) {
          outputJson({
            success: true,
            command: "learn",
            changedFiles: [],
            suggestedDomains: [],
            unmatchedFiles: [],
            message: "No .mulch/ directory found — skipping",
          });
        }
        return;
      }

      try {
        const changedFiles = getChangedFiles(cwd, options.since);

        if (changedFiles.length === 0) {
          if (jsonMode) {
            outputJson({
              success: true,
              command: "learn",
              changedFiles: [],
              suggestedDomains: [],
              unmatchedFiles: [],
              message: "No changed files found",
            });
          } else {
            console.log("No changed files found. Nothing to learn from.");
          }
          return;
        }

        const { matches, unmatched } = await matchFilesToDomains(changedFiles);

        if (jsonMode) {
          outputJson({
            success: true,
            command: "learn",
            changedFiles,
            suggestedDomains: matches.map((m) => ({
              domain: m.domain,
              matchCount: m.matchedFiles.length,
              files: m.matchedFiles,
            })),
            unmatchedFiles: unmatched,
          });
          return;
        }

        // Plain text output
        console.log(chalk.bold("\nSession learnings check\n"));

        console.log(chalk.cyan(`Changed files (${changedFiles.length}):`));
        for (const f of changedFiles) {
          console.log(`  ${f}`);
        }

        if (matches.length > 0) {
          console.log(chalk.cyan("\nSuggested domains:"));
          for (const m of matches) {
            const label =
              m.matchedFiles.length === 1 ? "file matches" : "files match";
            console.log(
              `  ${chalk.bold(m.domain)} (${m.matchedFiles.length} ${label} existing records)`,
            );
          }
        }

        if (unmatched.length > 0) {
          console.log(
            chalk.yellow("\nUnmatched files (no domain association):"),
          );
          for (const f of unmatched) {
            console.log(`  ${f}`);
          }
        }

        console.log(chalk.dim("\nRecord learnings with:"));
        console.log(
          chalk.dim(
            '  mulch record <domain> --type <type> --description "..."',
          ),
        );
        console.log();
      } catch (err) {
        if (jsonMode) {
          outputJsonError("learn", (err as Error).message);
        } else {
          console.error(`Error: ${(err as Error).message}`);
        }
        process.exitCode = 1;
      }
    });
}
