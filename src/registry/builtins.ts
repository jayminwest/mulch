import type {
	ConventionRecord,
	DecisionRecord,
	ExpertiseRecord,
	FailureRecord,
	GuideRecord,
	PatternRecord,
	ReferenceRecord,
} from "../schemas/record.ts";
import {
	compactMeta,
	formatLinks,
	formatOutcome,
	formatRecordMeta,
	idTag,
	truncate,
	xmlEscape,
} from "../utils/format-helpers.ts";
import { type SharedDefinitions, type TypeDefinition, TypeRegistry } from "./type-registry.ts";

const linkArray = {
	type: "array",
	items: { type: "string", pattern: "^([a-z0-9-]+:)?mx-[0-9a-f]{4,8}$" },
} as const;

const SHARED_DEFINITIONS: SharedDefinitions = {
	classification: {
		type: "string",
		enum: ["foundational", "tactical", "observational"],
	},
	evidence: {
		type: "object",
		properties: {
			commit: { type: "string" },
			date: { type: "string" },
			issue: { type: "string" },
			file: { type: "string" },
			bead: { type: "string" },
			seeds: { type: "string" },
			gh: { type: "string" },
			linear: { type: "string" },
		},
		additionalProperties: false,
	},
	outcome: {
		type: "object",
		properties: {
			status: { type: "string", enum: ["success", "failure", "partial"] },
			duration: { type: "number" },
			test_results: { type: "string" },
			agent: { type: "string" },
			notes: { type: "string" },
			recorded_at: { type: "string" },
		},
		required: ["status"],
		additionalProperties: false,
	},
};

const baseSchemaProps = {
	id: { type: "string", pattern: "^mx-[0-9a-f]{4,8}$" },
	classification: { $ref: "#/definitions/classification" },
	recorded_at: { type: "string" },
	evidence: { $ref: "#/definitions/evidence" },
	tags: { type: "array", items: { type: "string" } },
	relates_to: linkArray,
	supersedes: linkArray,
	outcomes: { type: "array", items: { $ref: "#/definitions/outcome" } },
	dir_anchors: { type: "array", items: { type: "string" } },
	supersession_demoted_at: { type: "string" },
	anchor_decay_demoted_at: { type: "string" },
	owner: { type: "string" },
	// "archived" is intentionally absent — soft-archived records bypass AJV
	// (they live under .mulch/archive/) and live records may not carry it.
	status: { type: "string", enum: ["draft", "active", "deprecated"] },
} as const;

// --- convention ---

const conventionDef: TypeDefinition = {
	name: "convention",
	kind: "builtin",
	required: ["content"],
	optional: [],
	dedupKey: "content",
	idKey: "content",
	summary: (r) => truncate((r as ConventionRecord).content, 60),
	extractsFiles: false,
	filesField: "files",
	compact: "concat",
	sectionTitle: "Conventions",
	ajvSchema: {
		type: "object",
		properties: {
			...baseSchemaProps,
			type: { type: "string", const: "convention" },
			content: { type: "string" },
		},
		required: ["type", "content", "classification", "recorded_at"],
		additionalProperties: false,
	},
	formatMarkdown: (records, full) => {
		if (records.length === 0) return "";
		const lines = ["### Conventions"];
		for (const rec of records as ConventionRecord[]) {
			lines.push(`- ${idTag(rec)}${rec.content}${formatRecordMeta(rec, full)}`);
		}
		return lines.join("\n");
	},
	formatCompactLine: (record) => {
		const r = record as ConventionRecord;
		const links = formatLinks(r);
		const meta = compactMeta(r);
		const outcome = formatOutcome(r.outcomes);
		return `- [convention] ${truncate(r.content)}${meta}${outcome}${links}`;
	},
	formatXml: (record) => {
		const r = record as ConventionRecord;
		return [`    ${xmlEscape(r.content)}`];
	},
};

// --- pattern ---

const patternDef: TypeDefinition = {
	name: "pattern",
	kind: "builtin",
	required: ["name", "description"],
	optional: ["files"],
	dedupKey: "name",
	idKey: "name",
	summary: (r) => (r as PatternRecord).name,
	extractsFiles: true,
	filesField: "files",
	compact: "concat",
	sectionTitle: "Patterns",
	ajvSchema: {
		type: "object",
		properties: {
			...baseSchemaProps,
			type: { type: "string", const: "pattern" },
			name: { type: "string" },
			description: { type: "string" },
			files: { type: "array", items: { type: "string" } },
		},
		required: ["type", "name", "description", "classification", "recorded_at"],
		additionalProperties: false,
	},
	formatMarkdown: (records, full) => {
		if (records.length === 0) return "";
		const lines = ["### Patterns"];
		for (const rec of records as PatternRecord[]) {
			let line = `- ${idTag(rec)}**${rec.name}**: ${rec.description}`;
			if (rec.files && rec.files.length > 0) {
				line += ` (${rec.files.join(", ")})`;
			}
			line += formatRecordMeta(rec, full);
			lines.push(line);
		}
		return lines.join("\n");
	},
	formatCompactLine: (record) => {
		const r = record as PatternRecord;
		const links = formatLinks(r);
		const meta = compactMeta(r);
		const outcome = formatOutcome(r.outcomes);
		const files = r.files && r.files.length > 0 ? ` (${r.files.join(", ")})` : "";
		return `- [pattern] ${r.name}: ${truncate(r.description)}${files}${meta}${outcome}${links}`;
	},
	formatXml: (record) => {
		const r = record as PatternRecord;
		const lines: string[] = [];
		lines.push(`    <name>${xmlEscape(r.name)}</name>`);
		lines.push(`    <description>${xmlEscape(r.description)}</description>`);
		if (r.files && r.files.length > 0) {
			lines.push(`    <files>${r.files.map(xmlEscape).join(", ")}</files>`);
		}
		return lines;
	},
};

// --- failure ---

const failureDef: TypeDefinition = {
	name: "failure",
	kind: "builtin",
	required: ["description", "resolution"],
	optional: [],
	dedupKey: "description",
	idKey: "description",
	summary: (r) => truncate((r as FailureRecord).description, 60),
	extractsFiles: false,
	filesField: "files",
	compact: "concat",
	sectionTitle: "Known Failures",
	ajvSchema: {
		type: "object",
		properties: {
			...baseSchemaProps,
			type: { type: "string", const: "failure" },
			description: { type: "string" },
			resolution: { type: "string" },
		},
		required: ["type", "description", "resolution", "classification", "recorded_at"],
		additionalProperties: false,
	},
	formatMarkdown: (records, full) => {
		if (records.length === 0) return "";
		const lines = ["### Known Failures"];
		for (const rec of records as FailureRecord[]) {
			lines.push(`- ${idTag(rec)}${rec.description}${formatRecordMeta(rec, full)}`);
			lines.push(`  → ${rec.resolution}`);
		}
		return lines.join("\n");
	},
	formatCompactLine: (record) => {
		const r = record as FailureRecord;
		const links = formatLinks(r);
		const meta = compactMeta(r);
		const outcome = formatOutcome(r.outcomes);
		return `- [failure] ${truncate(r.description)} → ${truncate(r.resolution)}${meta}${outcome}${links}`;
	},
	formatXml: (record) => {
		const r = record as FailureRecord;
		return [
			`    <description>${xmlEscape(r.description)}</description>`,
			`    <resolution>${xmlEscape(r.resolution)}</resolution>`,
		];
	},
};

// --- decision ---

const decisionDef: TypeDefinition = {
	name: "decision",
	kind: "builtin",
	required: ["title", "rationale"],
	optional: ["date"],
	dedupKey: "title",
	idKey: "title",
	summary: (r) => (r as DecisionRecord).title,
	extractsFiles: false,
	filesField: "files",
	compact: "concat",
	sectionTitle: "Decisions",
	ajvSchema: {
		type: "object",
		properties: {
			...baseSchemaProps,
			type: { type: "string", const: "decision" },
			title: { type: "string" },
			rationale: { type: "string" },
			date: { type: "string" },
		},
		required: ["type", "title", "rationale", "classification", "recorded_at"],
		additionalProperties: false,
	},
	formatMarkdown: (records, full) => {
		if (records.length === 0) return "";
		const lines = ["### Decisions"];
		for (const rec of records as DecisionRecord[]) {
			lines.push(`- ${idTag(rec)}**${rec.title}**: ${rec.rationale}${formatRecordMeta(rec, full)}`);
		}
		return lines.join("\n");
	},
	formatCompactLine: (record) => {
		const r = record as DecisionRecord;
		const links = formatLinks(r);
		const meta = compactMeta(r);
		const outcome = formatOutcome(r.outcomes);
		return `- [decision] ${r.title}: ${truncate(r.rationale)}${meta}${outcome}${links}`;
	},
	formatXml: (record) => {
		const r = record as DecisionRecord;
		return [
			`    <title>${xmlEscape(r.title)}</title>`,
			`    <rationale>${xmlEscape(r.rationale)}</rationale>`,
		];
	},
};

// --- reference ---

const referenceDef: TypeDefinition = {
	name: "reference",
	kind: "builtin",
	required: ["name", "description"],
	optional: ["files"],
	dedupKey: "name",
	idKey: "name",
	summary: (r) => (r as ReferenceRecord).name,
	extractsFiles: true,
	filesField: "files",
	compact: "concat",
	sectionTitle: "References",
	ajvSchema: {
		type: "object",
		properties: {
			...baseSchemaProps,
			type: { type: "string", const: "reference" },
			name: { type: "string" },
			description: { type: "string" },
			files: { type: "array", items: { type: "string" } },
		},
		required: ["type", "name", "description", "classification", "recorded_at"],
		additionalProperties: false,
	},
	formatMarkdown: (records, full) => {
		if (records.length === 0) return "";
		const lines = ["### References"];
		for (const rec of records as ReferenceRecord[]) {
			let line = `- ${idTag(rec)}**${rec.name}**: ${rec.description}`;
			if (rec.files && rec.files.length > 0) {
				line += ` (${rec.files.join(", ")})`;
			}
			line += formatRecordMeta(rec, full);
			lines.push(line);
		}
		return lines.join("\n");
	},
	formatCompactLine: (record) => {
		const r = record as ReferenceRecord;
		const links = formatLinks(r);
		const meta = compactMeta(r);
		const outcome = formatOutcome(r.outcomes);
		const refFiles =
			r.files && r.files.length > 0 ? `: ${r.files.join(", ")}` : `: ${truncate(r.description)}`;
		return `- [reference] ${r.name}${refFiles}${meta}${outcome}${links}`;
	},
	formatXml: (record) => {
		const r = record as ReferenceRecord;
		const lines: string[] = [];
		lines.push(`    <name>${xmlEscape(r.name)}</name>`);
		lines.push(`    <description>${xmlEscape(r.description)}</description>`);
		if (r.files && r.files.length > 0) {
			lines.push(`    <files>${r.files.map(xmlEscape).join(", ")}</files>`);
		}
		return lines;
	},
};

// --- guide ---

const guideDef: TypeDefinition = {
	name: "guide",
	kind: "builtin",
	required: ["name", "description"],
	optional: [],
	dedupKey: "name",
	idKey: "name",
	summary: (r) => (r as GuideRecord).name,
	extractsFiles: false,
	filesField: "files",
	compact: "concat",
	sectionTitle: "Guides",
	ajvSchema: {
		type: "object",
		properties: {
			...baseSchemaProps,
			type: { type: "string", const: "guide" },
			name: { type: "string" },
			description: { type: "string" },
		},
		required: ["type", "name", "description", "classification", "recorded_at"],
		additionalProperties: false,
	},
	formatMarkdown: (records, full) => {
		if (records.length === 0) return "";
		const lines = ["### Guides"];
		for (const rec of records as GuideRecord[]) {
			lines.push(
				`- ${idTag(rec)}**${rec.name}**: ${rec.description}${formatRecordMeta(rec, full)}`,
			);
		}
		return lines.join("\n");
	},
	formatCompactLine: (record) => {
		const r = record as GuideRecord;
		const links = formatLinks(r);
		const meta = compactMeta(r);
		const outcome = formatOutcome(r.outcomes);
		return `- [guide] ${r.name}: ${truncate(r.description)}${meta}${outcome}${links}`;
	},
	formatXml: (record) => {
		const r = record as GuideRecord;
		return [
			`    <name>${xmlEscape(r.name)}</name>`,
			`    <description>${xmlEscape(r.description)}</description>`,
		];
	},
};

// Section enumeration order for markdown rendering. Matches the historical
// order in formatDomainExpertise so output stays byte-identical.
export const BUILTIN_DEFS: readonly TypeDefinition[] = [
	conventionDef,
	patternDef,
	failureDef,
	decisionDef,
	referenceDef,
	guideDef,
] as const;

export function buildBuiltinRegistry(): TypeRegistry {
	return new TypeRegistry([...BUILTIN_DEFS], SHARED_DEFINITIONS);
}

// Re-export helper for downstream cast-assertion sites:
export type AnyRecord = ExpertiseRecord;
