import chalk from "chalk";
import type { Command } from "commander";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { archiveRecords } from "../utils/archive.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile, resolveRecordId, writeExpertiseFile } from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

interface ArchivedRecordInfo {
	id: string | null;
	type: string;
	summary: string;
	reason: string;
}

function buildArchivedInfo(record: ExpertiseRecord, reason: string): ArchivedRecordInfo {
	return {
		id: record.id ?? null,
		type: record.type,
		summary: getRecordSummary(record),
		reason,
	};
}

function printArchivedRecord(
	record: ExpertiseRecord,
	domain: string,
	reason: string,
	dryRun: boolean,
): void {
	const prefix = dryRun ? `${chalk.yellow("[DRY RUN]")} ` : "";
	const verb = dryRun ? "Would archive" : "Archived";
	const rid = record.id ? ` ${accent(record.id)}` : "";
	console.log(
		`${prefix}${brand(`${verb} ${record.type}`)}${rid} ${brand(`from ${domain}`)} (${reason}): ${getRecordSummary(record)}`,
	);
}

export function registerArchiveCommand(program: Command): void {
	program
		.command("archive")
		.argument("<domain>", "expertise domain")
		.argument("[id]", "record ID (e.g. mx-abc123, abc123, or abc)")
		.description(
			"Soft-archive one or more live records (symmetric to `ml restore`; pairs with `ml prune` for bulk decay)",
		)
		.option("--records <ids>", "comma-separated list of record IDs to archive")
		.requiredOption("--reason <text>", "why this record is being archived (required, free-text)")
		.option("--dry-run", "preview what would be archived without making changes", false)
		.action(
			async (
				domain: string,
				id: string | undefined,
				options: { records?: string; reason: string; dryRun: boolean },
			) => {
				const jsonMode = program.opts().json === true;
				try {
					const config = await readConfig();

					if (!(domain in config.domains)) {
						const available = Object.keys(config.domains).join(", ") || "(none)";
						if (jsonMode) {
							outputJsonError(
								"archive",
								`Domain "${domain}" not found in config. Available domains: ${available}`,
							);
						} else {
							console.error(chalk.red(`Error: domain "${domain}" not found in config.`));
							console.error(chalk.red(`Available domains: ${available}`));
						}
						process.exitCode = 1;
						return;
					}

					const reasonText = options.reason.trim();
					if (reasonText.length === 0) {
						if (jsonMode) {
							outputJsonError("archive", "--reason must not be empty.");
						} else {
							console.error(chalk.red("Error: --reason must not be empty."));
						}
						process.exitCode = 1;
						return;
					}

					const hasId = id !== undefined;
					const hasRecords = options.records !== undefined;
					const modeCount = [hasId, hasRecords].filter(Boolean).length;

					if (modeCount === 0) {
						if (jsonMode) {
							outputJsonError("archive", "Must provide a record ID or --records.");
						} else {
							console.error(chalk.red("Error: must provide a record ID or --records."));
						}
						process.exitCode = 1;
						return;
					}

					if (modeCount > 1) {
						if (jsonMode) {
							outputJsonError(
								"archive",
								"Cannot combine a record ID with --records. Use only one mode.",
							);
						} else {
							console.error(
								chalk.red("Error: cannot combine a record ID with --records. Use only one mode."),
							);
						}
						process.exitCode = 1;
						return;
					}

					const rawIds: string[] = hasRecords
						? (options.records as string)
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean)
						: [id as string];

					if (rawIds.length === 0) {
						if (jsonMode) {
							outputJsonError("archive", "--records requires at least one ID.");
						} else {
							console.error(chalk.red("Error: --records requires at least one ID."));
						}
						process.exitCode = 1;
						return;
					}

					const stampedReason = `manual: ${reasonText}`;
					const filePath = getExpertisePath(domain);

					// Resolve + remove from live under the live-file lock so concurrent
					// writers don't lose data between read and write. Archive write
					// happens after the live write (mirrors `ml prune` phase 3).
					const lockResult = await withFileLock(filePath, async () => {
						const records = await readExpertiseFile(filePath);
						const toArchiveIndices = new Set<number>();

						for (const rawId of rawIds) {
							const resolved = resolveRecordId(records, rawId);
							if (!resolved.ok) {
								return { ok: false as const, error: resolved.error };
							}
							toArchiveIndices.add(resolved.index);
						}

						const archived = records.filter((_, i) => toArchiveIndices.has(i));
						const kept = records.filter((_, i) => !toArchiveIndices.has(i));

						if (!options.dryRun) {
							await writeExpertiseFile(filePath, kept);
						}

						return { ok: true as const, archived, kept };
					});

					if (!lockResult.ok) {
						if (jsonMode) {
							outputJsonError("archive", lockResult.error);
						} else {
							console.error(chalk.red(`Error: ${lockResult.error}`));
						}
						process.exitCode = 1;
						return;
					}

					const { archived, kept } = lockResult;

					if (!options.dryRun && archived.length > 0) {
						await archiveRecords(domain, archived, new Date(), stampedReason);
					}

					if (jsonMode) {
						outputJson({
							success: true,
							command: "archive",
							domain,
							dryRun: options.dryRun,
							archived: archived.map((r) => buildArchivedInfo(r, stampedReason)),
							kept: kept.length,
						});
					} else if (!isQuiet()) {
						for (const r of archived) {
							printArchivedRecord(r, domain, stampedReason, options.dryRun);
						}
						if (!options.dryRun && archived.length > 1) {
							console.log(brand(`✓ Archived ${archived.length} records from ${domain}`));
						}
					}
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === "ENOENT") {
						if (jsonMode) {
							outputJsonError("archive", "No .mulch/ directory found. Run `mulch init` first.");
						} else {
							console.error("Error: No .mulch/ directory found. Run `mulch init` first.");
						}
					} else {
						if (jsonMode) {
							outputJsonError("archive", (err as Error).message);
						} else {
							console.error(`Error: ${(err as Error).message}`);
						}
					}
					process.exitCode = 1;
				}
			},
		);
}
