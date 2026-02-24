import { execSync } from "node:child_process";
import chalk from "chalk";
import type { Command } from "commander";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import {
  compareSemver,
  getCurrentVersion,
  getLatestVersion,
} from "../utils/version.ts";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for and install mulch-cli updates")
    .option("--check", "only check for updates, do not install")
    .action(async (options: { check?: boolean }) => {
      const jsonMode = program.opts().json === true;
      const current = getCurrentVersion();
      const latest = getLatestVersion();

      if (latest === null) {
        if (jsonMode) {
          outputJsonError(
            "update",
            "Unable to reach npm registry. Check your internet connection.",
          );
        } else {
          console.error(
            chalk.red(
              "Unable to reach npm registry. Check your internet connection.",
            ),
          );
        }
        process.exitCode = 1;
        return;
      }

      const cmp = compareSemver(current, latest);

      if (cmp >= 0) {
        if (jsonMode) {
          outputJson({
            success: true,
            command: "update",
            current,
            latest,
            upToDate: true,
            updated: false,
          });
        } else {
          console.log(chalk.green(`mulch-cli ${current} is up to date`));
        }
        return;
      }

      if (options.check) {
        if (jsonMode) {
          outputJson({
            success: true,
            command: "update",
            current,
            latest,
            upToDate: false,
            updated: false,
          });
        } else {
          console.log(
            `Update available: ${chalk.yellow(current)} → ${chalk.green(latest)}`,
          );
          console.log(`Run ${chalk.cyan("mulch update")} to install.`);
        }
        return;
      }

      if (!jsonMode) {
        console.log(
          `Updating mulch-cli: ${chalk.yellow(current)} → ${chalk.green(latest)}`,
        );
      }

      try {
        execSync("npm update -g mulch-cli", {
          encoding: "utf-8",
          timeout: 60000,
          stdio: jsonMode ? ["pipe", "pipe", "pipe"] : "inherit",
        });

        if (jsonMode) {
          outputJson({
            success: true,
            command: "update",
            current,
            latest,
            upToDate: false,
            updated: true,
          });
        } else {
          console.log(chalk.green(`Updated to mulch-cli ${latest}`));
        }
      } catch (err) {
        if (jsonMode) {
          outputJsonError("update", `Update failed: ${(err as Error).message}`);
        } else {
          console.error(chalk.red(`Update failed: ${(err as Error).message}`));
          console.error(
            chalk.yellow("Try running manually: npm update -g mulch-cli"),
          );
        }
        process.exitCode = 1;
      }
    });
}
