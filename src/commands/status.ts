import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { getExpertisePath, getMulchDir, readConfig } from "../utils/config.ts";
import {
	calculateDomainHealth,
	countRecords,
	getFileModTime,
	readExpertiseFile,
} from "../utils/expertise.ts";
import { formatStatusOutput } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";

export function registerStatusCommand(program: Command): void {
	program
		.command("status")
		.description("Show status of expertise records")
		.action(async () => {
			const jsonMode = program.opts().json === true;
			const mulchDir = getMulchDir();

			if (!existsSync(mulchDir)) {
				if (jsonMode) {
					outputJsonError("status", "No .mulch/ directory found. Run `mulch init` first.");
				} else {
					console.error(chalk.red("No .mulch/ directory found. Run `mulch init` first."));
				}
				process.exitCode = 1;
				return;
			}

			const config = await readConfig();
			const observationalShelfLifeDays = config.classification_defaults.shelf_life.observational;
			const now = Date.now();

			const domainStats = await Promise.all(
				Object.keys(config.domains).map(async (domain) => {
					const filePath = getExpertisePath(domain);
					const records = await readExpertiseFile(filePath);
					const lastUpdated = await getFileModTime(filePath);
					const health = calculateDomainHealth(
						records,
						config.governance.max_entries,
						config.classification_defaults.shelf_life,
					);
					const oldestRecorded = health.oldest_timestamp ? new Date(health.oldest_timestamp) : null;
					const newestRecorded = health.newest_timestamp ? new Date(health.newest_timestamp) : null;
					let rotting = false;
					let rottingDays: number | null = null;
					if (newestRecorded) {
						const ageDays = Math.floor((now - newestRecorded.getTime()) / 86400000);
						if (ageDays > observationalShelfLifeDays) {
							rotting = true;
							rottingDays = ageDays;
						}
					}
					return {
						domain,
						count: countRecords(records),
						lastUpdated,
						oldestRecorded,
						newestRecorded,
						rotting,
						rottingDays,
						health,
					};
				}),
			);

			if (jsonMode) {
				outputJson({
					success: true,
					command: "status",
					domains: domainStats.map((s) => ({
						domain: s.domain,
						count: s.count,
						lastUpdated: s.lastUpdated?.toISOString() ?? null,
						oldest_recorded: s.oldestRecorded?.toISOString() ?? null,
						newest_recorded: s.newestRecorded?.toISOString() ?? null,
						rotting: s.rotting,
						rotting_days: s.rottingDays,
						health: s.health,
					})),
					governance: config.governance,
					shelf_life: config.classification_defaults.shelf_life,
				});
			} else {
				const output = formatStatusOutput(
					domainStats.map((s) => ({
						domain: s.domain,
						count: s.count,
						lastUpdated: s.lastUpdated,
						oldestRecorded: s.oldestRecorded,
						newestRecorded: s.newestRecorded,
						rotting: s.rotting,
						rottingDays: s.rottingDays,
					})),
					config.governance,
				);
				console.log(output);
			}
		});
}
