import type { CustomTypeConfig } from "../schemas/config.ts";
import {
	compactMeta,
	formatLinks,
	formatOutcome,
	formatRecordMeta,
	idTag,
	truncate,
	xmlEscape,
} from "../utils/format-helpers.ts";
import { compileSummaryTemplate } from "./template.ts";
import type { TypeDefinition } from "./type-registry.ts";

export const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set([
	"convention",
	"pattern",
	"failure",
	"decision",
	"reference",
	"guide",
]);

// Fields owned by BaseRecord. Custom types must NOT redeclare these as
// required/optional — they're applied automatically by the schema layer.
const BASE_FIELDS: ReadonlySet<string> = new Set([
	"id",
	"type",
	"classification",
	"recorded_at",
	"evidence",
	"tags",
	"relates_to",
	"supersedes",
	"outcomes",
]);

const CUSTOM_NAME_RE = /^[a-z][a-z0-9_]*$/;
const VALID_COMPACT_STRATEGIES = new Set(["concat", "merge_outcomes", "keep_latest", "manual"]);

const linkArray = {
	type: "array",
	items: { type: "string", pattern: "^([a-z0-9-]+:)?mx-[0-9a-f]{4,8}$" },
} as const;

export function validateCustomTypeConfig(name: string, cfg: CustomTypeConfig): void {
	if (!CUSTOM_NAME_RE.test(name)) {
		throw new Error(
			`Invalid custom_types name "${name}": must match ${CUSTOM_NAME_RE} (lowercase, start with letter, alphanumeric/underscore).`,
		);
	}
	if (BUILTIN_TYPE_NAMES.has(name)) {
		throw new Error(
			`Custom type "${name}" shadows a built-in record type. Reserved names: ${[...BUILTIN_TYPE_NAMES].join(", ")}.`,
		);
	}
	if (!Array.isArray(cfg.required) || cfg.required.length === 0) {
		throw new Error(`Custom type "${name}" must declare a non-empty "required" array.`);
	}
	const seen = new Set<string>();
	for (const f of cfg.required) {
		if (typeof f !== "string" || f.length === 0) {
			throw new Error(`Custom type "${name}" has an invalid required field: ${JSON.stringify(f)}.`);
		}
		if (BASE_FIELDS.has(f)) {
			throw new Error(
				`Custom type "${name}" cannot declare base field "${f}" as required (base fields: ${[...BASE_FIELDS].join(", ")}).`,
			);
		}
		if (seen.has(f)) {
			throw new Error(`Custom type "${name}" has duplicate required field "${f}".`);
		}
		seen.add(f);
	}
	for (const f of cfg.optional ?? []) {
		if (typeof f !== "string" || f.length === 0) {
			throw new Error(`Custom type "${name}" has an invalid optional field: ${JSON.stringify(f)}.`);
		}
		if (BASE_FIELDS.has(f)) {
			throw new Error(`Custom type "${name}" cannot declare base field "${f}" as optional.`);
		}
		if (seen.has(f)) {
			throw new Error(`Custom type "${name}" has field "${f}" in both required and optional.`);
		}
		seen.add(f);
	}
	if (typeof cfg.dedup_key !== "string" || cfg.dedup_key.length === 0) {
		throw new Error(`Custom type "${name}" must set "dedup_key" (field name or "content_hash").`);
	}
	if (cfg.dedup_key !== "content_hash" && !seen.has(cfg.dedup_key)) {
		throw new Error(
			`Custom type "${name}" dedup_key "${cfg.dedup_key}" must be declared in required/optional or be "content_hash".`,
		);
	}
	if (cfg.id_key !== undefined && cfg.id_key !== "content_hash" && !seen.has(cfg.id_key)) {
		throw new Error(
			`Custom type "${name}" id_key "${cfg.id_key}" must be declared in required/optional or be "content_hash".`,
		);
	}
	if (typeof cfg.summary !== "string" || cfg.summary.length === 0) {
		throw new Error(`Custom type "${name}" must set "summary" template string.`);
	}
	if (cfg.compact !== undefined && !VALID_COMPACT_STRATEGIES.has(cfg.compact)) {
		throw new Error(
			`Custom type "${name}" compact strategy "${cfg.compact}" is invalid. Use one of: ${[...VALID_COMPACT_STRATEGIES].join(", ")}.`,
		);
	}
	if (cfg.extracts_files && cfg.files_field !== undefined && !seen.has(cfg.files_field)) {
		throw new Error(
			`Custom type "${name}" files_field "${cfg.files_field}" must be declared in required/optional when extracts_files: true.`,
		);
	}
	if (cfg.aliases !== undefined) {
		if (typeof cfg.aliases !== "object" || cfg.aliases === null || Array.isArray(cfg.aliases)) {
			throw new Error(
				`Custom type "${name}" aliases must be a map of canonical field name → legacy alias names.`,
			);
		}
		const seenAliases = new Set<string>();
		for (const [canonical, legacyNames] of Object.entries(cfg.aliases)) {
			if (!seen.has(canonical)) {
				throw new Error(
					`Custom type "${name}" aliases key "${canonical}" must be declared in required/optional.`,
				);
			}
			if (!Array.isArray(legacyNames) || legacyNames.length === 0) {
				throw new Error(
					`Custom type "${name}" aliases entry "${canonical}" must be a non-empty array of legacy field names.`,
				);
			}
			for (const legacy of legacyNames) {
				if (typeof legacy !== "string" || legacy.length === 0) {
					throw new Error(
						`Custom type "${name}" aliases entry "${canonical}" has an invalid legacy name: ${JSON.stringify(legacy)}.`,
					);
				}
				if (BASE_FIELDS.has(legacy)) {
					throw new Error(
						`Custom type "${name}" aliases legacy name "${legacy}" collides with a base field.`,
					);
				}
				if (seen.has(legacy)) {
					throw new Error(
						`Custom type "${name}" aliases legacy name "${legacy}" is already declared as a current field; aliases are for retired names only.`,
					);
				}
				if (seenAliases.has(legacy)) {
					throw new Error(
						`Custom type "${name}" aliases legacy name "${legacy}" appears under multiple canonical fields; each alias maps to one canonical name.`,
					);
				}
				seenAliases.add(legacy);
			}
		}
	}
}

function defaultSectionTitle(name: string): string {
	return `${name.charAt(0).toUpperCase() + name.slice(1)}s`;
}

export function buildCustomTypeDefinition(name: string, cfg: CustomTypeConfig): TypeDefinition {
	validateCustomTypeConfig(name, cfg);

	const required = [...cfg.required];
	const optional = [...(cfg.optional ?? [])];
	const dedupKey = cfg.dedup_key;
	const idKey = cfg.id_key ?? dedupKey;
	const summaryFn = compileSummaryTemplate(cfg.summary);
	const extractsFiles = cfg.extracts_files ?? false;
	const filesField = cfg.files_field ?? "files";
	const compactStrategy = cfg.compact ?? "manual";
	const sectionTitle = cfg.section_title ?? defaultSectionTitle(name);

	const properties: Record<string, unknown> = {
		id: { type: "string", pattern: "^mx-[0-9a-f]{4,8}$" },
		type: { type: "string", const: name },
		classification: { $ref: "#/definitions/classification" },
		recorded_at: { type: "string" },
		evidence: { $ref: "#/definitions/evidence" },
		tags: { type: "array", items: { type: "string" } },
		relates_to: linkArray,
		supersedes: linkArray,
		outcomes: { type: "array", items: { $ref: "#/definitions/outcome" } },
	};

	for (const f of [...required, ...optional]) {
		if (extractsFiles && f === filesField) {
			properties[f] = { type: "array", items: { type: "string" } };
		} else {
			properties[f] = { type: "string" };
		}
	}

	const ajvSchema = {
		type: "object",
		properties,
		required: ["type", ...required, "classification", "recorded_at"],
		additionalProperties: false,
	};

	const aliases = cfg.aliases
		? Object.fromEntries(Object.entries(cfg.aliases).map(([k, v]) => [k, [...v]]))
		: undefined;

	return {
		name,
		kind: "custom",
		required,
		optional,
		dedupKey,
		idKey,
		summary: summaryFn,
		extractsFiles,
		filesField,
		compact: compactStrategy,
		sectionTitle,
		ajvSchema,
		...(aliases ? { aliases } : {}),
		formatMarkdown: (records, full) => {
			if (records.length === 0) return "";
			const lines = [`### ${sectionTitle}`];
			for (const rec of records) {
				const r = rec as unknown as Record<string, unknown>;
				let line = `- ${idTag(rec)}**${summaryFn(rec)}**`;
				const detail: string[] = [];
				for (const f of [...required, ...optional]) {
					if (extractsFiles && f === filesField) continue;
					const v = r[f];
					if (v == null || v === "") continue;
					detail.push(`${f}: ${String(v)}`);
				}
				if (detail.length > 0) line += ` — ${detail.join("; ")}`;
				if (extractsFiles) {
					const files = r[filesField];
					if (Array.isArray(files) && files.length > 0) {
						line += ` (${(files as string[]).join(", ")})`;
					}
				}
				line += formatRecordMeta(rec, full);
				lines.push(line);
			}
			return lines.join("\n");
		},
		formatCompactLine: (record) => {
			const r = record as unknown as Record<string, unknown>;
			const links = formatLinks(record);
			const meta = compactMeta(record);
			const outcome = formatOutcome(record.outcomes);
			let filesPart = "";
			if (extractsFiles) {
				const files = r[filesField];
				if (Array.isArray(files) && files.length > 0) {
					filesPart = ` (${(files as string[]).join(", ")})`;
				}
			}
			return `- [${name}] ${truncate(summaryFn(record))}${filesPart}${meta}${outcome}${links}`;
		},
		formatXml: (record) => {
			const r = record as unknown as Record<string, unknown>;
			const lines: string[] = [];
			for (const f of [...required, ...optional]) {
				const v = r[f];
				if (v == null) continue;
				if (Array.isArray(v)) {
					lines.push(
						`    <${f}>${(v as string[]).map((s) => xmlEscape(String(s))).join(", ")}</${f}>`,
					);
				} else {
					lines.push(`    <${f}>${xmlEscape(String(v))}</${f}>`);
				}
			}
			return lines;
		},
	};
}

export function buildCustomTypeDefinitions(
	customTypes: Record<string, CustomTypeConfig> | undefined,
): TypeDefinition[] {
	if (!customTypes) return [];
	const defs: TypeDefinition[] = [];
	for (const [name, cfg] of Object.entries(customTypes)) {
		defs.push(buildCustomTypeDefinition(name, cfg));
	}
	return defs;
}
