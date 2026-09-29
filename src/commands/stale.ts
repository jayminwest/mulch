import type { Command } from "commander";
import type { MulchConfig } from "../schemas/config.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile } from "../utils/expertise.ts";
import { outputJson, reportCommandError } from "../utils/json-output.ts";
import { isQuiet } from "../utils/palette.ts";
import { findStaleRecords, type StaleReason } from "../utils/staleness.ts";
import { collectSupersededIds } from "./prune.ts";

interface StaleEntry {
	id: string;
	domain: string;
	type: string;
	reasons: StaleReason[];
}

/** Stale live records across `domains`, in domain + file order. */
async function collectStaleEntries(config: MulchConfig, domains: string[]): Promise<StaleEntry[]> {
	const loaded: Array<{ domain: string; records: ExpertiseRecord[] }> = [];
	for (const domain of domains) {
		loaded.push({ domain, records: await readExpertiseFile(getExpertisePath(domain)) });
	}
	// Superseded records are already hidden from prime; don't re-flag them.
	const { supersededIds } = collectSupersededIds(loaded);
	const isLive = (r: ExpertiseRecord) => !(r.id && supersededIds.has(r.id));
	const stale = findStaleRecords(
		loaded.flatMap((l) => l.records.filter(isLive)),
		{
			cwd: process.cwd(),
			now: new Date(),
			shelfLife: config.classification_defaults.shelf_life,
		},
	);
	const entries: StaleEntry[] = [];
	for (const { domain, records } of loaded) {
		for (const r of records) {
			const reasons = r.id && isLive(r) ? stale.get(r.id) : undefined;
			if (r.id && reasons) entries.push({ id: r.id, domain, type: r.type, reasons });
		}
	}
	return entries;
}

export function registerStaleCommand(program: Command): void {
	program
		.command("stale")
		.argument("[domains...]", "optional domain(s) to check (default: all)")
		.description(
			"List records that look stale: anchors changed since the evidence commit, missing anchors, or past shelf life unconfirmed",
		)
		.action(async (domainsArg: string[]) => {
			const jsonMode = program.opts().json === true;
			try {
				const config = await readConfig();
				const domains = domainsArg.length > 0 ? domainsArg : Object.keys(config.domains);
				const unknown = domains.find((d) => !(d in config.domains));
				if (unknown) {
					reportCommandError("stale", jsonMode, `Domain "${unknown}" not found in config.`);
					return;
				}
				const entries = await collectStaleEntries(config, domains);
				if (jsonMode) {
					outputJson({ success: true, command: "stale", records: entries });
					return;
				}
				if (entries.length === 0) {
					if (!isQuiet()) console.log("No stale records.");
					return;
				}
				for (const e of entries) {
					const reasons = e.reasons.map((r) => r.detail).join("; ");
					console.log(`${e.id} (${e.domain}, ${e.type}) ${reasons}`);
				}
				console.log(
					`\n${entries.length} stale record(s). Check with \`ml show <id>\`; refresh via \`ml edit\`, confirm via \`ml outcome\`, or replace with \`ml record --supersedes <id>\`.`,
				);
			} catch (err) {
				reportCommandError("stale", jsonMode, err);
			}
		});
}
