import { type Command, Option } from "commander";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
  filterByClassification,
  filterByFile,
  filterByType,
  getFileModTime,
  readExpertiseFile,
} from "../utils/expertise.ts";
import { formatDomainExpertise } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import {
  type ScoredRecord,
  sortByConfirmationScore,
} from "../utils/scoring.ts";

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .argument("[domain]", "expertise domain to query")
    .description("Query expertise records")
    .option("--type <type>", "filter by record type")
    .addOption(
      new Option(
        "--classification <classification>",
        "filter by classification",
      ).choices(["foundational", "tactical", "observational"]),
    )
    .option("--file <file>", "filter by associated file path (substring match)")
    .addOption(
      new Option(
        "--outcome-status <status>",
        "filter by outcome status",
      ).choices(["success", "failure"]),
    )
    .option(
      "--sort-by-score",
      "sort results by confirmation-frequency score (highest first)",
    )
    .option("--all", "show all domains")
    .action(
      async (domain: string | undefined, options: Record<string, unknown>) => {
        const jsonMode = program.opts().json === true;
        try {
          const config = await readConfig();

          const domainsToQuery: string[] = [];

          if (options.all) {
            domainsToQuery.push(...config.domains);
            if (domainsToQuery.length === 0) {
              if (jsonMode) {
                outputJson({ success: true, command: "query", domains: [] });
              } else {
                console.log(
                  "No domains configured. Run `mulch add <domain>` to get started.",
                );
              }
              return;
            }
          } else if (domain) {
            if (!config.domains.includes(domain)) {
              if (jsonMode) {
                outputJsonError(
                  "query",
                  `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
                );
              } else {
                console.error(
                  `Error: Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
                );
                console.error(
                  `Hint: Run \`mulch add ${domain}\` to create this domain, or check .mulch/mulch.config.yaml`,
                );
              }
              process.exitCode = 1;
              return;
            }
            domainsToQuery.push(domain);
          } else {
            if (jsonMode) {
              outputJsonError(
                "query",
                "Please specify a domain or use --all to query all domains.",
              );
            } else {
              console.error(
                "Error: Please specify a domain or use --all to query all domains.",
              );
            }
            process.exitCode = 1;
            return;
          }

          if (jsonMode) {
            const result: Array<{ domain: string; records: unknown[] }> = [];
            for (const d of domainsToQuery) {
              const filePath = getExpertisePath(d);
              let records = await readExpertiseFile(filePath);
              if (options.type) {
                records = filterByType(records, options.type as string);
              }
              if (options.classification) {
                records = filterByClassification(
                  records,
                  options.classification as string,
                );
              }
              if (options.file) {
                records = filterByFile(records, options.file as string);
              }
              if (options.outcomeStatus) {
                records = records.filter((r) =>
                  r.outcomes?.some(
                    (o) => o.status === (options.outcomeStatus as string),
                  ),
                );
              }
              if (options.sortByScore) {
                records = sortByConfirmationScore(records as ScoredRecord[]);
              }
              result.push({ domain: d, records });
            }
            outputJson({ success: true, command: "query", domains: result });
          } else {
            const sections: string[] = [];
            for (const d of domainsToQuery) {
              const filePath = getExpertisePath(d);
              let records = await readExpertiseFile(filePath);
              const lastUpdated = await getFileModTime(filePath);
              if (options.type) {
                records = filterByType(records, options.type as string);
              }
              if (options.classification) {
                records = filterByClassification(
                  records,
                  options.classification as string,
                );
              }
              if (options.file) {
                records = filterByFile(records, options.file as string);
              }
              if (options.outcomeStatus) {
                records = records.filter((r) =>
                  r.outcomes?.some(
                    (o) => o.status === (options.outcomeStatus as string),
                  ),
                );
              }
              if (options.sortByScore) {
                records = sortByConfirmationScore(records as ScoredRecord[]);
              }
              sections.push(formatDomainExpertise(d, records, lastUpdated));
            }
            console.log(sections.join("\n\n"));
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError(
                "query",
                "No .mulch/ directory found. Run `mulch init` first.",
              );
            } else {
              console.error(
                "Error: No .mulch/ directory found. Run `mulch init` first.",
              );
            }
          } else {
            if (jsonMode) {
              outputJsonError("query", (err as Error).message);
            } else {
              console.error(`Error: ${(err as Error).message}`);
            }
          }
          process.exitCode = 1;
        }
      },
    );
}
