import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { type Command, Option } from "commander";
import {
  DEFAULT_BUDGET,
  applyBudget,
  formatBudgetSummary,
} from "../utils/budget.ts";
import type { DomainRecords } from "../utils/budget.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { getFileModTime, readExpertiseFile } from "../utils/expertise.ts";
import {
  formatDomainExpertise,
  formatDomainExpertiseCompact,
  formatDomainExpertisePlain,
  formatDomainExpertiseXml,
  formatMcpOutput,
  formatPrimeOutput,
  formatPrimeOutputCompact,
  formatPrimeOutputPlain,
  formatPrimeOutputXml,
  getSessionEndReminder,
} from "../utils/format.ts";
import type { McpDomain, PrimeFormat } from "../utils/format.ts";
import { filterByContext, getChangedFiles, isGitRepo } from "../utils/git.ts";
import { outputJsonError } from "../utils/json-output.ts";

interface PrimeOptions {
  full?: boolean;
  verbose?: boolean;
  mcp?: boolean;
  format?: PrimeFormat;
  export?: string;
  domain?: string[];
  excludeDomain?: string[];
  context?: boolean;
  files?: string[];
  budget?: string;
  noLimit?: boolean;
}

/**
 * Produce a rough text representation of a record for token estimation.
 * Uses a simple format similar to compact lines.
 */
function estimateRecordText(
  record: import("../schemas/record.js").ExpertiseRecord,
): string {
  switch (record.type) {
    case "convention":
      return `[convention] ${record.content}`;
    case "pattern": {
      const files =
        record.files && record.files.length > 0
          ? ` (${record.files.join(", ")})`
          : "";
      return `[pattern] ${record.name}: ${record.description}${files}`;
    }
    case "failure":
      return `[failure] ${record.description} -> ${record.resolution}`;
    case "decision":
      return `[decision] ${record.title}: ${record.rationale}`;
    case "reference": {
      const refFiles =
        record.files && record.files.length > 0
          ? `: ${record.files.join(", ")}`
          : `: ${record.description}`;
      return `[reference] ${record.name}${refFiles}`;
    }
    case "guide":
      return `[guide] ${record.name}: ${record.description}`;
  }
}

export function registerPrimeCommand(program: Command): void {
  program
    .command("prime")
    .description("Generate a priming prompt from expertise records")
    .argument("[domains...]", "optional domain(s) to scope output to")
    .option("--full", "include full record details (classification, evidence)")
    .option(
      "-v, --verbose",
      "full output with section headers and recording instructions",
    )
    .option("--mcp", "output in MCP-compatible JSON format")
    .option("--domain <domains...>", "domain(s) to include")
    .option("--exclude-domain <domains...>", "domain(s) to exclude")
    .addOption(
      new Option("--format <format>", "output format")
        .choices(["markdown", "xml", "plain"])
        .default("markdown"),
    )
    .option(
      "--context",
      "filter records to only those relevant to changed files",
    )
    .option(
      "--files <paths...>",
      "filter records to only those relevant to specified files",
    )
    .option("--export <path>", "export output to a file")
    .option(
      "--budget <tokens>",
      `token budget for output (default: ${DEFAULT_BUDGET})`,
    )
    .option("--no-limit", "disable token budget limit")
    .action(async (domainsArg: string[], options: PrimeOptions) => {
      const jsonMode = program.opts().json === true;
      try {
        const config = await readConfig();
        const format = options.format ?? "markdown";

        const requested = [...domainsArg, ...(options.domain ?? [])];
        const unique = [...new Set(requested)];

        for (const d of unique) {
          if (!config.domains.includes(d)) {
            if (jsonMode) {
              outputJsonError(
                "prime",
                `Domain "${d}" not found in config. Available domains: ${config.domains.join(", ")}`,
              );
            } else {
              console.error(
                `Error: Domain "${d}" not found in config. Available domains: ${config.domains.join(", ")}`,
              );
            }
            process.exitCode = 1;
            return;
          }
        }

        const excluded = options.excludeDomain ?? [];
        for (const d of excluded) {
          if (!config.domains.includes(d)) {
            if (jsonMode) {
              outputJsonError(
                "prime",
                `Excluded domain "${d}" not found in config. Available domains: ${config.domains.join(", ")}`,
              );
            } else {
              console.error(
                `Error: Excluded domain "${d}" not found in config. Available domains: ${config.domains.join(", ")}`,
              );
            }
            process.exitCode = 1;
            return;
          }
        }

        let targetDomains = unique.length > 0 ? unique : config.domains;

        targetDomains = targetDomains.filter((d) => !excluded.includes(d));

        // Resolve changed files for --context or --files filtering
        let filesToFilter: string[] | undefined;
        if (options.context) {
          const cwd = process.cwd();
          if (!isGitRepo(cwd)) {
            const msg = "Not in a git repository. --context requires git.";
            if (jsonMode) {
              outputJsonError("prime", msg);
            } else {
              console.error(`Error: ${msg}`);
            }
            process.exitCode = 1;
            return;
          }
          filesToFilter = getChangedFiles(cwd, "HEAD~1");
          if (filesToFilter.length === 0) {
            if (jsonMode) {
              outputJsonError(
                "prime",
                "No changed files found. Nothing to filter by.",
              );
            } else {
              console.log("No changed files found. Nothing to filter by.");
            }
            return;
          }
        } else if (options.files && options.files.length > 0) {
          filesToFilter = options.files;
        }

        // Determine budget settings
        const isMachineOutput = options.mcp === true || jsonMode;
        const budgetEnabled = !isMachineOutput && options.noLimit !== true;
        const budget = options.budget
          ? Number.parseInt(options.budget, 10)
          : DEFAULT_BUDGET;

        let output: string;

        if (isMachineOutput) {
          // --json and --mcp produce the same structured output — no budget
          const domains: McpDomain[] = [];
          for (const domain of targetDomains) {
            const filePath = getExpertisePath(domain);
            let records = await readExpertiseFile(filePath);
            if (filesToFilter) {
              records = filterByContext(records, filesToFilter);
            }
            if (!filesToFilter || records.length > 0) {
              domains.push({ domain, entry_count: records.length, records });
            }
          }
          output = formatMcpOutput(domains);
        } else {
          // Load all records per domain
          const allDomainRecords: DomainRecords[] = [];
          const modTimes = new Map<string, Date | null>();

          for (const domain of targetDomains) {
            const filePath = getExpertisePath(domain);
            let records = await readExpertiseFile(filePath);
            if (filesToFilter) {
              records = filterByContext(records, filesToFilter);
              if (records.length === 0) continue;
            }
            allDomainRecords.push({ domain, records });
            const lastUpdated = await getFileModTime(filePath);
            modTimes.set(domain, lastUpdated);
          }

          // Apply budget filtering
          let domainRecordsToFormat: DomainRecords[];
          let droppedCount = 0;
          let droppedDomainCount = 0;

          if (budgetEnabled) {
            const result = applyBudget(allDomainRecords, budget, (record) =>
              estimateRecordText(record),
            );
            domainRecordsToFormat = result.kept;
            droppedCount = result.droppedCount;
            droppedDomainCount = result.droppedDomainCount;
          } else {
            domainRecordsToFormat = allDomainRecords;
          }

          // Format domain sections
          const domainSections: string[] = [];
          for (const { domain, records } of domainRecordsToFormat) {
            const lastUpdated = modTimes.get(domain) ?? null;

            if (options.verbose || options.full || format !== "markdown") {
              switch (format) {
                case "xml":
                  domainSections.push(
                    formatDomainExpertiseXml(domain, records, lastUpdated),
                  );
                  break;
                case "plain":
                  domainSections.push(
                    formatDomainExpertisePlain(domain, records, lastUpdated),
                  );
                  break;
                default:
                  domainSections.push(
                    formatDomainExpertise(domain, records, lastUpdated, {
                      full: options.full,
                    }),
                  );
                  break;
              }
            } else {
              domainSections.push(
                formatDomainExpertiseCompact(domain, records, lastUpdated),
              );
            }
          }

          if (options.verbose || options.full || format !== "markdown") {
            switch (format) {
              case "xml":
                output = formatPrimeOutputXml(domainSections);
                break;
              case "plain":
                output = formatPrimeOutputPlain(domainSections);
                break;
              default:
                output = formatPrimeOutput(domainSections);
                break;
            }
          } else {
            output = formatPrimeOutputCompact(domainSections);
          }

          // Append truncation summary before session reminder
          if (droppedCount > 0) {
            output += `\n\n${formatBudgetSummary(droppedCount, droppedDomainCount)}`;
          }

          output += `\n\n${getSessionEndReminder(format)}`;
        }

        if (options.export) {
          await writeFile(options.export, `${output}\n`, "utf-8");
          if (!jsonMode) {
            console.log(chalk.green(`Exported to ${options.export}`));
          }
        } else {
          console.log(output);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          if (jsonMode) {
            outputJsonError(
              "prime",
              "No .mulch/ directory found. Run `mulch init` first.",
            );
          } else {
            console.error(
              "Error: No .mulch/ directory found. Run `mulch init` first.",
            );
          }
        } else {
          if (jsonMode) {
            outputJsonError("prime", (err as Error).message);
          } else {
            console.error(`Error: ${(err as Error).message}`);
          }
        }
        process.exitCode = 1;
      }
    });
}
