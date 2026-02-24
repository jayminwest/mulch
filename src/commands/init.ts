import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { getMulchDir, initMulchDir } from "../utils/config.ts";
import { outputJson } from "../utils/json-output.ts";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize .mulch/ in the current project")
    .action(async () => {
      const jsonMode = program.opts().json === true;
      const mulchDir = getMulchDir();
      const alreadyExists = existsSync(mulchDir);

      await initMulchDir();

      if (jsonMode) {
        outputJson({
          success: true,
          command: "init",
          created: !alreadyExists,
          path: mulchDir,
        });
      } else if (alreadyExists) {
        console.log(
          chalk.green("Updated .mulch/ — filled in any missing artifacts."),
        );
      } else {
        console.log(chalk.green(`Initialized .mulch/ in ${process.cwd()}`));
      }
    });
}
