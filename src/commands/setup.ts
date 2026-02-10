import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, chmod, unlink, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { getMulchDir } from "../utils/config.js";

/** Supported provider names. */
const SUPPORTED_PROVIDERS = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "windsurf",
  "aider",
] as const;

type Provider = (typeof SUPPORTED_PROVIDERS)[number];

function isProvider(value: string): value is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

/** Result of a provider recipe operation. */
interface RecipeResult {
  success: boolean;
  message: string;
}

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
    return { success: false, message: "Not a git repository — .git directory not found." };
  }

  const hooksDir = join(gitDir, "hooks");
  await mkdir(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, "pre-commit");
  let content = "";

  if (existsSync(hookPath)) {
    content = await readFile(hookPath, "utf-8");
    if (content.includes(HOOK_MARKER_START)) {
      return { success: true, message: "Git pre-commit hook already installed." };
    }
  }

  if (content) {
    content = content.trimEnd() + "\n\n" + MULCH_HOOK_SECTION + "\n";
  } else {
    content = "#!/bin/sh\n\n" + MULCH_HOOK_SECTION + "\n";
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
    return { success: false, message: "Git pre-commit hook exists but has no mulch section." };
  }

  return { success: true, message: "Git pre-commit hook is installed." };
}

async function removeGitHook(cwd: string): Promise<RecipeResult> {
  const hookPath = join(cwd, ".git", "hooks", "pre-commit");
  if (!existsSync(hookPath)) {
    return { success: true, message: "Git pre-commit hook not found; nothing to remove." };
  }

  const content = await readFile(hookPath, "utf-8");
  if (!content.includes(HOOK_MARKER_START)) {
    return { success: true, message: "No mulch section in pre-commit hook; nothing to remove." };
  }

  const startIdx = content.indexOf(HOOK_MARKER_START);
  const endIdx = content.indexOf(HOOK_MARKER_END);
  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + HOOK_MARKER_END.length);
  const cleaned = (before + after).replace(/\n{3,}/g, "\n\n").trim();

  // If only the shebang (or nothing) remains, delete the file
  if (!cleaned || cleaned === "#!/bin/sh") {
    await unlink(hookPath);
    return { success: true, message: "Removed mulch pre-commit hook (file deleted)." };
  }

  await writeFile(hookPath, cleaned + "\n", "utf-8");
  return { success: true, message: "Removed mulch section from pre-commit hook." };
}

// ────────────────────────────────────────────────────────────
// Provider recipes
// ────────────────────────────────────────────────────────────

interface ProviderRecipe {
  /** Install the integration (idempotent). */
  install(cwd: string): Promise<RecipeResult>;
  /** Check whether the integration is installed. */
  check(cwd: string): Promise<RecipeResult>;
  /** Remove the integration. */
  remove(cwd: string): Promise<RecipeResult>;
}

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

const CLAUDE_HOOK_COMMAND = "mulch prime";

function claudeSettingsPath(cwd: string): string {
  return join(cwd, ".claude", "settings.json");
}

function hasMulchHook(groups: ClaudeHookGroup[]): boolean {
  return groups.some((g) =>
    g.hooks.some((h) => h.command === CLAUDE_HOOK_COMMAND),
  );
}

function removeMulchHookGroups(groups: ClaudeHookGroup[]): ClaudeHookGroup[] {
  return groups.filter(
    (g) => !g.hooks.some((h) => h.command === CLAUDE_HOOK_COMMAND),
  );
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
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

    return { success: true, message: "Installed Claude hooks for SessionStart and PreCompact." };
  },

  async check(cwd) {
    const settingsPath = claudeSettingsPath(cwd);
    if (!existsSync(settingsPath)) {
      return { success: false, message: "Claude settings.json not found." };
    }

    const raw = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as ClaudeSettings;

    if (!settings.hooks) {
      return { success: false, message: "No hooks configured in Claude settings." };
    }

    const events = ["SessionStart", "PreCompact"];
    const missing: string[] = [];
    for (const event of events) {
      if (!settings.hooks[event] || !hasMulchHook(settings.hooks[event])) {
        missing.push(event);
      }
    }

    if (missing.length > 0) {
      return { success: false, message: `Missing hooks for: ${missing.join(", ")}.` };
    }
    return { success: true, message: "Claude hooks are installed and correct." };
  },

  async remove(cwd) {
    const settingsPath = claudeSettingsPath(cwd);
    if (!existsSync(settingsPath)) {
      return { success: true, message: "Claude settings.json not found; nothing to remove." };
    }

    const raw = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as ClaudeSettings;

    if (!settings.hooks) {
      return { success: true, message: "No hooks in Claude settings; nothing to remove." };
    }

    let removed = false;
    for (const event of Object.keys(settings.hooks)) {
      const before = settings.hooks[event].length;
      settings.hooks[event] = removeMulchHookGroups(settings.hooks[event]);
      if (settings.hooks[event].length < before) {
        removed = true;
      }
      if (settings.hooks[event].length === 0) {
        delete settings.hooks[event];
      }
    }

    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

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
mulch prime
\`\`\`

When you learn something new about this project (conventions, patterns, failures, decisions),
record it with:

\`\`\`
mulch record <domain> --type <convention|pattern|failure|decision> [options]
\`\`\`

Run \`mulch --help\` for full usage.
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

    return { success: true, message: "Installed Cursor rule at .cursor/rules/mulch.mdc." };
  },

  async check(cwd) {
    const rulePath = cursorRulePath(cwd);
    if (!existsSync(rulePath)) {
      return { success: false, message: "Cursor rule file not found." };
    }
    const content = await readFile(rulePath, "utf-8");
    if (content !== CURSOR_RULE_CONTENT) {
      return { success: false, message: "Cursor rule file exists but has been modified." };
    }
    return { success: true, message: "Cursor rule is installed and correct." };
  },

  async remove(cwd) {
    const rulePath = cursorRulePath(cwd);
    if (!existsSync(rulePath)) {
      return { success: true, message: "Cursor rule not found; nothing to remove." };
    }
    await unlink(rulePath);
    return { success: true, message: "Removed Cursor rule file." };
  },
};

// ── Codex ───────────────────────────────────────────────────

function codexAgentsPath(cwd: string): string {
  return join(cwd, "AGENTS.md");
}

const CODEX_SECTION_MARKER_START = "<!-- mulch:start -->";
const CODEX_SECTION_MARKER_END = "<!-- mulch:end -->";

const CODEX_SECTION = `${CODEX_SECTION_MARKER_START}
## Mulch Expertise

At the start of every session, run \`mulch prime\` to load project expertise.

When you learn something new about this project, record it with:

\`\`\`
mulch record <domain> --type <convention|pattern|failure|decision> [options]
\`\`\`
${CODEX_SECTION_MARKER_END}`;

function hasMulchSection(content: string): boolean {
  return content.includes(CODEX_SECTION_MARKER_START);
}

function removeMulchSection(content: string): string {
  const startIdx = content.indexOf(CODEX_SECTION_MARKER_START);
  const endIdx = content.indexOf(CODEX_SECTION_MARKER_END);
  if (startIdx === -1 || endIdx === -1) return content;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + CODEX_SECTION_MARKER_END.length);

  // Clean up extra newlines left behind
  return (before + after).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const codexRecipe: ProviderRecipe = {
  async install(cwd) {
    const agentsPath = codexAgentsPath(cwd);
    let content = "";

    if (existsSync(agentsPath)) {
      content = await readFile(agentsPath, "utf-8");
      if (hasMulchSection(content)) {
        return { success: true, message: "AGENTS.md already contains mulch section." };
      }
    }

    const newContent = content
      ? content.trimEnd() + "\n\n" + CODEX_SECTION + "\n"
      : CODEX_SECTION + "\n";

    await writeFile(agentsPath, newContent, "utf-8");

    return { success: true, message: "Added mulch section to AGENTS.md." };
  },

  async check(cwd) {
    const agentsPath = codexAgentsPath(cwd);
    if (!existsSync(agentsPath)) {
      return { success: false, message: "AGENTS.md not found." };
    }
    const content = await readFile(agentsPath, "utf-8");
    if (!hasMulchSection(content)) {
      return { success: false, message: "AGENTS.md exists but has no mulch section." };
    }
    return { success: true, message: "AGENTS.md contains mulch section." };
  },

  async remove(cwd) {
    const agentsPath = codexAgentsPath(cwd);
    if (!existsSync(agentsPath)) {
      return { success: true, message: "AGENTS.md not found; nothing to remove." };
    }
    const content = await readFile(agentsPath, "utf-8");
    if (!hasMulchSection(content)) {
      return { success: true, message: "No mulch section in AGENTS.md; nothing to remove." };
    }
    const cleaned = removeMulchSection(content);
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
  const MARKER_START = "<!-- mulch:start -->";
  const MARKER_END = "<!-- mulch:end -->";

  const section = `${MARKER_START}
## Mulch Expertise

At the start of every session, run \`mulch prime\` to load project expertise.

When you learn something new about this project, record it with:

\`\`\`
mulch record <domain> --type <convention|pattern|failure|decision> [options]
\`\`\`
${MARKER_END}`;

  return {
    async install(cwd) {
      const filePath = config.filePath(cwd);
      let content = "";

      if (existsSync(filePath)) {
        content = await readFile(filePath, "utf-8");
        if (content.includes(MARKER_START)) {
          return { success: true, message: `${config.fileName} already contains mulch section.` };
        }
      }

      const newContent = content
        ? content.trimEnd() + "\n\n" + section + "\n"
        : section + "\n";

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, newContent, "utf-8");

      return { success: true, message: `Added mulch section to ${config.fileName}.` };
    },

    async check(cwd) {
      const filePath = config.filePath(cwd);
      if (!existsSync(filePath)) {
        return { success: false, message: `${config.fileName} not found.` };
      }
      const content = await readFile(filePath, "utf-8");
      if (!content.includes(MARKER_START)) {
        return { success: false, message: `${config.fileName} exists but has no mulch section.` };
      }
      return { success: true, message: `${config.fileName} contains mulch section.` };
    },

    async remove(cwd) {
      const filePath = config.filePath(cwd);
      if (!existsSync(filePath)) {
        return { success: true, message: `${config.fileName} not found; nothing to remove.` };
      }
      const content = await readFile(filePath, "utf-8");
      if (!content.includes(MARKER_START)) {
        return { success: true, message: `No mulch section in ${config.fileName}; nothing to remove.` };
      }

      const startIdx = content.indexOf(MARKER_START);
      const endIdx = content.indexOf(MARKER_END);
      const before = content.substring(0, startIdx);
      const after = content.substring(endIdx + MARKER_END.length);
      const cleaned = (before + after).replace(/\n{3,}/g, "\n\n").trim() + "\n";

      await writeFile(filePath, cleaned, "utf-8");
      return { success: true, message: `Removed mulch section from ${config.fileName}.` };
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

const recipes: Record<Provider, ProviderRecipe> = {
  claude: claudeRecipe,
  cursor: cursorRecipe,
  codex: codexRecipe,
  gemini: geminiRecipe,
  windsurf: windsurfRecipe,
  aider: aiderRecipe,
};

// ── Exported helpers for testing ────────────────────────────

export {
  recipes,
  SUPPORTED_PROVIDERS,
  CURSOR_RULE_CONTENT,
  CODEX_SECTION,
  CLAUDE_HOOK_COMMAND,
  MULCH_HOOK_SECTION,
  installGitHook,
  checkGitHook,
  removeGitHook,
};

export type { Provider, ProviderRecipe };

// ── Command registration ────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .argument("[provider]", `agent provider (${SUPPORTED_PROVIDERS.join(", ")})`)
    .description("Set up mulch integration for a specific agent provider")
    .option("--check", "verify provider integration is installed")
    .option("--remove", "remove provider integration")
    .option("--hooks", "install a pre-commit git hook running mulch validate")
    .action(async (provider: string | undefined, options: { check?: boolean; remove?: boolean; hooks?: boolean }) => {
      // Verify .mulch/ exists
      const mulchDir = getMulchDir();
      if (!existsSync(mulchDir)) {
        console.error(
          chalk.red("Error: No .mulch/ directory found. Run `mulch init` first."),
        );
        process.exitCode = 1;
        return;
      }

      if (!provider && !options.hooks) {
        console.error(
          chalk.red("Error: specify a provider or use --hooks."),
        );
        process.exitCode = 1;
        return;
      }

      // Handle --hooks
      if (options.hooks) {
        const cwd = process.cwd();
        let hookResult: RecipeResult;
        if (options.check) {
          hookResult = await checkGitHook(cwd);
        } else if (options.remove) {
          hookResult = await removeGitHook(cwd);
        } else {
          hookResult = await installGitHook(cwd);
        }

        if (hookResult.success) {
          console.log(chalk.green(`\u2714 ${hookResult.message}`));
        } else {
          console.error(chalk.red(`\u2716 ${hookResult.message}`));
          process.exitCode = 1;
        }

        // If no provider, stop here
        if (!provider) return;
      }

      // Handle provider
      if (!provider) return;

      if (!isProvider(provider)) {
        console.error(
          chalk.red(`Error: unknown provider "${provider}".`),
        );
        console.error(
          chalk.red(`Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`),
        );
        process.exitCode = 1;
        return;
      }

      {
        const recipe = recipes[provider];

        if (options.check) {
          const result = await recipe.check(process.cwd());
          if (result.success) {
            console.log(chalk.green(`\u2714 ${result.message}`));
          } else {
            console.log(chalk.yellow(`\u2716 ${result.message}`));
            process.exitCode = 1;
          }
          return;
        }

        if (options.remove) {
          const result = await recipe.remove(process.cwd());
          if (result.success) {
            console.log(chalk.green(`\u2714 ${result.message}`));
          } else {
            console.error(chalk.red(`Error: ${result.message}`));
            process.exitCode = 1;
          }
          return;
        }

        // Default: install
        const result = await recipe.install(process.cwd());
        if (result.success) {
          console.log(chalk.green(`\u2714 ${result.message}`));
        } else {
          console.error(chalk.red(`Error: ${result.message}`));
          process.exitCode = 1;
        }
      }
    });
}
