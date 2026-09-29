import type { Command } from "commander";
import { getRegistry } from "../registry/type-registry.ts";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { getExpertisePath, readConfig } from "../utils/config.ts";
import { readExpertiseFile } from "../utils/expertise.ts";
import { outputJson, reportCommandError } from "../utils/json-output.ts";

interface ShownRecord {
	domain: string;
	record: ExpertiseRecord;
}

/**
 * Find records by id (full `mx-abc123`, bare hash, or unique prefix) across
 * every configured domain. Returns an error string for a missing or
 * ambiguous identifier.
 */
async function findRecordsById(
	domains: string[],
	identifiers: string[],
): Promise<{ ok: true; found: ShownRecord[] } | { ok: false; error: string }> {
	const all: ShownRecord[] = [];
	for (const domain of domains) {
		for (const record of await readExpertiseFile(getExpertisePath(domain))) {
			all.push({ domain, record });
		}
	}
	const found: ShownRecord[] = [];
	for (const identifier of identifiers) {
		const prefix = `mx-${identifier.startsWith("mx-") ? identifier.slice(3) : identifier}`;
		const exact = all.filter((s) => s.record.id === prefix);
		const matches = exact.length > 0 ? exact : all.filter((s) => s.record.id?.startsWith(prefix));
		const [first] = matches;
		if (!first) {
			return {
				ok: false,
				error: `Record "${identifier}" not found. Run \`ml search\` or \`ml prime\` to see record IDs.`,
			};
		}
		if (matches.length > 1) {
			const ids = matches.map((m) => `${m.record.id} (${m.domain})`).join(", ");
			return {
				ok: false,
				error: `Ambiguous identifier "${identifier}" matches ${matches.length} records: ${ids}. Use more characters to disambiguate.`,
			};
		}
		found.push(first);
	}
	return { ok: true, found };
}

export function registerShowCommand(program: Command): void {
	program
		.command("show")
		.argument("<ids...>", "record ID(s) (e.g. mx-abc123, abc123, or abc)")
		.description("Show full record bodies by ID (the detail behind `ml prime`'s index)")
		.action(async (ids: string[]) => {
			const jsonMode = program.opts().json === true;
			try {
				const config = await readConfig();
				const result = await findRecordsById(Object.keys(config.domains), ids);
				if (!result.ok) {
					reportCommandError("show", jsonMode, result.error);
					return;
				}
				if (jsonMode) {
					outputJson({ success: true, command: "show", records: result.found });
					return;
				}
				const registry = getRegistry();
				const blocks = result.found.map(({ domain, record }) => {
					const body = registry.get(record.type)?.formatMarkdown([record], true);
					return `## ${domain}\n\n${body || JSON.stringify(record, null, 2)}`;
				});
				console.log(blocks.join("\n\n"));
			} catch (err) {
				reportCommandError("show", jsonMode, err);
			}
		});
}
