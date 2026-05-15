// Custom tools registered on session_start when `pi.tools` is enabled.
//
// record_expertise — structured wrapper around `ml record <domain> --batch
//   <tmp> --json`. The parameter schema is permissive (a free-form `fields`
//   bag) but the tool description is composed dynamically from the in-process
//   TypeRegistry plus per-domain rules, so the LLM gets accurate allowed-types
//   and required-fields strings for *this project's* config — including any
//   declared custom_types (release_decision, flake_symptom, …).
//
// query_expertise — wraps `ml search` and `ml prime` (full + --files variants)
//   behind one tool so the LLM stops escaping into bash for what should be a
//   single call. Shells out so it inherits CLI behavior verbatim (auto-flip to
//   manifest, archived flag, JSON output, hooks).
//
// Both tools shell out via `pi.exec` (no stdin support, so record_expertise
// uses --batch with a temp file) and return JSON on the happy path so the
// model can parse outcomes deterministically.
//
// The TypeRegistry is hydrated from mulch.config.yaml on every tool call,
// matching the rest of the extension's "read config on every invocation"
// posture — config edits take effect without restart.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, ExecResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { initRegistryFromConfig } from "../../../src/registry/init.ts";
import type { TypeRegistry } from "../../../src/registry/type-registry.ts";
import type { MulchConfig } from "../../../src/schemas/config.ts";
import { readConfig } from "../../../src/utils/config.ts";
import { getAllowedTypes, getRequiredFields } from "../../../src/utils/domain-rules.ts";

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

export interface ToolDeps {
	exec: ExecFn;
	cwd: string;
}

const RECORD_TIMEOUT_MS = 15_000;
const QUERY_TIMEOUT_MS = 15_000;

// --- record_expertise ---

const classificationSchema = Type.Union([
	Type.Literal("foundational"),
	Type.Literal("tactical"),
	Type.Literal("observational"),
]);

const recordSchema = Type.Object({
	domain: Type.String({
		description: "Mulch domain — one of the configured domains. Auto-created if it does not exist.",
	}),
	type: Type.String({
		description:
			"Record type. Allowed values are project-specific; see the description for the type-and-required-fields table.",
	}),
	fields: Type.Record(Type.String(), Type.Unknown(), {
		description:
			"Type-specific fields. Required fields per type are listed in the tool description.",
	}),
	classification: Type.Optional(classificationSchema),
	tags: Type.Optional(Type.Array(Type.String())),
	relates_to: Type.Optional(Type.Array(Type.String())),
	supersedes: Type.Optional(Type.Array(Type.String())),
	evidence: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description:
				"Evidence references. Supported keys: commit, date, issue, file, bead, seeds, gh, linear.",
		}),
	),
	dry_run: Type.Optional(
		Type.Boolean({
			description: "Preview validation without writing. Defaults to false.",
		}),
	),
});

export type RecordExpertiseInput = Static<typeof recordSchema>;

export interface RecordExpertiseDetails {
	domain: string;
	type: string;
	created?: number;
	updated?: number;
	skipped?: number;
	errors?: string[];
	warnings?: string[];
	dryRun?: boolean;
}

function composeRecordDescription(registry: TypeRegistry, config: MulchConfig): string {
	const lines: string[] = [];
	lines.push(
		"Record a structured expertise insight into a Mulch domain. Wraps `ml record --batch --json`.",
	);
	lines.push("");
	lines.push("Record types and their required fields:");
	for (const def of registry.enabled()) {
		const required = def.required.length === 0 ? "(none)" : def.required.join(", ");
		const disabled = registry.isDisabled(def.name) ? " [disabled]" : "";
		lines.push(`  - ${def.name}${disabled}: ${required}`);
	}
	const domainEntries = Object.entries(config.domains);
	if (domainEntries.length > 0) {
		lines.push("");
		lines.push("Per-domain rules:");
		for (const [name, dom] of domainEntries) {
			const parts: string[] = [];
			if (dom.allowed_types && dom.allowed_types.length > 0) {
				parts.push(`allowed types: ${dom.allowed_types.join(", ")}`);
			}
			if (dom.required_fields && dom.required_fields.length > 0) {
				parts.push(`required fields: ${dom.required_fields.join(", ")}`);
			}
			if (parts.length === 0) parts.push("any registered type");
			lines.push(`  - ${name}: ${parts.join("; ")}`);
		}
	}
	lines.push("");
	lines.push(
		"Pass type-specific fields under `fields`. Evidence (commit + files) auto-populates from git when omitted.",
	);
	return lines.join("\n");
}

interface RecordValidation {
	ok: true;
	record: Record<string, unknown>;
}

interface RecordValidationError {
	ok: false;
	error: string;
}

function validateRecordInput(
	input: RecordExpertiseInput,
	registry: TypeRegistry,
	config: MulchConfig,
): RecordValidation | RecordValidationError {
	const def = registry.get(input.type);
	if (!def) {
		const enabled = registry
			.enabled()
			.map((d) => d.name)
			.join(", ");
		return {
			ok: false,
			error: `Unknown record type "${input.type}". Registered types: ${enabled}.`,
		};
	}

	const allowed = getAllowedTypes(config, input.domain);
	if (allowed && !allowed.includes(input.type)) {
		return {
			ok: false,
			error: `Type "${input.type}" is not allowed in domain "${input.domain}". Allowed types: ${allowed.join(", ")}.`,
		};
	}

	const fields = input.fields ?? {};
	const missingTypeFields = def.required.filter((field) => {
		const value = fields[field];
		return (
			value === undefined ||
			value === null ||
			value === "" ||
			(Array.isArray(value) && value.length === 0)
		);
	});
	if (missingTypeFields.length > 0) {
		return {
			ok: false,
			error: `Missing required field(s) for type "${input.type}": ${missingTypeFields.join(", ")}.`,
		};
	}

	const record: Record<string, unknown> = { type: input.type, ...fields };
	if (input.classification) record.classification = input.classification;
	if (input.tags && input.tags.length > 0) record.tags = input.tags;
	if (input.relates_to && input.relates_to.length > 0) record.relates_to = input.relates_to;
	if (input.supersedes && input.supersedes.length > 0) record.supersedes = input.supersedes;
	if (input.evidence && Object.keys(input.evidence).length > 0) record.evidence = input.evidence;

	const domainRequired = getRequiredFields(config, input.domain);
	if (domainRequired && domainRequired.length > 0) {
		const missingDomain = domainRequired.filter((field) => {
			const value = record[field];
			return (
				value === undefined ||
				value === null ||
				value === "" ||
				(Array.isArray(value) && value.length === 0)
			);
		});
		if (missingDomain.length > 0) {
			return {
				ok: false,
				error: `Domain "${input.domain}" requires field(s) ${missingDomain.map((f) => `"${f}"`).join(", ")}. Pass them under \`fields\` or \`evidence\`.`,
			};
		}
	}

	return { ok: true, record };
}

function textResult(
	text: string,
	details: RecordExpertiseDetails,
): AgentToolResult<RecordExpertiseDetails> {
	return { content: [{ type: "text", text }], details };
}

async function withTempBatchFile<T>(
	record: Record<string, unknown>,
	fn: (path: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "mulch-pi-"));
	const file = join(dir, `record-${randomBytes(4).toString("hex")}.json`);
	await writeFile(file, JSON.stringify([record]), "utf-8");
	try {
		return await fn(file);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

interface RecordCliOutput {
	success?: boolean;
	created?: number;
	updated?: number;
	skipped?: number;
	errors?: string[];
	warnings?: string[];
}

function parseRecordOutput(stdout: string): RecordCliOutput | null {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) return null;
	try {
		const parsed = JSON.parse(trimmed) as RecordCliOutput;
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

export async function buildRecordExpertiseTool(
	deps: ToolDeps,
): Promise<ToolDefinition<typeof recordSchema, RecordExpertiseDetails>> {
	const registry = await initRegistryFromConfig(deps.cwd);
	const config = await readConfig(deps.cwd);
	const description = composeRecordDescription(registry, config);

	return {
		name: "record_expertise",
		label: "Record expertise",
		description,
		parameters: recordSchema,
		async execute(_toolCallId, params): Promise<AgentToolResult<RecordExpertiseDetails>> {
			// Re-read on every call so config edits take effect mid-session.
			const liveConfig = await readConfig(deps.cwd);
			const liveRegistry = await initRegistryFromConfig(deps.cwd);
			const validated = validateRecordInput(params, liveRegistry, liveConfig);
			if (!validated.ok) {
				return textResult(`mulch.record: ${validated.error}`, {
					domain: params.domain,
					type: params.type,
					errors: [validated.error],
				});
			}

			const dryRun = params.dry_run === true;
			const args = ["record", params.domain, "--batch", "<placeholder>", "--json"];
			if (dryRun) args.push("--dry-run");

			return withTempBatchFile(validated.record, async (path) => {
				args[3] = path;
				let result: ExecResult;
				try {
					result = await deps.exec("ml", args, { cwd: deps.cwd, timeout: RECORD_TIMEOUT_MS });
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return textResult(`mulch.record: exec failed — ${msg}`, {
						domain: params.domain,
						type: params.type,
						errors: [msg],
						dryRun,
					});
				}

				const parsed = parseRecordOutput(result.stdout);
				if (parsed) {
					const details: RecordExpertiseDetails = {
						domain: params.domain,
						type: params.type,
						created: parsed.created ?? 0,
						updated: parsed.updated ?? 0,
						skipped: parsed.skipped ?? 0,
						errors: parsed.errors,
						warnings: parsed.warnings,
						dryRun,
					};
					const summary = dryRun
						? `mulch.record (dry-run): create=${details.created} update=${details.updated} skip=${details.skipped}`
						: `mulch.record: create=${details.created} update=${details.updated} skip=${details.skipped}`;
					const errorTail =
						parsed.errors && parsed.errors.length > 0
							? `\nErrors: ${parsed.errors.join("; ")}`
							: "";
					const warnTail =
						parsed.warnings && parsed.warnings.length > 0
							? `\nWarnings: ${parsed.warnings.join("; ")}`
							: "";
					return textResult(`${summary}${errorTail}${warnTail}`, details);
				}

				// Non-JSON stdout (or non-zero exit) — surface raw output for debugging.
				const tail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
				return textResult(`mulch.record failed (exit ${result.code}): ${tail}`, {
					domain: params.domain,
					type: params.type,
					errors: [tail],
					dryRun,
				});
			});
		},
	};
}

// --- query_expertise ---

const querySchema = Type.Object({
	query: Type.Optional(
		Type.String({
			description: "Search string (case-insensitive substring). Omit to list a domain or files.",
		}),
	),
	domain: Type.Optional(
		Type.String({
			description: "Limit to a single domain. With no `query` or `files`, primes that domain.",
		}),
	),
	files: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Repo-relative paths to scope-load via `ml prime --files`. Ignores `query` when set.",
		}),
	),
	type: Type.Optional(Type.String({ description: "Filter by record type when searching." })),
	tag: Type.Optional(Type.String({ description: "Filter by tag when searching." })),
	archived: Type.Optional(
		Type.Boolean({ description: "Include soft-archived records (search-only)." }),
	),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: "Cap on records returned (best-effort; some modes ignore).",
		}),
	),
});

export type QueryExpertiseInput = Static<typeof querySchema>;

export interface QueryExpertiseDetails {
	mode: "search" | "prime-files" | "prime-domain" | "prime";
	args: string[];
	exitCode: number;
	bytes: number;
}

function buildQueryArgs(params: QueryExpertiseInput): {
	mode: QueryExpertiseDetails["mode"];
	args: string[];
} {
	if (params.files && params.files.length > 0) {
		const args = ["prime", "--files", ...params.files, "--json"];
		if (params.limit !== undefined) args.push("--budget", String(params.limit));
		return { mode: "prime-files", args };
	}
	if (params.query) {
		const args = ["search", params.query, "--json"];
		if (params.domain) args.push("--domain", params.domain);
		if (params.type) args.push("--type", params.type);
		if (params.tag) args.push("--tag", params.tag);
		if (params.archived) args.push("--archived");
		return { mode: "search", args };
	}
	if (params.domain) {
		const args = ["prime", params.domain, "--json"];
		if (params.limit !== undefined) args.push("--budget", String(params.limit));
		return { mode: "prime-domain", args };
	}
	const args = ["prime", "--json"];
	if (params.limit !== undefined) args.push("--budget", String(params.limit));
	return { mode: "prime", args };
}

function queryTextResult(
	text: string,
	details: QueryExpertiseDetails,
): AgentToolResult<QueryExpertiseDetails> {
	return { content: [{ type: "text", text }], details };
}

export function buildQueryExpertiseTool(
	deps: ToolDeps,
): ToolDefinition<typeof querySchema, QueryExpertiseDetails> {
	return {
		name: "query_expertise",
		label: "Query expertise",
		description:
			"Read Mulch expertise via `ml search` or `ml prime`. " +
			"Pass `query` to search across domains, `files` to scope-load records relevant to specific paths, " +
			"or `domain` alone to prime that domain. Returns JSON.",
		parameters: querySchema,
		async execute(_toolCallId, params): Promise<AgentToolResult<QueryExpertiseDetails>> {
			const { mode, args } = buildQueryArgs(params);
			let result: ExecResult;
			try {
				result = await deps.exec("ml", args, { cwd: deps.cwd, timeout: QUERY_TIMEOUT_MS });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return queryTextResult(`mulch.query: exec failed — ${msg}`, {
					mode,
					args,
					exitCode: -1,
					bytes: 0,
				});
			}
			if (result.code !== 0) {
				const tail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
				return queryTextResult(`mulch.query failed (exit ${result.code}): ${tail}`, {
					mode,
					args,
					exitCode: result.code,
					bytes: result.stdout.length,
				});
			}
			const stdout = result.stdout.trim();
			return queryTextResult(stdout.length === 0 ? "(no results)" : stdout, {
				mode,
				args,
				exitCode: result.code,
				bytes: stdout.length,
			});
		},
	};
}
