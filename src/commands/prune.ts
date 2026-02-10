import { Command } from "commander";
import chalk from "chalk";
import { readConfig, getExpertisePath } from "../utils/config.js";
import { readExpertiseFile, writeExpertiseFile } from "../utils/expertise.js";
import type { ExpertiseRecord, Classification } from "../schemas/record.js";

interface PruneResult {
  domain: string;
  before: number;
  pruned: number;
  after: number;
}

function isStale(
  record: ExpertiseRecord,
  now: Date,
  shelfLife: { tactical: number; observational: number },
): boolean {
  const classification: Classification = record.classification;

  if (classification === "foundational") {
    return false;
  }

  const recordedAt = new Date(record.recorded_at);
  const ageInDays = (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24);

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
      const config = await readConfig();
      const now = new Date();
      const shelfLife = config.classification_defaults.shelf_life;
      const results: PruneResult[] = [];
      let totalPruned = 0;

      for (const domain of config.domains) {
        const filePath = getExpertisePath(domain);
        const records = await readExpertiseFile(filePath);

        if (records.length === 0) {
          continue;
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
          results.push({
            domain,
            before: records.length,
            pruned,
            after: kept.length,
          });
          totalPruned += pruned;

          if (!options.dryRun) {
            await writeExpertiseFile(filePath, kept);
          }
        }
      }

      if (totalPruned === 0) {
        console.log(chalk.green("No stale entries found. All records are current."));
        return;
      }

      const label = options.dryRun ? "Would prune" : "Pruned";
      const prefix = options.dryRun ? chalk.yellow("[DRY RUN] ") : "";

      for (const result of results) {
        console.log(
          `${prefix}${chalk.cyan(result.domain)}: ${label} ${chalk.red(String(result.pruned))} of ${result.before} entries (${result.after} remaining)`,
        );
      }

      console.log(
        `\n${prefix}${chalk.bold(`Total: ${label.toLowerCase()} ${totalPruned} stale ${totalPruned === 1 ? "entry" : "entries"}.`)}`,
      );
    });
}
