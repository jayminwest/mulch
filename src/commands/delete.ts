import chalk from "chalk";
import type { Command } from "commander";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
  readExpertiseFile,
  resolveRecordId,
  writeExpertiseFile,
} from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

export function registerDeleteCommand(program: Command): void {
  program
    .command("delete")
    .argument("<domain>", "expertise domain")
    .argument("<id>", "record ID (e.g. mx-abc123, abc123, or abc)")
    .description("Delete an expertise record")
    .action(async (domain: string, id: string) => {
      const jsonMode = program.opts().json === true;
      try {
        const config = await readConfig();

        if (!config.domains.includes(domain)) {
          if (jsonMode) {
            outputJsonError(
              "delete",
              `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
            );
          } else {
            console.error(
              chalk.red(`Error: domain "${domain}" not found in config.`),
            );
            console.error(
              chalk.red(
                `Available domains: ${config.domains.join(", ") || "(none)"}`,
              ),
            );
          }
          process.exitCode = 1;
          return;
        }

        const filePath = getExpertisePath(domain);
        await withFileLock(filePath, async () => {
          const records = await readExpertiseFile(filePath);

          const resolved = resolveRecordId(records, id);
          if (!resolved.ok) {
            if (jsonMode) {
              outputJsonError("delete", resolved.error);
            } else {
              console.error(chalk.red(`Error: ${resolved.error}`));
            }
            process.exitCode = 1;
            return;
          }
          const targetIndex = resolved.index;

          const deleted = records[targetIndex];
          records.splice(targetIndex, 1);
          await writeExpertiseFile(filePath, records);

          if (jsonMode) {
            outputJson({
              success: true,
              command: "delete",
              domain,
              id: deleted.id ?? null,
              type: deleted.type,
              summary: getRecordSummary(deleted),
            });
          } else {
            if (!isQuiet()) {
              const id = deleted.id ? ` ${accent(deleted.id)}` : "";
              console.log(
                `${brand("✓")} ${brand(`Deleted ${deleted.type}`)}${id} ${brand(`from ${domain}`)}: ${getRecordSummary(deleted)}`,
              );
            }
          }
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          if (jsonMode) {
            outputJsonError(
              "delete",
              "No .mulch/ directory found. Run `mulch init` first.",
            );
          } else {
            console.error(
              "Error: No .mulch/ directory found. Run `mulch init` first.",
            );
          }
        } else {
          if (jsonMode) {
            outputJsonError("delete", (err as Error).message);
          } else {
            console.error(`Error: ${(err as Error).message}`);
          }
        }
        process.exitCode = 1;
      }
    });
}
