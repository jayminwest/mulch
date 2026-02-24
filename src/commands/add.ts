import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import {
  getExpertisePath,
  getMulchDir,
  readConfig,
  writeConfig,
} from "../utils/config.ts";
import { createExpertiseFile } from "../utils/expertise.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .argument("<domain>", "expertise domain to add")
    .description("Add a new expertise domain")
    .action(async (domain: string) => {
      const jsonMode = program.opts().json === true;
      const mulchDir = getMulchDir();

      if (!existsSync(mulchDir)) {
        if (jsonMode) {
          outputJsonError(
            "add",
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

      if (config.domains.includes(domain)) {
        if (jsonMode) {
          outputJsonError("add", `Domain "${domain}" already exists.`);
        } else {
          console.error(chalk.red(`Domain "${domain}" already exists.`));
        }
        process.exitCode = 1;
        return;
      }

      const expertisePath = getExpertisePath(domain);
      await createExpertiseFile(expertisePath);

      config.domains.push(domain);
      await writeConfig(config);

      if (jsonMode) {
        outputJson({ success: true, command: "add", domain });
      } else {
        console.log(chalk.green(`Added domain "${domain}".`));
      }
    });
}
