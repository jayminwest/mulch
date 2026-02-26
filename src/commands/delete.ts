import chalk from "chalk";
import type { Command } from "commander";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
  readExpertiseFile,
  resolveRecordId,
  writeExpertiseFile,
} from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

interface DeletedRecordInfo {
  id: string | null;
  type: string;
  summary: string;
}

function buildDeletedInfo(record: ExpertiseRecord): DeletedRecordInfo {
  return {
    id: record.id ?? null,
    type: record.type,
    summary: getRecordSummary(record),
  };
}

function printDeletedRecord(
  record: ExpertiseRecord,
  domain: string,
  dryRun: boolean,
): void {
  const prefix = dryRun ? `${chalk.yellow("[DRY RUN]")} ` : "";
  const verb = dryRun ? "Would delete" : "Deleted";
  const rid = record.id ? ` ${accent(record.id)}` : "";
  console.log(
    `${prefix}${brand(`${verb} ${record.type}`)}${rid} ${brand(`from ${domain}`)}: ${getRecordSummary(record)}`,
  );
}

export function registerDeleteCommand(program: Command): void {
  program
    .command("delete")
    .argument("<domain>", "expertise domain")
    .argument("[id]", "record ID (e.g. mx-abc123, abc123, or abc)")
    .description("Delete an expertise record or multiple records in bulk")
    .option("--records <ids>", "comma-separated list of record IDs to delete")
    .option(
      "--all-except <ids>",
      "delete all records except these comma-separated IDs",
    )
    .option(
      "--dry-run",
      "preview what would be deleted without making changes",
      false,
    )
    .action(
      async (
        domain: string,
        id: string | undefined,
        options: { records?: string; allExcept?: string; dryRun: boolean },
      ) => {
        const jsonMode = program.opts().json === true;
        try {
          const config = await readConfig();

          if (!config.domains.includes(domain)) {
            if (jsonMode) {
              outputJsonError(
                "delete",
                `Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
              );
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

          // Validate flag combinations
          const hasId = id !== undefined;
          const hasRecords = options.records !== undefined;
          const hasAllExcept = options.allExcept !== undefined;
          const modeCount = [hasId, hasRecords, hasAllExcept].filter(
            Boolean,
          ).length;

          if (modeCount === 0) {
            if (jsonMode) {
              outputJsonError(
                "delete",
                "Must provide a record ID, --records, or --all-except.",
              );
            } else {
              console.error(
                chalk.red(
                  "Error: must provide a record ID, --records, or --all-except.",
                ),
              );
            }
            process.exitCode = 1;
            return;
          }

          if (modeCount > 1) {
            if (jsonMode) {
              outputJsonError(
                "delete",
                "Cannot combine a record ID with --records or --all-except. Use only one mode.",
              );
            } else {
              console.error(
                chalk.red(
                  "Error: cannot combine a record ID with --records or --all-except. Use only one mode.",
                ),
              );
            }
            process.exitCode = 1;
            return;
          }

          const filePath = getExpertisePath(domain);

          // ── Single record delete ──────────────────────────────────────────
          if (hasId) {
            await withFileLock(filePath, async () => {
              const records = await readExpertiseFile(filePath);

              const resolved = resolveRecordId(records, id as string);
              if (!resolved.ok) {
                if (jsonMode) {
                  outputJsonError("delete", resolved.error);
                } else {
                  console.error(chalk.red(`Error: ${resolved.error}`));
                }
                process.exitCode = 1;
                return;
              }
              const targetIndex = resolved.index;
              const deleted = records[targetIndex];

              if (options.dryRun) {
                if (jsonMode) {
                  outputJson({
                    success: true,
                    command: "delete",
                    domain,
                    dryRun: true,
                    deleted: [buildDeletedInfo(deleted)],
                    kept: records.length - 1,
                  });
                } else {
                  if (!isQuiet()) {
                    printDeletedRecord(deleted, domain, true);
                  }
                }
                return;
              }

              records.splice(targetIndex, 1);
              await writeExpertiseFile(filePath, records);

              if (jsonMode) {
                outputJson({
                  success: true,
                  command: "delete",
                  domain,
                  id: deleted.id ?? null,
                  type: deleted.type,
                  summary: getRecordSummary(deleted),
                });
              } else {
                if (!isQuiet()) {
                  const rid = deleted.id ? ` ${accent(deleted.id)}` : "";
                  console.log(
                    `${brand("✓")} ${brand(`Deleted ${deleted.type}`)}${rid} ${brand(`from ${domain}`)}: ${getRecordSummary(deleted)}`,
                  );
                }
              }
            });
            return;
          }

          // ── Bulk delete: --records ────────────────────────────────────────
          if (hasRecords) {
            const ids = (options.records as string)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            if (ids.length === 0) {
              if (jsonMode) {
                outputJsonError(
                  "delete",
                  "--records requires at least one ID.",
                );
              } else {
                console.error(
                  chalk.red("Error: --records requires at least one ID."),
                );
              }
              process.exitCode = 1;
              return;
            }

            await withFileLock(filePath, async () => {
              const records = await readExpertiseFile(filePath);
              const toDeleteIndices = new Set<number>();

              for (const rawId of ids) {
                const resolved = resolveRecordId(records, rawId);
                if (!resolved.ok) {
                  if (jsonMode) {
                    outputJsonError("delete", resolved.error);
                  } else {
                    console.error(chalk.red(`Error: ${resolved.error}`));
                  }
                  process.exitCode = 1;
                  return;
                }
                toDeleteIndices.add(resolved.index);
              }

              const deleted = records.filter((_, i) => toDeleteIndices.has(i));
              const kept = records.filter((_, i) => !toDeleteIndices.has(i));

              if (!options.dryRun) {
                await writeExpertiseFile(filePath, kept);
              }

              if (jsonMode) {
                outputJson({
                  success: true,
                  command: "delete",
                  domain,
                  dryRun: options.dryRun,
                  deleted: deleted.map(buildDeletedInfo),
                  kept: kept.length,
                });
              } else {
                if (!isQuiet()) {
                  for (const r of deleted) {
                    printDeletedRecord(r, domain, options.dryRun);
                  }
                  if (!options.dryRun && deleted.length > 1) {
                    console.log(
                      brand(
                        `✓ Deleted ${deleted.length} records from ${domain}`,
                      ),
                    );
                  }
                }
              }
            });
            return;
          }

          // ── Bulk delete: --all-except ─────────────────────────────────────
          if (hasAllExcept) {
            const keepRawIds = (options.allExcept as string)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            if (keepRawIds.length === 0) {
              if (jsonMode) {
                outputJsonError(
                  "delete",
                  "--all-except requires at least one ID to keep.",
                );
              } else {
                console.error(
                  chalk.red(
                    "Error: --all-except requires at least one ID to keep.",
                  ),
                );
              }
              process.exitCode = 1;
              return;
            }

            await withFileLock(filePath, async () => {
              const records = await readExpertiseFile(filePath);
              const keepIndices = new Set<number>();

              for (const rawId of keepRawIds) {
                const resolved = resolveRecordId(records, rawId);
                if (!resolved.ok) {
                  if (jsonMode) {
                    outputJsonError("delete", resolved.error);
                  } else {
                    console.error(chalk.red(`Error: ${resolved.error}`));
                  }
                  process.exitCode = 1;
                  return;
                }
                keepIndices.add(resolved.index);
              }

              const deleted = records.filter((_, i) => !keepIndices.has(i));
              const kept = records.filter((_, i) => keepIndices.has(i));

              if (!options.dryRun) {
                await writeExpertiseFile(filePath, kept);
              }

              if (jsonMode) {
                outputJson({
                  success: true,
                  command: "delete",
                  domain,
                  dryRun: options.dryRun,
                  deleted: deleted.map(buildDeletedInfo),
                  kept: kept.length,
                });
              } else {
                if (!isQuiet()) {
                  for (const r of deleted) {
                    printDeletedRecord(r, domain, options.dryRun);
                  }
                  if (!options.dryRun && deleted.length > 1) {
                    console.log(
                      brand(
                        `✓ Deleted ${deleted.length} records from ${domain}`,
                      ),
                    );
                  }
                }
              }
            });
            return;
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            if (jsonMode) {
              outputJsonError(
                "delete",
                "No .mulch/ directory found. Run `mulch init` first.",
              );
            } else {
              console.error(
                "Error: No .mulch/ directory found. Run `mulch init` first.",
              );
            }
          } else {
            if (jsonMode) {
              outputJsonError("delete", (err as Error).message);
            } else {
              console.error(`Error: ${(err as Error).message}`);
            }
          }
          process.exitCode = 1;
        }
      },
    );
}
