// Per-domain rule helpers shared across record (write-time gate), validate
// and sync (read-time re-validation), and doctor (diagnostic surfacing).
// Empty/missing arrays mean "no rule" — back-compat with pre-R-01 configs.

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
