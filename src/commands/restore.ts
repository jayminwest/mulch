import chalk from "chalk";
import type { Command } from "commander";
import type { ExpertiseRecord } from "../schemas/record.ts";
import {
	archiveRecords,
	getArchivePath,
	readArchiveFile,
	removeFromArchive,
	restoreToExpertise,
	stripArchiveFields,
} from "../utils/archive.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile, resolveRecordId } from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

export function registerRestoreCommand(program: Command): void {
	program
		.command("restore")
		.argument("<id>", "archived record ID (e.g. mx-abc123, abc123, or abc)")
		.description("Restore a soft-archived record from .mulch/archive/ back to live expertise")
		.action(async (id: string) => {
			const jsonMode = program.opts().json === true;
			try {
				const config = await readConfig();

				// Search every archive file for the record id. Records carry no
				// domain field, so we have to scan domain by domain. The id space
				// is sha-derived and effectively unique, so collisions across
				// domain archives are vanishingly rare; surface them as an error
				// when they do happen.
				const matches: Array<{ domain: string; record: ExpertiseRecord }> = [];
				for (const domain of Object.keys(config.domains)) {
					const archivePath = getArchivePath(domain);
					const records = await readArchiveFile(archivePath);
					const resolved = resolveRecordId(records, id);
					if (resolved.ok) {
						matches.push({ domain, record: resolved.record });
					}
				}

				if (matches.length === 0) {
					const msg = `Archived record "${id}" not found in any domain. Run \`ml search --archived <query>\` to browse archives.`;
					if (jsonMode) {
						outputJsonError("restore", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				if (matches.length > 1) {
					const where = matches.map((m) => `${m.domain} (${m.record.id})`).join(", ");
					const msg = `Identifier "${id}" matches archived records in multiple domains: ${where}. Use a longer prefix.`;
					if (jsonMode) {
						outputJsonError("restore", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				const target = matches[0];
				if (!target) return;
				const { domain, record } = target;
				const recordId = record.id;
				if (!recordId) {
					const msg = `Archived record has no id; cannot restore safely.`;
					if (jsonMode) {
						outputJsonError("restore", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				// Pre-check: refuse to restore over an existing live id BEFORE touching
				// the archive. Race-safe re-check happens inside restoreToExpertise
				// under the live file's lock; if that catches a duplicate we'll roll
				// the archive back below.
				const expertisePath = getExpertisePath(domain);
				const liveExisting = await readExpertiseFile(expertisePath);
				const livePreConflict = liveExisting.find((r) => r.id === recordId);
				if (livePreConflict) {
					const msg = `Live record "${recordId}" already exists in domain "${domain}" (classification: ${livePreConflict.classification}). Delete or rename the live record before restoring, or run \`ml search --archived ${recordId}\` to inspect the archived copy.`;
					if (jsonMode) {
						outputJsonError("restore", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				const removed = await removeFromArchive(domain, recordId);
				if (!removed) {
					const msg = `Archived record "${recordId}" disappeared between read and write (concurrent restore?).`;
					if (jsonMode) {
						outputJsonError("restore", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				// Capture the original archive_reason BEFORE stripping so we can
				// surface it in the success line and preserve it on a rollback
				// re-archive. Archives written before mulch-b41a have no reason
				// on disk — fall back to "manual" so the field is always set.
				const originalReason = removed.archive_reason ?? "manual";
				const live = stripArchiveFields(removed);
				const restoreRes = await restoreToExpertise(expertisePath, live);
				if (!restoreRes.ok) {
					// Race lost between pre-check and lock. Roll the archive back so
					// the record isn't stranded. Preserve the original archive_reason
					// so the round-trip is invisible to anyone reading the archive.
					await archiveRecords(domain, [stripArchiveFields(removed)], new Date(), originalReason);
					const msg = `Live record "${recordId}" appeared in domain "${domain}" while restore was in flight (classification: ${restoreRes.conflict.classification}). Re-archived; nothing changed.`;
					if (jsonMode) {
						outputJsonError("restore", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				if (jsonMode) {
					outputJson({
						success: true,
						command: "restore",
						domain,
						id: live.id ?? null,
						type: live.type,
						summary: getRecordSummary(live),
						archive_reason: originalReason,
					});
				} else if (!isQuiet()) {
					const rid = live.id ? ` ${accent(live.id)}` : "";
					console.log(
						`${brand("✓")} ${brand(`Restored ${live.type}`)}${rid} ${brand(`to ${domain}`)} (archived: ${originalReason}): ${getRecordSummary(live)}`,
					);
				}
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					if (jsonMode) {
						outputJsonError("restore", "No .mulch/ directory found. Run `mulch init` first.");
					} else {
						console.error("Error: No .mulch/ directory found. Run `mulch init` first.");
					}
				} else {
					if (jsonMode) {
						outputJsonError("restore", (err as Error).message);
					} else {
						console.error(`Error: ${(err as Error).message}`);
					}
				}
				process.exitCode = 1;
			}
		});
}
