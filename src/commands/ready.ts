import chalk from "chalk";
import type { Command } from "commander";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile } from "../utils/expertise.ts";
import { formatTimeAgo, getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

interface AnnotatedRecord {
  domain: string;
  record: ExpertiseRecord;
}

function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(h|d|w)$/);
  if (!match) {
    throw new Error(
      `Invalid duration: "${input}". Use format like "24h", "7d", "2w".`,
    );
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "h":
      return value * 3600000;
    case "d":
      return value * 86400000;
    case "w":
      return value * 7 * 86400000;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

export function registerReadyCommand(program: Command): void {
  program
    .command("ready")
    .description("Show recently added or updated expertise records")
    .option("--limit <n>", "maximum number of records to show", "10")
    .option("--domain <domain>", "limit to a specific domain")
    .option(
      "--since <duration>",
      "show records from the last duration (e.g. 24h, 7d, 2w)",
    )
    .action(
      async (options: { limit: string; domain?: string; since?: string }) => {
        const jsonMode = program.opts().json === true;

        try {
          const config = await readConfig();
          const limit = Number.parseInt(options.limit, 10);

          if (Number.isNaN(limit) || limit < 1) {
            if (jsonMode) {
              outputJsonError("ready", "Limit must be a positive integer.");
            } else {
              console.error(
                chalk.red("Error: --limit must be a positive integer."),
              );
            }
            process.exitCode = 1;
            return;
          }

          let domainsToCheck: string[];
          if (options.domain) {
            if (!config.domains.includes(options.domain)) {
              if (jsonMode) {
                outputJsonError(
                  "ready",
                  `Domain "${options.domain}" not found in config. Available domains: ${config.domains.join(", ")}`,
                );
              } else {
                console.error(
                  chalk.red(
                    `Error: domain "${options.domain}" not found. Available: ${config.domains.join(", ")}`,
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            domainsToCheck = [options.domain];
          } else {
            domainsToCheck = config.domains;
          }

          let sinceMs: number | undefined;
          if (options.since) {
            try {
              sinceMs = parseDuration(options.since);
            } catch (err) {
              if (jsonMode) {
                outputJsonError("ready", (err as Error).message);
              } else {
                console.error(chalk.red(`Error: ${(err as Error).message}`));
              }
              process.exitCode = 1;
              return;
            }
          }

          // Collect all records with domain annotation
          const all: AnnotatedRecord[] = [];
          for (const domain of domainsToCheck) {
            const filePath = getExpertisePath(domain);
            const records = await readExpertiseFile(filePath);
            for (const record of records) {
              all.push({ domain, record });
            }
          }

          // Sort by recorded_at descending
          all.sort((a, b) => {
            const aTime = new Date(a.record.recorded_at).getTime();
            const bTime = new Date(b.record.recorded_at).getTime();
            return bTime - aTime;
          });

          // Apply --since filter
          let filtered = all;
          if (sinceMs !== undefined) {
            const cutoff = Date.now() - sinceMs;
            filtered = all.filter((entry) => {
              return new Date(entry.record.recorded_at).getTime() >= cutoff;
            });
          }

          // Apply limit
          const entries = filtered.slice(0, limit);

          if (jsonMode) {
            outputJson({
              success: true,
              command: "ready",
              count: entries.length,
              entries: entries.map((e) => ({
                domain: e.domain,
                id: e.record.id ?? null,
                type: e.record.type,
                recorded_at: e.record.recorded_at,
                summary: getRecordSummary(e.record),
                record: e.record,
              })),
            });
          } else {
            if (entries.length === 0) {
              console.log("No recent expertise records found.");
              return;
            }

            const header = options.since
              ? `Recent Expertise (last ${options.since})`
              : `Recent Expertise (last ${entries.length} records)`;
            console.log(header);
            console.log("");

            for (const entry of entries) {
              const age = formatTimeAgo(new Date(entry.record.recorded_at));
              const id = entry.record.id
                ? chalk.dim(`${entry.record.id}  `)
                : "";
              const domain = chalk.cyan(entry.domain.padEnd(14));
              const type = chalk.yellow(`[${entry.record.type}]`.padEnd(14));
              const summary = getRecordSummary(entry.record);
              console.log(
                `  ${id}${chalk.dim(age.padEnd(10))}${domain}${type}${summary}`,
              );
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError(
                "ready",
                "No .mulch/ directory found. Run `mulch init` first.",
              );
            } else {
              console.error(
                "Error: No .mulch/ directory found. Run `mulch init` first.",
              );
            }
          } else {
            if (jsonMode) {
              outputJsonError("ready", (err as Error).message);
            } else {
              console.error(`Error: ${(err as Error).message}`);
            }
          }
          process.exitCode = 1;
        }
      },
    );
}
