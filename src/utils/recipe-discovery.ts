import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface RecipeResult {
	success: boolean;
	message: string;
}

export interface ProviderRecipe {
	install(cwd: string): Promise<RecipeResult>;
	check(cwd: string): Promise<RecipeResult>;
	remove(cwd: string): Promise<RecipeResult>;
}

export type RecipeSource = "builtin" | "filesystem-ts" | "filesystem-sh" | "npm";

export interface RecipeWithSource {
	name: string;
	source: RecipeSource;
	recipe: ProviderRecipe;
	path?: string;
}

export interface FilesystemRecipeListing {
	name: string;
	source: "filesystem-ts" | "filesystem-sh";
	path: string;
}

export const NPM_RECIPE_PREFIX = "mulch-recipe-";

export function recipesDir(cwd: string): string {
	return join(cwd, ".mulch", "recipes");
}

export function validateRecipeShape(obj: unknown): obj is ProviderRecipe {
	if (!obj || typeof obj !== "object") return false;
	const r = obj as Record<string, unknown>;
	return (
		typeof r.install === "function" &&
		typeof r.check === "function" &&
		typeof r.remove === "function"
	);
}

function makeShellRecipe(name: string, scriptPath: string): ProviderRecipe {
	const run = (action: "install" | "check" | "remove", cwd: string): Promise<RecipeResult> =>
		new Promise((resolve) => {
			const child = spawn(scriptPath, [action], {
				cwd,
				env: {
					...process.env,
					MULCH_RECIPE_NAME: name,
					MULCH_RECIPE_ACTION: action,
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (d: Buffer) => {
				stdout += d.toString();
			});
			child.stderr?.on("data", (d: Buffer) => {
				stderr += d.toString();
			});
			child.on("error", (err) => {
				resolve({
					success: false,
					message: `Failed to execute ${scriptPath}: ${err.message}`,
				});
			});
			child.on("close", (code) => {
				const out = stdout.trim();
				const err = stderr.trim();
				const ok = code === 0;
				const fallback = ok
					? `${name} ${action} succeeded`
					: `${name} ${action} exited with code ${code ?? "?"}${err ? `: ${err}` : ""}`;
				resolve({ success: ok, message: out || fallback });
			});
		});

	return {
		install: (cwd) => run("install", cwd),
		check: (cwd) => run("check", cwd),
		remove: (cwd) => run("remove", cwd),
	};
}

export async function loadFilesystemRecipe(
	name: string,
	cwd: string,
): Promise<RecipeWithSource | null> {
	const dir = recipesDir(cwd);
	const tsPath = join(dir, `${name}.ts`);
	const shPath = join(dir, `${name}.sh`);

	if (existsSync(tsPath)) {
		const mod = (await import(tsPath)) as { default?: unknown };
		// Spec is `export default { install, check, remove }`. Reject named-only
		// exports — accepting them silently let users ship recipes that resolved
		// in development (where they remembered the right named imports) but
		// surprised the next consumer who imported them as a default.
		if (mod.default === undefined) {
			throw new Error(
				`Recipe "${name}" at ${tsPath} has no default export. ProviderRecipes must be exposed via \`export default { install, check, remove }\`; named exports alone are not accepted. See examples/recipes/internal-ide.ts for a template.`,
			);
		}
		if (!validateRecipeShape(mod.default)) {
			throw new Error(
				`Recipe "${name}" at ${tsPath} default export is not a valid ProviderRecipe (must have async install/check/remove functions). See examples/recipes/internal-ide.ts for a template.`,
			);
		}
		return { name, source: "filesystem-ts", recipe: mod.default, path: tsPath };
	}

	if (existsSync(shPath)) {
		return {
			name,
			source: "filesystem-sh",
			recipe: makeShellRecipe(name, shPath),
			path: shPath,
		};
	}

	return null;
}

export async function loadNpmRecipe(name: string, cwd: string): Promise<RecipeWithSource | null> {
	const pkgName = `${NPM_RECIPE_PREFIX}${name}`;
	const requireFn = createRequire(import.meta.url);
	let resolved: string;
	try {
		resolved = requireFn.resolve(pkgName, { paths: [cwd] });
	} catch {
		return null;
	}
	const mod = (await import(resolved)) as { default?: unknown };
	if (mod.default === undefined) {
		throw new Error(
			`Recipe package "${pkgName}" has no default export. ProviderRecipes must be exposed via \`export default { install, check, remove }\`; named exports alone are not accepted.`,
		);
	}
	if (!validateRecipeShape(mod.default)) {
		throw new Error(
			`Recipe package "${pkgName}" default export is not a valid ProviderRecipe (must have async install/check/remove functions).`,
		);
	}
	return { name, source: "npm", recipe: mod.default, path: resolved };
}

export async function listFilesystemRecipes(cwd: string): Promise<FilesystemRecipeListing[]> {
	const dir = recipesDir(cwd);
	if (!existsSync(dir)) return [];
	const entries = await readdir(dir);
	const out: FilesystemRecipeListing[] = [];
	for (const entry of entries) {
		if (entry.endsWith(".ts")) {
			out.push({
				name: entry.slice(0, -3),
				source: "filesystem-ts",
				path: join(dir, entry),
			});
		} else if (entry.endsWith(".sh")) {
			out.push({
				name: entry.slice(0, -3),
				source: "filesystem-sh",
				path: join(dir, entry),
			});
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveRecipe(
	name: string,
	cwd: string,
	builtins: Record<string, ProviderRecipe>,
): Promise<RecipeWithSource | null> {
	const fs = await loadFilesystemRecipe(name, cwd);
	if (fs) return fs;

	const npm = await loadNpmRecipe(name, cwd);
	if (npm) return npm;

	const builtin = builtins[name];
	if (builtin) {
		return { name, source: "builtin", recipe: builtin };
	}

	return null;
}
