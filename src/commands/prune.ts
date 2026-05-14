import chalk from "chalk";
import type { Command } from "commander";
import {
	DEFAULT_ANCHOR_VALIDITY_GRACE_DAYS,
	DEFAULT_ANCHOR_VALIDITY_THRESHOLD,
	validateAnchorValidityConfig,
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

type ActionReason = "stale" | "superseded" | "anchor_decay";

interface RecordAction {
	domain: string;
	id?: string;
	type: string;
	from: Classification;
	// "archived" when the record bottomed out and moved to the archive (or was
	// hard-deleted with --hard).
	to: Classification | "archived";
	reasons: ActionReason[];
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
 * Identify ids that participate in any supersession cycle (SCC of size > 1).
 * Iterative Tarjan, so long chains and self-loops can't blow the stack.
 * Self-loops are filtered at edge-collection time so they don't register as
 * trivial cycles.
 */
function findSupersessionCycleIds(graph: ReadonlyMap<string, Set<string>>): Set<string> {
	const cycleIds = new Set<string>();
	const indices = new Map<string, number>();
	const lowlinks = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	let nextIndex = 0;

	type Frame = { node: string; iter: Iterator<string>; pendingChild: string | null };
	for (const start of graph.keys()) {
		if (indices.has(start)) continue;
		const callStack: Frame[] = [];
		const open = (node: string) => {
			indices.set(node, nextIndex);
			lowlinks.set(node, nextIndex);
			nextIndex++;
			stack.push(node);
			onStack.add(node);
			const edges = graph.get(node);
			callStack.push({
				node,
				iter: (edges ?? new Set<string>()).values(),
				pendingChild: null,
			});
		};
		open(start);

		while (callStack.length > 0) {
			const frame = callStack[callStack.length - 1];
			if (!frame) break;
			if (frame.pendingChild !== null) {
				const childLow = lowlinks.get(frame.pendingChild);
				const nodeLow = lowlinks.get(frame.node);
				if (childLow !== undefined && nodeLow !== undefined && childLow < nodeLow) {
					lowlinks.set(frame.node, childLow);
				}
				frame.pendingChild = null;
			}
			const next = frame.iter.next();
			if (next.done) {
				const idx = indices.get(frame.node);
				const low = lowlinks.get(frame.node);
				if (idx !== undefined && low !== undefined && idx === low) {
					const component: string[] = [];
					while (stack.length > 0) {
						const popped = stack.pop();
						if (popped === undefined) break;
						onStack.delete(popped);
						component.push(popped);
						if (popped === frame.node) break;
					}
					if (component.length > 1) {
						for (const c of component) cycleIds.add(c);
					}
				}
				callStack.pop();
				continue;
			}
			const target = next.value;
			if (!indices.has(target)) {
				frame.pendingChild = target;
				open(target);
			} else if (onStack.has(target)) {
				const targetIdx = indices.get(target);
				const nodeLow = lowlinks.get(frame.node);
				if (targetIdx !== undefined && nodeLow !== undefined && targetIdx < nodeLow) {
					lowlinks.set(frame.node, targetIdx);
				}
			}
		}
	}
	return cycleIds;
}

/**
 * Set of record IDs referenced by any live record's `supersedes` field,
 * unioned across every domain. Cross-domain by design — supersession is
 * content-relational, not domain-bound. Self-references are filtered out,
 * and any record that participates in a multi-record cycle (e.g. A↔B) is
 * excluded so cycle members aren't both demoted/archived together.
 */
function collectSupersededIds(liveByDomain: ReadonlyArray<{ records: ExpertiseRecord[] }>): {
	supersededIds: Set<string>;
	cycleIds: Set<string>;
} {
	const graph = new Map<string, Set<string>>();
	const allEdges: Array<[string, string]> = [];
	for (const { records } of liveByDomain) {
		for (const r of records) {
			if (!r.id || !r.supersedes || r.supersedes.length === 0) continue;
			let edges = graph.get(r.id);
			if (!edges) {
				edges = new Set<string>();
				graph.set(r.id, edges);
			}
			for (const targetId of r.supersedes) {
				if (targetId === r.id) continue;
				edges.add(targetId);
				if (!graph.has(targetId)) graph.set(targetId, new Set<string>());
				allEdges.push([r.id, targetId]);
			}
		}
	}

	const cycleIds = findSupersessionCycleIds(graph);
	const supersededIds = new Set<string>();
	for (const [, target] of allEdges) {
		if (cycleIds.has(target)) continue;
		supersededIds.add(target);
	}
	return { supersededIds, cycleIds };
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
				const anchorValidationErrors = validateAnchorValidityConfig(anchorCfg);
				if (anchorValidationErrors.length > 0) {
					const msg = `Invalid decay.anchor_validity config: ${anchorValidationErrors.join("; ")}. Edit .mulch/mulch.config.yaml.`;
					if (jsonMode) {
						outputJsonError("prune", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				const anchorThreshold = anchorCfg.threshold ?? DEFAULT_ANCHOR_VALIDITY_THRESHOLD;
				const anchorGrace = anchorCfg.grace_days ?? DEFAULT_ANCHOR_VALIDITY_GRACE_DAYS;

				const results: PruneResult[] = [];
				const actions: RecordAction[] = [];
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

				const { supersededIds, cycleIds } = collectSupersededIds(liveByDomain);
				if (cycleIds.size > 0 && !jsonMode && !isQuiet()) {
					console.error(
						chalk.yellow(
							`Warning: supersession cycle detected for ${cycleIds.size} record(s); cycle members will not be demoted. Run \`ml doctor\` for details.`,
						),
					);
				}

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
					const domainActions: RecordAction[] = [];
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
								domainActions.push({
									domain,
									id: record.id,
									type: record.type,
									from: record.classification,
									to: "archived",
									reasons: ["stale"],
								});
								continue;
							}

							const supersededHit = !!record.id && supersededIds.has(record.id);
							const anchorHit = isAnchorDecayed(record);

							if (!supersededHit && !anchorHit) {
								kept.push(record);
								continue;
							}

							const reasons: ActionReason[] = [];
							if (supersededHit) reasons.push("superseded");
							if (anchorHit) reasons.push("anchor_decay");

							const target = options.aggressive ? null : nextDemotionTier(record.classification);
							if (target === null) {
								pruned++;
								// Bottom-out via supersession/anchor_decay — stamp the
								// archive_reason inline so the multi-record archive write
								// in this domain preserves per-record reasons (vs the
								// caller-wide reason param passed to archiveRecords).
								const bottomReason =
									supersededHit && anchorHit
										? "superseded+anchor_decay"
										: supersededHit
											? "superseded"
											: "anchor_decay";
								archived.push({ ...record, archive_reason: bottomReason });
								domainActions.push({
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
							domainActions.push({
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
							// Default reason "stale" covers records pushed via the
							// shelf-life path; bottom-out records pre-stamp their own
							// reason and archiveRecords preserves it.
							await archiveRecords(domain, archived, now, "stale");
						}
						results.push(domainResult);
						totalPruned += domainResult.pruned;
						totalDemoted += domainResult.demoted;
						totalAnchorDemoted += domainResult.anchor_demoted;
						totalSupersessionDemoted += domainResult.supersession_demoted;
						actions.push(...domainActions);
					}
				}

				if (jsonMode) {
					// `explanations` in JSON is the legacy shape: demotion-only,
					// gated on --explain. Per-seed acceptance: JSON output is
					// unchanged. Stale-archive entries live in `results` /
					// `totalPruned`; they're never in `explanations`.
					const explanations = options.explain
						? actions.filter((a) => a.reasons.some((r) => r !== "stale"))
						: undefined;
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
						...(explanations ? { explanations } : {}),
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

				const quiet = isQuiet();
				const actionsByDomain = new Map<string, RecordAction[]>();
				for (const a of actions) {
					const list = actionsByDomain.get(a.domain) ?? [];
					list.push(a);
					actionsByDomain.set(a.domain, list);
				}

				for (const result of results) {
					let body: string;
					if (result.pruned > 0 && result.demoted > 0) {
						body = `${label} ${chalk.red(String(result.pruned))}, demoted ${chalk.yellow(String(result.demoted))}`;
					} else if (result.pruned > 0) {
						body = `${label} ${chalk.red(String(result.pruned))}`;
					} else {
						body = `${demoteLabel} ${chalk.yellow(String(result.demoted))}`;
					}
					if (!quiet) {
						console.log(
							`${prefix}${chalk.cyan(result.domain)}: ${body} of ${result.before} records (${result.after} remaining)`,
						);
						const domainActions = actionsByDomain.get(result.domain) ?? [];
						for (const a of domainActions) {
							const idPart = a.id ? chalk.dim(a.id) : chalk.dim("(no id)");
							const reasonPart = a.reasons.join(" + ");
							console.log(`  ${idPart} [${a.type}]: ${a.from} → ${a.to} (${reasonPart})`);
							if (options.explain && a.anchors) {
								const frac = (a.anchors.valid_fraction * 100).toFixed(0);
								console.log(
									`      anchors: ${a.anchors.valid}/${a.anchors.total} valid (${frac}%)`,
								);
								for (const b of a.anchors.broken) {
									console.log(`        ${chalk.red("✗")} ${b.kind}: ${b.path}`);
								}
							}
						}
					}
				}

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
				// Totals print even under --quiet; the per-record list above is
				// what --quiet suppresses (seed mulch-5ce3).
				const separator = quiet ? "" : "\n";
				console.log(`${separator}${prefix}${chalk.bold(`Total: ${totals.join("; ")}.`)}`);
				if (!quiet && !options.hard && !options.dryRun && totalPruned > 0) {
					console.log(
						chalk.dim(
							"Records moved to .mulch/archive/. Restore with `ml restore <id>` or use `--hard` next time to permanently delete.",
						),
					);
				}
			},
		);
}
