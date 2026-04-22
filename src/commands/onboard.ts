import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { hasMarkerSection, replaceMarkerSection, wrapInMarkers } from "../utils/markers.ts";

export const ONBOARD_VERSION = 2;
export const VERSION_MARKER = `<!-- mulch-onboard-v:${String(ONBOARD_VERSION)} -->`;

const SNIPPET_DEFAULT = `## Project Expertise (Mulch)
${VERSION_MARKER}

This project uses [Mulch](https://github.com/jayminwest/mulch) for structured expertise management.

**At the start of every session**, run:
\`\`\`bash
ml prime
\`\`\`

Injects project-specific conventions, patterns, decisions, failures, references, and guides into
your context. Run \`ml prime --files src/foo.ts\` before editing a file to load only records
relevant to that path (per-file framing, classification age, and confirmation scores included).

**Before completing your task**, record insights worth preserving — conventions discovered,
patterns applied, failures encountered, or decisions made:
\`\`\`bash
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
\`\`\`

Evidence auto-populates from git (current commit + changed files). Link explicitly with
\`--evidence-seeds <id>\` / \`--evidence-gh <id>\` / \`--evidence-linear <id>\` / \`--evidence-bead <id>\`,
\`--evidence-commit <sha>\`, or \`--relates-to <mx-id>\`. Upserts of named records merge outcomes
instead of replacing them; validation failures print a copy-paste retry hint with missing fields
pre-filled.

Run \`ml status\` for domain health, \`ml doctor\` to check record integrity (add \`--fix\` to strip
broken file anchors), \`ml --help\` for the full command list. Write commands use file locking and
atomic writes, so multiple agents can record concurrently. Expertise survives \`git worktree\`
cleanup — \`.mulch/\` resolves to the main repo.

### Before You Finish

1. Discover what to record (shows changed files and suggests domains):
   \`\`\`bash
   ml learn
   \`\`\`
2. Store insights from this work session:
   \`\`\`bash
   ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
   \`\`\`
3. Validate and commit:
   \`\`\`bash
   ml sync
   \`\`\`
`;

const LEGACY_HEADER = "## Project Expertise (Mulch)";
const LEGACY_TAIL = 'mulch validate && git add .mulch/ && git commit -m "mulch: record learnings"';

function getSnippet(provider: string | undefined): string {
	if (!provider || provider === "default") {
		return SNIPPET_DEFAULT;
	}
	// All providers use the same standardized snippet
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

interface OnboardTarget {
	path: string;
	fileName: string;
	exists: boolean;
}

function hasLegacySnippet(content: string): boolean {
	return content.includes(LEGACY_HEADER);
}

function replaceLegacySnippet(content: string, newSection: string): string {
	const headerIdx = content.indexOf(LEGACY_HEADER);
	if (headerIdx === -1) return content;

	const tailIdx = content.indexOf(LEGACY_TAIL, headerIdx);

	let endIdx: number;
	if (tailIdx !== -1) {
		// Find the closing ``` after the tail line
		const afterTail = content.indexOf("```", tailIdx + LEGACY_TAIL.length);
		if (afterTail !== -1) {
			endIdx = afterTail + 3;
			// Consume trailing newlines
			while (endIdx < content.length && content[endIdx] === "\n") {
				endIdx++;
			}
		} else {
			endIdx = content.length;
		}
	} else {
		// Tail not found (user edited the snippet): take from header to EOF
		endIdx = content.length;
	}

	const before = content.substring(0, headerIdx);
	const after = content.substring(endIdx);

	return before + newSection + after;
}

function isSnippetCurrent(content: string): boolean {
	if (!hasMarkerSection(content)) return false;
	return content.includes(VERSION_MARKER);
}

async function findSnippetLocations(cwd: string): Promise<OnboardTarget[]> {
	const candidates = [
		{ fileName: "CLAUDE.md", path: join(cwd, "CLAUDE.md") },
		{ fileName: ".claude/CLAUDE.md", path: join(cwd, ".claude", "CLAUDE.md") },
		{ fileName: "AGENTS.md", path: join(cwd, "AGENTS.md") },
	];

	const results: OnboardTarget[] = [];
	for (const c of candidates) {
		const exists = await fileExists(c.path);
		if (exists) {
			const content = await readFile(c.path, "utf-8");
			if (hasMarkerSection(content) || hasLegacySnippet(content)) {
				results.push({ ...c, exists: true });
			}
		}
	}
	return results;
}

async function resolveTargetFile(cwd: string): Promise<{
	target: OnboardTarget;
	duplicates: OnboardTarget[];
}> {
	const withSnippet = await findSnippetLocations(cwd);

	// If snippet found in one or more locations, use the first; others are duplicates
	const [firstSnippet, ...restSnippets] = withSnippet;
	if (firstSnippet !== undefined) {
		return {
			target: firstSnippet,
			duplicates: restSnippets,
		};
	}

	// No snippet found anywhere. Prefer existing CLAUDE.md, else AGENTS.md
	if (await fileExists(join(cwd, "CLAUDE.md"))) {
		return {
			target: {
				fileName: "CLAUDE.md",
				path: join(cwd, "CLAUDE.md"),
				exists: true,
			},
			duplicates: [],
		};
	}

	// If AGENTS.md already exists (no snippet), append there to respect Codex-style projects.
	// Only create a new file when neither exists — prefer CLAUDE.md over AGENTS.md in that case.
	const agentsExists = await fileExists(join(cwd, "AGENTS.md"));
	if (agentsExists) {
		return {
			target: {
				fileName: "AGENTS.md",
				path: join(cwd, "AGENTS.md"),
				exists: true,
			},
			duplicates: [],
		};
	}

	return {
		target: {
			fileName: "CLAUDE.md",
			path: join(cwd, "CLAUDE.md"),
			exists: false,
		},
		duplicates: [],
	};
}

type OnboardAction =
	| "created"
	| "appended"
	| "updated"
	| "migrated"
	| "up_to_date"
	| "not_installed"
	| "outdated"
	| "legacy";

export async function runOnboard(options: {
	stdout?: boolean;
	provider?: string;
	check?: boolean;
	cwd?: string;
	jsonMode?: boolean;
}): Promise<void> {
	const cwd = options.cwd ?? process.cwd();
	const snippet = getSnippet(options.provider);
	const wrappedSnippet = wrapInMarkers(snippet);

	if (options.stdout) {
		process.stdout.write(wrappedSnippet);
		return;
	}

	const { target, duplicates } = await resolveTargetFile(cwd);

	// --check: read-only inspection
	if (options.check) {
		let action: OnboardAction;

		if (!target.exists) {
			action = "not_installed";
		} else {
			const content = await readFile(target.path, "utf-8");
			if (hasMarkerSection(content)) {
				action = isSnippetCurrent(content) ? "up_to_date" : "outdated";
			} else if (hasLegacySnippet(content)) {
				action = "legacy";
			} else {
				action = "not_installed";
			}
		}

		if (options.jsonMode) {
			outputJson({
				success: true,
				command: "onboard",
				file: target.fileName,
				action,
			});
		} else {
			const messages: Record<string, string> = {
				not_installed: `Mulch snippet is not installed in ${target.fileName}.`,
				up_to_date: `Mulch snippet in ${target.fileName} is up to date.`,
				outdated: `Mulch snippet in ${target.fileName} is outdated. Run \`ml onboard\` to update.`,
				legacy: `Mulch snippet in ${target.fileName} uses legacy format (no markers). Run \`ml onboard\` to migrate.`,
			};
			const colors: Record<string, (s: string) => string> = {
				not_installed: chalk.yellow,
				up_to_date: chalk.green,
				outdated: chalk.yellow,
				legacy: chalk.yellow,
			};
			const colorFn = colors[action] ?? chalk.white;
			const msg = messages[action] ?? action;
			console.log(colorFn(msg));
		}

		if (duplicates.length > 0) {
			const names = duplicates.map((d) => d.fileName).join(", ");
			if (!options.jsonMode) {
				console.log(chalk.yellow(`Warning: mulch snippet also found in: ${names}`));
			}
		}
		return;
	}

	// Write path
	let action: OnboardAction;

	if (!target.exists) {
		// Create new file
		await mkdir(dirname(target.path), { recursive: true });
		await writeFile(target.path, `${wrappedSnippet}\n`, "utf-8");
		action = "created";
	} else {
		const content = await readFile(target.path, "utf-8");

		if (hasMarkerSection(content)) {
			// Check if current
			if (isSnippetCurrent(content)) {
				action = "up_to_date";
			} else {
				// Replace marker section
				const updated = replaceMarkerSection(content, wrappedSnippet);
				if (updated !== null) {
					await writeFile(target.path, updated, "utf-8");
				}
				action = "updated";
			}
		} else if (hasLegacySnippet(content)) {
			// Migrate legacy snippet
			const migrated = replaceLegacySnippet(content, `${wrappedSnippet}\n`);
			await writeFile(target.path, migrated, "utf-8");
			action = "migrated";
		} else {
			// Append to existing file
			await writeFile(target.path, `${content.trimEnd()}\n\n${wrappedSnippet}\n`, "utf-8");
			action = "appended";
		}
	}

	if (options.jsonMode) {
		outputJson({
			success: true,
			command: "onboard",
			file: target.fileName,
			action,
		});
	} else {
		const messages: Record<string, string> = {
			created: `Mulch onboarding snippet written to ${target.fileName}.`,
			appended: `Mulch onboarding snippet appended to ${target.fileName}.`,
			updated: `Mulch onboarding snippet updated in ${target.fileName}.`,
			migrated: `Mulch onboarding snippet migrated to marker format in ${target.fileName}.`,
			up_to_date: `Mulch snippet in ${target.fileName} is already up to date. No changes made.`,
		};
		const color = action === "up_to_date" ? chalk.yellow : chalk.green;
		console.log(color(messages[action]));
	}

	if (duplicates.length > 0) {
		const names = duplicates.map((d) => d.fileName).join(", ");
		if (!options.jsonMode) {
			console.log(chalk.yellow(`Warning: mulch snippet also found in: ${names}`));
		}
	}
}

export function registerOnboardCommand(program: Command): void {
	program
		.command("onboard")
		.description("Generate or update a CLAUDE.md/AGENTS.md snippet pointing to ml prime")
		.option("--stdout", "print snippet to stdout instead of writing to file")
		.option("--provider <provider>", "customize snippet for a specific provider (e.g. claude)")
		.option("--check", "check if onboarding snippet is installed and up to date")
		.action(async (options: { stdout?: boolean; provider?: string; check?: boolean }) => {
			const jsonMode = program.opts().json === true;
			try {
				await runOnboard({ ...options, jsonMode });
			} catch (err) {
				if (jsonMode) {
					outputJsonError("onboard", (err as Error).message);
				} else {
					console.error(`Error: ${(err as Error).message}`);
				}
				process.exitCode = 1;
			}
		});
}
