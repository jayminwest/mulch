import { type Command, Option } from "commander";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
	filterByClassification,
	filterByFile,
	filterByType,
	getFileModTime,
	readExpertiseFile,
} from "../utils/expertise.ts";
import {
	formatDomainExpertise,
	formatDomainExpertiseCompact,
	formatDomainExpertisePlain,
	formatDomainExpertiseXml,
	type PrimeFormat,
} from "../utils/format.ts";
import { outputJson, outputJsonError, reportCommandError } from "../utils/json-output.ts";
import { type ScoredRecord, sortByConfirmationScore } from "../utils/scoring.ts";

function applyQueryFilters(
	records: ExpertiseRecord[],
	options: Record<string, unknown>,
): ExpertiseRecord[] {
	if (options.type) {
		records = filterByType(records, options.type as string);
	}
	if (options.classification) {
		records = filterByClassification(records, options.classification as string);
	}
	if (options.file) {
		records = filterByFile(records, options.file as string);
	}
	if (options.outcomeStatus) {
		records = records.filter((r) =>
			r.outcomes?.some((o) => o.status === (options.outcomeStatus as string)),
		);
	}
	if (options.sortByScore) {
		records = sortByConfirmationScore(records as ScoredRecord[]);
	}
	return records;
}

export function registerQueryCommand(program: Command): void {
	program
		.command("query")
		.argument("[domain]", "expertise domain to query")
		.description("Query expertise records")
		.option("--type <type>", "filter by record type")
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
			]),
		)
		.option("--sort-by-score", "sort results by confirmation-frequency score (highest first)")
		.option("--all", "show all domains")
		.addOption(
			new Option("--format <format>", "output format for records").choices([
				"markdown",
				"compact",
				"xml",
				"plain",
				"ids",
			]),
		)
		.action(async (domain: string | undefined, options: Record<string, unknown>) => {
			const jsonMode = program.opts().json === true;
			try {
				const config = await readConfig();

				const domainsToQuery: string[] = [];

				if (options.all) {
					domainsToQuery.push(...Object.keys(config.domains));
					if (domainsToQuery.length === 0) {
						if (jsonMode) {
							outputJson({ success: true, command: "query", domains: [] });
						} else {
							console.log("No domains configured. Run `ml add <domain>` to get started.");
						}
						return;
					}
				} else if (domain) {
					if (!(domain in config.domains)) {
						if (jsonMode) {
							outputJsonError(
								"query",
								`Domain "${domain}" not found in config. Available domains: ${Object.keys(config.domains).join(", ") || "(none)"}`,
							);
						} else {
							console.error(
								`Error: Domain "${domain}" not found in config. Available domains: ${Object.keys(config.domains).join(", ") || "(none)"}`,
							);
							console.error(
								`Hint: Run \`ml add ${domain}\` to create this domain, or check .mulch/mulch.config.yaml`,
							);
						}
						process.exitCode = 1;
						return;
					}
					domainsToQuery.push(domain);
				} else {
					reportCommandError(
						"query",
						jsonMode,
						"Please specify a domain or use --all to query all domains.",
					);
					return;
				}

				if (jsonMode) {
					const result: Array<{ domain: string; records: unknown[] }> = [];
					for (const d of domainsToQuery) {
						const filePath = getExpertisePath(d);
						const records = applyQueryFilters(await readExpertiseFile(filePath), options);
						result.push({ domain: d, records });
					}
					outputJson({ success: true, command: "query", domains: result });
				} else {
					const globalFormat = program.opts().format as PrimeFormat | undefined;
					const fmt =
						(options.format as string | undefined) ??
						(globalFormat as string | undefined) ??
						"markdown";
					if (fmt === "ids") {
						const ids: string[] = [];
						for (const d of domainsToQuery) {
							const filePath = getExpertisePath(d);
							const records = applyQueryFilters(await readExpertiseFile(filePath), options);
							for (const r of records) {
								if (r.id) ids.push(r.id);
							}
						}
						if (ids.length > 0) {
							console.log(ids.join("\n"));
						}
					} else {
						const sections: string[] = [];
						for (const d of domainsToQuery) {
							const filePath = getExpertisePath(d);
							const records = applyQueryFilters(await readExpertiseFile(filePath), options);
							const lastUpdated = await getFileModTime(filePath);
							switch (fmt) {
								case "compact":
									sections.push(formatDomainExpertiseCompact(d, records, lastUpdated));
									break;
								case "xml":
									sections.push(formatDomainExpertiseXml(d, records, lastUpdated));
									break;
								case "plain":
									sections.push(formatDomainExpertisePlain(d, records, lastUpdated));
									break;
								default:
									sections.push(formatDomainExpertise(d, records, lastUpdated));
									break;
							}
						}
						console.log(sections.join("\n\n"));
					}
				}
			} catch (err) {
				reportCommandError("query", jsonMode, err);
			}
		});
}
