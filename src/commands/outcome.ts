import chalk from "chalk";
import { type Command, Option } from "commander";
import type { Outcome } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
  readExpertiseFile,
  resolveRecordId,
  writeExpertiseFile,
} from "../utils/expertise.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

export function registerOutcomeCommand(program: Command): void {
  program
    .command("outcome")
    .argument("<domain>", "expertise domain")
    .argument("<id>", "record ID (e.g. mx-abc123, abc123, or abc)")
    .description("Append an outcome to an existing expertise record")
    .addOption(
      new Option("--status <status>", "outcome status").choices([
        "success",
        "failure",
        "partial",
      ]),
    )
    .option("--duration <ms>", "duration in milliseconds")
    .option("--agent <name>", "agent name")
    .option("--notes <text>", "notes about the outcome")
    .option("--test-results <text>", "test results summary")
    .action(
      async (domain: string, id: string, options: Record<string, unknown>) => {
        const jsonMode = program.opts().json === true;
        try {
          const config = await readConfig();

          if (!config.domains.includes(domain)) {
            if (jsonMode) {
              outputJsonError(
                "outcome",
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

          // If no --status provided, show existing outcomes for the record
          if (!options.status) {
            const records = await readExpertiseFile(filePath);
            const resolved = resolveRecordId(records, id);
            if (!resolved.ok) {
              if (jsonMode) {
                outputJsonError("outcome", resolved.error);
              } else {
                console.error(chalk.red(`Error: ${resolved.error}`));
              }
              process.exitCode = 1;
              return;
            }
            const record = resolved.record;
            const outcomes = record.outcomes ?? [];

            if (jsonMode) {
              outputJson({
                success: true,
                command: "outcome",
                domain,
                id: record.id,
                outcomes,
              });
            } else {
              if (!isQuiet()) {
                if (outcomes.length === 0) {
                  console.log(
                    chalk.dim("No outcomes recorded for this record."),
                  );
                } else {
                  console.log(
                    `${brand("Outcomes")} for ${accent(record.id ?? id)} (${outcomes.length}):`,
                  );
                  for (const [i, o] of outcomes.entries()) {
                    const statusColor =
                      o.status === "success"
                        ? chalk.green
                        : o.status === "failure"
                          ? chalk.red
                          : chalk.yellow;
                    console.log(
                      `  ${chalk.dim(`${i + 1}.`)} ${statusColor(o.status)}${o.agent ? chalk.dim(` (${o.agent})`) : ""}`,
                    );
                    if (o.duration !== undefined)
                      console.log(chalk.dim(`     duration: ${o.duration}ms`));
                    if (o.test_results)
                      console.log(chalk.dim(`     tests: ${o.test_results}`));
                    if (o.notes)
                      console.log(chalk.dim(`     notes: ${o.notes}`));
                    if (o.recorded_at)
                      console.log(chalk.dim(`     recorded: ${o.recorded_at}`));
                  }
                }
              }
            }
            return;
          }

          // Append outcome to record
          await withFileLock(filePath, async () => {
            const records = await readExpertiseFile(filePath);
            const resolved = resolveRecordId(records, id);
            if (!resolved.ok) {
              if (jsonMode) {
                outputJsonError("outcome", resolved.error);
              } else {
                console.error(chalk.red(`Error: ${resolved.error}`));
              }
              process.exitCode = 1;
              return;
            }

            const targetIndex = resolved.index;
            const record = { ...records[targetIndex] };

            const o: Outcome = {
              status: options.status as "success" | "failure" | "partial",
              recorded_at: new Date().toISOString(),
            };
            if (options.duration !== undefined) {
              o.duration = Number.parseFloat(options.duration as string);
            }
            if (options.agent) {
              o.agent = options.agent as string;
            }
            if (options.notes) {
              o.notes = options.notes as string;
            }
            if (options.testResults) {
              o.test_results = options.testResults as string;
            }

            record.outcomes = [...(record.outcomes ?? []), o];
            records[targetIndex] = record;
            await writeExpertiseFile(filePath, records);

            if (jsonMode) {
              outputJson({
                success: true,
                command: "outcome",
                action: "appended",
                domain,
                id: record.id,
                outcome: o,
                total_outcomes: record.outcomes.length,
              });
            } else {
              if (!isQuiet()) {
                const statusColor =
                  o.status === "success"
                    ? chalk.green
                    : o.status === "failure"
                      ? chalk.red
                      : chalk.yellow;
                console.log(
                  `${brand("✓")} ${brand("Outcome recorded:")} ${statusColor(o.status)}${o.agent ? chalk.dim(` (${o.agent})`) : ""} on ${accent(record.id ?? id)}`,
                );
              }
            }
          });
        } catch (err) {
          if (jsonMode) {
            outputJsonError(
              "outcome",
              err instanceof Error ? err.message : String(err),
            );
          } else {
            console.error(
              chalk.red(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
          }
          process.exitCode = 1;
        }
      },
    );
}
