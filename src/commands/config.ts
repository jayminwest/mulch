import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import Ajv, { type ErrorObject } from "ajv";
import type { Command } from "commander";
import yaml from "js-yaml";
import { configSchema } from "../schemas/config-schema.ts";
import { getConfigPath, readConfig } from "../utils/config.ts";
import { withFileLock } from "../utils/lock.ts";

export function registerConfigCommand(program: Command): void {
	const config = program.command("config").description("Read and write .mulch/mulch.config.yaml");

	config
		.command("schema")
		.description("Emit MulchConfig JSON Schema for warren and other config-UI consumers")
		.action(() => {
			process.stdout.write(`${JSON.stringify(configSchema, null, 2)}\n`);
		});

	config
		.command("show")
		.description(
			"Emit the effective MulchConfig as JSON. Pass --path to read a single knob; falls back to the schema default when the knob is unset.",
		)
		.option(
			"--path <path>",
			"Dot-notation path to a single knob (e.g. governance.max_entries, search.boost_factor)",
		)
		.action(async (opts: { path?: string }) => {
			let cfg: unknown;
			try {
				cfg = await readConfig();
			} catch (err) {
				process.stderr.write(`${(err as Error).message}\n`);
				process.exitCode = 1;
				return;
			}
			if (opts.path === undefined) {
				process.stdout.write(`${JSON.stringify(cfg, null, 2)}\n`);
				return;
			}
			const segments = opts.path.split(".").filter((s) => s.length > 0);
			if (segments.length === 0) {
				process.stderr.write("--path must not be empty.\n");
				process.exitCode = 1;
				return;
			}
			const fromConfig = walkConfig(cfg, segments);
			const value = fromConfig !== undefined ? fromConfig : walkSchemaDefault(segments);
			if (value === undefined) {
				process.stderr.write(
					`Path '${opts.path}' not found in config and has no schema default.\n`,
				);
				process.exitCode = 1;
				return;
			}
			process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
		});

	config
		.command("set")
		.description(
			"Set a config knob via dot-notation path. <value> is YAML-parsed (so booleans, numbers, lists, and objects all work uniformly). The full resulting config is validated against the schema before atomic write under a file lock; invalid values are rejected with a schema-referenced error. Last-writer-wins semantics under concurrent writes — re-read via `ml config show` after every write.",
		)
		.argument(
			"<path>",
			"Dot-notation path (e.g. governance.max_entries, search.boost_factor, domains.warren.allowed_types)",
		)
		.argument("<value>", "YAML-parsed value to set at <path>")
		.action(async (path: string, value: string) => {
			try {
				await runConfigSet(path, value);
			} catch (err) {
				process.stderr.write(`${(err as Error).message}\n`);
				process.exitCode = 1;
			}
		});
}

async function runConfigSet(rawPath: string, rawValue: string): Promise<void> {
	const segments = rawPath.split(".").filter((s) => s.length > 0);
	if (segments.length === 0) {
		throw new Error("<path> must not be empty.");
	}

	const configPath = getConfigPath();
	if (!existsSync(configPath)) {
		throw new Error(
			"No .mulch/ directory found. Run `mulch init` to set up this project before `ml config set`.",
		);
	}

	// Reject paths that descend through a closed-shape boundary into an unknown
	// key. AJV catches type/range mismatches at validate time; this gives a
	// targeted error before write so `ml config set governance.typo 5` doesn't
	// silently turn into "valid value at an unknown leaf".
	validatePathInSchema(segments);

	let parsedValue: unknown;
	try {
		parsedValue = yaml.load(rawValue);
	} catch (err) {
		throw new Error(`Invalid YAML for <value>: ${(err as Error).message}`);
	}

	await withFileLock(configPath, async () => {
		const cfg = (await readConfig()) as unknown as Record<string, unknown>;
		setAtPath(cfg, segments, parsedValue);

		const ajv = new Ajv({ allErrors: true, strict: false });
		const validate = ajv.compile(configSchema);
		if (!validate(cfg)) {
			const errs = validate.errors ?? [];
			const lines = errs.map(formatAjvError);
			throw new Error(`Invalid config after set:\n${lines.join("\n")}`);
		}

		const dumped = yaml.dump(cfg, { lineWidth: -1 });
		await writeFileAtomic(configPath, dumped);
	});
}

function validatePathInSchema(segments: string[]): void {
	let cur: unknown = configSchema;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i] as string;
		if (!cur || typeof cur !== "object") {
			throw new Error(
				`Path '${segments.slice(0, i + 1).join(".")}' descends past a leaf in the schema.`,
			);
		}
		const node = cur as Record<string, unknown>;
		const props = node.properties as Record<string, unknown> | undefined;
		if (props && Object.hasOwn(props, seg)) {
			cur = props[seg];
			continue;
		}
		const additional = node.additionalProperties;
		if (additional && typeof additional === "object") {
			cur = additional;
			continue;
		}
		const known = props ? Object.keys(props).join(", ") : "(none)";
		const parent = segments.slice(0, i).join(".") || "<root>";
		throw new Error(
			`Unknown config path: '${segments.slice(0, i + 1).join(".")}' is not a known knob. Known keys at '${parent}': ${known}.`,
		);
	}
}

function setAtPath(obj: Record<string, unknown>, segments: string[], value: unknown): void {
	let cur = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		const seg = segments[i] as string;
		const next = cur[seg];
		if (next === null || typeof next !== "object" || Array.isArray(next)) {
			cur[seg] = {};
		}
		cur = cur[seg] as Record<string, unknown>;
	}
	const leaf = segments[segments.length - 1] as string;
	cur[leaf] = value;
}

function formatAjvError(err: ErrorObject): string {
	const path = err.instancePath || "<root>";
	const meta = lookupSchemaMeta(err.instancePath);
	const tail = meta?.title ? ` (${meta.title})` : "";
	return `  - ${path}: ${err.message ?? "(unknown)"}${tail}`;
}

function lookupSchemaMeta(
	instancePath: string,
): { title?: string; description?: string } | undefined {
	if (!instancePath) return undefined;
	const segs = instancePath
		.split("/")
		.slice(1)
		.filter((s) => s.length > 0);
	let cur: unknown = configSchema;
	for (const seg of segs) {
		if (!cur || typeof cur !== "object") return undefined;
		const node = cur as Record<string, unknown>;
		const props = node.properties as Record<string, unknown> | undefined;
		if (props && Object.hasOwn(props, seg)) {
			cur = props[seg];
			continue;
		}
		const additional = node.additionalProperties;
		if (additional && typeof additional === "object") {
			cur = additional;
			continue;
		}
		return undefined;
	}
	if (!cur || typeof cur !== "object") return undefined;
	const node = cur as Record<string, unknown>;
	return {
		title: node.title as string | undefined,
		description: node.description as string | undefined,
	};
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${randomBytes(8).toString("hex")}`;
	await writeFile(tmpPath, content, "utf-8");
	try {
		await rename(tmpPath, filePath);
	} catch (err) {
		try {
			await unlink(tmpPath);
		} catch {
			// best-effort cleanup
		}
		throw err;
	}
}

function walkConfig(value: unknown, segments: string[]): unknown {
	let cur: unknown = value;
	for (const seg of segments) {
		if (cur === null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[seg];
		if (cur === undefined) return undefined;
	}
	return cur;
}

// Walk the JSON Schema down `segments` and synthesize a default for the
// resulting node. Leaves return their declared `default`; non-leaf nodes
// recurse into `properties` and collect child defaults so `--path search`
// (after `ml config unset search`) yields `{ boost_factor: 0.1 }` rather than
// "not found". Open maps (additionalProperties as an object) are followed when
// no matching `properties` entry exists, supporting paths like
// `domains.<name>.allowed_types`.
function walkSchemaDefault(segments: string[]): unknown {
	let cur: unknown = configSchema;
	for (const seg of segments) {
		if (!cur || typeof cur !== "object") return undefined;
		const node = cur as Record<string, unknown>;
		const props = node.properties as Record<string, unknown> | undefined;
		if (props && Object.hasOwn(props, seg)) {
			cur = props[seg];
			continue;
		}
		const additional = node.additionalProperties;
		if (additional && typeof additional === "object") {
			cur = additional;
			continue;
		}
		return undefined;
	}
	return collectSchemaDefaults(cur);
}

function collectSchemaDefaults(node: unknown): unknown {
	if (!node || typeof node !== "object") return undefined;
	const n = node as Record<string, unknown>;
	if ("default" in n) return n.default;
	const props = n.properties as Record<string, unknown> | undefined;
	if (!props) return undefined;
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(props)) {
		const sub = collectSchemaDefaults(v);
		if (sub !== undefined) result[k] = sub;
	}
	return Object.keys(result).length > 0 ? result : undefined;
}
