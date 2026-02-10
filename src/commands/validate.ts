import { Command } from "commander";
import { readFile } from "node:fs/promises";
import _Ajv from "ajv";
const Ajv = _Ajv.default ?? _Ajv;
import chalk from "chalk";
import { readConfig, getExpertisePath } from "../utils/config.js";
import { recordSchema } from "../schemas/record-schema.js";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate expertise records against schemas")
    .action(async () => {
      const config = await readConfig();
      const domains = config.domains;

      const ajv = new Ajv();
      const validate = ajv.compile(recordSchema);

      let totalRecords = 0;
      let totalErrors = 0;

      for (const domain of domains) {
        const filePath = getExpertisePath(domain);
        let content: string;
        try {
          content = await readFile(filePath, "utf-8");
        } catch {
          // File doesn't exist yet, skip
          continue;
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.length === 0) continue;

          totalRecords++;
          const lineNumber = i + 1;

          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            totalErrors++;
            console.error(
              chalk.red(
                `${domain}:${lineNumber} - Invalid JSON: failed to parse`,
              ),
            );
            continue;
          }

          if (!validate(parsed)) {
            totalErrors++;
            console.error(
              chalk.red(`${domain}:${lineNumber} - Schema validation failed:`),
            );
            for (const err of validate.errors ?? []) {
              console.error(
                chalk.red(`  ${err.instancePath} ${err.message}`),
              );
            }
          }
        }
      }

      if (totalErrors > 0) {
        console.log(
          chalk.red(
            `${totalRecords} records validated, ${totalErrors} errors found`,
          ),
        );
        process.exit(1);
      } else {
        console.log(
          chalk.green(
            `${totalRecords} records validated, ${totalErrors} errors found`,
          ),
        );
      }
    });
}
