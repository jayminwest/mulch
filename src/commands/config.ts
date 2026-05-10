import type { Command } from "commander";
import { configSchema } from "../schemas/config-schema.ts";
import { readConfig } from "../utils/config.ts";

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
