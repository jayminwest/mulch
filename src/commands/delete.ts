import { Command } from "commander";
import chalk from "chalk";
import { readConfig, getExpertisePath } from "../utils/config.js";
import {
  readExpertiseFile,
  writeExpertiseFile,
  resolveRecordId,
} from "../utils/expertise.js";
import { withFileLock } from "../utils/lock.js";
import { getRecordSummary } from "../utils/format.js";
import { outputJson, outputJsonError } from "../utils/json-output.js";

export function registerDeleteCommand(program: Command): void {
  program
    .command("delete")
    .argument("<domain>", "expertise domain")
    .argument("<id>", "record ID (e.g. mx-abc123, abc123, or abc)")
    .description("Delete an expertise record")
    .action(
      async (domain: string, id: string) => {
        const jsonMode = program.opts().json === true;
        try {
          const config = await readConfig();

          if (!config.domains.includes(domain)) {
            if (jsonMode) {
              outputJsonError("delete", `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`);
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
              console.log(
                chalk.green(
                  `✔ Deleted ${deleted.type} ${deleted.id ?? ""} from ${domain}: ${getRecordSummary(deleted)}`,
                ),
              );
            }
          });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError("delete", "No .mulch/ directory found. Run `mulch init` first.");
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
      },
    );
}
