import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import chalk from "chalk";
import type { Command } from "commander";
import { recordSchema } from "../schemas/record-schema.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate expertise records against schemas")
    .action(async () => {
      const jsonMode = program.opts().json === true;
      const config = await readConfig();
      const domains = config.domains;

      const ajv = new Ajv();
      const validate = ajv.compile(recordSchema);

      let totalRecords = 0;
      let totalErrors = 0;
      let totalWarnings = 0;
      const errors: Array<{ domain: string; line: number; message: string }> =
        [];
      const warnings: Array<{ domain: string; line: number; message: string }> =
        [];

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
            const msg = "Invalid JSON: failed to parse";
            errors.push({ domain, line: lineNumber, message: msg });
            if (!jsonMode) {
              console.error(chalk.red(`${domain}:${lineNumber} - ${msg}`));
            }
            continue;
          }

          // Detect legacy singular "outcome" field — warn, don't error
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            "outcome" in parsed &&
            !("outcomes" in parsed)
          ) {
            totalWarnings++;
            const msg =
              'Legacy "outcome" field (singular); run `mulch doctor --fix` to migrate to "outcomes[]"';
            warnings.push({ domain, line: lineNumber, message: msg });
            if (!jsonMode) {
              console.error(chalk.yellow(`${domain}:${lineNumber} - ${msg}`));
            }
          } else if (!validate(parsed)) {
            totalErrors++;
            const schemaErrors = (validate.errors ?? [])
              .map((err) => `${err.instancePath} ${err.message}`)
              .join("; ");
            const msg = `Schema validation failed: ${schemaErrors}`;
            errors.push({ domain, line: lineNumber, message: msg });
            if (!jsonMode) {
              console.error(
                chalk.red(
                  `${domain}:${lineNumber} - Schema validation failed:`,
                ),
              );
              for (const err of validate.errors ?? []) {
                console.error(
                  chalk.red(`  ${err.instancePath} ${err.message}`),
                );
              }
            }
          }
        }
      }

      if (jsonMode) {
        outputJson({
          success: totalErrors === 0,
          command: "validate",
          valid: totalErrors === 0,
          totalRecords,
          totalErrors,
          totalWarnings,
          errors,
          warnings,
        });
      } else if (totalErrors > 0) {
        console.log(
          chalk.red(
            `${totalRecords} records validated, ${totalErrors} errors found`,
          ),
        );
      } else if (totalWarnings > 0) {
        console.log(
          chalk.yellow(
            `${totalRecords} records validated, ${totalErrors} errors found, ${totalWarnings} warning(s)`,
          ),
        );
      } else {
        console.log(
          chalk.green(
            `${totalRecords} records validated, ${totalErrors} errors found`,
          ),
        );
      }

      if (totalErrors > 0) {
        process.exitCode = 1;
      }
    });
}
