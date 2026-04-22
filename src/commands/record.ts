import { existsSync, readFileSync } from "node:fs";
import Ajv from "ajv";
import chalk from "chalk";
import { type Command, Option } from "commander";
import type {
	Classification,
	Evidence,
	ExpertiseRecord,
	Outcome,
	RecordType,
} from "../schemas/record.ts";
import { recordSchema } from "../schemas/record-schema.ts";
import { addDomain, getExpertisePath, readConfig } from "../utils/config.ts";
import {
	appendRecord,
	findDuplicate,
	readExpertiseFile,
	writeExpertiseFile,
} from "../utils/expertise.ts";
import { getContextFiles, getCurrentCommit } from "../utils/git-context.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { brand, isQuiet } from "../utils/palette.ts";

const RECORD_TYPE_REQUIREMENTS: Record<string, string> = {
	convention: "convention records require: content",
	pattern: "pattern records require: name, description",
	failure: "failure records require: description, resolution",
	decision: "decision records require: title, rationale",
	reference: "reference records require: name, description",
	guide: "guide records require: name, description",
};

function buildRetryCommand(
	domain: string,
	content: string | undefined,
	options: Record<string, unknown>,
	missingFlags: Array<{ flag: string; placeholder: string }>,
): string {
	const parts = ["mulch record", domain];
	if (content) parts.push(JSON.stringify(content));
	if (options.type) parts.push(`--type ${options.type as string}`);
	if (options.classification && options.classification !== "tactical") {
		parts.push(`--classification ${options.classification as string}`);
	}
	if (options.name) parts.push(`--name ${JSON.stringify(options.name as string)}`);
	if (options.description)
		parts.push(`--description ${JSON.stringify(options.description as string)}`);
	if (options.resolution)
		parts.push(`--resolution ${JSON.stringify(options.resolution as string)}`);
	if (options.title) parts.push(`--title ${JSON.stringify(options.title as string)}`);
	if (options.rationale) parts.push(`--rationale ${JSON.stringify(options.rationale as string)}`);
	if (options.files) parts.push(`--files ${JSON.stringify(options.files as string)}`);
	if (options.tags) parts.push(`--tags ${JSON.stringify(options.tags as string)}`);
	if (options.evidenceCommit) parts.push(`--evidence-commit ${options.evidenceCommit as string}`);
	if (options.evidenceIssue)
		parts.push(`--evidence-issue ${JSON.stringify(options.evidenceIssue as string)}`);
	if (options.evidenceFile)
		parts.push(`--evidence-file ${JSON.stringify(options.evidenceFile as string)}`);
	if (options.evidenceBead)
		parts.push(`--evidence-bead ${JSON.stringify(options.evidenceBead as string)}`);
	if (options.evidenceSeeds)
		parts.push(`--evidence-seeds ${JSON.stringify(options.evidenceSeeds as string)}`);
	if (options.evidenceGh)
		parts.push(`--evidence-gh ${JSON.stringify(options.evidenceGh as string)}`);
	if (options.evidenceLinear)
		parts.push(`--evidence-linear ${JSON.stringify(options.evidenceLinear as string)}`);
	for (const { flag, placeholder } of missingFlags) {
		parts.push(`${flag} ${JSON.stringify(placeholder)}`);
	}
	return parts.join(" ");
}

/**
 * Process records from stdin (JSON single object or array)
 * Validates, dedups, and appends with file locking
 */
export async function processStdinRecords(
	domain: string,
	_jsonMode: boolean,
	force: boolean,
	dryRun: boolean,
	stdinData?: string,
	cwd?: string,
): Promise<{
	created: number;
	updated: number;
	skipped: number;
	errors: string[];
}> {
	const config = await readConfig(cwd);

	if (!config.domains.includes(domain)) {
		await addDomain(domain, cwd);
	}

	// Read stdin (or use provided data for testing)
	const inputData = stdinData ?? readFileSync(0, "utf-8");
	let inputRecords: unknown[];

	try {
		const parsed = JSON.parse(inputData);
		inputRecords = Array.isArray(parsed) ? parsed : [parsed];
	} catch (err) {
		throw new Error(
			`Failed to parse JSON from stdin: ${err instanceof Error ? err.message : String(err)}`,
		);
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
			const recordType =
				typeof record === "object" && record !== null
					? (record as Record<string, unknown>).type
					: undefined;
			const typeHint =
				typeof recordType === "string" && RECORD_TYPE_REQUIREMENTS[recordType]
					? `. Hint: ${RECORD_TYPE_REQUIREMENTS[recordType]}`
					: "";
			errors.push(`Record ${i}: ${validationErrors}${typeHint}`);
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
						// Upsert: replace in place, merging outcomes from existing
						const existingRecord = currentRecords[dup.index];
						if (!existingRecord) continue;
						const mergedOutcomes = [...(existingRecord.outcomes ?? []), ...(record.outcomes ?? [])];
						currentRecords[dup.index] =
							mergedOutcomes.length > 0 ? { ...record, outcomes: mergedOutcomes } : record;
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
			new Option("--type <type>", "record type").choices([
				"convention",
				"pattern",
				"failure",
				"decision",
				"reference",
				"guide",
			]),
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
		.option(
			"--evidence-commit <commit>",
			"evidence: commit hash (auto-populated from git if omitted)",
		)
		.option("--evidence-issue <issue>", "evidence: issue reference")
		.option("--evidence-file <file>", "evidence: file path")
		.option("--evidence-bead <bead>", "evidence: bead ID")
		.option("--evidence-seeds <id>", "evidence: seeds issue ID")
		.option("--evidence-gh <ref>", "evidence: GitHub issue or PR reference")
		.option("--evidence-linear <ticket>", "evidence: Linear ticket reference")
		.option("--relates-to <ids>", "comma-separated record IDs this relates to")
		.option("--supersedes <ids>", "comma-separated record IDs this supersedes")
		.addOption(
			new Option("--outcome-status <status>", "outcome status").choices([
				"success",
				"failure",
				"partial",
			]),
		)
		.option("--outcome-duration <ms>", "outcome duration in milliseconds")
		.option("--outcome-test-results <text>", "outcome test results summary")
		.option("--outcome-agent <agent>", "outcome agent name")
		.option("--force", "force recording even if duplicate exists")
		.option("--stdin", "read JSON record(s) from stdin (single object or array)")
		.option("--batch <file>", "read JSON record(s) from file (single object or array)")
		.option("--dry-run", "preview what would be recorded without writing")
		.addHelpText(
			"after",
			`
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
`,
		)
		.action(
			async (domain: string, content: string | undefined, options: Record<string, unknown>) => {
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
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Dry-run complete. Would process ${total} record(s) in ${domain}:`)}`,
										);
									if (result.created > 0) {
										if (!isQuiet()) console.log(chalk.dim(`  Create: ${result.created}`));
									}
									if (result.updated > 0) {
										if (!isQuiet()) console.log(chalk.dim(`  Update: ${result.updated}`));
									}
									if (result.skipped > 0) {
										if (!isQuiet()) console.log(chalk.dim(`  Skip: ${result.skipped}`));
									}
									if (!isQuiet())
										console.log(chalk.dim("  Run without --dry-run to apply changes."));
								} else {
									if (!isQuiet()) console.log(chalk.yellow("No records would be processed."));
								}
							} else {
								if (result.created > 0) {
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Created ${result.created} record(s) in ${domain}`)}`,
										);
								}
								if (result.updated > 0) {
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Updated ${result.updated} record(s) in ${domain}`)}`,
										);
								}
								if (result.skipped > 0) {
									if (!isQuiet())
										console.log(
											chalk.yellow(`Skipped ${result.skipped} duplicate(s) in ${domain}`),
										);
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
							console.error(
								chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
							);
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
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Dry-run complete. Would process ${total} record(s) in ${domain}:`)}`,
										);
									if (result.created > 0) {
										if (!isQuiet()) console.log(chalk.dim(`  Create: ${result.created}`));
									}
									if (result.updated > 0) {
										if (!isQuiet()) console.log(chalk.dim(`  Update: ${result.updated}`));
									}
									if (result.skipped > 0) {
										if (!isQuiet()) console.log(chalk.dim(`  Skip: ${result.skipped}`));
									}
									if (!isQuiet())
										console.log(chalk.dim("  Run without --dry-run to apply changes."));
								} else {
									if (!isQuiet()) console.log(chalk.yellow("No records would be processed."));
								}
							} else {
								if (result.created > 0) {
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Created ${result.created} record(s) in ${domain}`)}`,
										);
								}
								if (result.updated > 0) {
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Updated ${result.updated} record(s) in ${domain}`)}`,
										);
								}
								if (result.skipped > 0) {
									if (!isQuiet())
										console.log(
											chalk.yellow(`Skipped ${result.skipped} duplicate(s) in ${domain}`),
										);
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
							console.error(
								chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
							);
						}
						process.exitCode = 1;
					}
					return;
				}
				const config = await readConfig();

				if (!config.domains.includes(domain)) {
					await addDomain(domain);
					if (!isQuiet()) {
						console.log(`${brand("✓")} ${brand(`Auto-created domain "${domain}"`)}`);
					}
				}

				// Validate --type is provided for non-stdin mode
				if (!options.type) {
					if (jsonMode) {
						outputJsonError(
							"record",
							"--type is required (convention, pattern, failure, decision, reference, guide)",
						);
					} else {
						console.error(
							chalk.red(
								"Error: --type is required (convention, pattern, failure, decision, reference, guide)",
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
				if (
					options.evidenceCommit ||
					options.evidenceIssue ||
					options.evidenceFile ||
					options.evidenceBead ||
					options.evidenceSeeds ||
					options.evidenceGh ||
					options.evidenceLinear
				) {
					evidence = {};
					if (options.evidenceCommit) evidence.commit = options.evidenceCommit as string;
					if (options.evidenceIssue) evidence.issue = options.evidenceIssue as string;
					if (options.evidenceFile) evidence.file = options.evidenceFile as string;
					if (options.evidenceBead) evidence.bead = options.evidenceBead as string;
					if (options.evidenceSeeds) evidence.seeds = options.evidenceSeeds as string;
					if (options.evidenceGh) evidence.gh = options.evidenceGh as string;
					if (options.evidenceLinear) evidence.linear = options.evidenceLinear as string;
				}

				// Auto-populate evidence.commit from git HEAD if not explicitly provided
				if (!options.evidenceCommit) {
					const autoCommit = getCurrentCommit();
					if (autoCommit) {
						evidence = evidence ?? {};
						evidence.commit = autoCommit;
					}
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
					const o: Outcome = {
						status: options.outcomeStatus as "success" | "failure" | "partial",
					};
					if (options.outcomeDuration !== undefined) {
						o.duration = Number.parseFloat(options.outcomeDuration as string);
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
								outputJsonError(
									"record",
									"Convention records require content (positional argument or --description).",
								);
							} else {
								console.error(
									chalk.red(
										"Error: convention records require content (positional argument or --description).",
									),
								);
								const retryCmd = buildRetryCommand(domain, content, options, [
									{ flag: "--description", placeholder: "<content>" },
								]);
								console.error(chalk.dim(`  Retry: ${retryCmd}`));
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
						const patternDesc = (options.description as string | undefined) ?? content;
						if (!patternName || !patternDesc) {
							const missing: Array<{ flag: string; placeholder: string }> = [];
							if (!patternName) missing.push({ flag: "--name", placeholder: "<name>" });
							if (!patternDesc)
								missing.push({ flag: "--description", placeholder: "<description>" });
							if (jsonMode) {
								outputJsonError(
									"record",
									"Pattern records require --name and --description (or positional content).",
								);
							} else {
								console.error(
									chalk.red(
										"Error: pattern records require --name and --description (or positional content).",
									),
								);
								const retryCmd = buildRetryCommand(domain, content, options, missing);
								console.error(chalk.dim(`  Retry: ${retryCmd}`));
							}
							process.exitCode = 1;
							return;
						}
						const patternFiles =
							typeof options.files === "string" ? options.files.split(",") : getContextFiles();
						record = {
							type: "pattern",
							name: patternName,
							description: patternDesc,
							classification,
							recorded_at: recordedAt,
							...(evidence && { evidence }),
							...(patternFiles.length > 0 && { files: patternFiles }),
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
							const missing: Array<{ flag: string; placeholder: string }> = [];
							if (!failureDesc)
								missing.push({ flag: "--description", placeholder: "<description>" });
							if (!failureResolution)
								missing.push({ flag: "--resolution", placeholder: "<resolution>" });
							if (jsonMode) {
								outputJsonError(
									"record",
									"Failure records require --description and --resolution.",
								);
							} else {
								console.error(
									chalk.red("Error: failure records require --description and --resolution."),
								);
								const retryCmd = buildRetryCommand(domain, content, options, missing);
								console.error(chalk.dim(`  Retry: ${retryCmd}`));
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
							const missing: Array<{ flag: string; placeholder: string }> = [];
							if (!decisionTitle) missing.push({ flag: "--title", placeholder: "<title>" });
							if (!decisionRationale)
								missing.push({ flag: "--rationale", placeholder: "<rationale>" });
							if (jsonMode) {
								outputJsonError("record", "Decision records require --title and --rationale.");
							} else {
								console.error(
									chalk.red("Error: decision records require --title and --rationale."),
								);
								const retryCmd = buildRetryCommand(domain, content, options, missing);
								console.error(chalk.dim(`  Retry: ${retryCmd}`));
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
						const refDesc = (options.description as string | undefined) ?? content;
						if (!refName || !refDesc) {
							const missing: Array<{ flag: string; placeholder: string }> = [];
							if (!refName) missing.push({ flag: "--name", placeholder: "<name>" });
							if (!refDesc) missing.push({ flag: "--description", placeholder: "<description>" });
							if (jsonMode) {
								outputJsonError(
									"record",
									"Reference records require --name and --description (or positional content).",
								);
							} else {
								console.error(
									chalk.red(
										"Error: reference records require --name and --description (or positional content).",
									),
								);
								const retryCmd = buildRetryCommand(domain, content, options, missing);
								console.error(chalk.dim(`  Retry: ${retryCmd}`));
							}
							process.exitCode = 1;
							return;
						}
						const refFiles =
							typeof options.files === "string" ? options.files.split(",") : getContextFiles();
						record = {
							type: "reference",
							name: refName,
							description: refDesc,
							classification,
							recorded_at: recordedAt,
							...(evidence && { evidence }),
							...(refFiles.length > 0 && { files: refFiles }),
							...(tags && tags.length > 0 && { tags }),
							...(relatesTo && relatesTo.length > 0 && { relates_to: relatesTo }),
							...(supersedes && supersedes.length > 0 && { supersedes }),
							...(outcomes && { outcomes }),
						};
						break;
					}

					case "guide": {
						const guideName = options.name as string | undefined;
						const guideDesc = (options.description as string | undefined) ?? content;
						if (!guideName || !guideDesc) {
							const missing: Array<{ flag: string; placeholder: string }> = [];
							if (!guideName) missing.push({ flag: "--name", placeholder: "<name>" });
							if (!guideDesc) missing.push({ flag: "--description", placeholder: "<description>" });
							if (jsonMode) {
								outputJsonError(
									"record",
									"Guide records require --name and --description (or positional content).",
								);
							} else {
								console.error(
									chalk.red(
										"Error: guide records require --name and --description (or positional content).",
									),
								);
								const retryCmd = buildRetryCommand(domain, content, options, missing);
								console.error(chalk.dim(`  Retry: ${retryCmd}`));
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
					const typeHint = RECORD_TYPE_REQUIREMENTS[recordType]
						? `. Hint: ${RECORD_TYPE_REQUIREMENTS[recordType]}`
						: "";
					if (jsonMode) {
						outputJsonError("record", `Schema validation failed: ${errors.join("; ")}${typeHint}`);
					} else {
						console.error(chalk.red("Error: record failed schema validation:"));
						for (const err of validate.errors ?? []) {
							console.error(chalk.red(`  ${err.instancePath} ${err.message}`));
						}
						if (typeHint) {
							console.error(chalk.yellow(`Hint: ${RECORD_TYPE_REQUIREMENTS[recordType]}`));
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
							record.type === "pattern" ||
							record.type === "decision" ||
							record.type === "reference" ||
							record.type === "guide";

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
							if (!isQuiet())
								console.log(
									`${brand("✓")} ${brand(`Dry-run: Would create ${recordType} in ${domain}`)}`,
								);
						} else if (action === "updated") {
							if (!isQuiet())
								console.log(
									`${brand("✓")} ${brand(`Dry-run: Would update existing ${recordType} in ${domain}`)}`,
								);
						} else {
							if (!isQuiet())
								console.log(
									chalk.yellow(
										`Dry-run: Duplicate ${recordType} already exists in ${domain}. Would skip.`,
									),
								);
						}
						if (!isQuiet()) console.log(chalk.dim("  Run without --dry-run to apply changes."));
					}
				} else {
					// Normal mode: write with file locking
					await withFileLock(filePath, async () => {
						const existing = await readExpertiseFile(filePath);
						const dup = findDuplicate(existing, record);

						if (dup && !options.force) {
							const isNamed =
								record.type === "pattern" ||
								record.type === "decision" ||
								record.type === "reference" ||
								record.type === "guide";

							if (isNamed) {
								// Upsert: replace in place, merging outcomes from existing
								const existingRecord = existing[dup.index];
								if (!existingRecord) return;
								const mergedOutcomes = [
									...(existingRecord.outcomes ?? []),
									...(record.outcomes ?? []),
								];
								const upsertRecord =
									mergedOutcomes.length > 0 ? { ...record, outcomes: mergedOutcomes } : record;
								existing[dup.index] = upsertRecord;
								await writeExpertiseFile(filePath, existing);
								if (jsonMode) {
									outputJson({
										success: true,
										command: "record",
										action: "updated",
										domain,
										type: recordType,
										index: dup.index + 1,
										record: upsertRecord,
									});
								} else {
									if (!isQuiet())
										console.log(
											`${brand("✓")} ${brand(`Updated existing ${recordType} in ${domain} (record #${dup.index + 1})`)}`,
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
									if (!isQuiet())
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
								if (!isQuiet())
									console.log(`${brand("✓")} ${brand(`Recorded ${recordType} in ${domain}`)}`);
							}
						}
					});
				}
			},
		);
}
