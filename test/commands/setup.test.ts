import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	buildCursorRuleContent,
	CLAUDE_HOOK_COMMAND,
	checkGitHook,
	installGitHook,
	recipes,
	removeGitHook,
} from "../../src/commands/setup.ts";
import { initMulchDir } from "../../src/utils/config.ts";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");

describe("setup command", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "mulch-setup-test-"));
		await initMulchDir(tmpDir);
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	// ── Claude recipe ───────────────────────────────────────────

	describe("claude recipe", () => {
		it("installs SessionStart hook into new settings.json", async () => {
			const result = await recipes.claude.install(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Installed");

			const settingsPath = join(tmpDir, ".claude", "settings.json");
			expect(existsSync(settingsPath)).toBe(true);

			const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
			const expectedGroup = {
				matcher: "",
				hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }],
			};
			expect(settings.hooks.SessionStart).toEqual(expect.arrayContaining([expectedGroup]));
			// PreCompact is no longer registered — its stdout is discarded after
			// compaction, and SessionStart's empty matcher already covers the
			// post-compact reload case via the `compact` filter.
			expect(settings.hooks.PreCompact).toBeUndefined();
		});

		it("preserves existing settings when installing hooks", async () => {
			const settingsPath = join(tmpDir, ".claude", "settings.json");
			await mkdir(join(tmpDir, ".claude"), { recursive: true });
			await writeFile(
				settingsPath,
				JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2),
				"utf-8",
			);

			await recipes.claude.install(tmpDir);

			const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
			expect(settings.permissions.allow).toContain("Read");
			expect(settings.hooks.SessionStart).toHaveLength(1);
		});

		it("is idempotent — second install reports already installed", async () => {
			await recipes.claude.install(tmpDir);
			const result = await recipes.claude.install(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("already installed");

			// Verify no duplicate hooks
			const settingsPath = join(tmpDir, ".claude", "settings.json");
			const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
			expect(settings.hooks.SessionStart).toHaveLength(1);
		});

		it("check reports success after install", async () => {
			await recipes.claude.install(tmpDir);
			const result = await recipes.claude.check(tmpDir);
			expect(result.success).toBe(true);
		});

		it("check reports failure when no settings exist", async () => {
			const result = await recipes.claude.check(tmpDir);
			expect(result.success).toBe(false);
		});

		it("check reports missing hooks", async () => {
			const settingsPath = join(tmpDir, ".claude", "settings.json");
			await mkdir(join(tmpDir, ".claude"), { recursive: true });
			await writeFile(settingsPath, JSON.stringify({ hooks: {} }), "utf-8");

			const result = await recipes.claude.check(tmpDir);
			expect(result.success).toBe(false);
			expect(result.message).toContain("Missing hooks");
		});

		it("remove cleans up hooks", async () => {
			await recipes.claude.install(tmpDir);
			const result = await recipes.claude.remove(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Removed");

			const settings = JSON.parse(
				await readFile(join(tmpDir, ".claude", "settings.json"), "utf-8"),
			);
			expect(settings.hooks).toBeUndefined();
		});

		it("remove cleans up legacy PreCompact entries from older installs", async () => {
			// Older versions of mulch wrote both SessionStart and PreCompact
			// entries; remove() should still strip both so an upgrade-then-uninstall
			// path leaves nothing behind.
			const settingsPath = join(tmpDir, ".claude", "settings.json");
			await mkdir(join(tmpDir, ".claude"), { recursive: true });
			const legacy = {
				hooks: {
					SessionStart: [
						{ matcher: "", hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }] },
					],
					PreCompact: [{ matcher: "", hooks: [{ type: "command", command: CLAUDE_HOOK_COMMAND }] }],
				},
			};
			await writeFile(settingsPath, JSON.stringify(legacy, null, 2), "utf-8");

			const result = await recipes.claude.remove(tmpDir);
			expect(result.success).toBe(true);

			const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
			expect(settings.hooks).toBeUndefined();
		});

		it("remove is safe when no settings exist", async () => {
			const result = await recipes.claude.remove(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("nothing to remove");
		});
	});

	// ── Cursor recipe ──────────────────────────────────────────

	describe("cursor recipe", () => {
		it("creates rule file on install", async () => {
			const result = await recipes.cursor.install(tmpDir);
			expect(result.success).toBe(true);

			const rulePath = join(tmpDir, ".cursor", "rules", "mulch.mdc");
			expect(existsSync(rulePath)).toBe(true);

			const content = await readFile(rulePath, "utf-8");
			expect(content).toBe(await buildCursorRuleContent(tmpDir));
		});

		it("is idempotent", async () => {
			await recipes.cursor.install(tmpDir);
			const result = await recipes.cursor.install(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("already installed");
		});

		it("check succeeds after install", async () => {
			await recipes.cursor.install(tmpDir);
			const result = await recipes.cursor.check(tmpDir);
			expect(result.success).toBe(true);
		});

		it("check fails when file is missing", async () => {
			const result = await recipes.cursor.check(tmpDir);
			expect(result.success).toBe(false);
		});

		it("check detects modified file", async () => {
			await recipes.cursor.install(tmpDir);
			const rulePath = join(tmpDir, ".cursor", "rules", "mulch.mdc");
			await writeFile(rulePath, "modified content", "utf-8");

			const result = await recipes.cursor.check(tmpDir);
			expect(result.success).toBe(false);
			expect(result.message).toContain("modified");
		});

		it("remove deletes the rule file", async () => {
			await recipes.cursor.install(tmpDir);
			const result = await recipes.cursor.remove(tmpDir);
			expect(result.success).toBe(true);

			const rulePath = join(tmpDir, ".cursor", "rules", "mulch.mdc");
			expect(existsSync(rulePath)).toBe(false);
		});

		it("remove is safe when file does not exist", async () => {
			const result = await recipes.cursor.remove(tmpDir);
			expect(result.success).toBe(true);
		});
	});

	// ── Codex recipe ───────────────────────────────────────────

	describe("codex recipe", () => {
		it("creates AGENTS.md and .codex/config.toml on fresh install", async () => {
			const result = await recipes.codex.install(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Installed");

			const agentsPath = join(tmpDir, "AGENTS.md");
			const tomlPath = join(tmpDir, ".codex", "config.toml");
			expect(existsSync(agentsPath)).toBe(true);
			expect(existsSync(tomlPath)).toBe(true);

			const agents = await readFile(agentsPath, "utf-8");
			expect(agents).toContain("<!-- mulch:start -->");
			expect(agents).toContain("ml prime");

			const toml = await readFile(tomlPath, "utf-8");
			expect(toml).toContain("# mulch:start");
			expect(toml).toContain("[features]");
			expect(toml).toContain("codex_hooks = true");
			expect(toml).toContain("[[hooks.SessionStart]]");
			expect(toml).toContain("[[hooks.SessionStart.hooks]]");
			expect(toml).toContain('command = "ml prime"');
		});

		it("appends to existing AGENTS.md without clobbering it", async () => {
			const agentsPath = join(tmpDir, "AGENTS.md");
			await writeFile(agentsPath, "# Existing Content\n\nSome stuff.\n", "utf-8");

			await recipes.codex.install(tmpDir);

			const content = await readFile(agentsPath, "utf-8");
			expect(content).toContain("# Existing Content");
			expect(content).toContain("<!-- mulch:start -->");
		});

		it("preserves unrelated entries in existing .codex/config.toml", async () => {
			const tomlPath = join(tmpDir, ".codex", "config.toml");
			await mkdir(join(tmpDir, ".codex"), { recursive: true });
			const existing = `# user-managed\nmodel = "gpt-5"\n\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "/bin/true"\n`;
			await writeFile(tomlPath, existing, "utf-8");

			await recipes.codex.install(tmpDir);

			const content = await readFile(tomlPath, "utf-8");
			expect(content).toContain('model = "gpt-5"');
			expect(content).toContain("[[hooks.PreToolUse]]");
			expect(content).toContain('command = "/bin/true"');
			expect(content).toContain("# mulch:start");
			expect(content).toContain('command = "ml prime"');
		});

		it("is idempotent — second install does not duplicate entries", async () => {
			await recipes.codex.install(tmpDir);
			const result = await recipes.codex.install(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("already installed");

			const agents = await readFile(join(tmpDir, "AGENTS.md"), "utf-8");
			const tomlContent = await readFile(join(tmpDir, ".codex", "config.toml"), "utf-8");
			const agentsMarkers = (agents.match(/<!-- mulch:start -->/g) ?? []).length;
			const tomlMarkers = (tomlContent.match(/# mulch:start/g) ?? []).length;
			expect(agentsMarkers).toBe(1);
			expect(tomlMarkers).toBe(1);
			const sessionStartCount = (tomlContent.match(/\[\[hooks\.SessionStart\]\]/g) ?? []).length;
			expect(sessionStartCount).toBe(1);
		});

		it("check passes after install", async () => {
			await recipes.codex.install(tmpDir);
			const result = await recipes.codex.check(tmpDir);
			expect(result.success).toBe(true);
		});

		it("check fails when AGENTS.md is missing", async () => {
			const result = await recipes.codex.check(tmpDir);
			expect(result.success).toBe(false);
		});

		it("check fails when .codex/config.toml is missing", async () => {
			// Stage AGENTS.md only, no toml
			const agentsPath = join(tmpDir, "AGENTS.md");
			await writeFile(
				agentsPath,
				"# AGENTS\n\n<!-- mulch:start -->\nstuff\n<!-- mulch:end -->\n",
				"utf-8",
			);
			const result = await recipes.codex.check(tmpDir);
			expect(result.success).toBe(false);
			expect(result.message).toContain(".codex/config.toml");
		});

		it("remove strips both AGENTS.md section and TOML hook entry", async () => {
			const agentsPath = join(tmpDir, "AGENTS.md");
			await writeFile(agentsPath, "# Header\n\nParagraph.\n", "utf-8");

			const tomlPath = join(tmpDir, ".codex", "config.toml");
			await mkdir(join(tmpDir, ".codex"), { recursive: true });
			await writeFile(
				tomlPath,
				'# user-managed\nmodel = "gpt-5"\n\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n',
				"utf-8",
			);

			await recipes.codex.install(tmpDir);
			const result = await recipes.codex.remove(tmpDir);
			expect(result.success).toBe(true);

			const agents = await readFile(agentsPath, "utf-8");
			expect(agents).toContain("# Header");
			expect(agents).not.toContain("<!-- mulch:start -->");

			const toml = await readFile(tomlPath, "utf-8");
			expect(toml).toContain('model = "gpt-5"');
			expect(toml).toContain("[[hooks.PreToolUse]]");
			expect(toml).not.toContain("# mulch:start");
			expect(toml).not.toContain('command = "ml prime"');
		});

		it("remove is safe when no files exist", async () => {
			const result = await recipes.codex.remove(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("nothing to remove");
		});
	});

	// ── Git hooks ─────────────────────────────────────────────

	describe("git hooks", () => {
		it("installs pre-commit hook", async () => {
			await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
			const result = await installGitHook(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Installed");

			const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
			expect(existsSync(hookPath)).toBe(true);

			const content = await readFile(hookPath, "utf-8");
			expect(content).toContain("#!/bin/sh");
			expect(content).toContain("mulch validate");
		});

		it("makes hook executable", async () => {
			await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
			await installGitHook(tmpDir);

			const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
			const fileStat = await stat(hookPath);
			// Check that owner execute bit is set
			// eslint-disable-next-line no-bitwise
			expect(fileStat.mode & 0o755).toBe(0o755);
		});

		it("appends to existing pre-commit hook", async () => {
			const hooksDir = join(tmpDir, ".git", "hooks");
			await mkdir(hooksDir, { recursive: true });

			const hookPath = join(hooksDir, "pre-commit");
			const existingContent = "#!/bin/sh\n\necho 'existing hook'\n";
			await writeFile(hookPath, existingContent, "utf-8");

			const result = await installGitHook(tmpDir);
			expect(result.success).toBe(true);

			const content = await readFile(hookPath, "utf-8");
			expect(content).toContain("echo 'existing hook'");
			expect(content).toContain("mulch validate");
		});

		it("is idempotent", async () => {
			await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
			await installGitHook(tmpDir);
			const result = await installGitHook(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("already installed");

			const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
			const content = await readFile(hookPath, "utf-8");
			// Only one marker
			const markerCount = content.split("# mulch:start").length - 1;
			expect(markerCount).toBe(1);
		});

		it("check reports success after install", async () => {
			await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
			await installGitHook(tmpDir);

			const result = await checkGitHook(tmpDir);
			expect(result.success).toBe(true);
		});

		it("check reports failure when hook is missing", async () => {
			await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
			const result = await checkGitHook(tmpDir);
			expect(result.success).toBe(false);
		});

		it("remove strips mulch section", async () => {
			const hooksDir = join(tmpDir, ".git", "hooks");
			await mkdir(hooksDir, { recursive: true });

			const hookPath = join(hooksDir, "pre-commit");
			const existingContent = "#!/bin/sh\n\necho 'existing hook'\n";
			await writeFile(hookPath, existingContent, "utf-8");

			await installGitHook(tmpDir);
			const result = await removeGitHook(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("Removed mulch section");

			const content = await readFile(hookPath, "utf-8");
			expect(content).toContain("echo 'existing hook'");
			expect(content).not.toContain("# mulch:start");
		});

		it("remove deletes file if only mulch content", async () => {
			await mkdir(join(tmpDir, ".git", "hooks"), { recursive: true });
			await installGitHook(tmpDir);

			const result = await removeGitHook(tmpDir);
			expect(result.success).toBe(true);
			expect(result.message).toContain("file deleted");

			const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
			expect(existsSync(hookPath)).toBe(false);
		});

		it("fails gracefully when not a git repo", async () => {
			// tmpDir has no .git directory since we only created .mulch
			// First remove any .git dir that might exist
			const gitDir = join(tmpDir, ".git");
			if (existsSync(gitDir)) {
				await rm(gitDir, { recursive: true, force: true });
			}

			const result = await installGitHook(tmpDir);
			expect(result.success).toBe(false);
			expect(result.message).toContain("Not a git repository");
		});
	});

	// ── Discovery via CLI ──────────────────────────────────────

	describe("recipe discovery", () => {
		const STUB_TS = `
const recipe = {
	async install() { return { success: true, message: "filesystem-ts install" }; },
	async check() { return { success: true, message: "filesystem-ts check" }; },
	async remove() { return { success: true, message: "filesystem-ts remove" }; },
};
export default recipe;
`;

		const STUB_SH = `#!/bin/sh
case "$1" in
	install) echo "filesystem-sh install"; exit 0 ;;
	check) echo "filesystem-sh check"; exit 0 ;;
	remove) echo "filesystem-sh remove"; exit 0 ;;
esac
exit 1
`;

		function runCli(args: string[], cwd: string) {
			return Bun.spawnSync(["bun", CLI_PATH, ...args], {
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
		}

		it("--list (json) reports built-ins and filesystem recipes", async () => {
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(join(recipesDir, "internal-ide.ts"), STUB_TS, "utf-8");
			await writeFile(join(recipesDir, "legacy-bot.sh"), STUB_SH, "utf-8");
			await chmod(join(recipesDir, "legacy-bot.sh"), 0o755);

			const result = runCli(["--json", "setup", "--list"], tmpDir);
			expect(result.exitCode).toBe(0);

			const out = JSON.parse(result.stdout.toString());
			expect(out.success).toBe(true);
			expect(out.action).toBe("list");

			const names = out.providers.map((p: { name: string }) => p.name);
			expect(names).toContain("claude");
			expect(names).toContain("internal-ide");
			expect(names).toContain("legacy-bot");

			const internal = out.providers.find((p: { name: string }) => p.name === "internal-ide");
			expect(internal.source).toBe("filesystem-ts");
			expect(internal.path).toContain(".mulch/recipes/internal-ide.ts");

			const legacy = out.providers.find((p: { name: string }) => p.name === "legacy-bot");
			expect(legacy.source).toBe("filesystem-sh");
		});

		it("--list flags built-ins shadowed by filesystem recipes", async () => {
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(join(recipesDir, "claude.ts"), STUB_TS, "utf-8");

			const result = runCli(["--json", "setup", "--list"], tmpDir);
			expect(result.exitCode).toBe(0);
			const out = JSON.parse(result.stdout.toString());

			const claudeBuiltin = out.providers.find(
				(p: { name: string; source: string }) => p.name === "claude" && p.source === "builtin",
			);
			expect(claudeBuiltin.shadowed_by).toBe("filesystem-ts");
		});

		it("setup <name> resolves filesystem-ts recipe and runs install", async () => {
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(join(recipesDir, "internal-ide.ts"), STUB_TS, "utf-8");

			const result = runCli(["--json", "setup", "internal-ide"], tmpDir);
			expect(result.exitCode).toBe(0);

			const out = JSON.parse(result.stdout.toString());
			expect(out.success).toBe(true);
			expect(out.provider).toBe("internal-ide");
			expect(out.source).toBe("filesystem-ts");
			expect(out.message).toBe("filesystem-ts install");
		});

		it("setup <name> resolves filesystem-sh recipe and runs check", async () => {
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(join(recipesDir, "legacy-bot.sh"), STUB_SH, "utf-8");
			await chmod(join(recipesDir, "legacy-bot.sh"), 0o755);

			const result = runCli(["--json", "setup", "legacy-bot", "--check"], tmpDir);
			expect(result.exitCode).toBe(0);

			const out = JSON.parse(result.stdout.toString());
			expect(out.success).toBe(true);
			expect(out.source).toBe("filesystem-sh");
			expect(out.message).toBe("filesystem-sh check");
		});

		it("filesystem recipe shadows built-in when name collides", async () => {
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(join(recipesDir, "claude.ts"), STUB_TS, "utf-8");

			const result = runCli(["--json", "setup", "claude"], tmpDir);
			expect(result.exitCode).toBe(0);

			const out = JSON.parse(result.stdout.toString());
			expect(out.source).toBe("filesystem-ts");
			expect(out.message).toBe("filesystem-ts install");
		});

		it("setup <unknown> exits non-zero with a discovery hint", async () => {
			const result = runCli(["--json", "setup", "nonexistent"], tmpDir);
			expect(result.exitCode).toBe(1);

			const err = JSON.parse(result.stderr.toString());
			expect(err.success).toBe(false);
			expect(err.error).toContain('Unknown provider "nonexistent"');
			expect(err.error).toContain("--list");
			expect(err.error).toContain(".mulch/recipes/nonexistent");
			expect(err.error).toContain("mulch-recipe-nonexistent");
		});

		it("setup with no args, no --hooks, no --list errors", async () => {
			const result = runCli(["--json", "setup"], tmpDir);
			expect(result.exitCode).toBe(1);

			const err = JSON.parse(result.stderr.toString());
			expect(err.error).toContain("--list");
		});

		it("setup <name> formats a recipe install() throw instead of crashing", async () => {
			// Regression for mulch-828d: a recipe whose install/check/remove
			// throws (e.g. fs error mid-way, network failure) used to surface
			// as a raw Bun stack trace because the action handler awaited the
			// call without try/catch.
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(
				join(recipesDir, "boom.ts"),
				`export default {
  async install() { throw new Error("intentional install failure"); },
  async check() { return { success: true, message: "" }; },
  async remove() { return { success: true, message: "" }; },
};
`,
				"utf-8",
			);

			const result = runCli(["--json", "setup", "boom"], tmpDir);
			expect(result.exitCode).toBe(1);
			const out = JSON.parse(result.stdout.toString());
			expect(out.success).toBe(false);
			expect(out.message).toContain("intentional install failure");
			expect(out.message).toContain("threw");
			// No raw Bun stack trace in stderr.
			expect(result.stderr.toString()).not.toContain("at install");
			expect(result.stderr.toString()).not.toContain("Bun v");
		});

		it("setup <name> with named-only TS recipe fails with default-export error", async () => {
			const recipesDir = join(tmpDir, ".mulch", "recipes");
			await mkdir(recipesDir, { recursive: true });
			await writeFile(
				join(recipesDir, "named.ts"),
				`export const install = async () => ({ success: true, message: "" });
export const check = async () => ({ success: true, message: "" });
export const remove = async () => ({ success: true, message: "" });
`,
				"utf-8",
			);

			const result = runCli(["--json", "setup", "named"], tmpDir);
			expect(result.exitCode).toBe(1);
			const err = JSON.parse(result.stderr.toString());
			expect(err.success).toBe(false);
			expect(err.error).toContain("no default export");
		});

		it("--list flags built-ins shadowed by an installed npm recipe package", async () => {
			// Stage a fake mulch-recipe-claude package in node_modules so the
			// per-builtin npm probe finds it. We don't need to load it — only
			// require.resolve must succeed.
			const pkgDir = join(tmpDir, "node_modules", "mulch-recipe-claude");
			await mkdir(pkgDir, { recursive: true });
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "mulch-recipe-claude", main: "index.js" }),
				"utf-8",
			);
			await writeFile(join(pkgDir, "index.js"), "module.exports = {};\n", "utf-8");

			const result = runCli(["--json", "setup", "--list"], tmpDir);
			expect(result.exitCode).toBe(0);
			const out = JSON.parse(result.stdout.toString());
			const claudeBuiltin = out.providers.find(
				(p: { name: string; source: string }) => p.name === "claude" && p.source === "builtin",
			);
			expect(claudeBuiltin.shadowed_by).toBe("npm");
		});
	});
});
