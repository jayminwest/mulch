import { Command } from "commander";
import { readConfig, getExpertisePath } from "../utils/config.js";
import { readExpertiseFile, getFileModTime, filterByType } from "../utils/expertise.js";
import { formatDomainExpertise } from "../utils/format.js";

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .argument("[domain]", "expertise domain to query")
    .description("Query expertise records")
    .option("--type <type>", "filter by record type")
    .option("--all", "show all domains")
    .action(async (domain: string | undefined, options: Record<string, unknown>) => {
      try {
        const config = await readConfig();

        const domainsToQuery: string[] = [];

        if (options.all) {
          domainsToQuery.push(...config.domains);
          if (domainsToQuery.length === 0) {
            console.log("No domains configured. Run `mulch add <domain>` to get started.");
            return;
          }
        } else if (domain) {
          if (!config.domains.includes(domain)) {
            console.error(`Error: Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`);
            process.exitCode = 1;
            return;
          }
          domainsToQuery.push(domain);
        } else {
          console.error("Error: Please specify a domain or use --all to query all domains.");
          process.exitCode = 1;
          return;
        }

        const sections: string[] = [];
        for (const d of domainsToQuery) {
          const filePath = getExpertisePath(d);
          let records = await readExpertiseFile(filePath);
          const lastUpdated = await getFileModTime(filePath);

          if (options.type) {
            records = filterByType(records, options.type as string);
          }

          sections.push(formatDomainExpertise(d, records, lastUpdated));
        }

        console.log(sections.join("\n\n"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.error("Error: No .mulch/ directory found. Run `mulch init` first.");
        } else {
          console.error(`Error: ${(err as Error).message}`);
        }
        process.exitCode = 1;
      }
    });
}
