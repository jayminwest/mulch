import Ajv, { type ValidateFunction } from "ajv";
import type { ExpertiseRecord } from "../schemas/record.ts";
import { buildBuiltinRegistry } from "./builtins.ts";

export interface TypeDefinition {
	name: string;
	kind: "builtin" | "custom";
	required: readonly string[];
	optional: readonly string[];
	dedupKey: string | "content_hash";
	idKey: string;
	summary: (record: ExpertiseRecord) => string;
	extractsFiles: boolean;
	filesField: string;
	compact: "keep_latest" | "concat" | "merge_outcomes" | "manual";
	sectionTitle: string;
	ajvSchema: Record<string, unknown>;
	formatMarkdown: (records: ExpertiseRecord[], full: boolean) => string;
	formatCompactLine: (record: ExpertiseRecord) => string;
	formatXml: (record: ExpertiseRecord) => string[];
	// Phase 3: canonical field name → legacy aliases. Only set on custom types.
	aliases?: Readonly<Record<string, readonly string[]>>;
}

export interface SharedDefinitions {
	classification: Record<string, unknown>;
	evidence: Record<string, unknown>;
	outcome: Record<string, unknown>;
}

export class TypeRegistry {
	readonly definitions: SharedDefinitions;
	private readonly defs: ReadonlyMap<string, TypeDefinition>;
	private readonly order: readonly string[];
	private readonly disabledSet: ReadonlySet<string>;
	readonly validator: ValidateFunction;

	constructor(
		defs: TypeDefinition[],
		definitions: SharedDefinitions,
		disabled: Iterable<string> = [],
	) {
		this.defs = new Map(defs.map((d) => [d.name, d]));
		this.order = defs.map((d) => d.name);
		this.disabledSet = new Set(disabled);
		this.definitions = definitions;
		this.validator = compileValidator(defs, definitions);
	}

	get(name: string): TypeDefinition | undefined {
		return this.defs.get(name);
	}

	enabled(): TypeDefinition[] {
		return this.order.map((n) => this.defs.get(n) as TypeDefinition);
	}

	names(): string[] {
		return [...this.order];
	}

	isDisabled(name: string): boolean {
		return this.disabledSet.has(name);
	}

	disabledNames(): string[] {
		return [...this.disabledSet];
	}

	builtinDefs(): TypeDefinition[] {
		return this.enabled().filter((d) => d.kind === "builtin");
	}

	customDefs(): TypeDefinition[] {
		return this.enabled().filter((d) => d.kind === "custom");
	}
}

function compileValidator(
	defs: TypeDefinition[],
	definitions: SharedDefinitions,
): ValidateFunction {
	const schema = {
		$schema: "http://json-schema.org/draft-07/schema#",
		title: "Mulch Expertise Record",
		description: "A single expertise record in a Mulch domain file",
		type: "object",
		definitions,
		oneOf: defs.map((d) => d.ajvSchema),
	};
	const ajv = new Ajv();
	return ajv.compile(schema);
}

let _registry: TypeRegistry | null = null;

// Lazy fallback to a built-in registry so callers (api.ts, tests) that don't
// explicitly initialize still get a working registry. CLI/entry points may
// call setRegistry() to override (e.g., Phase 2's config-derived custom types).
export function getRegistry(): TypeRegistry {
	if (!_registry) {
		_registry = buildBuiltinRegistry();
	}
	return _registry;
}

export function setRegistry(registry: TypeRegistry): void {
	_registry = registry;
}

export function resetRegistry(): void {
	_registry = null;
}
