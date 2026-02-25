#!/usr/bin/env bun

import chalk from "chalk";
import { Command } from "commander";
import { registerAddCommand } from "./commands/add.ts";
import { registerCompactCommand } from "./commands/compact.ts";
import { registerDeleteCommand } from "./commands/delete.ts";
import { registerDiffCommand } from "./commands/diff.ts";
import { registerDoctorCommand } from "./commands/doctor.ts";
import { registerEditCommand } from "./commands/edit.ts";
import { registerInitCommand } from "./commands/init.ts";
import { registerLearnCommand } from "./commands/learn.ts";
import { registerOnboardCommand } from "./commands/onboard.ts";
import { registerOutcomeCommand } from "./commands/outcome.ts";
import { registerPrimeCommand } from "./commands/prime.ts";
import { registerPruneCommand } from "./commands/prune.ts";
import { registerQueryCommand } from "./commands/query.ts";
import { registerReadyCommand } from "./commands/ready.ts";
import { registerRecordCommand } from "./commands/record.ts";
import { registerSearchCommand } from "./commands/search.ts";
import { registerSetupCommand } from "./commands/setup.ts";
import { registerStatusCommand } from "./commands/status.ts";
import { registerSyncCommand } from "./commands/sync.ts";
import { registerUpdateCommand } from "./commands/update.ts";
import { registerUpgradeCommand } from "./commands/upgrade.ts";
import { registerValidateCommand } from "./commands/validate.ts";
import { accent, brand, muted, setQuiet } from "./utils/palette.ts";

export const VERSION = "0.6.0";

const rawArgs = process.argv.slice(2);

// Handle --version --json before Commander processes the flag
if (
  (rawArgs.includes("-v") || rawArgs.includes("--version")) &&
  rawArgs.includes("--json")
) {
  const platform = `${process.platform}-${process.arch}`;
  console.log(
    JSON.stringify({
      name: "@os-eco/mulch-cli",
      version: VERSION,
      runtime: "bun",
      platform,
    }),
  );
  process.exit();
}

// Apply quiet mode early so it affects all output during command execution
if (rawArgs.includes("--quiet") || rawArgs.includes("-q")) {
  setQuiet(true);
}

const program = new Command();

const COL_WIDTH = 20;

program
  .name("mulch")
  .description("Structured expertise management")
  .version(VERSION, "-v, --version", "Print version")
  .option("--json", "Output as structured JSON")
  .option("-q, --quiet", "Suppress non-error output")
  .configureHelp({
    formatHelp(cmd, helper): string {
      const lines: string[] = [];

      // Header: "mulch v0.6.0 — Structured expertise management"
      lines.push(
        `${brand.bold(cmd.name())} ${muted(`v${VERSION}`)} — Structured expertise management`,
      );
      lines.push("");

      // Usage
      lines.push(`Usage: ${chalk.dim(cmd.name())} <command> [options]`);
      lines.push("");

      // Commands
      const visibleCmds = helper.visibleCommands(cmd);
      if (visibleCmds.length > 0) {
        lines.push("Commands:");
        for (const sub of visibleCmds) {
          const term = helper.subcommandTerm(sub);
          const firstSpace = term.indexOf(" ");
          const name = firstSpace >= 0 ? term.slice(0, firstSpace) : term;
          const args = firstSpace >= 0 ? ` ${term.slice(firstSpace + 1)}` : "";
          const coloredTerm = `${chalk.green(name)}${args ? chalk.dim(args) : ""}`;
          const rawLen = term.length;
          const padding = " ".repeat(Math.max(2, COL_WIDTH - rawLen));
          lines.push(
            `  ${coloredTerm}${padding}${helper.subcommandDescription(sub)}`,
          );
        }
        lines.push("");
      }

      // Options
      const visibleOpts = helper.visibleOptions(cmd);
      if (visibleOpts.length > 0) {
        lines.push("Options:");
        for (const opt of visibleOpts) {
          const flags = helper.optionTerm(opt);
          const padding = " ".repeat(Math.max(2, COL_WIDTH - flags.length));
          lines.push(
            `  ${chalk.dim(flags)}${padding}${helper.optionDescription(opt)}`,
          );
        }
        lines.push("");
      }

      // Footer
      lines.push(
        `Run '${chalk.dim(cmd.name())} <command> --help' for command-specific help.`,
      );

      return `${lines.join("\n")}\n`;
    },
  });

// Suppress the default description header (we handle it in formatHelp)
program.addHelpCommand(false);

registerInitCommand(program);
registerAddCommand(program);
registerRecordCommand(program);
registerEditCommand(program);
registerQueryCommand(program);
registerSetupCommand(program);
registerPrimeCommand(program);
registerOnboardCommand(program);
registerStatusCommand(program);
registerValidateCommand(program);
registerPruneCommand(program);
registerSearchCommand(program);
registerOutcomeCommand(program);
registerDoctorCommand(program);
registerReadyCommand(program);
registerSyncCommand(program);
registerDeleteCommand(program);
registerLearnCommand(program);
registerCompactCommand(program);
registerDiffCommand(program);
registerUpdateCommand(program);
registerUpgradeCommand(program);

program.parse();
