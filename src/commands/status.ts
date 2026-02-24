import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { getExpertisePath, getMulchDir, readConfig } from "../utils/config.ts";
import {
  calculateDomainHealth,
  countRecords,
  getFileModTime,
  readExpertiseFile,
} from "../utils/expertise.ts";
import { formatStatusOutput } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show status of expertise records")
    .action(async () => {
      const jsonMode = program.opts().json === true;
      const mulchDir = getMulchDir();

      if (!existsSync(mulchDir)) {
        if (jsonMode) {
          outputJsonError(
            "status",
            "No .mulch/ directory found. Run `mulch init` first.",
          );
        } else {
          console.error(
            chalk.red("No .mulch/ directory found. Run `mulch init` first."),
          );
        }
        process.exitCode = 1;
        return;
      }

      const config = await readConfig();

      const domainStats = await Promise.all(
        config.domains.map(async (domain) => {
          const filePath = getExpertisePath(domain);
          const records = await readExpertiseFile(filePath);
          const lastUpdated = await getFileModTime(filePath);
          const health = calculateDomainHealth(
            records,
            config.governance.max_entries,
            config.classification_defaults.shelf_life,
          );
          return {
            domain,
            count: countRecords(records),
            lastUpdated,
            health,
            records,
          };
        }),
      );

      if (jsonMode) {
        outputJson({
          success: true,
          command: "status",
          domains: domainStats.map((s) => ({
            domain: s.domain,
            count: s.count,
            lastUpdated: s.lastUpdated?.toISOString() ?? null,
            health: s.health,
          })),
          governance: config.governance,
        });
      } else {
        const output = formatStatusOutput(
          domainStats.map((s) => ({
            domain: s.domain,
            count: s.count,
            lastUpdated: s.lastUpdated,
          })),
          config.governance,
        );
        console.log(output);
      }
    });
}
