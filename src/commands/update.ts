import type { Command } from "commander";
import { printWarning } from "../utils/palette.ts";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update", { hidden: true })
    .description("Deprecated: use 'upgrade' instead")
    .option("--check", "only check for updates, do not install")
    .action(async () => {
      printWarning(
        "'mulch update' is deprecated. Use 'mulch upgrade' instead.",
      );
      process.exitCode = 1;
    });
}
