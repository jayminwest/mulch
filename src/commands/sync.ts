import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import chalk from "chalk";
import type { Command } from "commander";
import { recordSchema } from "../schemas/record-schema.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { brand, isQuiet } from "../utils/palette.ts";

function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function gitHasChanges(cwd: string): boolean {
  try {
    const status = execFileSync("git", ["status", "--porcelain", ".mulch/"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function gitAdd(cwd: string): void {
  execFileSync("git", ["add", ".mulch/"], { cwd, stdio: "pipe" });
}

function gitCommit(cwd: string, message: string): string {
  return execFileSync("git", ["commit", "-m", message], {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

interface ValidateResult {
  valid: boolean;
  totalRecords: number;
  errors: Array<{ domain: string; line: number; message: string }>;
}

async function validateExpertise(cwd?: string): Promise<ValidateResult> {
  const config = await readConfig(cwd);
  const domains = config.domains;

  const ajv = new Ajv();
  const validate = ajv.compile(recordSchema);

  let totalRecords = 0;
  const errors: Array<{ domain: string; line: number; message: string }> = [];

  for (const domain of domains) {
    const filePath = getExpertisePath(domain, cwd);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      totalRecords++;
      const lineNumber = i + 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        errors.push({
          domain,
          line: lineNumber,
          message: "Invalid JSON: failed to parse",
        });
        continue;
      }
      if (!validate(parsed)) {
        const schemaErrors = (validate.errors ?? [])
          .map((err) => `${err.instancePath} ${err.message}`)
          .join("; ");
        errors.push({
          domain,
          line: lineNumber,
          message: `Schema validation failed: ${schemaErrors}`,
        });
      }
    }
  }

  return { valid: errors.length === 0, totalRecords, errors };
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Validate, stage, and commit .mulch/ changes")
    .option("--message <message>", "custom commit message")
    .option("--no-validate", "skip validation step")
    .action(async (options: { message?: string; validate?: boolean }) => {
      const jsonMode = program.opts().json === true;
      const cwd = process.cwd();

      // Check if we're in a git repo
      if (!isGitRepo(cwd)) {
        if (jsonMode) {
          outputJsonError(
            "sync",
            "Not in a git repository. Run this command from within a git repository.",
          );
        } else {
          console.error(chalk.red("Error: not in a git repository."));
        }
        process.exitCode = 1;
        return;
      }

      // Validate (unless --no-validate)
      if (options.validate !== false) {
        try {
          const result = await validateExpertise();
          if (!result.valid) {
            if (jsonMode) {
              outputJson({
                success: false,
                command: "sync",
                validated: false,
                committed: false,
                errors: result.errors,
              });
            } else {
              console.error(chalk.red("Validation failed:"));
              for (const err of result.errors) {
                console.error(
                  chalk.red(`  ${err.domain}:${err.line} - ${err.message}`),
                );
              }
              console.error(
                chalk.red(
                  "\nFix errors and retry, or use --no-validate to skip.",
                ),
              );
            }
            process.exitCode = 1;
            return;
          }
          if (!jsonMode && !isQuiet()) {
            console.log(
              `${brand("✓")} ${brand(`Validated ${result.totalRecords} records`)}`,
            );
          }
        } catch (err) {
          if (jsonMode) {
            outputJsonError(
              "sync",
              `Validation error: ${(err as Error).message}`,
            );
          } else {
            console.error(
              chalk.red(`Validation error: ${(err as Error).message}`),
            );
          }
          process.exitCode = 1;
          return;
        }
      }

      // Check for changes
      if (!gitHasChanges(cwd)) {
        if (jsonMode) {
          outputJson({
            success: true,
            command: "sync",
            validated: options.validate !== false,
            committed: false,
            message: "No changes to commit",
          });
        } else {
          if (!isQuiet()) console.log("No .mulch/ changes to commit.");
        }
        return;
      }

      // Git add + commit
      const commitMessage = options.message ?? "mulch: update expertise";
      try {
        gitAdd(cwd);
        gitCommit(cwd, commitMessage);

        if (jsonMode) {
          outputJson({
            success: true,
            command: "sync",
            validated: options.validate !== false,
            committed: true,
            message: commitMessage,
          });
        } else {
          if (!isQuiet())
            console.log(
              `${brand("✓")} ${brand(`Committed .mulch/ changes: "${commitMessage}"`)}`,
            );
        }
      } catch (err) {
        if (jsonMode) {
          outputJsonError("sync", `Git error: ${(err as Error).message}`);
        } else {
          console.error(chalk.red(`Git error: ${(err as Error).message}`));
        }
        process.exitCode = 1;
      }
    });
}
