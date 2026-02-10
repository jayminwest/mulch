import { Command, Option } from "commander";
import _Ajv from "ajv";
const Ajv = _Ajv.default ?? _Ajv;
import chalk from "chalk";
import { readConfig, getExpertisePath } from "../utils/config.js";
import {
  readExpertiseFile,
  writeExpertiseFile,
  resolveRecordId,
} from "../utils/expertise.js";
import { recordSchema } from "../schemas/record-schema.js";
import type { Classification } from "../schemas/record.js";
import { outputJson, outputJsonError } from "../utils/json-output.js";

export function registerEditCommand(program: Command): void {
  program
    .command("edit")
    .argument("<domain>", "expertise domain")
    .argument("<id>", "record ID (e.g. mx-abc123, abc123, or abc)")
    .description("Edit an existing expertise record")
    .addOption(
      new Option(
        "--classification <classification>",
        "update classification",
      ).choices(["foundational", "tactical", "observational"]),
    )
    .option("--content <content>", "update content (convention)")
    .option("--name <name>", "update name (pattern)")
    .option("--description <description>", "update description")
    .option("--resolution <resolution>", "update resolution (failure)")
    .option("--title <title>", "update title (decision)")
    .option("--rationale <rationale>", "update rationale (decision)")
    .option("--files <files>", "update related files (comma-separated)")
    .option("--relates-to <ids>", "update linked record IDs (comma-separated)")
    .option("--supersedes <ids>", "update superseded record IDs (comma-separated)")
    .action(
      async (
        domain: string,
        id: string,
        options: Record<string, unknown>,
      ) => {
        const jsonMode = program.opts().json === true;
        try {
          const config = await readConfig();

          if (!config.domains.includes(domain)) {
            if (jsonMode) {
              outputJsonError("edit", `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`);
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
          const records = await readExpertiseFile(filePath);

          const resolved = resolveRecordId(records, id);
          if (!resolved.ok) {
            if (jsonMode) {
              outputJsonError("edit", resolved.error);
            } else {
              console.error(chalk.red(`Error: ${resolved.error}`));
            }
            process.exitCode = 1;
            return;
          }
          const targetIndex = resolved.index;

          const record = { ...records[targetIndex] };

          // Apply updates based on record type
          if (options.classification) {
            record.classification = options.classification as Classification;
          }
          if (typeof options.relatesTo === "string") {
            record.relates_to = options.relatesTo
              .split(",")
              .map((id: string) => id.trim())
              .filter(Boolean);
          }
          if (typeof options.supersedes === "string") {
            record.supersedes = options.supersedes
              .split(",")
              .map((id: string) => id.trim())
              .filter(Boolean);
          }

          switch (record.type) {
            case "convention":
              if (options.content) {
                record.content = options.content as string;
              }
              break;
            case "pattern":
              if (options.name) {
                record.name = options.name as string;
              }
              if (options.description) {
                record.description = options.description as string;
              }
              if (typeof options.files === "string") {
                record.files = (options.files as string).split(",");
              }
              break;
            case "failure":
              if (options.description) {
                record.description = options.description as string;
              }
              if (options.resolution) {
                record.resolution = options.resolution as string;
              }
              break;
            case "decision":
              if (options.title) {
                record.title = options.title as string;
              }
              if (options.rationale) {
                record.rationale = options.rationale as string;
              }
              break;
            case "reference":
              if (options.name) {
                record.name = options.name as string;
              }
              if (options.description) {
                record.description = options.description as string;
              }
              if (typeof options.files === "string") {
                record.files = (options.files as string).split(",");
              }
              break;
            case "guide":
              if (options.name) {
                record.name = options.name as string;
              }
              if (options.description) {
                record.description = options.description as string;
              }
              break;
          }

          // Validate the updated record
          const ajv = new Ajv();
          const validate = ajv.compile(recordSchema);
          if (!validate(record)) {
            const errors = (validate.errors ?? []).map((err) => `${err.instancePath} ${err.message}`);
            if (jsonMode) {
              outputJsonError("edit", `Updated record failed schema validation: ${errors.join("; ")}`);
            } else {
              console.error(
                chalk.red("Error: updated record failed schema validation:"),
              );
              for (const err of validate.errors ?? []) {
                console.error(
                  chalk.red(`  ${err.instancePath} ${err.message}`),
                );
              }
            }
            process.exitCode = 1;
            return;
          }

          records[targetIndex] = record;
          await writeExpertiseFile(filePath, records);

          if (jsonMode) {
            outputJson({
              success: true,
              command: "edit",
              domain,
              id: record.id ?? null,
              type: record.type,
              record,
            });
          } else {
            console.log(
              chalk.green(
                `\u2714 Updated ${record.type} ${record.id ?? ""} in ${domain}`,
              ),
            );
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError("edit", "No .mulch/ directory found. Run `mulch init` first.");
            } else {
              console.error(
                "Error: No .mulch/ directory found. Run `mulch init` first.",
              );
            }
          } else {
            if (jsonMode) {
              outputJsonError("edit", (err as Error).message);
            } else {
              console.error(`Error: ${(err as Error).message}`);
            }
          }
          process.exitCode = 1;
        }
      },
    );
}
