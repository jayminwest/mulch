import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import { type Command, Option } from "commander";
import { getRegistry, type TypeDefinition } from "../registry/type-registry.ts";
import type { Classification, Evidence, ExpertiseRecord, Outcome } from "../schemas/record.ts";
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

function buildTypeRequirements(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const def of getRegistry().enabled()) {
		out[def.name] = `${def.name} records require: ${def.required.join(", ")}`;
	}
	return out;
}

// snake_case field name → camelCase Commander option key (e.g. "test_results" → "testResults").
function fieldToOptionKey(field: string): string {
	return field.replace(/_(.)/g, (_, c: string) => c.toUpperCase());
}

// Returns the positional content fallback for built-in types that historically
// accept it. Returns null for custom types and built-ins without fallback.
function positionalFallbackField(def: TypeDefinition): string | null {
	if (def.kind !== "builtin") return null;
	if (def.name === "convention") return "content";
	if (def.name === "pattern" || def.name === "reference" || def.name === "guide") {
		return "description";
	}
	return null;
}

interface BaseRecordParts {
	classification: Classification;
	recorded_at: string;
	evidence?: Evidence;
	tags?: string[];
	relates_to?: string[];
	supersedes?: string[];
	outcomes?: Outcome[];
}

function buildRecordFromOptions(
	def: TypeDefinition,
	content: string | undefined,
	options: Record<string, unknown>,
	base: BaseRecordParts,
): { record: ExpertiseRecord | null; missing: Array<{ flag: string; placeholder: string }> } {
	const fallbackField = positionalFallbackField(def);
	const r: Record<string, unknown> = {
		type: def.name,
		classification: base.classification,
		recorded_at: base.recorded_at,
	};
	if (base.evidence) r.evidence = base.evidence;
	if (base.tags && base.tags.length > 0) r.tags = base.tags;
	if (base.relates_to && base.relates_to.length > 0) r.relates_to = base.relates_to;
	if (base.supersedes && base.supersedes.length > 0) r.supersedes = base.supersedes;
	if (base.outcomes) r.outcomes = base.outcomes;

	const missing: Array<{ flag: string; placeholder: string }> = [];

	const collectField = (field: string, isRequired: boolean): void => {
		const optKey = fieldToOptionKey(field);
		let value: unknown = options[optKey];
		if (value === undefined && fallbackField === field && content !== undefined) {
			value = content;
		}
		if (value === undefined || value === "") {
			if (isRequired)
				missing.push({ flag: `--${field.replace(/_/g, "-")}`, placeholder: `<${field}>` });
			return;
		}
		// extractsFiles: split comma-separated string from --files flag
		if (def.extractsFiles && field === def.filesField && typeof value === "string") {
			r[field] = value
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			return;
		}
		r[field] = value;
	};

	for (const field of def.required) collectField(field, true);
	for (const field of def.optional) collectField(field, false);

	// Auto-populate files from git context for extractsFiles types when not provided.
	if (def.extractsFiles && r[def.filesField] === undefined) {
		const ctx = getContextFiles();
		if (ctx.length > 0) r[def.filesField] = ctx;
	}

	if (missing.length > 0) return { record: null, missing };
	return { record: r as unknown as ExpertiseRecord, missing: [] };
}

function isNamedType(def: TypeDefinition): boolean {
	// "Named" types upsert on duplicate; "anonymous" types skip on duplicate.
	// Built-ins: convention/failure are anonymous; pattern/decision/reference/guide are named.
	if (def.kind === "builtin") {
		return def.name !== "convention" && def.name !== "failure";
	}
	// Custom types: treat as named iff dedup_key isn't content_hash (since
	// content_hash dedup behaves like an anonymous exact-match check).
	return def.dedupKey !== "content_hash";
}

function buildRetryCommand(
	domain: string,
	content: string | undefined,
	options: Record<string, unknown>,
	missingFlags: Array<{ flag: string; placeholder: string }>,
): string {
	const parts = ["ml record", domain];
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
	warnings: string[];
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

	// Validate each record against schema (cached on registry)
	const validate = getRegistry().validator;

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
			const requirements = buildTypeRequirements();
			const typeHint =
				typeof recordType === "string" && requirements[recordType]
					? `. Hint: ${requirements[recordType]}`
					: "";
			errors.push(`Record ${i}: ${validationErrors}${typeHint}`);
			continue;
		}

		validRecords.push(record as ExpertiseRecord);
	}

	// Emit one warning per disabled type seen across the batch, not per record.
	const warnings: string[] = [];
	const seenDisabledTypes = new Set<string>();
	for (const r of validRecords) {
		if (getRegistry().isDisabled(r.type) && !seenDisabledTypes.has(r.type)) {
			seenDisabledTypes.add(r.type);
			const msg = `type "${r.type}" is disabled (declared in disabled_types). Records will still be written; consider migrating off this type.`;
			warnings.push(msg);
			if (!isQuiet()) {
				console.error(chalk.yellow(`Warning: ${msg}`));
			}
		}
	}

	if (validRecords.length === 0) {
		return { created: 0, updated: 0, skipped: 0, errors, warnings };
	}

	// Process valid records with file locking (skip write in dry-run mode)
	const filePath = getExpertisePath(domain, cwd);
	let created = 0;
	let updated = 0;
	let skipped = 0;

	const registry = getRegistry();
	const isNamedRecord = (record: ExpertiseRecord): boolean => {
		const def = registry.get(record.type);
		return def ? isNamedType(def) : false;
	};

	if (dryRun) {
		// Dry-run: check for duplicates without writing
		const existing = await readExpertiseFile(filePath);
		const currentRecords = [...existing];

		for (const record of validRecords) {
			const dup = findDuplicate(currentRecords, record);

			if (dup && !force) {
				if (isNamedRecord(record)) {
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
					if (isNamedRecord(record)) {
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

	return { created, updated, skipped, errors, warnings };
}

export function registerRecordCommand(program: Command): void {
	const registry = getRegistry();
	const typeChoices = registry.names();

	const cmd = program
		.command("record")
		.argument("<domain>", "expertise domain")
		.argument("[content]", "record content")
		.description("Record an expertise record")
		.addOption(new Option("--type <type>", "record type").choices(typeChoices))
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
  ml record cli --batch records.json
  ml record cli --batch records.json --dry-run
  echo '[{"type":"convention","content":"test"}]' > batch.json && ml record cli --batch batch.json
`,
		);

	// Dynamically register --<field> flags for custom-type fields not already
	// covered by the built-in flag set. This makes Phase 2 custom_types
	// (declared in mulch.config.yaml) feel first-class on the CLI.
	const declaredOptionNames = new Set(
		cmd.options.map((o) => o.name()).concat(["files"]), // --files declared above
	);
	for (const def of registry.enabled()) {
		if (def.kind === "builtin") continue;
		for (const field of [...def.required, ...def.optional]) {
			const flagName = field.replace(/_/g, "-");
			if (declaredOptionNames.has(flagName)) continue;
			declaredOptionNames.add(flagName);
			cmd.option(`--${flagName} <${field}>`, `${def.name} field: ${field}`);
		}
	}

	cmd.action(
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
							warnings: result.warnings,
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
								if (!isQuiet()) console.log(chalk.dim("  Run without --dry-run to apply changes."));
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
							warnings: result.warnings,
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
								if (!isQuiet()) console.log(chalk.dim("  Run without --dry-run to apply changes."));
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
				await addDomain(domain);
				if (!isQuiet()) {
					console.log(`${brand("✓")} ${brand(`Auto-created domain "${domain}"`)}`);
				}
			}

			// Validate --type is provided for non-stdin mode
			if (!options.type) {
				const choicesMsg = `--type is required (${typeChoices.join(", ")})`;
				if (jsonMode) {
					outputJsonError("record", choicesMsg);
				} else {
					console.error(chalk.red(`Error: ${choicesMsg}`));
				}
				process.exitCode = 1;
				return;
			}

			const recordType = options.type as string;
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

			const def = getRegistry().get(recordType);
			if (!def) {
				const msg = `Unknown record type "${recordType}". Available: ${typeChoices.join(", ")}.`;
				if (jsonMode) {
					outputJsonError("record", msg);
				} else {
					console.error(chalk.red(`Error: ${msg}`));
				}
				process.exitCode = 1;
				return;
			}

			// Phase 3: disabled types still write but emit a deprecation warning.
			const disabledWarning = getRegistry().isDisabled(recordType)
				? `type "${recordType}" is disabled (declared in disabled_types). Records will still be written; consider migrating off this type.`
				: null;
			if (disabledWarning && !isQuiet() && !jsonMode) {
				console.error(chalk.yellow(`Warning: ${disabledWarning}`));
			}

			const built = buildRecordFromOptions(def, content, options, {
				classification,
				recorded_at: recordedAt,
				evidence,
				tags,
				relates_to: relatesTo,
				supersedes,
				outcomes,
			});

			if (!built.record) {
				const requireList = def.required.join(", ");
				const fallback = positionalFallbackField(def);
				const fallbackHint = fallback ? ` (or positional content for ${fallback})` : "";
				const msg = `${def.name} records require: ${requireList}${fallbackHint}.`;
				if (jsonMode) {
					outputJsonError("record", msg);
				} else {
					console.error(chalk.red(`Error: ${msg}`));
					const retryCmd = buildRetryCommand(domain, content, options, built.missing);
					console.error(chalk.dim(`  Retry: ${retryCmd}`));
				}
				process.exitCode = 1;
				return;
			}

			const record: ExpertiseRecord = built.record;

			// Validate against JSON schema (cached on registry)
			const validate = getRegistry().validator;
			if (!validate(record)) {
				const errors = (validate.errors ?? []).map((err) => `${err.instancePath} ${err.message}`);
				const requirements = buildTypeRequirements();
				const typeHint = requirements[recordType] ? `. Hint: ${requirements[recordType]}` : "";
				if (jsonMode) {
					outputJsonError("record", `Schema validation failed: ${errors.join("; ")}${typeHint}`);
				} else {
					console.error(chalk.red("Error: record failed schema validation:"));
					for (const err of validate.errors ?? []) {
						console.error(chalk.red(`  ${err.instancePath} ${err.message}`));
					}
					if (requirements[recordType]) {
						console.error(chalk.yellow(`Hint: ${requirements[recordType]}`));
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
					action = isNamedType(def) ? "updated" : "skipped";
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
						...(disabledWarning ? { warnings: [disabledWarning] } : {}),
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
						if (isNamedType(def)) {
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
									...(disabledWarning ? { warnings: [disabledWarning] } : {}),
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
									...(disabledWarning ? { warnings: [disabledWarning] } : {}),
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
								...(disabledWarning ? { warnings: [disabledWarning] } : {}),
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
