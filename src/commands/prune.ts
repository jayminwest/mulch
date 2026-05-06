import chalk from "chalk";
import type { Command } from "commander";
import {
	DEFAULT_ANCHOR_VALIDITY_GRACE_DAYS,
	DEFAULT_ANCHOR_VALIDITY_THRESHOLD,
} from "../schemas/config.ts";
import type { Classification, ExpertiseRecord } from "../schemas/record.ts";
import {
	type AnchorValidity,
	computeAnchorValidity,
	passedAnchorGrace,
} from "../utils/anchor-validity.ts";
import { archiveRecords } from "../utils/archive.ts";
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
	demoted: number;
	anchor_demoted: number;
	supersession_demoted: number;
	after: number;
}

type DemotionReason = "supersession" | "anchor_decay";

interface DemotionExplain {
	domain: string;
	id?: string;
	type: string;
	from: Classification;
	// "archived" when the record bottomed out and moved to the archive (or was
	// hard-deleted with --hard).
	to: Classification | "archived";
	reasons: DemotionReason[];
	anchors?: {
		valid_fraction: number;
		valid: number;
		total: number;
		broken: { kind: string; path: string }[];
	};
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

/**
 * Next classification tier in the supersession-demotion ladder. Returns null
 * when the record has bottomed out and should be archived (or hard-deleted
 * with --hard).
 */
function nextDemotionTier(c: Classification): Classification | null {
	if (c === "foundational") return "tactical";
	if (c === "tactical") return "observational";
	return null;
}

/**
 * Set of record IDs referenced by any live record's `supersedes` field,
 * unioned across every domain. Cross-domain by design — supersession is
 * content-relational, not domain-bound. Self-references are filtered out.
 */
function collectSupersededIds(
	liveByDomain: ReadonlyArray<{ records: ExpertiseRecord[] }>,
): Set<string> {
	const superseded = new Set<string>();
	for (const { records } of liveByDomain) {
		for (const r of records) {
			if (!r.supersedes || r.supersedes.length === 0) continue;
			for (const targetId of r.supersedes) {
				if (targetId === r.id) continue;
				superseded.add(targetId);
			}
		}
	}
	return superseded;
}

export function registerPruneCommand(program: Command): void {
	program
		.command("prune")
		.description(
			"Soft-archive (default) or hard-delete stale records, plus tier-demote superseded ones",
		)
		.option("--dry-run", "Show what would be pruned without removing", false)
		.option(
			"--hard",
			"Permanently delete stale records instead of moving them to .mulch/archive/",
			false,
		)
		.option(
			"--aggressive",
			"Collapse superseded records straight to archived in one pass instead of one tier at a time",
			false,
		)
		.option(
			"--check-anchors",
			"Demote records whose file/dir anchors no longer resolve (R-05f)",
			false,
		)
		.option(
			"--explain",
			"Print per-record reasons for each demotion (anchor list + decision)",
			false,
		)
		.action(
			async (options: {
				dryRun: boolean;
				hard: boolean;
				aggressive: boolean;
				checkAnchors: boolean;
				explain: boolean;
			}) => {
				const jsonMode = program.opts().json === true;
				const config = await readConfig();
				const now = new Date();
				const shelfLife = config.classification_defaults.shelf_life;
				const projectRoot = process.cwd();
				const anchorCfg = config.decay?.anchor_validity ?? {};
				const anchorThreshold = anchorCfg.threshold ?? DEFAULT_ANCHOR_VALIDITY_THRESHOLD;
				const anchorGrace = anchorCfg.grace_days ?? DEFAULT_ANCHOR_VALIDITY_GRACE_DAYS;

				const results: PruneResult[] = [];
				const explanations: DemotionExplain[] = [];
				let totalPruned = 0;
				let totalDemoted = 0;
				let totalAnchorDemoted = 0;
				let totalSupersessionDemoted = 0;

				// Phase 1 — preview: load every live record across all domains so
				// we can detect staleness candidates AND build the cross-domain
				// supersession set in one pass. No locks here; phase 3 re-reads
				// each candidate domain under its lock so concurrent writers don't
				// lose data.
				const liveByDomain: Array<{ domain: string; records: ExpertiseRecord[] }> = [];
				for (const domain of Object.keys(config.domains)) {
					const filePath = getExpertisePath(domain);
					const records = await readExpertiseFile(filePath);
					liveByDomain.push({ domain, records });
				}

				const supersededIds = collectSupersededIds(liveByDomain);

				// Per-record anchor validity, keyed by record id (only when
				// --check-anchors is set). Records with no id are evaluated inline
				// inside phase 3 since they can't be looked up cross-pass.
				const anchorValidityById = new Map<string, AnchorValidity>();
				if (options.checkAnchors) {
					for (const { records } of liveByDomain) {
						for (const r of records) {
							if (!r.id) continue;
							anchorValidityById.set(r.id, computeAnchorValidity(r, projectRoot));
						}
					}
				}

				const isAnchorDecayed = (r: ExpertiseRecord): AnchorValidity | null => {
					if (!options.checkAnchors) return null;
					if (!passedAnchorGrace(r, now, anchorGrace)) return null;
					const v = r.id ? anchorValidityById.get(r.id) : computeAnchorValidity(r, projectRoot);
					if (!v) return null;
					if (v.validFraction === null) return null; // exempt: zero anchors
					if (v.validFraction >= anchorThreshold) return null;
					return v;
				};

				const candidatesByDomain: Array<{
					domain: string;
					stale: ExpertiseRecord[];
					demote: ExpertiseRecord[];
					anchor_decay: ExpertiseRecord[];
				}> = [];
				for (const { domain, records } of liveByDomain) {
					const stale = records.filter((r) => isStale(r, now, shelfLife));
					const staleIds = new Set(stale.map((r) => r.id).filter((id): id is string => !!id));
					const demote = records.filter(
						(r) => r.id !== undefined && supersededIds.has(r.id) && !staleIds.has(r.id),
					);
					const anchor_decay = records.filter(
						(r) => isAnchorDecayed(r) !== null && !stale.includes(r),
					);
					if (stale.length > 0 || demote.length > 0 || anchor_decay.length > 0) {
						candidatesByDomain.push({ domain, stale, demote, anchor_decay });
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
				// records added since phase 1. Staleness wins over supersession on a
				// record that hits both: no point demoting something we're already
				// archiving. A record that's both superseded AND anchor-decayed
				// still demotes only one tier per pass; both reasons get stamped
				// onto the kept record.
				const candidateDomains = new Set(candidatesByDomain.map((c) => c.domain));
				for (const domain of Object.keys(config.domains)) {
					if (!candidateDomains.has(domain)) continue;
					const filePath = getExpertisePath(domain);

					const archived: ExpertiseRecord[] = [];
					const domainExplanations: DemotionExplain[] = [];
					const domainResult = await withFileLock(filePath, async () => {
						const records = await readExpertiseFile(filePath);
						if (records.length === 0) return null;

						const kept: ExpertiseRecord[] = [];
						let pruned = 0;
						let demoted = 0;
						let anchorDemoted = 0;
						let supersessionDemoted = 0;

						for (const record of records) {
							if (isStale(record, now, shelfLife)) {
								pruned++;
								archived.push(record);
								continue;
							}

							const supersededHit = !!record.id && supersededIds.has(record.id);
							const anchorHit = isAnchorDecayed(record);

							if (!supersededHit && !anchorHit) {
								kept.push(record);
								continue;
							}

							const reasons: DemotionReason[] = [];
							if (supersededHit) reasons.push("supersession");
							if (anchorHit) reasons.push("anchor_decay");

							const target = options.aggressive ? null : nextDemotionTier(record.classification);
							if (target === null) {
								pruned++;
								archived.push(record);
								if (options.explain) {
									domainExplanations.push({
										domain,
										id: record.id,
										type: record.type,
										from: record.classification,
										to: "archived",
										reasons,
										...(anchorHit
											? {
													anchors: {
														valid_fraction: anchorHit.validFraction ?? 0,
														valid: anchorHit.valid,
														total: anchorHit.total,
														broken: anchorHit.broken,
													},
												}
											: {}),
									});
								}
								continue;
							}

							const demotedRecord: ExpertiseRecord = {
								...record,
								classification: target,
							};
							if (supersededHit) {
								demotedRecord.supersession_demoted_at = now.toISOString();
								supersessionDemoted++;
							}
							if (anchorHit) {
								demotedRecord.anchor_decay_demoted_at = now.toISOString();
								anchorDemoted++;
							}
							kept.push(demotedRecord);
							demoted++;
							if (options.explain) {
								domainExplanations.push({
									domain,
									id: record.id,
									type: record.type,
									from: record.classification,
									to: target,
									reasons,
									...(anchorHit
										? {
												anchors: {
													valid_fraction: anchorHit.validFraction ?? 0,
													valid: anchorHit.valid,
													total: anchorHit.total,
													broken: anchorHit.broken,
												},
											}
										: {}),
								});
							}
						}

						if (pruned > 0 || demoted > 0) {
							if (!options.dryRun) {
								await writeExpertiseFile(filePath, kept);
							}
							return {
								domain,
								before: records.length,
								pruned,
								demoted,
								anchor_demoted: anchorDemoted,
								supersession_demoted: supersessionDemoted,
								after: kept.length,
							};
						}
						return null;
					});

					if (domainResult) {
						if (!options.dryRun && !options.hard && archived.length > 0) {
							await archiveRecords(domain, archived, now);
						}
						results.push(domainResult);
						totalPruned += domainResult.pruned;
						totalDemoted += domainResult.demoted;
						totalAnchorDemoted += domainResult.anchor_demoted;
						totalSupersessionDemoted += domainResult.supersession_demoted;
						if (options.explain) explanations.push(...domainExplanations);
					}
				}

				if (jsonMode) {
					outputJson({
						success: true,
						command: "prune",
						dryRun: options.dryRun,
						hard: options.hard,
						aggressive: options.aggressive,
						checkAnchors: options.checkAnchors,
						totalPruned,
						totalDemoted,
						totalAnchorDemoted,
						totalSupersessionDemoted,
						results,
						...(options.explain ? { explanations } : {}),
					});
					return;
				}

				if (totalPruned === 0 && totalDemoted === 0) {
					if (!isQuiet())
						console.log(brand("No stale or superseded records found. All records are current."));
					return;
				}

				const action = options.hard ? "Deleted" : "Archived";
				const wouldAction = options.hard ? "Would delete" : "Would archive";
				const label = options.dryRun ? wouldAction : action;
				const demoteLabel = options.dryRun ? "Would demote" : "Demoted";
				const prefix = options.dryRun ? chalk.yellow("[DRY RUN] ") : "";

				for (const result of results) {
					let body: string;
					if (result.pruned > 0 && result.demoted > 0) {
						body = `${label} ${chalk.red(String(result.pruned))}, demoted ${chalk.yellow(String(result.demoted))}`;
					} else if (result.pruned > 0) {
						body = `${label} ${chalk.red(String(result.pruned))}`;
					} else {
						body = `${demoteLabel} ${chalk.yellow(String(result.demoted))}`;
					}
					if (!isQuiet())
						console.log(
							`${prefix}${chalk.cyan(result.domain)}: ${body} of ${result.before} records (${result.after} remaining)`,
						);
				}

				if (options.explain && explanations.length > 0 && !isQuiet()) {
					console.log(`\n${chalk.bold("Explain:")}`);
					for (const ex of explanations) {
						const idPart = ex.id ? ` ${chalk.dim(`[${ex.id}]`)}` : "";
						const reasonPart = ex.reasons.join(" + ");
						console.log(
							`  ${chalk.cyan(ex.domain)}${idPart} ${ex.type}: ${ex.from} → ${ex.to} (${reasonPart})`,
						);
						if (ex.anchors) {
							const frac = (ex.anchors.valid_fraction * 100).toFixed(0);
							console.log(
								`      anchors: ${ex.anchors.valid}/${ex.anchors.total} valid (${frac}%)`,
							);
							for (const b of ex.anchors.broken) {
								console.log(`        ${chalk.red("✗")} ${b.kind}: ${b.path}`);
							}
						}
					}
				}

				if (!isQuiet()) {
					const totals: string[] = [];
					if (totalPruned > 0) {
						totals.push(
							`${label.toLowerCase()} ${totalPruned} stale ${totalPruned === 1 ? "record" : "records"}`,
						);
					}
					if (totalDemoted > 0) {
						const noun = totalDemoted === 1 ? "record" : "records";
						const breakdown: string[] = [];
						if (totalSupersessionDemoted > 0)
							breakdown.push(`${totalSupersessionDemoted} superseded`);
						if (totalAnchorDemoted > 0) breakdown.push(`${totalAnchorDemoted} anchor-decayed`);
						const suffix = breakdown.length > 1 ? ` (${breakdown.join(", ")})` : "";
						const tag =
							breakdown.length === 1 && totalSupersessionDemoted > 0
								? "superseded "
								: breakdown.length === 1 && totalAnchorDemoted > 0
									? "anchor-decayed "
									: "";
						totals.push(`${demoteLabel.toLowerCase()} ${totalDemoted} ${tag}${noun}${suffix}`);
					}
					console.log(`\n${prefix}${chalk.bold(`Total: ${totals.join("; ")}.`)}`);
					if (!options.hard && !options.dryRun && totalPruned > 0) {
						console.log(
							chalk.dim(
								"Records moved to .mulch/archive/. Restore with `ml restore <id>` or use `--hard` next time to permanently delete.",
							),
						);
					}
				}
			},
		);
}
