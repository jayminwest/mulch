import { Command, Option } from "commander";
import _Ajv from "ajv";
const Ajv = _Ajv.default ?? _Ajv;
import chalk from "chalk";
import { readConfig, getExpertisePath } from "../utils/config.js";
import {
  appendRecord,
  readExpertiseFile,
  writeExpertiseFile,
  findDuplicate,
} from "../utils/expertise.js";
import { withFileLock } from "../utils/lock.js";
import { recordSchema } from "../schemas/record-schema.js";
import type {
  ExpertiseRecord,
  RecordType,
  Classification,
  Evidence,
} from "../schemas/record.js";
import { outputJson, outputJsonError } from "../utils/json-output.js";

export function registerRecordCommand(program: Command): void {
  program
    .command("record")
    .argument("<domain>", "expertise domain")
    .argument("[content]", "record content")
    .description("Record an expertise record")
    .addOption(
      new Option("--type <type>", "record type")
        .choices(["convention", "pattern", "failure", "decision", "reference", "guide"])
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--classification <classification>", "classification level")
        .choices(["foundational", "tactical", "observational"])
        .default("tactical"),
    )
    .option("--name <name>", "name of the convention or pattern")
    .option("--description <description>", "description of the record")
    .option("--resolution <resolution>", "resolution for failure records")
    .option("--title <title>", "title for decision records")
    .option("--rationale <rationale>", "rationale for decision records")
    .option("--files <files>", "related files (comma-separated)")
    .option("--tags <tags>", "comma-separated tags")
    .option("--evidence-commit <commit>", "evidence: commit hash")
    .option("--evidence-issue <issue>", "evidence: issue reference")
    .option("--evidence-file <file>", "evidence: file path")
    .option("--relates-to <ids>", "comma-separated record IDs this relates to")
    .option("--supersedes <ids>", "comma-separated record IDs this supersedes")
    .option("--force", "force recording even if duplicate exists")
    .action(
      async (
        domain: string,
        content: string | undefined,
        options: Record<string, unknown>,
      ) => {
        const jsonMode = program.opts().json === true;
        const config = await readConfig();

        if (!config.domains.includes(domain)) {
          if (jsonMode) {
            outputJsonError("record", `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`);
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

        const recordType = options.type as RecordType;
        const classification = (options.classification as Classification) ?? "tactical";
        const recordedAt = new Date().toISOString();

        // Build evidence if any evidence option is provided
        let evidence: Evidence | undefined;
        if (options.evidenceCommit || options.evidenceIssue || options.evidenceFile) {
          evidence = {};
          if (options.evidenceCommit)
            evidence.commit = options.evidenceCommit as string;
          if (options.evidenceIssue)
            evidence.issue = options.evidenceIssue as string;
          if (options.evidenceFile)
            evidence.file = options.evidenceFile as string;
        }

        const tags =
          typeof options.tags === "string"
            ? options.tags
                .split(",")
                .map((t) => (t as string).trim())
                .filter(Boolean)
            : undefined;

        const relatesTo =
          typeof options.relatesTo === "string"
            ? options.relatesTo
                .split(",")
                .map((id: string) => id.trim())
                .filter(Boolean)
            : undefined;

        const supersedes =
          typeof options.supersedes === "string"
            ? options.supersedes
                .split(",")
                .map((id: string) => id.trim())
                .filter(Boolean)
            : undefined;

        let record: ExpertiseRecord;

        switch (recordType) {
          case "convention": {
            const conventionContent = content ?? (options.description as string | undefined);
            if (!conventionContent) {
              if (jsonMode) {
                outputJsonError("record", "Convention records require content (positional argument or --description).");
              } else {
                console.error(
                  chalk.red(
                    "Error: convention records require content (positional argument or --description).",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            record = {
              type: "convention",
              content: conventionContent,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
              ...(tags && tags.length > 0 && { tags }),
              ...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
              ...(supersedes && supersedes.length > 0 && { supersedes }),
            };
            break;
          }

          case "pattern": {
            const patternName = options.name as string | undefined;
            const patternDesc =
              (options.description as string | undefined) ?? content;
            if (!patternName || !patternDesc) {
              if (jsonMode) {
                outputJsonError("record", "Pattern records require --name and --description (or positional content).");
              } else {
                console.error(
                  chalk.red(
                    "Error: pattern records require --name and --description (or positional content).",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            record = {
              type: "pattern",
              name: patternName,
              description: patternDesc,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
              ...(typeof options.files === "string" && {
                files: options.files.split(","),
              }),
              ...(tags && tags.length > 0 && { tags }),
              ...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
              ...(supersedes && supersedes.length > 0 && { supersedes }),
            };
            break;
          }

          case "failure": {
            const failureDesc = options.description as string | undefined;
            const failureResolution = options.resolution as string | undefined;
            if (!failureDesc || !failureResolution) {
              if (jsonMode) {
                outputJsonError("record", "Failure records require --description and --resolution.");
              } else {
                console.error(
                  chalk.red(
                    "Error: failure records require --description and --resolution.",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            record = {
              type: "failure",
              description: failureDesc,
              resolution: failureResolution,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
              ...(tags && tags.length > 0 && { tags }),
              ...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
              ...(supersedes && supersedes.length > 0 && { supersedes }),
            };
            break;
          }

          case "decision": {
            const decisionTitle = options.title as string | undefined;
            const decisionRationale = options.rationale as string | undefined;
            if (!decisionTitle || !decisionRationale) {
              if (jsonMode) {
                outputJsonError("record", "Decision records require --title and --rationale.");
              } else {
                console.error(
                  chalk.red(
                    "Error: decision records require --title and --rationale.",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            record = {
              type: "decision",
              title: decisionTitle,
              rationale: decisionRationale,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
              ...(tags && tags.length > 0 && { tags }),
              ...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
              ...(supersedes && supersedes.length > 0 && { supersedes }),
            };
            break;
          }

          case "reference": {
            const refName = options.name as string | undefined;
            const refDesc =
              (options.description as string | undefined) ?? content;
            if (!refName || !refDesc) {
              if (jsonMode) {
                outputJsonError("record", "Reference records require --name and --description (or positional content).");
              } else {
                console.error(
                  chalk.red(
                    "Error: reference records require --name and --description (or positional content).",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            record = {
              type: "reference",
              name: refName,
              description: refDesc,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
              ...(typeof options.files === "string" && {
                files: options.files.split(","),
              }),
              ...(tags && tags.length > 0 && { tags }),
              ...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
              ...(supersedes && supersedes.length > 0 && { supersedes }),
            };
            break;
          }

          case "guide": {
            const guideName = options.name as string | undefined;
            const guideDesc =
              (options.description as string | undefined) ?? content;
            if (!guideName || !guideDesc) {
              if (jsonMode) {
                outputJsonError("record", "Guide records require --name and --description (or positional content).");
              } else {
                console.error(
                  chalk.red(
                    "Error: guide records require --name and --description (or positional content).",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }
            record = {
              type: "guide",
              name: guideName,
              description: guideDesc,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
              ...(tags && tags.length > 0 && { tags }),
              ...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
              ...(supersedes && supersedes.length > 0 && { supersedes }),
            };
            break;
          }
        }

        // Validate against JSON schema
        const ajv = new Ajv();
        const validate = ajv.compile(recordSchema);
        if (!validate(record)) {
          const errors = (validate.errors ?? []).map((err) => `${err.instancePath} ${err.message}`);
          if (jsonMode) {
            outputJsonError("record", `Schema validation failed: ${errors.join("; ")}`);
          } else {
            console.error(chalk.red("Error: record failed schema validation:"));
            for (const err of validate.errors ?? []) {
              console.error(chalk.red(`  ${err.instancePath} ${err.message}`));
            }
          }
          process.exitCode = 1;
          return;
        }

        const filePath = getExpertisePath(domain);
        await withFileLock(filePath, async () => {
          const existing = await readExpertiseFile(filePath);
          const dup = findDuplicate(existing, record);

          if (dup && !options.force) {
            const isNamed =
              record.type === "pattern" || record.type === "decision" ||
              record.type === "reference" || record.type === "guide";

            if (isNamed) {
              // Upsert: replace in place
              existing[dup.index] = record;
              await writeExpertiseFile(filePath, existing);
              if (jsonMode) {
                outputJson({
                  success: true,
                  command: "record",
                  action: "updated",
                  domain,
                  type: recordType,
                  index: dup.index + 1,
                  record,
                });
              } else {
                console.log(
                  chalk.green(
                    `\u2714 Updated existing ${recordType} in ${domain} (record #${dup.index + 1})`,
                  ),
                );
              }
            } else {
              // Exact match: skip
              if (jsonMode) {
                outputJson({
                  success: true,
                  command: "record",
                  action: "skipped",
                  domain,
                  type: recordType,
                  index: dup.index + 1,
                });
              } else {
                console.log(
                  chalk.yellow(
                    `Duplicate ${recordType} already exists in ${domain} (record #${dup.index + 1}). Use --force to add anyway.`,
                  ),
                );
              }
            }
          } else {
            await appendRecord(filePath, record);
            if (jsonMode) {
              outputJson({
                success: true,
                command: "record",
                action: "created",
                domain,
                type: recordType,
                record,
              });
            } else {
              console.log(
                chalk.green(`\u2714 Recorded ${recordType} in ${domain}`),
              );
            }
          }
        });
      },
    );
}
