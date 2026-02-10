import { existsSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { getMulchDir, readConfig, writeConfig, getExpertisePath } from "../utils/config.js";
import { createExpertiseFile } from "../utils/expertise.js";

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .argument("<domain>", "expertise domain to add")
    .description("Add a new expertise domain")
    .action(async (domain: string) => {
      const mulchDir = getMulchDir();

      if (!existsSync(mulchDir)) {
        console.error(
          chalk.red("No .mulch/ directory found. Run `mulch init` first."),
        );
        process.exitCode = 1;
        return;
      }

      const config = await readConfig();

      if (config.domains.includes(domain)) {
        console.error(
          chalk.red(`Domain "${domain}" already exists.`),
        );
        process.exitCode = 1;
        return;
      }

      const expertisePath = getExpertisePath(domain);
      await createExpertiseFile(expertisePath);

      config.domains.push(domain);
      await writeConfig(config);

      console.log(chalk.green(`Added domain "${domain}".`));
    });
}
