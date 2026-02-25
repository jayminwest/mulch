#!/usr/bin/env bun

import chalk from "chalk";
import { Command } from "commander";
import { registerAddCommand } from "./commands/add.ts";
import { registerCompactCommand } from "./commands/compact.ts";
import { registerCompletionsCommand } from "./commands/completions.ts";
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
import { outputJsonError } from "./utils/json-output.ts";
import { accent, brand, muted, setQuiet } from "./utils/palette.ts";

export const VERSION = "0.6.2";

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

// Detect --timing early (before Commander) so we can measure from startup
const hasTiming = rawArgs.includes("--timing");
const startTime = Date.now();

const program = new Command();

const COL_WIDTH = 20;

program
  .name("mulch")
  .description("Structured expertise management")
  .showSuggestionAfterError(false)
  .version(VERSION, "-v, --version", "Print version")
  .option("--json", "Output as structured JSON")
  .option("-q, --quiet", "Suppress non-error output")
  .option("--verbose", "Show full details in output")
  .option("--timing", "Print execution time to stderr")
  .configureHelp({
    formatHelp(cmd, helper): string {
      const lines: string[] = [];

      // Header: "mulch v0.6.2 — Structured expertise management"
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
registerCompletionsCommand(program);

// --- Typo suggestions via Levenshtein distance ---

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = new Array<number>((m + 1) * (n + 1)).fill(0);
  const idx = (i: number, j: number) => i * (n + 1) + j;
  for (let i = 0; i <= m; i++) dp[idx(i, 0)] = i;
  for (let j = 0; j <= n; j++) dp[idx(0, j)] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (dp[idx(i - 1, j)] ?? 0) + 1;
      const ins = (dp[idx(i, j - 1)] ?? 0) + 1;
      const sub = (dp[idx(i - 1, j - 1)] ?? 0) + cost;
      dp[idx(i, j)] = Math.min(del, ins, sub);
    }
  }
  return dp[idx(m, n)] ?? 0;
}

function suggestCommand(input: string): string | undefined {
  const commands = program.commands.map((c) => c.name());
  let bestMatch: string | undefined;
  let bestDist = 3; // Only suggest if distance <= 2
  for (const cmd of commands) {
    const dist = editDistance(input, cmd);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = cmd;
    }
  }
  return bestMatch;
}

program.on("command:*", (operands: string[]) => {
  const unknown = operands[0] ?? "";
  const json = rawArgs.includes("--json");
  const suggestion = suggestCommand(unknown);
  if (json) {
    outputJsonError(
      unknown,
      `Unknown command: ${unknown}${suggestion ? `. Did you mean '${suggestion}'?` : ""}`,
    );
  } else {
    process.stderr.write(`Unknown command: ${unknown}\n`);
    if (suggestion) {
      process.stderr.write(`Did you mean '${suggestion}'?\n`);
    }
    process.stderr.write("Run 'mulch --help' for usage.\n");
  }
  process.exitCode = 1;
});

await program.parseAsync();

if (hasTiming) {
  const elapsed = Date.now() - startTime;
  console.error(muted(`Done in ${elapsed}ms`));
}
