import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { getMulchDir } from "../utils/config.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import {
	hasMarkerSection,
	MARKER_END,
	MARKER_START,
	removeMarkerSection,
} from "../utils/markers.ts";
import {
	listFilesystemRecipes,
	NPM_RECIPE_PREFIX,
	type ProviderRecipe,
	type RecipeResult,
	type RecipeWithSource,
	resolveRecipe,
} from "../utils/recipe-discovery.ts";

// ────────────────────────────────────────────────────────────
// Git hook helpers
// ────────────────────────────────────────────────────────────

const HOOK_MARKER_START = "# mulch:start";
const HOOK_MARKER_END = "# mulch:end";

const MULCH_HOOK_SECTION = `${HOOK_MARKER_START}
# Run mulch validate before committing
if command -v mulch >/dev/null 2>&1; then
  mulch validate
  if [ $? -ne 0 ]; then
    echo "mulch validate failed. Commit aborted."
    exit 1
  fi
fi
${HOOK_MARKER_END}`;

async function installGitHook(cwd: string): Promise<RecipeResult> {
	const gitDir = join(cwd, ".git");
	if (!existsSync(gitDir)) {
		return {
			success: false,
			message: "Not a git repository — .git directory not found.",
		};
	}

	const hooksDir = join(gitDir, "hooks");
	await mkdir(hooksDir, { recursive: true });

	const hookPath = join(hooksDir, "pre-commit");
	let content = "";

	if (existsSync(hookPath)) {
		content = await readFile(hookPath, "utf-8");
		if (content.includes(HOOK_MARKER_START)) {
			return {
				success: true,
				message: "Git pre-commit hook already installed.",
			};
		}
	}

	if (content) {
		content = `${content.trimEnd()}\n\n${MULCH_HOOK_SECTION}\n`;
	} else {
		content = `#!/bin/sh\n\n${MULCH_HOOK_SECTION}\n`;
	}

	await writeFile(hookPath, content, "utf-8");
	await chmod(hookPath, 0o755);

	return { success: true, message: "Installed mulch pre-commit git hook." };
}

async function checkGitHook(cwd: string): Promise<RecipeResult> {
	const hookPath = join(cwd, ".git", "hooks", "pre-commit");
	if (!existsSync(hookPath)) {
		return { success: false, message: "Git pre-commit hook not found." };
	}

	const content = await readFile(hookPath, "utf-8");
	if (!content.includes(HOOK_MARKER_START)) {
		return {
			success: false,
			message: "Git pre-commit hook exists but has no mulch section.",
		};
	}

	return { success: true, message: "Git pre-commit hook is installed." };
}

async function removeGitHook(cwd: string): Promise<RecipeResult> {
	const hookPath = join(cwd, ".git", "hooks", "pre-commit");
	if (!existsSync(hookPath)) {
		return {
			success: true,
			message: "Git pre-commit hook not found; nothing to remove.",
		};
	}

	const content = await readFile(hookPath, "utf-8");
	if (!content.includes(HOOK_MARKER_START)) {
		return {
			success: true,
			message: "No mulch section in pre-commit hook; nothing to remove.",
		};
	}

	const startIdx = content.indexOf(HOOK_MARKER_START);
	const endIdx = content.indexOf(HOOK_MARKER_END);
	const before = content.substring(0, startIdx);
	const after = content.substring(endIdx + HOOK_MARKER_END.length);
	const cleaned = (before + after).replace(/\n{3,}/g, "\n\n").trim();

	// If only the shebang (or nothing) remains, delete the file
	if (!cleaned || cleaned === "#!/bin/sh") {
		await unlink(hookPath);
		return {
			success: true,
			message: "Removed mulch pre-commit hook (file deleted).",
		};
	}

	await writeFile(hookPath, `${cleaned}\n`, "utf-8");
	return {
		success: true,
		message: "Removed mulch section from pre-commit hook.",
	};
}

// ────────────────────────────────────────────────────────────
// Built-in provider recipes
// ────────────────────────────────────────────────────────────

// ── Claude ──────────────────────────────────────────────────

interface ClaudeHookEntry {
	type: string;
	command: string;
}

interface ClaudeHookGroup {
	matcher: string;
	hooks: ClaudeHookEntry[];
}

interface ClaudeSettings {
	hooks?: {
		[event: string]: ClaudeHookGroup[];
	};
	[key: string]: unknown;
}

const CLAUDE_HOOK_COMMAND = "ml prime";

function claudeSettingsPath(cwd: string): string {
	return join(cwd, ".claude", "settings.json");
}

function hasMulchHook(groups: ClaudeHookGroup[]): boolean {
	return groups.some((g) => g.hooks.some((h) => h.command === CLAUDE_HOOK_COMMAND));
}

function removeMulchHookGroups(groups: ClaudeHookGroup[]): ClaudeHookGroup[] {
	return groups.filter((g) => !g.hooks.some((h) => h.command === CLAUDE_HOOK_COMMAND));
}

function createMulchHookGroup(): ClaudeHookGroup {
	return {
		matcher: "",
		hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
	};
}

const claudeRecipe: ProviderRecipe = {
	async install(cwd) {
		const settingsPath = claudeSettingsPath(cwd);
		let settings: ClaudeSettings = {};

		if (existsSync(settingsPath)) {
			const raw = await readFile(settingsPath, "utf-8");
			settings = JSON.parse(raw) as ClaudeSettings;
		}

		if (!settings.hooks) {
			settings.hooks = {};
		}

		const events = ["SessionStart", "PreCompact"];
		let alreadyInstalled = true;

		for (const event of events) {
			if (!settings.hooks[event]) {
				settings.hooks[event] = [];
			}
			if (!hasMulchHook(settings.hooks[event])) {
				settings.hooks[event].push(createMulchHookGroup());
				alreadyInstalled = false;
			}
		}

		if (alreadyInstalled) {
			return { success: true, message: "Claude hooks already installed." };
		}

		await mkdir(dirname(settingsPath), { recursive: true });
		await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");

		return {
			success: true,
			message: "Installed Claude hooks for SessionStart and PreCompact.",
		};
	},

	async check(cwd) {
		const settingsPath = claudeSettingsPath(cwd);
		if (!existsSync(settingsPath)) {
			return { success: false, message: "Claude settings.json not found." };
		}

		const raw = await readFile(settingsPath, "utf-8");
		const settings = JSON.parse(raw) as ClaudeSettings;

		if (!settings.hooks) {
			return {
				success: false,
				message: "No hooks configured in Claude settings.",
			};
		}

		const events = ["SessionStart", "PreCompact"];
		const missing: string[] = [];
		for (const event of events) {
			if (!settings.hooks[event] || !hasMulchHook(settings.hooks[event])) {
				missing.push(event);
			}
		}

		if (missing.length > 0) {
			return {
				success: false,
				message: `Missing hooks for: ${missing.join(", ")}.`,
			};
		}
		return {
			success: true,
			message: "Claude hooks are installed and correct.",
		};
	},

	async remove(cwd) {
		const settingsPath = claudeSettingsPath(cwd);
		if (!existsSync(settingsPath)) {
			return {
				success: true,
				message: "Claude settings.json not found; nothing to remove.",
			};
		}

		const raw = await readFile(settingsPath, "utf-8");
		const settings = JSON.parse(raw) as ClaudeSettings;

		if (!settings.hooks) {
			return {
				success: true,
				message: "No hooks in Claude settings; nothing to remove.",
			};
		}

		let removed = false;
		for (const event of Object.keys(settings.hooks)) {
			const hookGroup = settings.hooks[event];
			if (!hookGroup) continue;
			const before = hookGroup.length;
			const updated = removeMulchHookGroups(hookGroup);
			settings.hooks[event] = updated;
			if (updated.length < before) {
				removed = true;
			}
			if (updated.length === 0) {
				delete settings.hooks[event];
			}
		}

		if (Object.keys(settings.hooks).length === 0) {
			settings.hooks = undefined;
		}

		await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");

		return {
			success: true,
			message: removed
				? "Removed mulch hooks from Claude settings."
				: "No mulch hooks found in Claude settings.",
		};
	},
};

// ── Cursor ──────────────────────────────────────────────────

function cursorRulePath(cwd: string): string {
	return join(cwd, ".cursor", "rules", "mulch.mdc");
}

const CURSOR_RULE_CONTENT = `---
description: Mulch expertise integration
globs: *
alwaysApply: true
---

# Mulch Expertise

At the start of every session, run the following command to load project expertise:

\`\`\`
ml prime
\`\`\`

This injects project-specific conventions, patterns, decisions, and other learnings into your context.
Use \`ml prime --files src/foo.ts\` to load only records relevant to specific files.

**Before completing your task**, review your work for insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made — and record them:

\`\`\`
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> [options]
\`\`\`

Evidence auto-populates from git (current commit + changed files). Link trackers explicitly with \`--evidence-seeds <id>\` / \`--evidence-gh <id>\` / \`--evidence-linear <id>\` / \`--evidence-bead <id>\`, or \`--relates-to <mx-id>\`.

**Before you finish**, run:

\`\`\`
ml learn        # see what files changed — decide what to record
ml record ...   # record learnings
ml sync         # validate, stage, and commit .mulch/ changes
\`\`\`
`;

const cursorRecipe: ProviderRecipe = {
	async install(cwd) {
		const rulePath = cursorRulePath(cwd);

		if (existsSync(rulePath)) {
			const existing = await readFile(rulePath, "utf-8");
			if (existing === CURSOR_RULE_CONTENT) {
				return { success: true, message: "Cursor rule already installed." };
			}
		}

		await mkdir(dirname(rulePath), { recursive: true });
		await writeFile(rulePath, CURSOR_RULE_CONTENT, "utf-8");

		return {
			success: true,
			message: "Installed Cursor rule at .cursor/rules/mulch.mdc.",
		};
	},

	async check(cwd) {
		const rulePath = cursorRulePath(cwd);
		if (!existsSync(rulePath)) {
			return { success: false, message: "Cursor rule file not found." };
		}
		const content = await readFile(rulePath, "utf-8");
		if (content !== CURSOR_RULE_CONTENT) {
			return {
				success: false,
				message: "Cursor rule file exists but has been modified.",
			};
		}
		return { success: true, message: "Cursor rule is installed and correct." };
	},

	async remove(cwd) {
		const rulePath = cursorRulePath(cwd);
		if (!existsSync(rulePath)) {
			return {
				success: true,
				message: "Cursor rule not found; nothing to remove.",
			};
		}
		await unlink(rulePath);
		return { success: true, message: "Removed Cursor rule file." };
	},
};

// ── Codex ───────────────────────────────────────────────────

function codexAgentsPath(cwd: string): string {
	return join(cwd, "AGENTS.md");
}

const CODEX_SECTION = `${MARKER_START}
## Mulch Expertise

At the start of every session, run \`ml prime\` to load project expertise.

This injects project-specific conventions, patterns, decisions, and other learnings into your context.
Use \`ml prime --files src/foo.ts\` to load only records relevant to specific files.

**Before completing your task**, review your work for insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made — and record them:

\`\`\`
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> [options]
\`\`\`

Evidence auto-populates from git (current commit + changed files). Link trackers explicitly with \`--evidence-seeds <id>\` / \`--evidence-gh <id>\` / \`--evidence-linear <id>\` / \`--evidence-bead <id>\`, or \`--relates-to <mx-id>\`.

**Before you finish**, run:

\`\`\`
ml learn        # see what files changed — decide what to record
ml record ...   # record learnings
ml sync         # validate, stage, and commit .mulch/ changes
\`\`\`
${MARKER_END}`;

const codexRecipe: ProviderRecipe = {
	async install(cwd) {
		const agentsPath = codexAgentsPath(cwd);
		let content = "";

		if (existsSync(agentsPath)) {
			content = await readFile(agentsPath, "utf-8");
			if (hasMarkerSection(content)) {
				return {
					success: true,
					message: "AGENTS.md already contains mulch section.",
				};
			}
		}

		const newContent = content
			? `${content.trimEnd()}\n\n${CODEX_SECTION}\n`
			: `${CODEX_SECTION}\n`;

		await writeFile(agentsPath, newContent, "utf-8");

		return { success: true, message: "Added mulch section to AGENTS.md." };
	},

	async check(cwd) {
		const agentsPath = codexAgentsPath(cwd);
		if (!existsSync(agentsPath)) {
			return { success: false, message: "AGENTS.md not found." };
		}
		const content = await readFile(agentsPath, "utf-8");
		if (!hasMarkerSection(content)) {
			return {
				success: false,
				message: "AGENTS.md exists but has no mulch section.",
			};
		}
		return { success: true, message: "AGENTS.md contains mulch section." };
	},

	async remove(cwd) {
		const agentsPath = codexAgentsPath(cwd);
		if (!existsSync(agentsPath)) {
			return {
				success: true,
				message: "AGENTS.md not found; nothing to remove.",
			};
		}
		const content = await readFile(agentsPath, "utf-8");
		if (!hasMarkerSection(content)) {
			return {
				success: true,
				message: "No mulch section in AGENTS.md; nothing to remove.",
			};
		}
		const cleaned = removeMarkerSection(content);
		await writeFile(agentsPath, cleaned, "utf-8");
		return { success: true, message: "Removed mulch section from AGENTS.md." };
	},
};

// ── Generic markdown-file recipe (gemini, windsurf, aider) ─

interface MarkdownRecipeConfig {
	filePath: (cwd: string) => string;
	fileName: string;
}

function createMarkdownRecipe(config: MarkdownRecipeConfig): ProviderRecipe {
	const section = `${MARKER_START}
## Mulch Expertise

At the start of every session, run \`ml prime\` to load project expertise.

This injects project-specific conventions, patterns, decisions, and other learnings into your context.
Use \`ml prime --files src/foo.ts\` to load only records relevant to specific files.

**Before completing your task**, review your work for insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made — and record them:

\`\`\`
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> [options]
\`\`\`

Evidence auto-populates from git (current commit + changed files). Link trackers explicitly with \`--evidence-seeds <id>\` / \`--evidence-gh <id>\` / \`--evidence-linear <id>\` / \`--evidence-bead <id>\`, or \`--relates-to <mx-id>\`.

**Before you finish**, run:

\`\`\`
ml learn        # see what files changed — decide what to record
ml record ...   # record learnings
ml sync         # validate, stage, and commit .mulch/ changes
\`\`\`
${MARKER_END}`;

	return {
		async install(cwd) {
			const filePath = config.filePath(cwd);
			let content = "";

			if (existsSync(filePath)) {
				content = await readFile(filePath, "utf-8");
				if (hasMarkerSection(content)) {
					return {
						success: true,
						message: `${config.fileName} already contains mulch section.`,
					};
				}
			}

			const newContent = content ? `${content.trimEnd()}\n\n${section}\n` : `${section}\n`;

			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, newContent, "utf-8");

			return {
				success: true,
				message: `Added mulch section to ${config.fileName}.`,
			};
		},

		async check(cwd) {
			const filePath = config.filePath(cwd);
			if (!existsSync(filePath)) {
				return { success: false, message: `${config.fileName} not found.` };
			}
			const content = await readFile(filePath, "utf-8");
			if (!hasMarkerSection(content)) {
				return {
					success: false,
					message: `${config.fileName} exists but has no mulch section.`,
				};
			}
			return {
				success: true,
				message: `${config.fileName} contains mulch section.`,
			};
		},

		async remove(cwd) {
			const filePath = config.filePath(cwd);
			if (!existsSync(filePath)) {
				return {
					success: true,
					message: `${config.fileName} not found; nothing to remove.`,
				};
			}
			const content = await readFile(filePath, "utf-8");
			if (!hasMarkerSection(content)) {
				return {
					success: true,
					message: `No mulch section in ${config.fileName}; nothing to remove.`,
				};
			}

			const cleaned = removeMarkerSection(content);
			await writeFile(filePath, cleaned, "utf-8");
			return {
				success: true,
				message: `Removed mulch section from ${config.fileName}.`,
			};
		},
	};
}

const geminiRecipe = createMarkdownRecipe({
	filePath: (cwd) => join(cwd, ".gemini", "settings.md"),
	fileName: ".gemini/settings.md",
});

const windsurfRecipe = createMarkdownRecipe({
	filePath: (cwd) => join(cwd, ".windsurf", "rules.md"),
	fileName: ".windsurf/rules.md",
});

const aiderRecipe = createMarkdownRecipe({
	filePath: (cwd) => join(cwd, ".aider.conf.md"),
	fileName: ".aider.conf.md",
});

// ── Recipe registry ─────────────────────────────────────────

/**
 * Built-in recipes shipped with mulch. Filesystem (`.mulch/recipes/<name>.{ts,sh}`)
 * and npm (`mulch-recipe-<name>`) discovery is handled by `resolveRecipe` in
 * `utils/recipe-discovery.ts` and takes precedence over these in that order.
 */
const BUILTIN_RECIPES = {
	claude: claudeRecipe,
	cursor: cursorRecipe,
	codex: codexRecipe,
	gemini: geminiRecipe,
	windsurf: windsurfRecipe,
	aider: aiderRecipe,
} as const satisfies Record<string, ProviderRecipe>;

/** @deprecated kept as alias for `BUILTIN_RECIPES` — used by tests. */
const recipes = BUILTIN_RECIPES;

const BUILTIN_PROVIDER_NAMES = Object.keys(BUILTIN_RECIPES).sort();

// ── Exported helpers for testing ────────────────────────────

export {
	BUILTIN_RECIPES,
	recipes,
	BUILTIN_PROVIDER_NAMES,
	CURSOR_RULE_CONTENT,
	CODEX_SECTION,
	CLAUDE_HOOK_COMMAND,
	MULCH_HOOK_SECTION,
	installGitHook,
	checkGitHook,
	removeGitHook,
};

export type { ProviderRecipe };

// ── Command registration ────────────────────────────────────

export function registerSetupCommand(program: Command): void {
	program
		.command("setup")
		.argument(
			"[provider]",
			`agent provider (built-in: ${BUILTIN_PROVIDER_NAMES.join(", ")}; or any name resolvable from .mulch/recipes/ or ${NPM_RECIPE_PREFIX}*)`,
		)
		.description("Set up mulch integration for a specific agent provider")
		.option("--check", "verify provider integration is installed")
		.option("--remove", "remove provider integration")
		.option("--hooks", "install a pre-commit git hook running mulch validate")
		.option("--list", "list discovered providers (built-in, .mulch/recipes/, mulch-recipe-* npm)")
		.action(
			async (
				provider: string | undefined,
				options: {
					check?: boolean;
					remove?: boolean;
					hooks?: boolean;
					list?: boolean;
				},
			) => {
				const jsonMode = program.opts().json === true;

				// Verify .mulch/ exists
				const mulchDir = getMulchDir();
				if (!existsSync(mulchDir)) {
					if (jsonMode) {
						outputJsonError("setup", "No .mulch/ directory found. Run `mulch init` first.");
					} else {
						console.error(chalk.red("Error: No .mulch/ directory found. Run `mulch init` first."));
					}
					process.exitCode = 1;
					return;
				}

				// Handle --list (no provider needed)
				if (options.list) {
					await runList(process.cwd(), jsonMode);
					return;
				}

				if (!provider && !options.hooks) {
					if (jsonMode) {
						outputJsonError("setup", "Specify a provider, use --hooks, or use --list.");
					} else {
						console.error(chalk.red("Error: specify a provider, use --hooks, or use --list."));
					}
					process.exitCode = 1;
					return;
				}

				// Handle --hooks
				if (options.hooks) {
					const cwd = process.cwd();
					let hookResult: RecipeResult;
					const action = options.check ? "check" : options.remove ? "remove" : "install";
					if (options.check) {
						hookResult = await checkGitHook(cwd);
					} else if (options.remove) {
						hookResult = await removeGitHook(cwd);
					} else {
						hookResult = await installGitHook(cwd);
					}

					if (jsonMode) {
						outputJson({
							success: hookResult.success,
							command: "setup",
							target: "hooks",
							action,
							message: hookResult.message,
						});
					} else if (hookResult.success) {
						console.log(chalk.green(`\u2714 ${hookResult.message}`));
					} else {
						console.error(chalk.red(`\u2716 ${hookResult.message}`));
					}

					if (!hookResult.success) {
						process.exitCode = 1;
					}

					// If no provider, stop here
					if (!provider) return;
				}

				// Handle provider
				if (!provider) return;

				const cwd = process.cwd();
				let resolved: RecipeWithSource | null;
				try {
					resolved = await resolveRecipe(provider, cwd, BUILTIN_RECIPES);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (jsonMode) {
						outputJsonError("setup", msg);
					} else {
						console.error(chalk.red(`Error: ${msg}`));
					}
					process.exitCode = 1;
					return;
				}

				if (!resolved) {
					const hint = `Unknown provider "${provider}". Run \`ml setup --list\` to see discovered providers, or add a recipe at .mulch/recipes/${provider}.{ts,sh} or install ${NPM_RECIPE_PREFIX}${provider}.`;
					if (jsonMode) {
						outputJsonError("setup", hint);
					} else {
						console.error(chalk.red(`Error: ${hint}`));
					}
					process.exitCode = 1;
					return;
				}

				const action = options.check ? "check" : options.remove ? "remove" : "install";
				let result: RecipeResult;
				try {
					if (options.check) {
						result = await resolved.recipe.check(cwd);
					} else if (options.remove) {
						result = await resolved.recipe.remove(cwd);
					} else {
						result = await resolved.recipe.install(cwd);
					}
				} catch (err) {
					// A recipe that throws (instead of returning a RecipeResult) would
					// otherwise surface as a raw Bun stack trace from a top-level
					// awaited action. Convert to the same shape as a returned failure
					// so users see a one-line, formatted error.
					const msg = err instanceof Error ? err.message : String(err);
					const sourceLabel =
						resolved.source === "builtin" ? "built-in" : (resolved.path ?? resolved.source);
					result = {
						success: false,
						message: `recipe "${provider}" ${action} threw (${sourceLabel}): ${msg}`,
					};
				}

				if (jsonMode) {
					outputJson({
						success: result.success,
						command: "setup",
						provider,
						source: resolved.source,
						...(resolved.path ? { path: resolved.path } : {}),
						action,
						message: result.message,
					});
				} else if (result.success) {
					console.log(chalk.green(`\u2714 ${result.message}`));
				} else if (options.check) {
					console.log(chalk.yellow(`\u2716 ${result.message}`));
				} else {
					console.error(chalk.red(`Error: ${result.message}`));
				}

				if (!result.success) {
					process.exitCode = 1;
				}
			},
		);
}

interface ProviderListing {
	name: string;
	source: "builtin" | "filesystem-ts" | "filesystem-sh" | "npm";
	path?: string;
	shadowedBy?: "filesystem-ts" | "filesystem-sh" | "npm";
}

function npmShadowExists(name: string, cwd: string): boolean {
	// resolveRecipe prefers filesystem \u2192 npm \u2192 built-in, so an installed
	// `mulch-recipe-<name>` package shadows the built-in (and is itself shadowed
	// by a filesystem recipe of the same name). Probe per-builtin rather than
	// enumerating node_modules \u2014 fast, and avoids rummaging through unrelated
	// packages.
	try {
		const requireFn = createRequire(import.meta.url);
		requireFn.resolve(`${NPM_RECIPE_PREFIX}${name}`, { paths: [cwd] });
		return true;
	} catch {
		return false;
	}
}

async function gatherProviderListings(cwd: string): Promise<ProviderListing[]> {
	const fsRecipes = await listFilesystemRecipes(cwd);

	const listings: ProviderListing[] = [];

	for (const name of BUILTIN_PROVIDER_NAMES) {
		// Resolution order is filesystem \u2192 npm \u2192 built-in, so a filesystem
		// shadow wins over npm. Report the actual winner so the marker isn't a
		// lie about what `ml setup <name>` would run.
		const fsShadow = fsRecipes.find((r) => r.name === name);
		const shadowedBy: ProviderListing["shadowedBy"] | undefined = fsShadow
			? fsShadow.source
			: npmShadowExists(name, cwd)
				? "npm"
				: undefined;
		listings.push({
			name,
			source: "builtin",
			...(shadowedBy ? { shadowedBy } : {}),
		});
	}

	for (const fs of fsRecipes) {
		listings.push({ name: fs.name, source: fs.source, path: fs.path });
	}

	listings.sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		// Filesystem before builtin so the active recipe sorts first.
		const order = { "filesystem-ts": 0, "filesystem-sh": 1, npm: 2, builtin: 3 } as const;
		return order[a.source] - order[b.source];
	});

	return listings;
}

async function runList(cwd: string, jsonMode: boolean): Promise<void> {
	const listings = await gatherProviderListings(cwd);

	if (jsonMode) {
		outputJson({
			success: true,
			command: "setup",
			action: "list",
			providers: listings.map((l) => ({
				name: l.name,
				source: l.source,
				...(l.path ? { path: relative(cwd, l.path) } : {}),
				...(l.shadowedBy ? { shadowed_by: l.shadowedBy } : {}),
			})),
		});
		return;
	}

	console.log(chalk.bold("Available providers:"));
	const labelWidth = Math.max(...listings.map((l) => l.name.length), 6);
	for (const l of listings) {
		const sourceLabel =
			l.source === "builtin"
				? l.shadowedBy
					? chalk.dim(`built-in (shadowed by ${l.shadowedBy})`)
					: "built-in"
				: l.source === "filesystem-ts"
					? `filesystem-ts: ${relative(cwd, l.path ?? "")}`
					: l.source === "filesystem-sh"
						? `filesystem-sh: ${relative(cwd, l.path ?? "")}`
						: `npm: ${NPM_RECIPE_PREFIX}${l.name}`;
		const marker = l.shadowedBy ? chalk.dim("\u00b7") : chalk.green("\u2713");
		console.log(`  ${marker} ${l.name.padEnd(labelWidth)}  ${sourceLabel}`);
	}
	console.log("");
	console.log(
		chalk.dim(
			`Resolution order: filesystem (.mulch/recipes/<name>.{ts,sh}) \u2192 npm (${NPM_RECIPE_PREFIX}<name>) \u2192 built-in.`,
		),
	);
}
