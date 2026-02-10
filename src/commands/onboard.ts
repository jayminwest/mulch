import { Command } from "commander";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";

const SNIPPET_DEFAULT = `## Project Expertise (Mulch)

This project uses [Mulch](https://github.com/jayminwest/mulch) for structured expertise management.

**Before starting work**, run:
\`\`\`bash
mulch prime
\`\`\`

**After completing work**, record learnings:
\`\`\`bash
mulch record <domain> --type <convention|pattern|failure|decision> --description "..."
\`\`\`

Run \`mulch status\` to see available domains and expertise health.

### Session Completion Checklist

1. Record learnings:
   \`\`\`bash
   mulch record <domain> --type <convention|pattern|failure|decision> --description "..."
   \`\`\`
2. Validate records:
   \`\`\`bash
   mulch validate
   \`\`\`
3. Commit changes:
   \`\`\`bash
   git add .mulch/ && git commit -m "Update expertise"
   \`\`\`
4. Push to share:
   \`\`\`bash
   git push
   \`\`\`
`;

function getSnippet(provider: string | undefined): string {
  if (!provider || provider === "default") {
    return SNIPPET_DEFAULT;
  }

  // Provider-specific snippets customize the phrasing slightly
  if (provider === "claude") {
    return `## Project Expertise (Mulch)

This project uses [Mulch](https://github.com/jayminwest/mulch) for structured expertise management.

**At the start of every session**, run:
\`\`\`bash
mulch prime
\`\`\`

This injects project-specific conventions, patterns, and decisions into your context.

**After completing work**, record what you learned:
\`\`\`bash
mulch record <domain> --type <convention|pattern|failure|decision> --description "..."
\`\`\`

Run \`mulch status\` to check domain health and entry counts.

### Session Completion Checklist

1. Record learnings:
   \`\`\`bash
   mulch record <domain> --type <convention|pattern|failure|decision> --description "..."
   \`\`\`
2. Validate records:
   \`\`\`bash
   mulch validate
   \`\`\`
3. Commit changes:
   \`\`\`bash
   git add .mulch/ && git commit -m "Update expertise"
   \`\`\`
4. Push to share:
   \`\`\`bash
   git push
   \`\`\`
`;
  }

  // For any other provider, use the default snippet
  return SNIPPET_DEFAULT;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectTargetFile(cwd: string): Promise<string> {
  // If CLAUDE.md exists, prefer it
  if (await fileExists(join(cwd, "CLAUDE.md"))) {
    return "CLAUDE.md";
  }
  // Otherwise default to AGENTS.md
  return "AGENTS.md";
}

export async function runOnboard(options: {
  stdout?: boolean;
  provider?: string;
  cwd?: string;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const snippet = getSnippet(options.provider);

  if (options.stdout) {
    process.stdout.write(snippet);
    return;
  }

  const targetFileName = await detectTargetFile(cwd);
  const targetPath = join(cwd, targetFileName);

  // Check if snippet is already present
  if (await fileExists(targetPath)) {
    const existing = await readFile(targetPath, "utf-8");
    if (existing.includes("## Project Expertise (Mulch)")) {
      console.log(
        chalk.yellow(`Mulch snippet already exists in ${targetFileName}. No changes made.`),
      );
      return;
    }
    // Append to existing file
    await writeFile(targetPath, existing + "\n" + snippet, "utf-8");
  } else {
    // Create new file
    await writeFile(targetPath, snippet, "utf-8");
  }

  console.log(chalk.green(`Mulch onboarding snippet written to ${targetFileName}`));
}

export function registerOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description(
      "Generate an AGENTS.md/CLAUDE.md snippet pointing to mulch prime",
    )
    .option("--stdout", "print snippet to stdout instead of writing to file")
    .option(
      "--provider <provider>",
      "customize snippet for a specific provider (e.g. claude)",
    )
    .action(async (options: { stdout?: boolean; provider?: string }) => {
      try {
        await runOnboard(options);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
