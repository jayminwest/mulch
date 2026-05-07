import { createInterface } from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { getRegistry, type TypeDefinition } from "../registry/type-registry.ts";
import type { ExpertiseRecord, RecordType } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import {
	generateRecordId,
	readExpertiseFile,
	resolveRecordId,
	writeExpertiseFile,
} from "../utils/expertise.ts";
import { getRecordSummary } from "../utils/format.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

interface CompactCandidate {
	domain: string;
	type: RecordType;
	records: Array<{
		id: string | undefined;
		summary: string;
		recorded_at: string;
	}>;
}

// For merge_outcomes types, finer grouping by idKey collapses true duplicates
// (same statement / same canonical key, differing outcomes). Other strategies
// group by type only — built-ins behave as before.
function groupingKeyFor(record: ExpertiseRecord): string {
	const def = getRegistry().get(record.type);
	if (def?.compact === "merge_outcomes") {
		const v = (record as unknown as Record<string, unknown>)[def.idKey];
		return `${record.type}::${String(v ?? "")}`;
	}
	return record.type;
}

function findCandidates(
	domain: string,
	records: ExpertiseRecord[],
	now: Date,
	shelfLife: { tactical: number; observational: number },
	minGroupSize = 3,
): CompactCandidate[] {
	// Group records by type (or by type+idKey for merge_outcomes types)
	const byKey = new Map<string, { type: RecordType; records: ExpertiseRecord[] }>();
	for (const r of records) {
		const key = groupingKeyFor(r);
		const slot = byKey.get(key);
		if (slot) {
			slot.records.push(r);
		} else {
			byKey.set(key, { type: r.type, records: [r] });
		}
	}

	const candidates: CompactCandidate[] = [];

	for (const { type, records: group } of byKey.values()) {
		if (group.length < 2) continue;

		// Include groups where at least one record is stale or the group is large enough
		const hasStale = group.some((r) => {
			if (r.classification === "foundational") return false;
			const ageMs = now.getTime() - new Date(r.recorded_at).getTime();
			const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
			if (r.classification === "tactical") return ageDays > shelfLife.tactical;
			if (r.classification === "observational") return ageDays > shelfLife.observational;
			return false;
		});

		if (hasStale || group.length >= minGroupSize) {
			candidates.push({
				domain,
				type,
				records: group.map((r) => ({
					id: r.id,
					summary: getRecordSummary(r),
					recorded_at: r.recorded_at,
				})),
			});
		}
	}

	return candidates;
}

function resolveRecordIds(records: ExpertiseRecord[], identifiers: string[]): number[] {
	const indices: number[] = [];
	for (const id of identifiers) {
		const result = resolveRecordId(records, id);
		if (!result.ok) {
			throw new Error(result.error);
		}
		indices.push(result.index);
	}
	return indices;
}

async function confirmAction(prompt: string): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(`${prompt} (y/N): `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

export function registerCompactCommand(program: Command): void {
	program
		.command("compact")
		.argument("[domain]", "expertise domain (required for --apply)")
		.description("Compact records: analyze candidates or apply a compaction")
		.option("--analyze", "show compaction candidates")
		.option("--apply", "apply a compaction (replace records with summary)")
		.option("--auto", "automatically compact all candidates")
		.option("--dry-run", "preview what --auto would do without writing (use with --auto)")
		.option("--min-group <size>", "minimum group size for auto-compaction (default: 5)", "5")
		.option("--max-records <count>", "maximum records to compact in one run (default: 50)", "50")
		.option("--yes", "skip confirmation prompts (use with --auto)")
		.option("--records <ids>", "comma-separated record IDs to compact")
		.option("--type <type>", "record type for the replacement")
		.option("--name <name>", "name for replacement (pattern/reference/guide)")
		.option("--title <title>", "title for replacement (decision)")
		.option("--description <description>", "description for replacement")
		.option("--content <content>", "content for replacement (convention)")
		.option("--resolution <resolution>", "resolution for replacement (failure)")
		.option("--rationale <rationale>", "rationale for replacement (decision)")
		.action(async (domain: string | undefined, options: Record<string, unknown>) => {
			const jsonMode = program.opts().json === true;

			if (options.analyze) {
				await handleAnalyze(jsonMode, domain);
			} else if (options.auto) {
				await handleAuto(options, jsonMode, domain);
			} else if (options.apply) {
				if (!domain) {
					const msg = "Domain is required for --apply.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				await handleApply(domain, options, jsonMode);
			} else {
				const msg = "Specify --analyze, --auto, or --apply.";
				if (jsonMode) {
					outputJsonError("compact", msg);
				} else {
					console.error(chalk.red(`Error: ${msg}`));
				}
				process.exitCode = 1;
			}
		});
}

async function handleAnalyze(jsonMode: boolean, domain?: string): Promise<void> {
	const config = await readConfig();
	const now = new Date();
	const shelfLife = config.classification_defaults.shelf_life;
	const allCandidates: CompactCandidate[] = [];

	// Filter to specific domain if provided, otherwise check all domains
	const domainsToCheck = domain ? [domain] : Object.keys(config.domains);

	// Validate domain if specified
	if (domain && !(domain in config.domains)) {
		const msg = `Domain "${domain}" not found in config.`;
		if (jsonMode) {
			outputJsonError("compact", msg);
		} else {
			console.error(chalk.red(`Error: ${msg}`));
		}
		process.exitCode = 1;
		return;
	}

	for (const d of domainsToCheck) {
		const filePath = getExpertisePath(d);
		const records = await readExpertiseFile(filePath);
		if (records.length < 2) continue;
		const candidates = findCandidates(d, records, now, shelfLife);
		allCandidates.push(...candidates);
	}

	if (jsonMode) {
		outputJson({
			success: true,
			command: "compact",
			action: "analyze",
			candidates: allCandidates,
		});
		return;
	}

	if (allCandidates.length === 0) {
		if (!isQuiet()) console.log(brand("No compaction candidates found."));
		return;
	}

	// Group candidates by domain for better organization
	const byDomain = new Map<string, CompactCandidate[]>();
	for (const c of allCandidates) {
		if (!byDomain.has(c.domain)) {
			byDomain.set(c.domain, []);
		}
		byDomain.get(c.domain)?.push(c);
	}

	const totalGroups = allCandidates.length;
	const totalRecords = allCandidates.reduce((sum, c) => sum + c.records.length, 0);

	console.log(chalk.bold("\nCompaction candidates:\n"));
	console.log(
		chalk.dim(`Found ${totalGroups} groups (${totalRecords} records that could be compacted)\n`),
	);

	for (const [domain, candidates] of byDomain) {
		console.log(chalk.bold(`${domain}:`));
		for (const c of candidates) {
			console.log(`  ${chalk.cyan(c.type)} (${c.records.length} records)`);
			for (const r of c.records.slice(0, 3)) {
				console.log(`    ${r.id ? accent(r.id) : chalk.dim("(no id)")}: ${r.summary}`);
			}
			if (c.records.length > 3) {
				console.log(chalk.dim(`    ... and ${c.records.length - 3} more`));
			}
		}
		console.log();
	}

	console.log(chalk.dim("To compact manually:"));
	console.log(
		chalk.dim("  mulch compact <domain> --apply --records <ids> --type <type> [fields...]"),
	);
	console.log(chalk.dim("\nTo compact automatically:"));
	console.log(chalk.dim("  mulch compact --auto [--dry-run]"));
}

async function handleAuto(
	options: Record<string, unknown>,
	jsonMode: boolean,
	domain?: string,
): Promise<void> {
	const config = await readConfig();
	const now = new Date();
	const shelfLife = config.classification_defaults.shelf_life;

	const dryRun = options.dryRun === true;
	const skipConfirmation = options.yes === true;
	const minGroupSize = Number.parseInt(options.minGroup as string, 10) || 5;
	const maxRecords = Number.parseInt(options.maxRecords as string, 10) || 50;

	// Filter to specific domain if provided, otherwise check all domains
	const domainsToCheck = domain ? [domain] : Object.keys(config.domains);

	// Validate domain if specified
	if (domain && !(domain in config.domains)) {
		const msg = `Domain "${domain}" not found in config.`;
		if (jsonMode) {
			outputJsonError("compact", msg);
		} else {
			console.error(chalk.red(`Error: ${msg}`));
		}
		process.exitCode = 1;
		return;
	}

	// Collect all candidates across specified domains
	const allCandidates: Array<{ domain: string; candidate: CompactCandidate }> = [];

	for (const d of domainsToCheck) {
		const filePath = getExpertisePath(d);
		const records = await readExpertiseFile(filePath);
		if (records.length < 2) continue;

		const candidates = findCandidates(d, records, now, shelfLife, minGroupSize);
		for (const candidate of candidates) {
			allCandidates.push({ domain: d, candidate });
		}
	}

	if (allCandidates.length === 0) {
		if (jsonMode) {
			outputJson({
				success: true,
				command: "compact",
				action: dryRun ? "dry-run" : "auto",
				compacted: 0,
				results: [],
			});
		} else {
			if (!isQuiet()) console.log(brand("No compaction candidates found."));
		}
		return;
	}

	// Calculate total records to compact and apply max limit
	let totalRecordsToCompact = 0;
	const candidatesToProcess: Array<{
		domain: string;
		candidate: CompactCandidate;
	}> = [];

	for (const item of allCandidates) {
		if (totalRecordsToCompact + item.candidate.records.length > maxRecords) {
			break;
		}
		candidatesToProcess.push(item);
		totalRecordsToCompact += item.candidate.records.length;
	}

	// Show summary
	if (!jsonMode && !dryRun) {
		console.log(chalk.bold("\nCompaction summary:\n"));
		console.log(`  ${candidatesToProcess.length} groups will be compacted`);
		console.log(`  ${totalRecordsToCompact} records → ${candidatesToProcess.length} records\n`);

		for (const { domain, candidate } of candidatesToProcess) {
			console.log(
				`${chalk.cyan(`${domain}/${candidate.type}`)} (${candidate.records.length} records)`,
			);
			for (const r of candidate.records.slice(0, 3)) {
				console.log(`  ${r.id ? accent(r.id) : chalk.dim("(no id)")}: ${r.summary}`);
			}
			if (candidate.records.length > 3) {
				console.log(chalk.dim(`  ... and ${candidate.records.length - 3} more`));
			}
			console.log();
		}

		if (allCandidates.length > candidatesToProcess.length) {
			const skipped = allCandidates.length - candidatesToProcess.length;
			console.log(
				chalk.yellow(`Note: ${skipped} additional groups skipped due to --max-records limit\n`),
			);
		}
	}

	// Dry-run mode: show detailed preview of what would be done
	if (dryRun) {
		if (jsonMode) {
			outputJson({
				success: true,
				command: "compact",
				action: "dry-run",
				wouldCompact: totalRecordsToCompact,
				groups: candidatesToProcess.map(({ domain, candidate }) => ({
					domain,
					type: candidate.type,
					count: candidate.records.length,
					records: candidate.records,
				})),
			});
		} else {
			console.log(chalk.bold("\nDry-run preview:\n"));
			console.log(`  ${candidatesToProcess.length} groups would be compacted`);
			console.log(`  ${totalRecordsToCompact} records → ${candidatesToProcess.length} records\n`);

			for (const { domain, candidate } of candidatesToProcess) {
				console.log(
					`${chalk.cyan(`${domain}/${candidate.type}`)} (${candidate.records.length} records)`,
				);
				for (const r of candidate.records.slice(0, 3)) {
					console.log(`  ${r.id ? accent(r.id) : chalk.dim("(no id)")}: ${r.summary}`);
				}
				if (candidate.records.length > 3) {
					console.log(chalk.dim(`  ... and ${candidate.records.length - 3} more`));
				}
				console.log();
			}

			if (allCandidates.length > candidatesToProcess.length) {
				const skipped = allCandidates.length - candidatesToProcess.length;
				console.log(
					chalk.yellow(`Note: ${skipped} additional groups skipped due to --max-records limit\n`),
				);
			}

			if (!isQuiet())
				console.log(
					`${brand("✓")} ${brand(`Dry-run complete. Would compact ${totalRecordsToCompact} records across ${candidatesToProcess.length} groups.`)}`,
				);
			if (!isQuiet()) console.log(chalk.dim("  Run without --dry-run to apply changes."));
		}
		return;
	}

	// Ask for confirmation unless --yes was passed
	if (!jsonMode && !skipConfirmation) {
		const confirmed = await confirmAction("Proceed with compaction?");
		if (!confirmed) {
			console.log(chalk.yellow("Compaction cancelled."));
			return;
		}
	}

	// Apply compaction
	let totalCompacted = 0;
	const results: Array<{ domain: string; type: RecordType; count: number }> = [];

	// Group candidates by domain for efficient processing
	const byDomain = new Map<string, CompactCandidate[]>();
	for (const { domain, candidate } of candidatesToProcess) {
		if (!byDomain.has(domain)) {
			byDomain.set(domain, []);
		}
		byDomain.get(domain)?.push(candidate);
	}

	for (const [domain, candidates] of byDomain) {
		const filePath = getExpertisePath(domain);

		await withFileLock(filePath, async () => {
			const records = await readExpertiseFile(filePath);
			let updatedRecords = [...records];

			for (const candidate of candidates) {
				// Find the actual record objects for this candidate
				const recordsToCompact = updatedRecords.filter(
					(r) => r.type === candidate.type && candidate.records.some((cr) => cr.id === r.id),
				);

				if (recordsToCompact.length < 2) continue;

				// Create merged replacement record
				const replacement = mergeRecords(recordsToCompact);

				// Remove old records
				const idsToRemove = new Set(recordsToCompact.map((r) => r.id));
				updatedRecords = updatedRecords.filter((r) => !idsToRemove.has(r.id));

				// Add replacement
				updatedRecords.push(replacement);

				totalCompacted += recordsToCompact.length;
				results.push({
					domain,
					type: candidate.type,
					count: recordsToCompact.length,
				});
			}

			// Write back if changes were made
			if (updatedRecords.length !== records.length) {
				await writeExpertiseFile(filePath, updatedRecords);
			}
		});
	}

	if (jsonMode) {
		outputJson({
			success: true,
			command: "compact",
			action: "auto",
			compacted: totalCompacted,
			results,
		});
		return;
	}

	if (!isQuiet())
		console.log(
			`\n${brand("✓")} ${brand(`Auto-compacted ${totalCompacted} records across ${results.length} groups`)}`,
		);
	for (const r of results) {
		if (!isQuiet()) console.log(chalk.dim(`  ${r.domain}/${r.type}: ${r.count} records → 1`));
	}
}

export function mergeRecords(records: ExpertiseRecord[]): ExpertiseRecord {
	if (records.length === 0) {
		throw new Error("Cannot merge empty record list");
	}

	const first = records[0];
	if (!first) {
		throw new Error("Cannot merge empty record list");
	}

	const def = getRegistry().get(first.type);
	if (!def) {
		throw new Error(`Unknown record type: ${first.type}`);
	}

	let result: ExpertiseRecord;
	switch (def.compact) {
		case "concat":
			result = compactConcat(records, def);
			break;
		case "keep_latest":
			result = compactKeepLatest(records, def);
			break;
		case "merge_outcomes":
			result = compactMergeOutcomes(records, def);
			break;
		case "manual":
			throw new Error(
				`Type "${def.name}" has compact strategy "manual" — use \`mulch compact --apply\` to compact manually.`,
			);
	}

	// Generate ID for the merged record
	result.id = generateRecordId(result);
	return result;
}

function commonMergeBase(
	records: ExpertiseRecord[],
	def: TypeDefinition,
): {
	supersedes: string[];
	tags: string[] | undefined;
	files: string[] | undefined;
} {
	const supersedes = records.map((r) => r.id).filter(Boolean) as string[];
	const allTags = records.flatMap((r) => r.tags ?? []);
	const tags = allTags.length > 0 ? Array.from(new Set(allTags)) : undefined;
	let files: string[] | undefined;
	if (def.extractsFiles) {
		const all = records.flatMap((r) => {
			const v = (r as unknown as Record<string, unknown>)[def.filesField];
			return Array.isArray(v) ? (v as string[]) : [];
		});
		files = all.length > 0 ? Array.from(new Set(all)) : undefined;
	}
	return { supersedes, tags, files };
}

// "Label-like" required fields that take the longest value during concat
// instead of being joined. Matches the historical built-in mergeRecords
// behavior (pattern.name, decision.title, etc.). Custom types using these
// field names get the same treatment, which is the expected ergonomic.
const LONGEST_PICK_FIELDS = new Set(["name", "title"]);

function compactConcat(records: ExpertiseRecord[], def: TypeDefinition): ExpertiseRecord {
	const base = commonMergeBase(records, def);
	const out: Record<string, unknown> = {
		type: def.name,
		classification: "foundational",
		recorded_at: new Date().toISOString(),
		supersedes: base.supersedes,
	};
	if (base.tags) out.tags = base.tags;
	if (def.extractsFiles && base.files) out[def.filesField] = base.files;

	for (const field of def.required) {
		const values = records
			.map((r) => (r as unknown as Record<string, unknown>)[field])
			.filter((v): v is string => typeof v === "string");
		if (LONGEST_PICK_FIELDS.has(field)) {
			out[field] = values.reduce(
				(longest, v) => (v.length > longest.length ? v : longest),
				values[0] ?? "",
			);
		} else {
			out[field] = values.join("\n\n");
		}
	}
	return out as unknown as ExpertiseRecord;
}

function compactKeepLatest(records: ExpertiseRecord[], def: TypeDefinition): ExpertiseRecord {
	const base = commonMergeBase(records, def);
	const sorted = [...records].sort(
		(a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
	);
	const latest = sorted[0];
	if (!latest) throw new Error("Cannot compact empty record list");
	const merged: Record<string, unknown> = { ...(latest as unknown as Record<string, unknown>) };
	merged.classification = "foundational";
	merged.recorded_at = new Date().toISOString();
	merged.supersedes = base.supersedes;
	if (base.tags) merged.tags = base.tags;
	else delete merged.tags;
	if (def.extractsFiles && base.files) merged[def.filesField] = base.files;
	delete merged.id;
	return merged as unknown as ExpertiseRecord;
}

function compactMergeOutcomes(records: ExpertiseRecord[], def: TypeDefinition): ExpertiseRecord {
	const base = commonMergeBase(records, def);
	// Combine outcomes from every input record.
	const allOutcomes = records.flatMap((r) => r.outcomes ?? []);

	// Take the latest record as the canonical shape, then merge outcomes.
	const sorted = [...records].sort(
		(a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
	);
	const latest = sorted[0];
	if (!latest) throw new Error("Cannot compact empty record list");
	const merged: Record<string, unknown> = { ...(latest as unknown as Record<string, unknown>) };
	merged.classification = "foundational";
	merged.recorded_at = new Date().toISOString();
	merged.supersedes = base.supersedes;
	if (base.tags) merged.tags = base.tags;
	else delete merged.tags;
	if (def.extractsFiles && base.files) merged[def.filesField] = base.files;
	if (allOutcomes.length > 0) merged.outcomes = allOutcomes;
	delete merged.id;
	return merged as unknown as ExpertiseRecord;
}

async function handleApply(
	domain: string,
	options: Record<string, unknown>,
	jsonMode: boolean,
): Promise<void> {
	const config = await readConfig();

	if (!(domain in config.domains)) {
		const msg = `Domain "${domain}" not found in config.`;
		if (jsonMode) {
			outputJsonError("compact", msg);
		} else {
			console.error(chalk.red(`Error: ${msg}`));
		}
		process.exitCode = 1;
		return;
	}

	if (typeof options.records !== "string") {
		const msg = "--records is required for --apply.";
		if (jsonMode) {
			outputJsonError("compact", msg);
		} else {
			console.error(chalk.red(`Error: ${msg}`));
		}
		process.exitCode = 1;
		return;
	}

	const filePath = getExpertisePath(domain);
	await withFileLock(filePath, async () => {
		const records = await readExpertiseFile(filePath);
		const identifiers = (options.records as string)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		let indicesToRemove: number[];
		try {
			indicesToRemove = resolveRecordIds(records, identifiers);
		} catch (err) {
			const msg = (err as Error).message;
			if (jsonMode) {
				outputJsonError("compact", msg);
			} else {
				console.error(chalk.red(`Error: ${msg}`));
			}
			process.exitCode = 1;
			return;
		}

		if (indicesToRemove.length < 2) {
			const msg = "Compaction requires at least 2 records.";
			if (jsonMode) {
				outputJsonError("compact", msg);
			} else {
				console.error(chalk.red(`Error: ${msg}`));
			}
			process.exitCode = 1;
			return;
		}

		// Build replacement record
		const firstIdx = indicesToRemove[0];
		const recordType =
			(options.type as RecordType | undefined) ??
			(firstIdx !== undefined ? records[firstIdx]?.type : undefined) ??
			"convention";
		const recordedAt = new Date().toISOString();
		const compactedFrom = indicesToRemove.map((i) => records[i]?.id).filter(Boolean) as string[];

		let replacement: ExpertiseRecord;

		switch (recordType) {
			case "convention": {
				const content =
					(options.content as string | undefined) ?? (options.description as string | undefined);
				if (!content) {
					const msg = "Replacement convention requires --content or --description.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				replacement = {
					type: "convention",
					content,
					classification: "foundational",
					recorded_at: recordedAt,
				};
				break;
			}
			case "pattern": {
				const name = options.name as string | undefined;
				const description = options.description as string | undefined;
				if (!name || !description) {
					const msg = "Replacement pattern requires --name and --description.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				replacement = {
					type: "pattern",
					name,
					description,
					classification: "foundational",
					recorded_at: recordedAt,
				};
				break;
			}
			case "failure": {
				const description = options.description as string | undefined;
				const resolution = options.resolution as string | undefined;
				if (!description || !resolution) {
					const msg = "Replacement failure requires --description and --resolution.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				replacement = {
					type: "failure",
					description,
					resolution,
					classification: "foundational",
					recorded_at: recordedAt,
				};
				break;
			}
			case "decision": {
				const title = options.title as string | undefined;
				const rationale = options.rationale as string | undefined;
				if (!title || !rationale) {
					const msg = "Replacement decision requires --title and --rationale.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				replacement = {
					type: "decision",
					title,
					rationale,
					classification: "foundational",
					recorded_at: recordedAt,
				};
				break;
			}
			case "reference": {
				const name = options.name as string | undefined;
				const description = options.description as string | undefined;
				if (!name || !description) {
					const msg = "Replacement reference requires --name and --description.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				replacement = {
					type: "reference",
					name,
					description,
					classification: "foundational",
					recorded_at: recordedAt,
				};
				break;
			}
			case "guide": {
				const name = options.name as string | undefined;
				const description = options.description as string | undefined;
				if (!name || !description) {
					const msg = "Replacement guide requires --name and --description.";
					if (jsonMode) {
						outputJsonError("compact", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}
				replacement = {
					type: "guide",
					name,
					description,
					classification: "foundational",
					recorded_at: recordedAt,
				};
				break;
			}
			default: {
				const msg = `Unknown record type "${recordType}".`;
				if (jsonMode) {
					outputJsonError("compact", msg);
				} else {
					console.error(chalk.red(`Error: ${msg}`));
				}
				process.exitCode = 1;
				return;
			}
		}

		// Add supersedes links to the compacted-from records
		if (compactedFrom.length > 0) {
			replacement.supersedes = compactedFrom;
		}

		// Validate replacement (cached on registry)
		const validate = getRegistry().validator;
		replacement.id = generateRecordId(replacement);
		if (!validate(replacement)) {
			const errors = (validate.errors ?? []).map((err) => `${err.instancePath} ${err.message}`);
			const msg = `Replacement record failed validation: ${errors.join("; ")}`;
			if (jsonMode) {
				outputJsonError("compact", msg);
			} else {
				console.error(chalk.red(`Error: ${msg}`));
			}
			process.exitCode = 1;
			return;
		}

		// Remove old records and append replacement
		const removeSet = new Set(indicesToRemove);
		const remaining = records.filter((_, i) => !removeSet.has(i));
		remaining.push(replacement);
		await writeExpertiseFile(filePath, remaining);

		if (jsonMode) {
			outputJson({
				success: true,
				command: "compact",
				action: "applied",
				domain,
				removed: indicesToRemove.length,
				replacement,
			});
		} else {
			if (!isQuiet())
				console.log(
					`${brand("✓")} ${brand(`Compacted ${indicesToRemove.length} ${recordType} records into 1 in ${domain}`)}`,
				);
		}
	});
}
