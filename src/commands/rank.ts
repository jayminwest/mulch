import chalk from "chalk";
import { type Command, Option } from "commander";
import { getRegistry } from "../registry/type-registry.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { filterByType, readExpertiseFile } from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { accent } from "../utils/palette.ts";
import { computeConfirmationScore, type ScoredRecord } from "../utils/scoring.ts";

interface RankedRecord {
	domain: string;
	record: ExpertiseRecord;
	score: number;
}

function formatScore(score: number): string {
	return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function registerRankCommand(program: Command): void {
	program
		.command("rank")
		.argument("[domain]", "limit ranking to a specific domain")
		.description("Rank records by confirmation-frequency score (highest first)")
		.addOption(new Option("--type <type>", "filter by record type").choices(getRegistry().names()))
		.option("--limit <n>", "return at most N records", "10")
		.option(
			"--min-score <n>",
			"exclude records whose confirmation score is below N (default: 0, i.e. include all)",
			"0",
		)
		.action(
			async (
				domain: string | undefined,
				options: { type?: string; limit: string; minScore: string },
			) => {
				const jsonMode = program.opts().json === true;
				try {
					const limit = Number.parseInt(options.limit, 10);
					if (Number.isNaN(limit) || limit < 1) {
						const msg = "--limit must be a positive integer.";
						if (jsonMode) {
							outputJsonError("rank", msg);
						} else {
							console.error(chalk.red(`Error: ${msg}`));
						}
						process.exitCode = 1;
						return;
					}

					const minScore = Number.parseFloat(options.minScore);
					if (Number.isNaN(minScore) || minScore < 0) {
						const msg = "--min-score must be a non-negative number.";
						if (jsonMode) {
							outputJsonError("rank", msg);
						} else {
							console.error(chalk.red(`Error: ${msg}`));
						}
						process.exitCode = 1;
						return;
					}

					const config = await readConfig();

					let domainsToRank: string[];
					if (domain) {
						if (!(domain in config.domains)) {
							const available = Object.keys(config.domains).join(", ") || "(none)";
							const msg = `Domain "${domain}" not found in config. Available domains: ${available}`;
							if (jsonMode) {
								outputJsonError("rank", msg);
							} else {
								console.error(chalk.red(`Error: ${msg}`));
								console.error(
									`Hint: Run \`ml add ${domain}\` to create this domain, or check .mulch/mulch.config.yaml`,
								);
							}
							process.exitCode = 1;
							return;
						}
						domainsToRank = [domain];
					} else {
						domainsToRank = Object.keys(config.domains);
					}

					const ranked: RankedRecord[] = [];
					for (const d of domainsToRank) {
						const filePath = getExpertisePath(d);
						let records = await readExpertiseFile(filePath);
						if (options.type) {
							records = filterByType(records, options.type);
						}
						for (const record of records) {
							const score = computeConfirmationScore(record as ScoredRecord);
							if (score < minScore) continue;
							ranked.push({ domain: d, record, score });
						}
					}

					ranked.sort((a, b) => b.score - a.score);

					const top = ranked.slice(0, limit);

					if (jsonMode) {
						outputJson({
							success: true,
							command: "rank",
							count: top.length,
							records: top.map((e) => ({
								domain: e.domain,
								id: e.record.id ?? null,
								type: e.record.type,
								score: e.score,
								summary: getRecordSummary(e.record),
								record: e.record,
							})),
						});
						return;
					}

					if (top.length === 0) {
						console.log("No records match the ranking criteria.");
						return;
					}

					const scope = domain ?? "all domains";
					console.log(
						`Top ${top.length} record${top.length === 1 ? "" : "s"} by confirmation score (${scope})`,
					);
					console.log("");

					for (const entry of top) {
						const id = entry.record.id ? `${accent(entry.record.id)}  ` : "";
						const score = chalk.green(`★${formatScore(entry.score)}`.padEnd(6));
						const domainCol = chalk.cyan(entry.domain.padEnd(14));
						const type = chalk.yellow(`[${entry.record.type}]`.padEnd(14));
						const summary = getRecordSummary(entry.record);
						console.log(`  ${id}${score}${domainCol}${type}${summary}`);
					}
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === "ENOENT") {
						const msg = "No .mulch/ directory found. Run `ml init` first.";
						if (jsonMode) {
							outputJsonError("rank", msg);
						} else {
							console.error(`Error: ${msg}`);
						}
					} else {
						const msg = (err as Error).message;
						if (jsonMode) {
							outputJsonError("rank", msg);
						} else {
							console.error(`Error: ${msg}`);
						}
					}
					process.exitCode = 1;
				}
			},
		);
}
