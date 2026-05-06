import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listFilesystemRecipes,
	loadFilesystemRecipe,
	loadNpmRecipe,
	NPM_RECIPE_PREFIX,
	type ProviderRecipe,
	resolveRecipe,
	validateRecipeShape,
} from "../../src/utils/recipe-discovery.ts";

const STUB_BUILTIN_TS = `
const recipe = {
	async install() { return { success: true, message: "stub-ts install" }; },
	async check() { return { success: true, message: "stub-ts check" }; },
	async remove() { return { success: true, message: "stub-ts remove" }; },
};
export default recipe;
`;

const SHELL_SCRIPT = `#!/bin/sh
case "$1" in
	install) echo "shell install ok"; exit 0 ;;
	check) echo "shell check ok"; exit 0 ;;
	remove) echo "shell remove ok"; exit 0 ;;
	*) echo "bad action: $1" 1>&2; exit 2 ;;
esac
`;

const FAILING_SHELL = `#!/bin/sh
echo "intentional failure" 1>&2
exit 7
`;

describe("validateRecipeShape", () => {
	it("accepts an object with install/check/remove functions", () => {
		expect(
			validateRecipeShape({
				install: async () => ({ success: true, message: "" }),
				check: async () => ({ success: true, message: "" }),
				remove: async () => ({ success: true, message: "" }),
			}),
		).toBe(true);
	});

	it("rejects null/undefined", () => {
		expect(validateRecipeShape(null)).toBe(false);
		expect(validateRecipeShape(undefined)).toBe(false);
	});

	it("rejects when a method is missing", () => {
		expect(
			validateRecipeShape({
				install: async () => ({ success: true, message: "" }),
				check: async () => ({ success: true, message: "" }),
			}),
		).toBe(false);
	});

	it("rejects when a method is not callable", () => {
		expect(
			validateRecipeShape({
				install: "nope",
				check: async () => ({ success: true, message: "" }),
				remove: async () => ({ success: true, message: "" }),
			}),
		).toBe(false);
	});
});

describe("loadFilesystemRecipe", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-recipe-fs-"));
		await mkdir(join(tmpDir, ".mulch", "recipes"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no recipe file exists", async () => {
		const result = await loadFilesystemRecipe("missing", tmpDir);
		expect(result).toBeNull();
	});

	it("loads a TypeScript recipe with a default export", async () => {
		const tsPath = join(tmpDir, ".mulch", "recipes", "internal.ts");
		await writeFile(tsPath, STUB_BUILTIN_TS, "utf-8");

		const result = await loadFilesystemRecipe("internal", tmpDir);
		expect(result).not.toBeNull();
		expect(result?.source).toBe("filesystem-ts");
		expect(result?.path).toBe(tsPath);

		const installResult = await result?.recipe.install(tmpDir);
		expect(installResult?.success).toBe(true);
		expect(installResult?.message).toBe("stub-ts install");
	});

	it("loads a shell recipe and runs install/check/remove via argv", async () => {
		const shPath = join(tmpDir, ".mulch", "recipes", "legacy.sh");
		await writeFile(shPath, SHELL_SCRIPT, "utf-8");
		await chmod(shPath, 0o755);

		const result = await loadFilesystemRecipe("legacy", tmpDir);
		expect(result).not.toBeNull();
		expect(result?.source).toBe("filesystem-sh");
		expect(result?.path).toBe(shPath);

		const install = await result?.recipe.install(tmpDir);
		expect(install?.success).toBe(true);
		expect(install?.message).toBe("shell install ok");

		const check = await result?.recipe.check(tmpDir);
		expect(check?.success).toBe(true);
		expect(check?.message).toBe("shell check ok");

		const remove = await result?.recipe.remove(tmpDir);
		expect(remove?.success).toBe(true);
		expect(remove?.message).toBe("shell remove ok");
	});

	it("surfaces a non-zero shell exit as a failure with stderr", async () => {
		const shPath = join(tmpDir, ".mulch", "recipes", "broken.sh");
		await writeFile(shPath, FAILING_SHELL, "utf-8");
		await chmod(shPath, 0o755);

		const result = await loadFilesystemRecipe("broken", tmpDir);
		const install = await result?.recipe.install(tmpDir);
		expect(install?.success).toBe(false);
		expect(install?.message).toContain("intentional failure");
	});

	it("prefers .ts over .sh when both exist", async () => {
		const tsPath = join(tmpDir, ".mulch", "recipes", "both.ts");
		const shPath = join(tmpDir, ".mulch", "recipes", "both.sh");
		await writeFile(tsPath, STUB_BUILTIN_TS, "utf-8");
		await writeFile(shPath, SHELL_SCRIPT, "utf-8");
		await chmod(shPath, 0o755);

		const result = await loadFilesystemRecipe("both", tmpDir);
		expect(result?.source).toBe("filesystem-ts");
	});

	it("throws when a TS recipe does not export a valid ProviderRecipe", async () => {
		const tsPath = join(tmpDir, ".mulch", "recipes", "bad.ts");
		await writeFile(tsPath, "export default { install: 'not a function' };\n", "utf-8");

		await expect(loadFilesystemRecipe("bad", tmpDir)).rejects.toThrow(
			/does not export a valid ProviderRecipe/,
		);
	});
});

describe("listFilesystemRecipes", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-recipe-list-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns empty when .mulch/recipes/ does not exist", async () => {
		const list = await listFilesystemRecipes(tmpDir);
		expect(list).toEqual([]);
	});

	it("lists .ts and .sh recipes sorted alphabetically", async () => {
		await mkdir(join(tmpDir, ".mulch", "recipes"), { recursive: true });
		await writeFile(join(tmpDir, ".mulch", "recipes", "zeta.sh"), SHELL_SCRIPT, "utf-8");
		await writeFile(join(tmpDir, ".mulch", "recipes", "alpha.ts"), STUB_BUILTIN_TS, "utf-8");
		await writeFile(join(tmpDir, ".mulch", "recipes", "README.md"), "# ignore me\n", "utf-8");

		const list = await listFilesystemRecipes(tmpDir);
		expect(list.map((l) => l.name)).toEqual(["alpha", "zeta"]);
		expect(list[0]?.source).toBe("filesystem-ts");
		expect(list[1]?.source).toBe("filesystem-sh");
	});
});

describe("loadNpmRecipe", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-recipe-npm-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no matching package is installed", async () => {
		const result = await loadNpmRecipe("nonexistent-xyz", tmpDir);
		expect(result).toBeNull();
	});

	it("loads a recipe from node_modules/mulch-recipe-<name>", async () => {
		const pkgDir = join(tmpDir, "node_modules", `${NPM_RECIPE_PREFIX}fakeprovider`);
		await mkdir(pkgDir, { recursive: true });
		await writeFile(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: `${NPM_RECIPE_PREFIX}fakeprovider`, main: "index.ts" }),
			"utf-8",
		);
		await writeFile(
			join(pkgDir, "index.ts"),
			`
const recipe = {
	async install() { return { success: true, message: "npm install ok" }; },
	async check() { return { success: true, message: "npm check ok" }; },
	async remove() { return { success: true, message: "npm remove ok" }; },
};
export default recipe;
`,
			"utf-8",
		);

		const result = await loadNpmRecipe("fakeprovider", tmpDir);
		expect(result).not.toBeNull();
		expect(result?.source).toBe("npm");
		const install = await result?.recipe.install(tmpDir);
		expect(install?.message).toBe("npm install ok");
	});

	it("throws when the npm package does not export a valid ProviderRecipe", async () => {
		const pkgDir = join(tmpDir, "node_modules", `${NPM_RECIPE_PREFIX}badpkg`);
		await mkdir(pkgDir, { recursive: true });
		await writeFile(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: `${NPM_RECIPE_PREFIX}badpkg`, main: "index.ts" }),
			"utf-8",
		);
		await writeFile(join(pkgDir, "index.ts"), "export default { hello: 'world' };\n", "utf-8");

		await expect(loadNpmRecipe("badpkg", tmpDir)).rejects.toThrow(
			/does not export a valid ProviderRecipe/,
		);
	});
});

describe("resolveRecipe", () => {
	let tmpDir: string;

	const stubBuiltin: ProviderRecipe = {
		async install() {
			return { success: true, message: "builtin install" };
		},
		async check() {
			return { success: true, message: "builtin check" };
		},
		async remove() {
			return { success: true, message: "builtin remove" };
		},
	};

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-recipe-resolve-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no source has a matching recipe", async () => {
		const result = await resolveRecipe("nope", tmpDir, {});
		expect(result).toBeNull();
	});

	it("returns built-in when nothing else matches", async () => {
		const result = await resolveRecipe("claude", tmpDir, { claude: stubBuiltin });
		expect(result?.source).toBe("builtin");
		const install = await result?.recipe.install(tmpDir);
		expect(install?.message).toBe("builtin install");
	});

	it("filesystem recipe shadows built-in of the same name", async () => {
		await mkdir(join(tmpDir, ".mulch", "recipes"), { recursive: true });
		await writeFile(join(tmpDir, ".mulch", "recipes", "claude.ts"), STUB_BUILTIN_TS, "utf-8");

		const result = await resolveRecipe("claude", tmpDir, { claude: stubBuiltin });
		expect(result?.source).toBe("filesystem-ts");
		const install = await result?.recipe.install(tmpDir);
		expect(install?.message).toBe("stub-ts install");
	});

	it("filesystem recipe is preferred over npm recipe", async () => {
		await mkdir(join(tmpDir, ".mulch", "recipes"), { recursive: true });
		await writeFile(join(tmpDir, ".mulch", "recipes", "shared.ts"), STUB_BUILTIN_TS, "utf-8");

		const pkgDir = join(tmpDir, "node_modules", `${NPM_RECIPE_PREFIX}shared`);
		await mkdir(pkgDir, { recursive: true });
		await writeFile(
			join(pkgDir, "package.json"),
			JSON.stringify({ name: `${NPM_RECIPE_PREFIX}shared`, main: "index.ts" }),
			"utf-8",
		);
		await writeFile(
			join(pkgDir, "index.ts"),
			`
const recipe = {
	async install() { return { success: true, message: "npm wins" }; },
	async check() { return { success: true, message: "" }; },
	async remove() { return { success: true, message: "" }; },
};
export default recipe;
`,
			"utf-8",
		);

		const result = await resolveRecipe("shared", tmpDir, {});
		expect(result?.source).toBe("filesystem-ts");
	});
});
