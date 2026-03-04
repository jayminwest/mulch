import chalk from "chalk";
import type { Command } from "commander";
import { getMulchDir, readConfig, removeDomain } from "../utils/config.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

export function registerDeleteDomainCommand(program: Command): void {
  program
    .command("delete-domain")
    .argument("<domain>", "expertise domain to delete")
    .description("Delete an expertise domain and its records")
    .option(
      "--delete-file",
      "also delete the expertise JSONL file (default: keep file)",
      false,
    )
    .option(
      "--dry-run",
      "preview what would be deleted without making changes",
      false,
    )
    .action(
      async (
        domain: string,
        options: { deleteFile: boolean; dryRun: boolean },
      ) => {
        const jsonMode = program.opts().json === true;

        try {
          const config = await readConfig();

          if (!config.domains.includes(domain)) {
            if (jsonMode) {
              outputJsonError(
                "delete-domain",
                `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
              );
            } else {
              console.error(
                chalk.red(`Error: domain "${domain}" not found in config.`),
              );
              console.error(
                chalk.red(
                  `Hint: Run \`mulch add ${domain}\` to create it, or check \`mulch status\` for existing domains.`,
                ),
              );
            }
            process.exitCode = 1;
            return;
          }

          if (options.dryRun) {
            if (jsonMode) {
              outputJson({
                success: true,
                command: "delete-domain",
                domain,
                dryRun: true,
                deleteFile: options.deleteFile,
              });
            } else {
              if (!isQuiet()) {
                const fileNote = options.deleteFile
                  ? " (and delete expertise file)"
                  : " (expertise file kept)";
                console.log(
                  `${chalk.yellow("[DRY RUN]")} Would remove domain ${accent(domain)} from config${fileNote}.`,
                );
              }
            }
            return;
          }

          await removeDomain(domain, process.cwd(), options.deleteFile);

          if (jsonMode) {
            outputJson({
              success: true,
              command: "delete-domain",
              domain,
              deletedFile: options.deleteFile,
            });
          } else {
            if (!isQuiet()) {
              const fileNote = options.deleteFile
                ? " and deleted expertise file"
                : "";
              console.log(
                `${brand("✓")} ${brand("Removed domain")} ${accent(domain)}${fileNote}.`,
              );
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError(
                "delete-domain",
                "No .mulch/ directory found. Run `mulch init` first.",
              );
            } else {
              console.error(
                chalk.red(
                  "Error: No .mulch/ directory found. Run `mulch init` first.",
                ),
              );
            }
          } else {
            if (jsonMode) {
              outputJsonError("delete-domain", (err as Error).message);
            } else {
              console.error(chalk.red(`Error: ${(err as Error).message}`));
            }
          }
          process.exitCode = 1;
        }
      },
    );
}
