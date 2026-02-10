import { existsSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { getMulchDir, readConfig, getExpertisePath } from "../utils/config.js";
import { readExpertiseFile, countRecords, getFileModTime } from "../utils/expertise.js";
import { formatStatusOutput } from "../utils/format.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show status of expertise records")
    .action(async () => {
      const mulchDir = getMulchDir();

      if (!existsSync(mulchDir)) {
        console.error(
          chalk.red("No .mulch/ directory found. Run `mulch init` first."),
        );
        process.exitCode = 1;
        return;
      }

      const config = await readConfig();

      const domainStats = await Promise.all(
        config.domains.map(async (domain) => {
          const filePath = getExpertisePath(domain);
          const records = await readExpertiseFile(filePath);
          const lastUpdated = await getFileModTime(filePath);
          return {
            domain,
            count: countRecords(records),
            lastUpdated,
          };
        }),
      );

      const output = formatStatusOutput(domainStats, config.governance);
      console.log(output);
    });
}
