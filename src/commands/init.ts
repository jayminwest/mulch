import { existsSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { getMulchDir, initMulchDir } from "../utils/config.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize .mulch/ in the current project")
    .action(async () => {
      const mulchDir = getMulchDir();

      if (existsSync(mulchDir)) {
        console.log(
          chalk.yellow(".mulch/ already exists in this directory."),
        );
        return;
      }

      await initMulchDir();
      console.log(chalk.green(`Initialized .mulch/ in ${process.cwd()}`));
    });
}
