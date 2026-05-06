import chalk from "chalk";
import type { Command } from "commander";
import type { Classification, ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile, writeExpertiseFile } from "../utils/expertise.ts";
import { runHooks } from "../utils/hooks.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { brand, isQuiet } from "../utils/palette.ts";

interface PruneResult {
	domain: string;
	before: number;
	pruned: number;
	after: number;
}

export function isStale(
	record: ExpertiseRecord,
	now: Date,
	shelfLife: { tactical: number; observational: number },
): boolean {
	const classification: Classification = record.classification;

	if (classification === "foundational") {
		return false;
	}

	const recordedAt = new Date(record.recorded_at);
	const ageInDays = Math.floor((now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60 * 24));

	if (classification === "tactical") {
		return ageInDays > shelfLife.tactical;
	}

	if (classification === "observational") {
		return ageInDays > shelfLife.observational;
	}

	return false;
}

export function registerPruneCommand(program: Command): void {
	program
		.command("prune")
		.description("Remove outdated or low-value expertise records")
		.option("--dry-run", "Show what would be pruned without removing", false)
		.action(async (options: { dryRun: boolean }) => {
			const jsonMode = program.opts().json === true;
			const config = await readConfig();
			const now = new Date();
			const shelfLife = config.classification_defaults.shelf_life;
			const results: PruneResult[] = [];
			let totalPruned = 0;

			// Phase 1 — preview: gather candidates across all domains without
			// locking. Locks are taken in phase 3 only for domains that actually
			// have stale records, so a no-op prune doesn't block other writers.
			const candidatesByDomain: Array<{ domain: string; records: ExpertiseRecord[] }> = [];
			for (const domain of Object.keys(config.domains)) {
				const filePath = getExpertisePath(domain);
				const records = await readExpertiseFile(filePath);
				const stale = records.filter((r) => isStale(r, now, shelfLife));
				if (stale.length > 0) {
					candidatesByDomain.push({ domain, records: stale });
				}
			}

			// Phase 2 — pre-prune hook. Skipped in dry-run since hooks like
			// digest-then-confirm imply user interaction that shouldn't fire on a
			// preview. Block-on-non-zero, no payload mutation per spec.
			if (!options.dryRun && candidatesByDomain.length > 0) {
				const hookRes = await runHooks("pre-prune", { candidates: candidatesByDomain });
				if (hookRes.blocked) {
					const reason = hookRes.blockReason ?? "pre-prune hook blocked";
					if (jsonMode) {
						outputJsonError("prune", reason);
					} else {
						console.error(chalk.red(`Error: ${reason}`));
					}
					process.exitCode = 1;
					return;
				}
				for (const w of hookRes.warnings) {
					if (!jsonMode) console.error(chalk.yellow(`Warning: ${w}`));
				}
			}

			// Phase 3 — perform writes. Re-read under the lock to absorb any
			// records added since phase 1, then drop stale ones. Domains with no
			// stale candidates are not relocked.
			const candidateDomains = new Set(candidatesByDomain.map((c) => c.domain));
			for (const domain of Object.keys(config.domains)) {
				if (!candidateDomains.has(domain)) continue;
				const filePath = getExpertisePath(domain);

				const domainResult = await withFileLock(filePath, async () => {
					const records = await readExpertiseFile(filePath);

					if (records.length === 0) {
						return null;
					}

					const kept: ExpertiseRecord[] = [];
					let pruned = 0;

					for (const record of records) {
						if (isStale(record, now, shelfLife)) {
							pruned++;
						} else {
							kept.push(record);
						}
					}

					if (pruned > 0) {
						if (!options.dryRun) {
							await writeExpertiseFile(filePath, kept);
						}
						return {
							domain,
							before: records.length,
							pruned,
							after: kept.length,
						};
					}
					return null;
				});

				if (domainResult) {
					results.push(domainResult);
					totalPruned += domainResult.pruned;
				}
			}

			if (jsonMode) {
				outputJson({
					success: true,
					command: "prune",
					dryRun: options.dryRun,
					totalPruned,
					results,
				});
				return;
			}

			if (totalPruned === 0) {
				if (!isQuiet()) console.log(brand("No stale records found. All records are current."));
				return;
			}

			const label = options.dryRun ? "Would prune" : "Pruned";
			const prefix = options.dryRun ? chalk.yellow("[DRY RUN] ") : "";

			for (const result of results) {
				if (!isQuiet())
					console.log(
						`${prefix}${chalk.cyan(result.domain)}: ${label} ${chalk.red(String(result.pruned))} of ${result.before} records (${result.after} remaining)`,
					);
			}

			if (!isQuiet())
				console.log(
					`\n${prefix}${chalk.bold(`Total: ${label.toLowerCase()} ${totalPruned} stale ${totalPruned === 1 ? "record" : "records"}.`)}`,
				);
		});
}
