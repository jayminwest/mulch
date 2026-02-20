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
  Outcome,
} from "../schemas/record.js";
import { outputJson, outputJsonError } from "../utils/json-output.js";
import { readFileSync, existsSync } from "node:fs";

/**
 * Process records from stdin (JSON single object or array)
 * Validates, dedups, and appends with file locking
 */
export async function processStdinRecords(
  domain: string,
  jsonMode: boolean,
  force: boolean,
  dryRun: boolean,
  stdinData?: string,
  cwd?: string,
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
  const config = await readConfig(cwd);

  if (!config.domains.includes(domain)) {
    throw new Error(`Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`);
  }

  // Read stdin (or use provided data for testing)
  const inputData = stdinData ?? readFileSync(0, "utf-8");
  let inputRecords: unknown[];

  try {
    const parsed = JSON.parse(inputData);
    inputRecords = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    throw new Error(`Failed to parse JSON from stdin: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate each record against schema
  const ajv = new Ajv();
  const validate = ajv.compile(recordSchema);

  const errors: string[] = [];
  const validRecords: ExpertiseRecord[] = [];

  for (let i = 0; i < inputRecords.length; i++) {
    const record = inputRecords[i];

    // Ensure recorded_at and classification are set
    if (typeof record === "object" && record !== null) {
      if (!("recorded_at" in record)) {
        (record as Record<string, unknown>).recorded_at = new Date().toISOString();
      }
      if (!("classification" in record)) {
        (record as Record<string, unknown>).classification = "tactical";
      }
    }

    if (!validate(record)) {
      const validationErrors = (validate.errors ?? [])
        .map((err) => `${err.instancePath} ${err.message}`)
        .join("; ");
      errors.push(`Record ${i}: ${validationErrors}`);
      continue;
    }

    validRecords.push(record as ExpertiseRecord);
  }

  if (validRecords.length === 0) {
    return { created: 0, updated: 0, skipped: 0, errors };
  }

  // Process valid records with file locking (skip write in dry-run mode)
  const filePath = getExpertisePath(domain, cwd);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  if (dryRun) {
    // Dry-run: check for duplicates without writing
    const existing = await readExpertiseFile(filePath);
    const currentRecords = [...existing];

    for (const record of validRecords) {
      const dup = findDuplicate(currentRecords, record);

      if (dup && !force) {
        const isNamed =
          record.type === "pattern" ||
          record.type === "decision" ||
          record.type === "reference" ||
          record.type === "guide";

        if (isNamed) {
          updated++;
        } else {
          skipped++;
        }
      } else {
        created++;
      }
    }
  } else {
    // Normal mode: write with file locking
    await withFileLock(filePath, async () => {
      const existing = await readExpertiseFile(filePath);
      let currentRecords = [...existing];

      for (const record of validRecords) {
        const dup = findDuplicate(currentRecords, record);

        if (dup && !force) {
          const isNamed =
            record.type === "pattern" ||
            record.type === "decision" ||
            record.type === "reference" ||
            record.type === "guide";

          if (isNamed) {
            // Upsert: replace in place
            currentRecords[dup.index] = record;
            updated++;
          } else {
            // Exact match: skip
            skipped++;
          }
        } else {
          // New record: append
          currentRecords.push(record);
          created++;
        }
      }

      // Write all changes at once
      if (created > 0 || updated > 0) {
        await writeExpertiseFile(filePath, currentRecords);
      }
    });
  }

  return { created, updated, skipped, errors };
}

export function registerRecordCommand(program: Command): void {
  program
    .command("record")
    .argument("<domain>", "expertise domain")
    .argument("[content]", "record content")
    .description("Record an expertise record")
    .addOption(
      new Option("--type <type>", "record type")
        .choices(["convention", "pattern", "failure", "decision", "reference", "guide"]),
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
    .option("--evidence-bead <bead>", "evidence: bead ID")
    .option("--relates-to <ids>", "comma-separated record IDs this relates to")
    .option("--supersedes <ids>", "comma-separated record IDs this supersedes")
    .addOption(
      new Option("--outcome-status <status>", "outcome status").choices(["success", "failure", "partial"]),
    )
    .option("--outcome-duration <ms>", "outcome duration in milliseconds")
    .option("--outcome-test-results <text>", "outcome test results summary")
    .option("--outcome-agent <agent>", "outcome agent name")
    .option("--force", "force recording even if duplicate exists")
    .option("--stdin", "read JSON record(s) from stdin (single object or array)")
    .option("--batch <file>", "read JSON record(s) from file (single object or array)")
    .option("--dry-run", "preview what would be recorded without writing")
    .addHelpText("after", `
Required fields per record type:
  convention   [content] or --description
  pattern      --name, --description (or [content])
  failure      --description, --resolution
  decision     --title, --rationale
  reference    --name, --description (or [content])
  guide        --name, --description (or [content])

Batch recording examples:
  mulch record cli --batch records.json
  mulch record cli --batch records.json --dry-run
  echo '[{"type":"convention","content":"test"}]' > batch.json && mulch record cli --batch batch.json
`)
    .action(
      async (
        domain: string,
        content: string | undefined,
        options: Record<string, unknown>,
      ) => {
        const jsonMode = program.opts().json === true;

        // Handle --batch mode
        if (options.batch) {
          const batchFile = options.batch as string;
          const dryRun = options.dryRun === true;

          if (!existsSync(batchFile)) {
            if (jsonMode) {
              outputJsonError("record", `Batch file not found: ${batchFile}`);
            } else {
              console.error(chalk.red(`Error: batch file not found: ${batchFile}`));
            }
            process.exitCode = 1;
            return;
          }

          try {
            const fileContent = readFileSync(batchFile, "utf-8");
            const result = await processStdinRecords(
              domain,
              jsonMode,
              options.force === true,
              dryRun,
              fileContent,
            );

            if (result.errors.length > 0) {
              if (jsonMode) {
                outputJsonError("record", `Validation errors: ${result.errors.join("; ")}`);
              } else {
                console.error(chalk.red("Validation errors:"));
                for (const error of result.errors) {
                  console.error(chalk.red(`  ${error}`));
                }
              }
            }

            if (jsonMode) {
              outputJson({
                success: result.errors.length === 0 || result.created + result.updated > 0,
                command: "record",
                action: dryRun ? "dry-run" : "batch",
                domain,
                created: result.created,
                updated: result.updated,
                skipped: result.skipped,
                errors: result.errors,
              });
            } else {
              if (dryRun) {
                const total = result.created + result.updated;
                if (total > 0 || result.skipped > 0) {
                  console.log(chalk.green(`✓ Dry-run complete. Would process ${total} record(s) in ${domain}:`));
                  if (result.created > 0) {
                    console.log(chalk.dim(`  Create: ${result.created}`));
                  }
                  if (result.updated > 0) {
                    console.log(chalk.dim(`  Update: ${result.updated}`));
                  }
                  if (result.skipped > 0) {
                    console.log(chalk.dim(`  Skip: ${result.skipped}`));
                  }
                  console.log(chalk.dim("  Run without --dry-run to apply changes."));
                } else {
                  console.log(chalk.yellow("No records would be processed."));
                }
              } else {
                if (result.created > 0) {
                  console.log(chalk.green(`✔ Created ${result.created} record(s) in ${domain}`));
                }
                if (result.updated > 0) {
                  console.log(chalk.green(`✔ Updated ${result.updated} record(s) in ${domain}`));
                }
                if (result.skipped > 0) {
                  console.log(chalk.yellow(`Skipped ${result.skipped} duplicate(s) in ${domain}`));
                }
              }
            }

            if (result.errors.length > 0 && result.created + result.updated === 0) {
              process.exitCode = 1;
            }
          } catch (err) {
            if (jsonMode) {
              outputJsonError("record", err instanceof Error ? err.message : String(err));
            } else {
              console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
            }
            process.exitCode = 1;
          }
          return;
        }

        // Handle --stdin mode
        if (options.stdin === true) {
          const dryRun = options.dryRun === true;

          try {
            const result = await processStdinRecords(
              domain,
              jsonMode,
              options.force === true,
              dryRun,
            );

            if (result.errors.length > 0) {
              if (jsonMode) {
                outputJsonError("record", `Validation errors: ${result.errors.join("; ")}`);
              } else {
                console.error(chalk.red("Validation errors:"));
                for (const error of result.errors) {
                  console.error(chalk.red(`  ${error}`));
                }
              }
            }

            if (jsonMode) {
              outputJson({
                success: result.errors.length === 0 || result.created + result.updated > 0,
                command: "record",
                action: dryRun ? "dry-run" : "stdin",
                domain,
                created: result.created,
                updated: result.updated,
                skipped: result.skipped,
                errors: result.errors,
              });
            } else {
              if (dryRun) {
                const total = result.created + result.updated;
                if (total > 0 || result.skipped > 0) {
                  console.log(chalk.green(`✓ Dry-run complete. Would process ${total} record(s) in ${domain}:`));
                  if (result.created > 0) {
                    console.log(chalk.dim(`  Create: ${result.created}`));
                  }
                  if (result.updated > 0) {
                    console.log(chalk.dim(`  Update: ${result.updated}`));
                  }
                  if (result.skipped > 0) {
                    console.log(chalk.dim(`  Skip: ${result.skipped}`));
                  }
                  console.log(chalk.dim("  Run without --dry-run to apply changes."));
                } else {
                  console.log(chalk.yellow("No records would be processed."));
                }
              } else {
                if (result.created > 0) {
                  console.log(chalk.green(`✔ Created ${result.created} record(s) in ${domain}`));
                }
                if (result.updated > 0) {
                  console.log(chalk.green(`✔ Updated ${result.updated} record(s) in ${domain}`));
                }
                if (result.skipped > 0) {
                  console.log(chalk.yellow(`Skipped ${result.skipped} duplicate(s) in ${domain}`));
                }
              }
            }

            if (result.errors.length > 0 && result.created + result.updated === 0) {
              process.exitCode = 1;
            }
          } catch (err) {
            if (jsonMode) {
              outputJsonError("record", err instanceof Error ? err.message : String(err));
            } else {
              console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
            }
            process.exitCode = 1;
          }
          return;
        }
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

        // Validate --type is provided for non-stdin mode
        if (!options.type) {
          if (jsonMode) {
            outputJsonError("record", "--type is required (convention, pattern, failure, decision, reference, guide)");
          } else {
            console.error(
              chalk.red("Error: --type is required (convention, pattern, failure, decision, reference, guide)"),
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
        if (options.evidenceCommit || options.evidenceIssue || options.evidenceFile || options.evidenceBead) {
          evidence = {};
          if (options.evidenceCommit)
            evidence.commit = options.evidenceCommit as string;
          if (options.evidenceIssue)
            evidence.issue = options.evidenceIssue as string;
          if (options.evidenceFile)
            evidence.file = options.evidenceFile as string;
          if (options.evidenceBead)
            evidence.bead = options.evidenceBead as string;
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

        let outcomes: Outcome[] | undefined;
        if (options.outcomeStatus) {
          const o: Outcome = { status: options.outcomeStatus as "success" | "failure" | "partial" };
          if (options.outcomeDuration !== undefined) {
            o.duration = parseFloat(options.outcomeDuration as string);
          }
          if (options.outcomeTestResults) {
            o.test_results = options.outcomeTestResults as string;
          }
          if (options.outcomeAgent) {
            o.agent = options.outcomeAgent as string;
          }
          outcomes = [o];
        }

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
              ...(outcomes && { outcomes }),
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
              ...(outcomes && { outcomes }),
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
              ...(outcomes && { outcomes }),
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
              ...(outcomes && { outcomes }),
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
              ...(outcomes && { outcomes }),
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
              ...(outcomes && { outcomes }),
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
        const dryRun = options.dryRun === true;

        if (dryRun) {
          // Dry-run: check for duplicates without writing
          const existing = await readExpertiseFile(filePath);
          const dup = findDuplicate(existing, record);

          let action = "created";
          if (dup && !options.force) {
            const isNamed =
              record.type === "pattern" || record.type === "decision" ||
              record.type === "reference" || record.type === "guide";

            action = isNamed ? "updated" : "skipped";
          }

          if (jsonMode) {
            outputJson({
              success: true,
              command: "record",
              action: "dry-run",
              wouldDo: action,
              domain,
              type: recordType,
              record,
            });
          } else {
            if (action === "created") {
              console.log(chalk.green(`✓ Dry-run: Would create ${recordType} in ${domain}`));
            } else if (action === "updated") {
              console.log(chalk.green(`✓ Dry-run: Would update existing ${recordType} in ${domain}`));
            } else {
              console.log(chalk.yellow(`Dry-run: Duplicate ${recordType} already exists in ${domain}. Would skip.`));
            }
            console.log(chalk.dim("  Run without --dry-run to apply changes."));
          }
        } else {
          // Normal mode: write with file locking
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
        }
      },
    );
}
