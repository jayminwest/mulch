import type { MulchConfig } from "../schemas/config.ts";
import { readConfig } from "../utils/config.ts";
import { BUILTIN_DEFS, buildBuiltinRegistry } from "./builtins.ts";
import { buildCustomTypeDefinitions } from "./custom.ts";
import {
	setRegistry,
	type TypeRegistry,
	TypeRegistry as TypeRegistryCtor,
} from "./type-registry.ts";

// Hoist SHARED_DEFINITIONS through buildBuiltinRegistry to keep one source of
// truth. We construct a temporary builtin registry just to read its definitions.
function buildRegistryWithCustomTypes(config: MulchConfig | null): TypeRegistry {
	const customDefs = config?.custom_types ? buildCustomTypeDefinitions(config.custom_types) : [];
	if (customDefs.length === 0) {
		return buildBuiltinRegistry();
	}
	// Reuse SHARED_DEFINITIONS from a builtin registry instance.
	const builtinRegistry = buildBuiltinRegistry();
	return new TypeRegistryCtor([...BUILTIN_DEFS, ...customDefs], builtinRegistry.definitions);
}

// Called once at CLI startup. Falls back to built-ins-only if no config exists
// (e.g., before `ml init`) so commands like `ml init` still work.
export async function initRegistryFromConfig(cwd?: string): Promise<TypeRegistry> {
	let config: MulchConfig | null = null;
	try {
		config = await readConfig(cwd);
	} catch {
		// No .mulch/ directory or unreadable config — built-ins only.
		config = null;
	}
	const registry = buildRegistryWithCustomTypes(config);
	setRegistry(registry);
	return registry;
}
