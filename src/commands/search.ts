import { type Command, Option } from "commander";
import { getRegistry } from "../registry/type-registry.ts";
import { DEFAULT_SEARCH_BOOST_FACTOR } from "../schemas/config.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getArchivePath, readArchiveFile } from "../utils/archive.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
	filterByClassification,
	filterByFile,
	filterByType,
	getFileModTime,
	readExpertiseFile,
	searchRecords,
} from "../utils/expertise.ts";
import {
	formatDomainExpertise,
	formatDomainExpertiseCompact,
	formatDomainExpertisePlain,
	formatDomainExpertiseXml,
	getRecordSummary,
	type PrimeFormat,
} from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { type ScoredRecord, sortByConfirmationScore } from "../utils/scoring.ts";

function formatArchivedSection(domain: string, records: ExpertiseRecord[]): string {
	const lines = [
		`## ${domain} (archived, ${records.length} record${records.length === 1 ? "" : "s"})`,
	];
	for (const r of records) {
		const date = (r.archived_at ?? "").slice(0, 10) || "unknown";
		const id = r.id ? `${r.id} ` : "";
		// Archives written before mulch-b41a have no reason on disk; omit the
		// suffix gracefully so back-compat output stays readable.
		const reason = r.archive_reason ? ` ${r.archive_reason}` : "";
		lines.push(`- [ARCHIVED ${date}${reason}] ${id}[${r.type}] ${getRecordSummary(r)}`);
	}
	return lines.join("\n");
}

function applyFilters(
	records: ExpertiseRecord[],
	options: {
		type?: string;
		tag?: string;
		classification?: string;
		file?: string;
		outcomeStatus?: string;
	},
): ExpertiseRecord[] {
	let out = records;
	if (options.type) out = filterByType(out, options.type);
	if (options.tag) {
		const tagLower = options.tag.toLowerCase();
		out = out.filter((r) => r.tags?.some((t) => t.toLowerCase() === tagLower));
	}
	if (options.classification) out = filterByClassification(out, options.classification);
	if (options.file) out = filterByFile(out, options.file);
	if (options.outcomeStatus) {
		out = out.filter((r) => r.outcomes?.some((o) => o.status === options.outcomeStatus));
	}
	return out;
}

export function registerSearchCommand(program: Command): void {
	program
		.command("search")
		.argument("[query]", "search string (case-insensitive substring match)")
		.description("Search expertise records across domains")
		.option("--domain <domain>", "limit search to a specific domain")
		.addOption(new Option("--type <type>", "filter by record type").choices(getRegistry().names()))
		.option("--tag <tag>", "filter by tag")
		.addOption(
			new Option("--classification <classification>", "filter by classification").choices([
				"foundational",
				"tactical",
				"observational",
			]),
		)
		.option("--file <file>", "filter by associated file path (substring match)")
		.addOption(
			new Option("--outcome-status <status>", "filter by outcome status").choices([
				"success",
				"failure",
				"partial",
			]),
		)
		.option("--sort-by-score", "sort results by confirmation-frequency score (highest first)")
		.option("--no-boost", "disable confirmation-frequency boost on BM25 ranking (pure BM25)")
		.option(
			"--archived",
			"include soft-archived records from .mulch/archive/ (excluded by default)",
		)
		.addOption(
			new Option("--format <format>", "output format for records").choices([
				"markdown",
				"compact",
				"xml",
				"plain",
				"ids",
			]),
		)
		.action(
			async (
				query: string | undefined,
				options: {
					domain?: string;
					type?: string;
					tag?: string;
					classification?: string;
					file?: string;
					outcomeStatus?: string;
					sortByScore?: boolean;
					boost?: boolean;
					format?: string;
					archived?: boolean;
				},
			) => {
				const jsonMode = program.opts().json === true;
				try {
					if (
						!query &&
						!options.type &&
						!options.domain &&
						!options.tag &&
						!options.classification &&
						!options.file &&
						!options.outcomeStatus
					) {
						if (jsonMode) {
							outputJsonError(
								"search",
								"Provide a search query or use --type, --domain, --tag, --classification, --file, or --outcome-status to filter.",
							);
						} else {
							console.error(
								"Error: Provide a search query or use --type, --domain, --tag, --classification, --file, or --outcome-status to filter.",
							);
						}
						process.exitCode = 1;
						return;
					}

					const config = await readConfig();
					const boostFactor =
						options.boost === false
							? 0
							: (config.search?.boost_factor ?? DEFAULT_SEARCH_BOOST_FACTOR);

					let domainsToSearch: string[];

					if (options.domain) {
						if (!(options.domain in config.domains)) {
							if (jsonMode) {
								outputJsonError(
									"search",
									`Domain "${options.domain}" not found in config. Available domains: ${Object.keys(config.domains).join(", ")}`,
								);
							} else {
								console.error(
									`Error: Domain "${options.domain}" not found in config. Available domains: ${Object.keys(config.domains).join(", ")}`,
								);
								console.error(
									`Hint: Run \`mulch add ${options.domain}\` to create this domain, or check .mulch/mulch.config.yaml`,
								);
							}
							process.exitCode = 1;
							return;
						}
						domainsToSearch = [options.domain];
					} else {
						domainsToSearch = Object.keys(config.domains);
					}

					let totalMatches = 0;

					if (jsonMode) {
						const result: Array<{
							domain: string;
							matches: unknown[];
							archived?: unknown[];
						}> = [];
						for (const domain of domainsToSearch) {
							const filePath = getExpertisePath(domain);
							const records = applyFilters(await readExpertiseFile(filePath), options);
							let matches = query ? searchRecords(records, query, { boostFactor }) : records;
							if (options.sortByScore) {
								matches = sortByConfirmationScore(matches as ScoredRecord[]);
							}
							let archivedMatches: ExpertiseRecord[] = [];
							if (options.archived) {
								const archiveRecords = applyFilters(
									await readArchiveFile(getArchivePath(domain)),
									options,
								);
								archivedMatches = query
									? searchRecords(archiveRecords, query, { boostFactor })
									: archiveRecords;
								if (options.sortByScore) {
									archivedMatches = sortByConfirmationScore(archivedMatches as ScoredRecord[]);
								}
							}
							if (matches.length > 0 || archivedMatches.length > 0) {
								totalMatches += matches.length + archivedMatches.length;
								const entry: { domain: string; matches: unknown[]; archived?: unknown[] } = {
									domain,
									matches,
								};
								if (options.archived) entry.archived = archivedMatches;
								result.push(entry);
							}
						}
						outputJson({
							success: true,
							command: "search",
							query: query ?? null,
							total: totalMatches,
							domains: result,
						});
					} else {
						const globalFormat = program.opts().format as PrimeFormat | undefined;
						const fmt = options.format ?? (globalFormat as string | undefined) ?? "markdown";
						const label = query ? `matching "${query}"` : "matching filters";

						if (fmt === "ids") {
							const ids: string[] = [];
							for (const domain of domainsToSearch) {
								const filePath = getExpertisePath(domain);
								const records = applyFilters(await readExpertiseFile(filePath), options);
								let matches = query ? searchRecords(records, query, { boostFactor }) : records;
								if (options.sortByScore) {
									matches = sortByConfirmationScore(matches as ScoredRecord[]);
								}
								for (const r of matches) {
									if (r.id) ids.push(r.id);
								}
								if (options.archived) {
									const archiveRecords = applyFilters(
										await readArchiveFile(getArchivePath(domain)),
										options,
									);
									let archivedMatches = query
										? searchRecords(archiveRecords, query, { boostFactor })
										: archiveRecords;
									if (options.sortByScore) {
										archivedMatches = sortByConfirmationScore(archivedMatches as ScoredRecord[]);
									}
									for (const r of archivedMatches) {
										if (r.id) ids.push(r.id);
									}
								}
							}
							if (ids.length === 0) {
								console.log(`No records ${label} found.`);
							} else {
								console.log(ids.join("\n"));
							}
						} else {
							const sections: string[] = [];
							for (const domain of domainsToSearch) {
								const filePath = getExpertisePath(domain);
								const records = applyFilters(await readExpertiseFile(filePath), options);
								const lastUpdated = await getFileModTime(filePath);
								let matches = query ? searchRecords(records, query, { boostFactor }) : records;
								if (options.sortByScore) {
									matches = sortByConfirmationScore(matches as ScoredRecord[]);
								}
								if (matches.length > 0) {
									totalMatches += matches.length;
									switch (fmt) {
										case "compact":
											sections.push(formatDomainExpertiseCompact(domain, matches, lastUpdated));
											break;
										case "xml":
											sections.push(formatDomainExpertiseXml(domain, matches, lastUpdated));
											break;
										case "plain":
											sections.push(formatDomainExpertisePlain(domain, matches, lastUpdated));
											break;
										default:
											sections.push(formatDomainExpertise(domain, matches, lastUpdated));
											break;
									}
								}
								if (options.archived) {
									const archiveRecords = applyFilters(
										await readArchiveFile(getArchivePath(domain)),
										options,
									);
									let archivedMatches = query
										? searchRecords(archiveRecords, query, { boostFactor })
										: archiveRecords;
									if (options.sortByScore) {
										archivedMatches = sortByConfirmationScore(archivedMatches as ScoredRecord[]);
									}
									if (archivedMatches.length > 0) {
										totalMatches += archivedMatches.length;
										sections.push(formatArchivedSection(domain, archivedMatches));
									}
								}
							}

							if (sections.length === 0) {
								console.log(`No records ${label} found.`);
							} else {
								console.log(sections.join("\n\n"));
								console.log(`\n${totalMatches} match${totalMatches === 1 ? "" : "es"} found.`);
							}
						}
					}
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === "ENOENT") {
						if (jsonMode) {
							outputJsonError("search", "No .mulch/ directory found. Run `mulch init` first.");
						} else {
							console.error("Error: No .mulch/ directory found. Run `mulch init` first.");
						}
					} else {
						if (jsonMode) {
							outputJsonError("search", (err as Error).message);
						} else {
							console.error(`Error: ${(err as Error).message}`);
						}
					}
					process.exitCode = 1;
				}
			},
		);
}
