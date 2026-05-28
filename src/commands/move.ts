import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { getRegistry } from "../registry/type-registry.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertiseDir, getExpertisePath, readConfig } from "../utils/config.ts";
import {
	findMissingDomainFields,
	getAllowedTypes,
	getRequiredFields,
} from "../utils/domain-rules.ts";
import {
	appendRecord,
	readExpertiseFile,
	resolveRecordId,
	writeExpertiseFile,
} from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { runHooks } from "../utils/hooks.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

interface MoveOptions {
	dryRun: boolean;
	force: boolean;
}

interface ReferenceHit {
	domain: string;
	id: string | null;
	field: "relates_to" | "supersedes";
}

// Scan every other expertise file for references (relates_to / supersedes) to
// the moved record's ID. We don't rewrite — the ID is preserved across the
// move, so existing links still resolve. The scan exists purely as an
// informational warning so users can audit the link graph if they care.
async function findIncomingReferences(
	movedId: string,
	cwd: string,
	skipFiles: Set<string>,
): Promise<ReferenceHit[]> {
	const expertiseDir = getExpertiseDir(cwd);
	if (!existsSync(expertiseDir)) return [];
	const entries = await readdir(expertiseDir).catch(() => [] as string[]);
	const hits: ReferenceHit[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".jsonl")) continue;
		const filePath = join(expertiseDir, entry);
		if (skipFiles.has(filePath)) continue;
		const domain = entry.slice(0, -".jsonl".length);
		const records = await readExpertiseFile(filePath, { allowUnknownTypes: true }).catch(
			() => [] as ExpertiseRecord[],
		);
		for (const r of records) {
			if (r.relates_to?.includes(movedId)) {
				hits.push({ domain, id: r.id ?? null, field: "relates_to" });
			}
			if (r.supersedes?.includes(movedId)) {
				hits.push({ domain, id: r.id ?? null, field: "supersedes" });
			}
		}
	}
	return hits;
}

export function registerMoveCommand(program: Command): void {
	program
		.command("move")
		.argument("<source-domain>", "current domain")
		.argument("<id>", "record ID (e.g. mx-abc123, abc123, or abc)")
		.argument("<target-domain>", "destination domain")
		.description("Move a record from one domain to another, preserving its ID and metadata")
		.option("--dry-run", "preview the move without making changes", false)
		.option(
			"--force",
			"bypass target domain's allowed_types gate (required_fields still enforced)",
			false,
		)
		.action(
			async (sourceDomain: string, id: string, targetDomain: string, options: MoveOptions) => {
				const jsonMode = program.opts().json === true;
				try {
					const config = await readConfig();
					const availableDomains = Object.keys(config.domains);

					if (sourceDomain === targetDomain) {
						const msg = "Source and target domain are the same — nothing to move.";
						if (jsonMode) outputJsonError("move", msg);
						else console.error(chalk.red(`Error: ${msg}`));
						process.exitCode = 1;
						return;
					}

					for (const d of [sourceDomain, targetDomain]) {
						if (!(d in config.domains)) {
							const msg = `Domain "${d}" not found in config. Available domains: ${availableDomains.join(", ") || "(none)"}`;
							if (jsonMode) outputJsonError("move", msg);
							else console.error(chalk.red(`Error: ${msg}`));
							process.exitCode = 1;
							return;
						}
					}

					const sourcePath = getExpertisePath(sourceDomain);
					const targetPath = getExpertisePath(targetDomain);

					// Read source under its lock to resolve the record. We release
					// the lock before validating so we don't hold it across hooks /
					// target lock acquisition — the record is re-fetched under lock
					// at write time below.
					const sourceRecords = await withFileLock(sourcePath, async () =>
						readExpertiseFile(sourcePath),
					);
					const resolved = resolveRecordId(sourceRecords, id);
					if (!resolved.ok) {
						if (jsonMode) outputJsonError("move", resolved.error);
						else console.error(chalk.red(`Error: ${resolved.error}`));
						process.exitCode = 1;
						return;
					}
					const record = resolved.record;

					// Reject archived records. The .mulch/archive/ store is walked by
					// `ml restore` and `ml search --archived`; live expertise files
					// shouldn't carry archived rows, but a stray status field would.
					if (record.status === "archived") {
						const msg = `Record ${record.id ?? id} is archived. Run \`ml restore ${record.id ?? id}\` first.`;
						if (jsonMode) outputJsonError("move", msg);
						else console.error(chalk.red(`Error: ${msg}`));
						process.exitCode = 1;
						return;
					}

					// Validate type against target allowed_types
					const allowedTypes = getAllowedTypes(config, targetDomain);
					if (allowedTypes && !allowedTypes.includes(record.type) && !options.force) {
						const msg = `Type "${record.type}" is not in target domain "${targetDomain}" allowed_types (${allowedTypes.join(", ")}). Pass --force to override, or adjust mulch.config.yaml.`;
						if (jsonMode) outputJsonError("move", msg);
						else console.error(chalk.red(`Error: ${msg}`));
						process.exitCode = 1;
						return;
					}

					// Validate required_fields for target
					const requiredFields = getRequiredFields(config, targetDomain);
					if (requiredFields) {
						const missing = findMissingDomainFields(
							record as unknown as Record<string, unknown>,
							requiredFields,
						);
						if (missing.length > 0) {
							const fieldList = missing.map((f) => `"${f}"`).join(", ");
							const msg = `Record is missing field(s) required by target domain "${targetDomain}": ${fieldList}. Edit the record (\`ml edit ${record.id ?? id}\`) before moving.`;
							if (jsonMode) outputJsonError("move", msg);
							else console.error(chalk.red(`Error: ${msg}`));
							process.exitCode = 1;
							return;
						}
					}

					// Re-validate against the JSON schema. The record is presumed
					// valid (it was written before), but a registry change since
					// then could have tightened the schema. This is a cheap
					// safeguard against silently writing a stale row into the new
					// domain.
					const validate = getRegistry().validator;
					if (!validate(record)) {
						const errs = (validate.errors ?? [])
							.map((e) => `${e.instancePath} ${e.message}`)
							.join("; ");
						const msg = `Record fails schema validation: ${errs}. Edit the record before moving.`;
						if (jsonMode) outputJsonError("move", msg);
						else console.error(chalk.red(`Error: ${msg}`));
						process.exitCode = 1;
						return;
					}

					// Informational scan for inbound references. Skips both source
					// and target files (target hasn't been written yet; source
					// references to the record itself are not interesting here).
					const incomingRefs = await findIncomingReferences(
						record.id ?? "",
						process.cwd(),
						new Set([sourcePath, targetPath]),
					);

					if (options.dryRun) {
						if (jsonMode) {
							outputJson({
								success: true,
								command: "move",
								dryRun: true,
								sourceDomain,
								targetDomain,
								record: {
									id: record.id ?? null,
									type: record.type,
									summary: getRecordSummary(record),
								},
								incomingReferences: incomingRefs,
							});
						} else if (!isQuiet()) {
							const rid = record.id ? ` ${accent(record.id)}` : "";
							console.log(
								`${chalk.yellow("[DRY RUN]")} ${brand(`Would move ${record.type}`)}${rid} ${brand(
									`from ${sourceDomain} → ${targetDomain}`,
								)}: ${getRecordSummary(record)}`,
							);
							if (incomingRefs.length > 0) {
								console.log(
									chalk.dim(
										`  ${incomingRefs.length} inbound reference(s) detected; ID is preserved so links remain valid.`,
									),
								);
							}
						}
						return;
					}

					// Fire pre-record against the target domain. A blocked hook
					// aborts the move (record stays in source intact).
					const preResult = await runHooks<{ domain: string; record: ExpertiseRecord }>(
						"pre-record",
						{ domain: targetDomain, record },
					);
					if (preResult.blocked) {
						const reason = preResult.blockReason ?? "pre-record hook blocked the move";
						if (jsonMode) outputJsonError("move", reason);
						else console.error(chalk.red(`Error: ${reason}`));
						process.exitCode = 1;
						return;
					}
					let recordToWrite = record;
					if (preResult.ranAny && preResult.payload?.record) {
						const mutated = preResult.payload.record;
						if (mutated !== record) {
							if (!validate(mutated)) {
								const errs = (validate.errors ?? [])
									.map((e) => `${e.instancePath} ${e.message}`)
									.join("; ");
								const msg = `pre-record hook produced an invalid record: ${errs}`;
								if (jsonMode) outputJsonError("move", msg);
								else console.error(chalk.red(`Error: ${msg}`));
								process.exitCode = 1;
								return;
							}
							recordToWrite = mutated;
						}
					}

					// Append to target, then remove from source. Locks are nested
					// in a fixed order (target before source) to keep concurrent
					// moves deadlock-free. If a crash lands between the append and
					// the source rewrite, the record appears in both domains —
					// recoverable by hand and strictly better than losing it.
					await withFileLock(targetPath, async () => {
						await appendRecord(targetPath, recordToWrite);
						await withFileLock(sourcePath, async () => {
							const currentSource = await readExpertiseFile(sourcePath);
							const filtered = currentSource.filter((r) => r.id !== recordToWrite.id);
							await writeExpertiseFile(sourcePath, filtered);
						});
					});

					const postResult = await runHooks("post-record", {
						domain: targetDomain,
						record: recordToWrite,
						action: "created",
					});

					const warnings = [...preResult.warnings, ...postResult.warnings];

					if (jsonMode) {
						outputJson({
							success: true,
							command: "move",
							sourceDomain,
							targetDomain,
							record: {
								id: recordToWrite.id ?? null,
								type: recordToWrite.type,
								summary: getRecordSummary(recordToWrite),
							},
							incomingReferences: incomingRefs,
							...(warnings.length > 0 ? { warnings } : {}),
						});
					} else if (!isQuiet()) {
						const rid = recordToWrite.id ? ` ${accent(recordToWrite.id)}` : "";
						console.log(
							`${brand("✓")} ${brand(`Moved ${recordToWrite.type}`)}${rid} ${brand(
								`from ${sourceDomain} → ${targetDomain}`,
							)}: ${getRecordSummary(recordToWrite)}`,
						);
						if (incomingRefs.length > 0) {
							console.log(
								chalk.yellow(
									`  ${incomingRefs.length} inbound reference(s) found; ID preserved so existing links still resolve:`,
								),
							);
							for (const ref of incomingRefs) {
								console.log(chalk.dim(`    ${ref.domain}/${ref.id ?? "(no id)"} via ${ref.field}`));
							}
						}
						for (const w of warnings) console.log(chalk.yellow(`  warning: ${w}`));
					}
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === "ENOENT") {
						const msg = "No .mulch/ directory found. Run `mulch init` first.";
						if (jsonMode) outputJsonError("move", msg);
						else console.error(chalk.red(`Error: ${msg}`));
					} else {
						if (jsonMode) outputJsonError("move", (err as Error).message);
						else console.error(chalk.red(`Error: ${(err as Error).message}`));
					}
					process.exitCode = 1;
				}
			},
		);
}
