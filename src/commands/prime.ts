import { Command } from "commander";
import { readConfig, getExpertisePath } from "../utils/config.js";
import { readExpertiseFile, getFileModTime } from "../utils/expertise.js";
import { formatDomainExpertise, formatPrimeOutput } from "../utils/format.js";

export function registerPrimeCommand(program: Command): void {
  program
    .command("prime")
    .description("Generate a priming prompt from expertise records")
    .option("--full", "include full record details")
    .option("--mcp", "output in MCP-compatible format")
    .option("--export", "export to file")
    .action(async (_options: Record<string, unknown>) => {
      try {
        const config = await readConfig();

        const domainSections: string[] = [];
        for (const domain of config.domains) {
          const filePath = getExpertisePath(domain);
          const records = await readExpertiseFile(filePath);
          const lastUpdated = await getFileModTime(filePath);

          domainSections.push(formatDomainExpertise(domain, records, lastUpdated));
        }

        console.log(formatPrimeOutput(domainSections));
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
