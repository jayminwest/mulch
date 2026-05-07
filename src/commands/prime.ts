import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { getRegistry } from "../registry/type-registry.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import type { DomainRecords } from "../utils/budget.ts";
import { applyBudget, DEFAULT_BUDGET, formatBudgetSummary } from "../utils/budget.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { getFileModTime, readExpertiseFile } from "../utils/expertise.ts";
import type { JsonDomain, ManifestDomain, PrimeFormat } from "../utils/format.ts";
import {
	buildManifestPayload,
	computeTypeCounts,
	formatDomainExpertise,
	formatDomainExpertiseCompact,
	formatDomainExpertisePlain,
	formatDomainExpertiseXml,
	formatJsonOutput,
	formatPrimeManifest,
	formatPrimeOutput,
	formatPrimeOutputCompact,
	formatPrimeOutputPlain,
	formatPrimeOutputXml,
	getSessionEndReminder,
} from "../utils/format.ts";
import { filterByContext, getChangedFiles, isGitRepo } from "../utils/git.ts";
import { runHooks } from "../utils/hooks.ts";
import { outputJsonError } from "../utils/json-output.ts";
import { brand, isQuiet } from "../utils/palette.ts";

interface PrimeOptions {
	full?: boolean;
	compact?: boolean;
	manifest?: boolean;
	export?: string;
	domain?: string[];
	excludeDomain?: string[];
	context?: boolean;
	files?: string[];
	budget?: string;
	noLimit?: boolean;
}

function resolvePrimeFormat(
	options: PrimeOptions,
	globalFormat: PrimeFormat | undefined,
): PrimeFormat {
	if (globalFormat) return globalFormat;
	if (options.full) return "markdown";
	if (options.compact) return "compact";
	return "compact";
}

/**
 * Produce a rough text representation of a record for token estimation.
 * Delegates to the type registry so custom types and unknown-but-tolerated
 * types (via --allow-unknown-types) get a non-undefined estimate.
 */
export function estimateRecordText(record: ExpertiseRecord): string {
	const def = getRegistry().get(record.type);
	if (!def) return `[${record.type}]`;
	return def.formatCompactLine(record);
}

export function registerPrimeCommand(program: Command): void {
	program
		.command("prime")
		.description("Generate a priming prompt from expertise records")
		.argument("[domains...]", "optional domain(s) to scope output to")
		.option("--compact", "alias for --format compact")
		.option("--full", "alias for --format markdown (full record details)")
		.option("--manifest", "emit a domain index instead of full records (for monolith projects)")
		.option("--domain <domains...>", "domain(s) to include")
		.option("--exclude-domain <domains...>", "domain(s) to exclude")
		.option("--context", "filter records to only those relevant to changed files")
		.option("--files <paths...>", "filter records to only those relevant to specified files")
		.option("--export <path>", "export output to a file")
		.option("--budget <tokens>", `token budget for output (default: ${DEFAULT_BUDGET})`)
		.option("--no-limit", "disable token budget limit")
		.action(async (domainsArg: string[], options: PrimeOptions) => {
			const globalOpts = program.opts();
			const jsonMode = globalOpts.json === true;
			const verbose = globalOpts.verbose === true;
			try {
				const config = await readConfig();
				const format = resolvePrimeFormat(options, globalOpts.format as PrimeFormat | undefined);

				if (options.manifest && options.full) {
					const msg = "Cannot combine --manifest with --full.";
					if (jsonMode) {
						outputJsonError("prime", msg);
					} else {
						console.error(`Error: ${msg}`);
					}
					process.exitCode = 1;
					return;
				}

				const requested = [...domainsArg, ...(options.domain ?? [])];
				const unique = [...new Set(requested)];

				const isScoped =
					unique.length > 0 ||
					(options.excludeDomain ?? []).length > 0 ||
					options.context === true ||
					(options.files !== undefined && options.files.length > 0);

				if (options.manifest && isScoped) {
					const msg =
						"--manifest cannot be combined with scoping arguments. Manifest mode lists available domains; use `ml prime <domain>` or `ml prime --files <path>` to load records.";
					if (jsonMode) {
						outputJsonError("prime", msg);
					} else {
						console.error(`Error: ${msg}`);
					}
					process.exitCode = 1;
					return;
				}

				const configMode = config.prime?.default_mode ?? "full";
				const effectiveMode: "manifest" | "full" = options.manifest
					? "manifest"
					: options.full
						? "full"
						: configMode;
				const useManifest = effectiveMode === "manifest" && !isScoped;

				for (const d of unique) {
					if (!(d in config.domains)) {
						if (jsonMode) {
							outputJsonError(
								"prime",
								`Domain "${d}" not found in config. Available domains: ${Object.keys(config.domains).join(", ")}`,
							);
						} else {
							console.error(
								`Error: Domain "${d}" not found in config. Available domains: ${Object.keys(config.domains).join(", ")}`,
							);
							console.error(
								`Hint: Run \`ml add ${d}\` to create this domain, or check .mulch/mulch.config.yaml`,
							);
						}
						process.exitCode = 1;
						return;
					}
				}

				const excluded = options.excludeDomain ?? [];
				for (const d of excluded) {
					if (!(d in config.domains)) {
						if (jsonMode) {
							outputJsonError(
								"prime",
								`Excluded domain "${d}" not found in config. Available domains: ${Object.keys(config.domains).join(", ")}`,
							);
						} else {
							console.error(
								`Error: Excluded domain "${d}" not found in config. Available domains: ${Object.keys(config.domains).join(", ")}`,
							);
							console.error(
								`Hint: Run \`ml add ${d}\` to create this domain, or check .mulch/mulch.config.yaml`,
							);
						}
						process.exitCode = 1;
						return;
					}
				}

				let targetDomains = unique.length > 0 ? unique : Object.keys(config.domains);

				targetDomains = targetDomains.filter((d) => !excluded.includes(d));

				// Resolve changed files for --context or --files filtering
				let filesToFilter: string[] | undefined;
				if (options.context) {
					const cwd = process.cwd();
					if (!isGitRepo(cwd)) {
						const msg = "Not in a git repository. --context requires git.";
						if (jsonMode) {
							outputJsonError("prime", msg);
						} else {
							console.error(`Error: ${msg}`);
						}
						process.exitCode = 1;
						return;
					}
					filesToFilter = getChangedFiles(cwd, "HEAD~1");
					if (filesToFilter.length === 0) {
						if (jsonMode) {
							outputJsonError("prime", "No changed files found. Nothing to filter by.");
						} else {
							console.log("No changed files found. Nothing to filter by.");
						}
						return;
					}
				} else if (options.files && options.files.length > 0) {
					filesToFilter = options.files;
				}

				// Determine budget settings
				const budgetEnabled = !jsonMode && options.noLimit !== true;
				const budget = options.budget ? Number.parseInt(options.budget, 10) : DEFAULT_BUDGET;

				let output: string;

				if (useManifest) {
					const manifestDomains: ManifestDomain[] = [];
					for (const domain of targetDomains) {
						const filePath = getExpertisePath(domain);
						const records = await readExpertiseFile(filePath);
						const lastUpdated = await getFileModTime(filePath);
						manifestDomains.push({
							domain,
							count: records.length,
							lastUpdated,
							typeCounts: computeTypeCounts(records),
						});
					}

					if (jsonMode) {
						output = JSON.stringify(
							buildManifestPayload(manifestDomains, config.governance),
							null,
							2,
						);
					} else {
						output = formatPrimeManifest(manifestDomains, config.governance, format);
						output += `\n\n${getSessionEndReminder(format)}`;
					}
				} else {
					// Load records once, fire pre-prime, then dispatch to formatter.
					// Hook payload is { domains: [{ domain, records }] }; mutation
					// allowed (script can drop records or whole domains by returning a
					// filtered list).
					interface LoadedDomain {
						domain: string;
						records: ExpertiseRecord[];
						lastUpdated: Date | null;
					}
					const loaded: LoadedDomain[] = [];
					for (const domain of targetDomains) {
						const filePath = getExpertisePath(domain);
						let records = await readExpertiseFile(filePath);
						if (filesToFilter) {
							records = filterByContext(records, filesToFilter);
							if (records.length === 0 && !jsonMode) continue;
						}
						const lastUpdated = await getFileModTime(filePath);
						loaded.push({ domain, records, lastUpdated });
					}

					const hookPayload = {
						domains: loaded.map(({ domain, records }) => ({ domain, records })),
					};
					const hookRes = await runHooks<typeof hookPayload>("pre-prime", hookPayload);
					if (hookRes.blocked) {
						const reason = hookRes.blockReason ?? "pre-prime hook blocked output";
						if (jsonMode) {
							outputJsonError("prime", reason);
						} else {
							console.error(`Error: ${reason}`);
						}
						process.exitCode = 1;
						return;
					}
					for (const w of hookRes.warnings) {
						if (!jsonMode) console.error(`Warning: ${w}`);
					}
					// If a hook mutated the payload, replace records on a per-domain
					// basis (matching original order); a hook-emitted domain not in
					// `loaded` is ignored to prevent surfacing data the user didn't ask
					// for in the budget/format paths.
					const mutatedByDomain = new Map<string, ExpertiseRecord[]>();
					if (hookRes.ranAny && hookRes.payload?.domains) {
						for (const d of hookRes.payload.domains) {
							if (d && typeof d.domain === "string" && Array.isArray(d.records)) {
								mutatedByDomain.set(d.domain, d.records);
							}
						}
					}
					const finalLoaded: LoadedDomain[] = loaded.map((l) => {
						const mut = mutatedByDomain.get(l.domain);
						return mut ? { ...l, records: mut } : l;
					});

					if (jsonMode) {
						const domains: JsonDomain[] = [];
						for (const { domain, records } of finalLoaded) {
							if (!filesToFilter || records.length > 0) {
								domains.push({ domain, entry_count: records.length, records });
							}
						}
						output = formatJsonOutput(domains);
					} else {
						// Reconstruct legacy structures for the existing budget+format pipeline.
						const allDomainRecords: DomainRecords[] = finalLoaded.map(({ domain, records }) => ({
							domain,
							records,
						}));
						const modTimes = new Map<string, Date | null>();
						for (const { domain, lastUpdated } of finalLoaded) {
							modTimes.set(domain, lastUpdated);
						}

						// Apply budget filtering
						let domainRecordsToFormat: DomainRecords[];
						let droppedCount = 0;
						let droppedDomainCount = 0;

						if (budgetEnabled) {
							const result = applyBudget(allDomainRecords, budget, (record) =>
								estimateRecordText(record),
							);
							domainRecordsToFormat = result.kept;
							droppedCount = result.droppedCount;
							droppedDomainCount = result.droppedDomainCount;
						} else {
							domainRecordsToFormat = allDomainRecords;
						}

						// Format domain sections
						const domainSections: string[] = [];
						for (const { domain, records } of domainRecordsToFormat) {
							const lastUpdated = modTimes.get(domain) ?? null;

							switch (format) {
								case "xml":
									domainSections.push(formatDomainExpertiseXml(domain, records, lastUpdated));
									break;
								case "plain":
									domainSections.push(formatDomainExpertisePlain(domain, records, lastUpdated));
									break;
								case "compact":
									domainSections.push(formatDomainExpertiseCompact(domain, records, lastUpdated));
									break;
								default:
									domainSections.push(
										formatDomainExpertise(domain, records, lastUpdated, {
											full: options.full || verbose,
										}),
									);
									break;
							}
						}

						switch (format) {
							case "xml":
								output = formatPrimeOutputXml(domainSections);
								break;
							case "plain":
								output = formatPrimeOutputPlain(domainSections);
								break;
							case "compact":
								output = formatPrimeOutputCompact(domainSections);
								break;
							default:
								output = formatPrimeOutput(domainSections);
								break;
						}

						// Append truncation summary before session reminder
						if (droppedCount > 0) {
							output += `\n\n${formatBudgetSummary(droppedCount, droppedDomainCount)}`;
						}

						output += `\n\n${getSessionEndReminder(format)}`;
					}
				}

				if (options.export) {
					await writeFile(options.export, `${output}\n`, "utf-8");
					if (!jsonMode && !isQuiet()) {
						console.log(`${brand("✓")} ${brand(`Exported to ${options.export}`)}`);
					}
				} else {
					console.log(output);
				}
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					if (jsonMode) {
						outputJsonError("prime", "No .mulch/ directory found. Run `mulch init` first.");
					} else {
						console.error("Error: No .mulch/ directory found. Run `mulch init` first.");
					}
				} else {
					if (jsonMode) {
						outputJsonError("prime", (err as Error).message);
					} else {
						console.error(`Error: ${(err as Error).message}`);
					}
				}
				process.exitCode = 1;
			}
		});
}
