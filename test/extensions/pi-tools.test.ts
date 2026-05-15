import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExecResult,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import {
	buildQueryExpertiseTool,
	buildRecordExpertiseTool,
	type QueryExpertiseDetails,
	type RecordExpertiseDetails,
} from "../../extensions/pi/lib/tools.ts";

type ExecCall = { command: string; args: string[]; cwd?: string; timeout?: number };

function fakeExec(
	respond: (call: ExecCall) => Partial<ExecResult> | Error | Promise<Partial<ExecResult>>,
): {
	exec: (
		command: string,
		args: string[],
		options?: { cwd?: string; timeout?: number },
	) => Promise<ExecResult>;
	calls: ExecCall[];
} {
	const calls: ExecCall[] = [];
	return {
		calls,
		exec: async (command, args, options) => {
			const call: ExecCall = { command, args, cwd: options?.cwd, timeout: options?.timeout };
			calls.push(call);
			const r = respond(call);
			if (r instanceof Error) throw r;
			const resolved = await r;
			return {
				stdout: resolved.stdout ?? "",
				stderr: resolved.stderr ?? "",
				code: resolved.code ?? 0,
				killed: resolved.killed ?? false,
			};
		},
	};
}

interface ToolResult<TDetails> {
	content: Array<{ type: "text"; text: string }>;
	details?: TDetails;
}

function firstText<TDetails>(result: ToolResult<TDetails>): string {
	return result.content[0]?.text ?? "";
}

// ToolDefinition.execute requires (toolCallId, params, signal, onUpdate, ctx).
// The implementations under test ignore the trailing three; this helper passes
// undefined for them so call sites stay readable.
function callExecute<TParams extends TSchema, TDetails>(
	tool: ToolDefinition<TParams, TDetails>,
	toolCallId: string,
	params: Static<TParams>,
): Promise<AgentToolResult<TDetails>> {
	return tool.execute(
		toolCallId,
		params,
		undefined as unknown as AbortSignal | undefined,
		undefined as unknown as AgentToolUpdateCallback<TDetails> | undefined,
		undefined as unknown as ExtensionContext,
	);
}

async function writeConfig(cwd: string, body: string): Promise<void> {
	await mkdir(join(cwd, ".mulch", "expertise"), { recursive: true });
	await writeFile(join(cwd, ".mulch", "mulch.config.yaml"), body, "utf-8");
}

describe("tools: buildRecordExpertiseTool", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-pi-tools-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("registers as record_expertise with a description listing types and per-domain rules", async () => {
		await writeConfig(
			tmpDir,
			[
				"version: '1'",
				"domains:",
				"  cli:",
				"    allowed_types: [convention, pattern, failure, decision]",
				"  ecosystem:",
				"    allowed_types: [pattern, failure]",
				"    required_fields: [evidence]",
				"custom_types:",
				"  release_decision:",
				"    extends: decision",
				"    required: [title, rationale, version]",
				"",
			].join("\n"),
		);

		const { exec } = fakeExec(() => ({ stdout: "{}", code: 0 }));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		expect(tool.name).toBe("record_expertise");
		// Built-in types surface with their required-field lists.
		expect(tool.description).toContain("convention:");
		expect(tool.description).toContain("pattern: name");
		// Custom types declared in mulch.config.yaml are reflected verbatim.
		expect(tool.description).toContain("release_decision: title, rationale, version");
		// Per-domain rules table includes both allowed_types and required_fields.
		expect(tool.description).toContain(
			"cli: allowed types: convention, pattern, failure, decision",
		);
		expect(tool.description).toContain(
			"ecosystem: allowed types: pattern, failure; required fields: evidence",
		);
	});

	it("rejects unknown record types without shelling out", async () => {
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		const { exec, calls } = fakeExec(() => ({ stdout: "{}", code: 0 }));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-1", {
			domain: "cli",
			type: "nonsense",
			fields: { description: "x" },
		})) as ToolResult<RecordExpertiseDetails>;

		expect(calls).toHaveLength(0);
		expect(firstText(out)).toContain('Unknown record type "nonsense"');
		expect(out.details?.errors?.[0]).toContain('Unknown record type "nonsense"');
	});

	it("rejects types not allowed by per-domain allowed_types and cites allowed list", async () => {
		await writeConfig(
			tmpDir,
			[
				"version: '1'",
				"domains:",
				"  architecture:",
				"    allowed_types: [decision, pattern, reference, guide]",
				"",
			].join("\n"),
		);
		const { exec, calls } = fakeExec(() => ({ stdout: "{}", code: 0 }));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-2", {
			domain: "architecture",
			type: "convention",
			fields: { content: "x" },
		})) as ToolResult<RecordExpertiseDetails>;

		expect(calls).toHaveLength(0);
		const text = firstText(out);
		expect(text).toContain('Type "convention" is not allowed in domain "architecture"');
		expect(text).toContain("decision, pattern, reference, guide");
	});

	it("rejects missing type-required fields without shelling out", async () => {
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		const { exec, calls } = fakeExec(() => ({ stdout: "{}", code: 0 }));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		// pattern requires `name` + `description`; we only pass description.
		const out = (await callExecute(tool, "call-3", {
			domain: "cli",
			type: "pattern",
			fields: { description: "missing the name" },
		})) as ToolResult<RecordExpertiseDetails>;

		expect(calls).toHaveLength(0);
		expect(firstText(out)).toContain('Missing required field(s) for type "pattern": name');
	});

	it("rejects records missing domain-required fields and points at fields/evidence", async () => {
		await writeConfig(
			tmpDir,
			[
				"version: '1'",
				"domains:",
				"  ecosystem:",
				"    allowed_types: [failure]",
				"    required_fields: [evidence]",
				"",
			].join("\n"),
		);
		const { exec, calls } = fakeExec(() => ({ stdout: "{}", code: 0 }));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-4", {
			domain: "ecosystem",
			type: "failure",
			fields: { description: "boom", resolution: "fixed" },
		})) as ToolResult<RecordExpertiseDetails>;

		expect(calls).toHaveLength(0);
		const text = firstText(out);
		expect(text).toContain('Domain "ecosystem" requires field(s) "evidence"');
		expect(text).toContain("Pass them under `fields` or `evidence`");
	});

	it("invokes ml record --batch <tmp> --json with the assembled record and parses JSON output", async () => {
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		let capturedBatch: unknown;
		const { exec, calls } = fakeExec(async (call) => {
			const idx = call.args.indexOf("--batch");
			const path = call.args[idx + 1];
			if (path) {
				const body = await readFile(path, "utf-8");
				capturedBatch = JSON.parse(body);
			}
			return {
				stdout: JSON.stringify({ created: 1, updated: 0, skipped: 0 }),
				code: 0,
			};
		});
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-5", {
			domain: "cli",
			type: "convention",
			fields: { content: "always do X" },
			tags: ["safety"],
			classification: "tactical",
		})) as ToolResult<RecordExpertiseDetails>;

		expect(calls).toHaveLength(1);
		const args = calls[0]?.args ?? [];
		expect(args[0]).toBe("record");
		expect(args[1]).toBe("cli");
		expect(args).toContain("--batch");
		expect(args).toContain("--json");
		expect(args).not.toContain("--dry-run");
		expect(calls[0]?.cwd).toBe(tmpDir);

		expect(Array.isArray(capturedBatch)).toBe(true);
		const record = (capturedBatch as Array<Record<string, unknown>>)[0];
		expect(record?.type).toBe("convention");
		expect(record?.content).toBe("always do X");
		expect(record?.tags).toEqual(["safety"]);
		expect(record?.classification).toBe("tactical");

		expect(firstText(out)).toContain("create=1 update=0 skip=0");
		expect(out.details).toMatchObject({
			domain: "cli",
			type: "convention",
			created: 1,
			updated: 0,
			skipped: 0,
			dryRun: false,
		});
	});

	it("appends --dry-run when dry_run is true and labels the summary", async () => {
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		const { exec, calls } = fakeExec(() => ({
			stdout: JSON.stringify({ created: 0, updated: 0, skipped: 1 }),
			code: 0,
		}));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-6", {
			domain: "cli",
			type: "convention",
			fields: { content: "preview only" },
			dry_run: true,
		})) as ToolResult<RecordExpertiseDetails>;

		expect(calls[0]?.args).toContain("--dry-run");
		expect(firstText(out)).toContain("(dry-run)");
		expect(out.details?.dryRun).toBe(true);
	});

	it("surfaces non-JSON stdout / non-zero exit with a helpful tail", async () => {
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		const { exec } = fakeExec(() => ({ stdout: "", stderr: "config invalid", code: 1 }));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-7", {
			domain: "cli",
			type: "convention",
			fields: { content: "x" },
		})) as ToolResult<RecordExpertiseDetails>;

		expect(firstText(out)).toContain("mulch.record failed");
		expect(firstText(out)).toContain("config invalid");
		expect(out.details?.errors?.[0]).toContain("config invalid");
	});

	it("returns a structured error if exec itself throws", async () => {
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		const { exec } = fakeExec(() => new Error("ENOENT"));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		const out = (await callExecute(tool, "call-8", {
			domain: "cli",
			type: "convention",
			fields: { content: "x" },
		})) as ToolResult<RecordExpertiseDetails>;

		expect(firstText(out)).toContain("exec failed");
		expect(out.details?.errors?.[0]).toContain("ENOENT");
	});

	it("re-reads config on every execute so freshly-declared custom types are accepted", async () => {
		// Start with a config that lacks the custom type.
		await writeConfig(tmpDir, "version: '1'\ndomains:\n  cli: {}\n");
		const { exec, calls } = fakeExec(() => ({
			stdout: JSON.stringify({ created: 1 }),
			code: 0,
		}));
		const tool = await buildRecordExpertiseTool({ exec, cwd: tmpDir });

		// First call: release_decision is unknown.
		const first = (await callExecute(tool, "call-9a", {
			domain: "cli",
			type: "release_decision",
			fields: { title: "v1", rationale: "ship it", version: "1.0.0" },
		})) as ToolResult<RecordExpertiseDetails>;
		expect(firstText(first)).toContain('Unknown record type "release_decision"');
		expect(calls).toHaveLength(0);

		// Edit config mid-session to declare the custom type.
		await writeFile(
			join(tmpDir, ".mulch", "mulch.config.yaml"),
			[
				"version: '1'",
				"domains:",
				"  cli: {}",
				"custom_types:",
				"  release_decision:",
				"    extends: decision",
				"    required: [title, rationale, version]",
				"",
			].join("\n"),
			"utf-8",
		);

		// Second call: same input should now succeed.
		const second = (await callExecute(tool, "call-9b", {
			domain: "cli",
			type: "release_decision",
			fields: { title: "v1", rationale: "ship it", version: "1.0.0" },
		})) as ToolResult<RecordExpertiseDetails>;
		expect(firstText(second)).toContain("create=1");
		expect(calls).toHaveLength(1);
	});
});

describe("tools: buildQueryExpertiseTool", () => {
	const FIXED_CWD = "/tmp/mulch-pi-query";

	it("registers as query_expertise with a description that names search/prime modes", () => {
		const tool = buildQueryExpertiseTool({
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
			cwd: FIXED_CWD,
		});
		expect(tool.name).toBe("query_expertise");
		expect(tool.description).toContain("ml search");
		expect(tool.description).toContain("ml prime");
	});

	it("forwards `query` to ml search with --json and optional filters", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: '{"hits":[]}', code: 0 }));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-1", {
			query: "anchors",
			domain: "cli",
			type: "pattern",
			tag: "safety",
			archived: true,
		})) as ToolResult<QueryExpertiseDetails>;

		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toBe("ml");
		expect(calls[0]?.args).toEqual([
			"search",
			"anchors",
			"--json",
			"--domain",
			"cli",
			"--type",
			"pattern",
			"--tag",
			"safety",
			"--archived",
		]);
		expect(out.details?.mode).toBe("search");
		expect(out.details?.exitCode).toBe(0);
		expect(firstText(out)).toBe('{"hits":[]}');
	});

	it("forwards `files` to ml prime --files (ignoring query)", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "## records", code: 0 }));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-2", {
			query: "ignored when files is present",
			files: ["src/foo.ts", "src/bar.ts"],
			limit: 1500,
		})) as ToolResult<QueryExpertiseDetails>;

		expect(calls[0]?.args).toEqual([
			"prime",
			"--files",
			"src/foo.ts",
			"src/bar.ts",
			"--json",
			"--budget",
			"1500",
		]);
		expect(out.details?.mode).toBe("prime-files");
	});

	it("primes a single domain when only `domain` is set", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "## cli", code: 0 }));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-3", {
			domain: "cli",
		})) as ToolResult<QueryExpertiseDetails>;

		expect(calls[0]?.args).toEqual(["prime", "cli", "--json"]);
		expect(out.details?.mode).toBe("prime-domain");
	});

	it("falls back to plain ml prime when no params are passed", async () => {
		const { exec, calls } = fakeExec(() => ({ stdout: "## all", code: 0 }));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-4", {})) as ToolResult<QueryExpertiseDetails>;

		expect(calls[0]?.args).toEqual(["prime", "--json"]);
		expect(out.details?.mode).toBe("prime");
	});

	it("returns a placeholder when stdout is empty on a clean exit", async () => {
		const { exec } = fakeExec(() => ({ stdout: "   \n", code: 0 }));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-5", {
			domain: "cli",
		})) as ToolResult<QueryExpertiseDetails>;
		expect(firstText(out)).toBe("(no results)");
	});

	it("surfaces non-zero exit with stderr tail and the failing exit code", async () => {
		const { exec } = fakeExec(() => ({ stdout: "", stderr: "boom", code: 2 }));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-6", {
			query: "x",
		})) as ToolResult<QueryExpertiseDetails>;
		expect(firstText(out)).toContain("mulch.query failed (exit 2)");
		expect(firstText(out)).toContain("boom");
		expect(out.details?.exitCode).toBe(2);
	});

	it("returns a structured error when exec throws", async () => {
		const { exec } = fakeExec(() => new Error("ENOENT"));
		const tool = buildQueryExpertiseTool({ exec, cwd: FIXED_CWD });

		const out = (await callExecute(tool, "q-7", {
			query: "x",
		})) as ToolResult<QueryExpertiseDetails>;
		expect(firstText(out)).toContain("exec failed");
		expect(out.details?.exitCode).toBe(-1);
	});
});
