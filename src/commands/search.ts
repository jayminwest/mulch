import { Command, Option } from "commander";
import { readConfig, getExpertisePath } from "../utils/config.js";
import { readExpertiseFile, getFileModTime, filterByType, filterByClassification, filterByFile } from "../utils/expertise.js";
import { searchRecords } from "../utils/expertise.js";
import { formatDomainExpertise } from "../utils/format.js";
import { outputJson, outputJsonError } from "../utils/json-output.js";
import { sortByConfirmationScore, type ScoredRecord } from "../utils/scoring.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .argument("[query]", "search string (case-insensitive substring match)")
    .description("Search expertise records across domains")
    .option("--domain <domain>", "limit search to a specific domain")
    .addOption(
      new Option("--type <type>", "filter by record type").choices([
        "convention",
        "pattern",
        "failure",
        "decision",
        "reference",
        "guide",
      ]),
    )
    .option("--tag <tag>", "filter by tag")
    .addOption(
      new Option("--classification <classification>", "filter by classification").choices([
        "foundational",
        "tactical",
        "observational",
      ]),
    )
    .option("--file <file>", "filter by associated file path (substring match)")
    .addOption(
      new Option("--outcome-status <status>", "filter by outcome status").choices(["success", "failure", "partial"]),
    )
    .option("--sort-by-score", "sort results by confirmation-frequency score (highest first)")
    .action(
      async (
        query: string | undefined,
        options: { domain?: string; type?: string; tag?: string; classification?: string; file?: string; outcomeStatus?: string; sortByScore?: boolean },
      ) => {
        const jsonMode = program.opts().json === true;
        try {
          if (!query && !options.type && !options.domain && !options.tag && !options.classification && !options.file && !options.outcomeStatus) {
            if (jsonMode) {
              outputJsonError("search", "Provide a search query or use --type, --domain, --tag, --classification, --file, or --outcome-status to filter.");
            } else {
              console.error("Error: Provide a search query or use --type, --domain, --tag, --classification, --file, or --outcome-status to filter.");
            }
            process.exitCode = 1;
            return;
          }

          const config = await readConfig();

          let domainsToSearch: string[];

          if (options.domain) {
            if (!config.domains.includes(options.domain)) {
              if (jsonMode) {
                outputJsonError("search", `Domain "${options.domain}" not found in config. Available domains: ${config.domains.join(", ")}`);
              } else {
                console.error(
                  `Error: Domain "${options.domain}" not found in config. Available domains: ${config.domains.join(", ")}`,
                );
              }
              process.exitCode = 1;
              return;
            }
            domainsToSearch = [options.domain];
          } else {
            domainsToSearch = config.domains;
          }

          let totalMatches = 0;

          if (jsonMode) {
            const result: Array<{ domain: string; matches: unknown[] }> = [];
            for (const domain of domainsToSearch) {
              const filePath = getExpertisePath(domain);
              let records = await readExpertiseFile(filePath);
              if (options.type) {
                records = filterByType(records, options.type);
              }
              if (options.tag) {
                const tagLower = options.tag.toLowerCase();
                records = records.filter((r) =>
                  r.tags?.some((t) => t.toLowerCase() === tagLower),
                );
              }
              if (options.classification) {
                records = filterByClassification(records, options.classification);
              }
              if (options.file) {
                records = filterByFile(records, options.file);
              }
              if (options.outcomeStatus) {
                records = records.filter((r) => r.outcomes?.some((o) => o.status === options.outcomeStatus));
              }
              let matches = query ? searchRecords(records, query) : records;
              if (options.sortByScore) {
                matches = sortByConfirmationScore(matches as ScoredRecord[]);
              }
              if (matches.length > 0) {
                totalMatches += matches.length;
                result.push({ domain, matches });
              }
            }
            outputJson({
              success: true,
              command: "search",
              query: query ?? null,
              total: totalMatches,
              domains: result,
            });
          } else {
            const sections: string[] = [];
            for (const domain of domainsToSearch) {
              const filePath = getExpertisePath(domain);
              let records = await readExpertiseFile(filePath);
              const lastUpdated = await getFileModTime(filePath);
              if (options.type) {
                records = filterByType(records, options.type);
              }
              if (options.tag) {
                const tagLower = options.tag.toLowerCase();
                records = records.filter((r) =>
                  r.tags?.some((t) => t.toLowerCase() === tagLower),
                );
              }
              if (options.classification) {
                records = filterByClassification(records, options.classification);
              }
              if (options.file) {
                records = filterByFile(records, options.file);
              }
              if (options.outcomeStatus) {
                records = records.filter((r) => r.outcomes?.some((o) => o.status === options.outcomeStatus));
              }
              let matches = query ? searchRecords(records, query) : records;
              if (options.sortByScore) {
                matches = sortByConfirmationScore(matches as ScoredRecord[]);
              }
              if (matches.length > 0) {
                totalMatches += matches.length;
                sections.push(
                  formatDomainExpertise(domain, matches, lastUpdated),
                );
              }
            }

            const label = query ? `matching "${query}"` : "matching filters";
            if (sections.length === 0) {
              console.log(`No records ${label} found.`);
            } else {
              console.log(sections.join("\n\n"));
              console.log(`\n${totalMatches} match${totalMatches === 1 ? "" : "es"} found.`);
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError("search", "No .mulch/ directory found. Run `mulch init` first.");
            } else {
              console.error(
                "Error: No .mulch/ directory found. Run `mulch init` first.",
              );
            }
          } else {
            if (jsonMode) {
              outputJsonError("search", (err as Error).message);
            } else {
              console.error(`Error: ${(err as Error).message}`);
            }
          }
          process.exitCode = 1;
        }
      },
    );
}
