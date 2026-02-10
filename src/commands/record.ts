import { Command, Option } from "commander";
import _Ajv from "ajv";
const Ajv = _Ajv.default ?? _Ajv;
import chalk from "chalk";
import { readConfig, getExpertisePath } from "../utils/config.js";
import { appendRecord } from "../utils/expertise.js";
import { recordSchema } from "../schemas/record-schema.js";
import type {
  ExpertiseRecord,
  RecordType,
  Classification,
  Evidence,
} from "../schemas/record.js";

export function registerRecordCommand(program: Command): void {
  program
    .command("record")
    .argument("<domain>", "expertise domain")
    .argument("[content]", "record content")
    .description("Record an expertise entry")
    .addOption(
      new Option("--type <type>", "record type")
        .choices(["convention", "pattern", "failure", "decision"])
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
    .option("--evidence-commit <commit>", "evidence: commit hash")
    .option("--evidence-issue <issue>", "evidence: issue reference")
    .option("--evidence-file <file>", "evidence: file path")
    .action(
      async (
        domain: string,
        content: string | undefined,
        options: Record<string, unknown>,
      ) => {
        const config = await readConfig();

        if (!config.domains.includes(domain)) {
          console.error(
            chalk.red(`Error: domain "${domain}" not found in config.`),
          );
          console.error(
            chalk.red(
              `Available domains: ${config.domains.join(", ") || "(none)"}`,
            ),
          );
          process.exit(1);
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

        let record: ExpertiseRecord;

        switch (recordType) {
          case "convention": {
            const conventionContent = content ?? (options.description as string | undefined);
            if (!conventionContent) {
              console.error(
                chalk.red(
                  "Error: convention records require content (positional argument or --description).",
                ),
              );
              process.exit(1);
            }
            record = {
              type: "convention",
              content: conventionContent,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
            };
            break;
          }

          case "pattern": {
            const patternName = options.name as string | undefined;
            const patternDesc =
              (options.description as string | undefined) ?? content;
            if (!patternName || !patternDesc) {
              console.error(
                chalk.red(
                  "Error: pattern records require --name and --description (or positional content).",
                ),
              );
              process.exit(1);
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
            };
            break;
          }

          case "failure": {
            const failureDesc = options.description as string | undefined;
            const failureResolution = options.resolution as string | undefined;
            if (!failureDesc || !failureResolution) {
              console.error(
                chalk.red(
                  "Error: failure records require --description and --resolution.",
                ),
              );
              process.exit(1);
            }
            record = {
              type: "failure",
              description: failureDesc,
              resolution: failureResolution,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
            };
            break;
          }

          case "decision": {
            const decisionTitle = options.title as string | undefined;
            const decisionRationale = options.rationale as string | undefined;
            if (!decisionTitle || !decisionRationale) {
              console.error(
                chalk.red(
                  "Error: decision records require --title and --rationale.",
                ),
              );
              process.exit(1);
            }
            record = {
              type: "decision",
              title: decisionTitle,
              rationale: decisionRationale,
              classification,
              recorded_at: recordedAt,
              ...(evidence && { evidence }),
            };
            break;
          }
        }

        // Validate against JSON schema
        const ajv = new Ajv();
        const validate = ajv.compile(recordSchema);
        if (!validate(record)) {
          console.error(chalk.red("Error: record failed schema validation:"));
          for (const err of validate.errors ?? []) {
            console.error(chalk.red(`  ${err.instancePath} ${err.message}`));
          }
          process.exit(1);
        }

        const filePath = getExpertisePath(domain);
        await appendRecord(filePath, record);

        console.log(
          chalk.green(`\u2714 Recorded ${recordType} in ${domain}`),
        );
      },
    );
}
