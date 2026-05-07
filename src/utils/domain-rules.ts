// Per-domain rule helpers shared across record (write-time gate), validate
// and sync (read-time re-validation), and doctor (diagnostic surfacing).
// Empty/missing arrays mean "no rule" — back-compat with pre-R-01 configs.

import type { ErrorObject } from "ajv";
import type { TypeRegistry } from "../registry/type-registry.ts";
import type { MulchConfig } from "../schemas/config.ts";

export function getAllowedTypes(config: MulchConfig, domain: string): string[] | null {
	const list = config.domains[domain]?.allowed_types;
	if (!list || list.length === 0) return null;
	return list;
}

export function getRequiredFields(config: MulchConfig, domain: string): string[] | null {
	const list = config.domains[domain]?.required_fields;
	if (!list || list.length === 0) return null;
	return list;
}

// Return the subset of `fields` that are missing or empty on the record.
// Treats undefined/null/""/empty-array as missing. Top-level field names only;
// nested paths are out of scope for v1.
export function findMissingDomainFields(
	record: Record<string, unknown>,
	fields: string[],
): string[] {
	const missing: string[] = [];
	for (const field of fields) {
		const value = record[field];
		if (
			value === undefined ||
			value === null ||
			value === "" ||
			(Array.isArray(value) && value.length === 0)
		) {
			missing.push(field);
		}
	}
	return missing;
}

// Fields owned by BaseRecord — accepted by every type's schema (built-in or
// custom). A domain.required_fields entry naming one of these is always
// compatible regardless of allowed_types.
const BASE_RECORD_FIELDS: ReadonlySet<string> = new Set([
	"id",
	"type",
	"classification",
	"recorded_at",
	"evidence",
	"tags",
	"relates_to",
	"supersedes",
	"outcomes",
	"dir_anchors",
	"supersession_demoted_at",
	"owner",
	"status",
]);

// Detect required_fields entries that no allowed type can hold. Built-in (and
// custom) record schemas use `additionalProperties: false`, so a domain that
// requires a field which isn't declared on any of its allowed types is
// unsatisfiable: every write fails AJV before the domain gate runs. Returns
// one entry per offending field with the resolved allowed-type names so
// callers can render a fix-it hint.
export function findIncompatibleRequiredFields(
	config: MulchConfig,
	domain: string,
	registry: TypeRegistry,
): Array<{ field: string; allowedTypes: string[] }> {
	const required = getRequiredFields(config, domain);
	if (!required) return [];
	const allowedTypeNames = getAllowedTypes(config, domain) ?? registry.names();
	const incompatible: Array<{ field: string; allowedTypes: string[] }> = [];
	for (const field of required) {
		if (BASE_RECORD_FIELDS.has(field)) continue;
		let acceptedByAny = false;
		for (const name of allowedTypeNames) {
			const def = registry.get(name);
			if (!def) continue;
			if (def.required.includes(field) || def.optional.includes(field)) {
				acceptedByAny = true;
				break;
			}
		}
		if (!acceptedByAny) {
			incompatible.push({ field, allowedTypes: [...allowedTypeNames] });
		}
	}
	return incompatible;
}

// Scan AJV errors for `additionalProperties` rejections whose property name is
// listed in domain.required_fields. Returns the deduped set of such field
// names so the caller can render a targeted hint instead of the raw AJV soup.
export function findRejectedRequiredFields(
	errors: readonly ErrorObject[] | null | undefined,
	requiredFields: readonly string[] | null,
): string[] {
	if (!errors || !requiredFields || requiredFields.length === 0) return [];
	const requiredSet = new Set(requiredFields);
	const rejected = new Set<string>();
	for (const err of errors) {
		if (err.keyword !== "additionalProperties") continue;
		const params = err.params as { additionalProperty?: unknown };
		const prop = params.additionalProperty;
		if (typeof prop === "string" && requiredSet.has(prop)) {
			rejected.add(prop);
		}
	}
	return [...rejected];
}
