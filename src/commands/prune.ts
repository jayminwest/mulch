import chalk from "chalk";
import type { Command } from "commander";
import type { Classification, ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile, writeExpertiseFile } from "../utils/expertise.ts";
import { outputJson } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";

interface PruneResult {
  domain: string;
  before: number;
  pruned: number;
  after: number;
}

export function isStale(
  record: ExpertiseRecord,
  now: Date,
  shelfLife: { tactical: number; observational: number },
): boolean {
  const classification: Classification = record.classification;

  if (classification === "foundational") {
    return false;
  }

  const recordedAt = new Date(record.recorded_at);
  const ageInDays = Math.floor(
    (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (classification === "tactical") {
    return ageInDays > shelfLife.tactical;
  }

  if (classification === "observational") {
    return ageInDays > shelfLife.observational;
  }

  return false;
}

export function registerPruneCommand(program: Command): void {
  program
    .command("prune")
    .description("Remove outdated or low-value expertise records")
    .option("--dry-run", "Show what would be pruned without removing", false)
    .action(async (options: { dryRun: boolean }) => {
      const jsonMode = program.opts().json === true;
      const config = await readConfig();
      const now = new Date();
      const shelfLife = config.classification_defaults.shelf_life;
      const results: PruneResult[] = [];
      let totalPruned = 0;

      for (const domain of config.domains) {
        const filePath = getExpertisePath(domain);

        const domainResult = await withFileLock(filePath, async () => {
          const records = await readExpertiseFile(filePath);

          if (records.length === 0) {
            return null;
          }

          const kept: ExpertiseRecord[] = [];
          let pruned = 0;

          for (const record of records) {
            if (isStale(record, now, shelfLife)) {
              pruned++;
            } else {
              kept.push(record);
            }
          }

          if (pruned > 0) {
            if (!options.dryRun) {
              await writeExpertiseFile(filePath, kept);
            }
            return {
              domain,
              before: records.length,
              pruned,
              after: kept.length,
            };
          }
          return null;
        });

        if (domainResult) {
          results.push(domainResult);
          totalPruned += domainResult.pruned;
        }
      }

      if (jsonMode) {
        outputJson({
          success: true,
          command: "prune",
          dryRun: options.dryRun,
          totalPruned,
          results,
        });
        return;
      }

      if (totalPruned === 0) {
        console.log(
          chalk.green("No stale records found. All records are current."),
        );
        return;
      }

      const label = options.dryRun ? "Would prune" : "Pruned";
      const prefix = options.dryRun ? chalk.yellow("[DRY RUN] ") : "";

      for (const result of results) {
        console.log(
          `${prefix}${chalk.cyan(result.domain)}: ${label} ${chalk.red(String(result.pruned))} of ${result.before} records (${result.after} remaining)`,
        );
      }

      console.log(
        `\n${prefix}${chalk.bold(`Total: ${label.toLowerCase()} ${totalPruned} stale ${totalPruned === 1 ? "record" : "records"}.`)}`,
      );
    });
}
