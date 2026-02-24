import { existsSync } from "node:fs";
import type { Command } from "commander";
import { getMulchDir, initMulchDir } from "../utils/config.ts";
import { outputJson } from "../utils/json-output.ts";
import { brand, isQuiet } from "../utils/palette.ts";

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
        if (!isQuiet())
          console.log(
            brand("Updated .mulch/ — filled in any missing artifacts."),
          );
      } else {
        if (!isQuiet())
          console.log(brand(`Initialized .mulch/ in ${process.cwd()}`));
      }
    });
}
