import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MulchConfig } from "../schemas/config.ts";
import { DEFAULT_CONFIG } from "../schemas/config.ts";
import { createExpertiseFile } from "./expertise.ts";

const MULCH_DIR = ".mulch";
const CONFIG_FILE = "mulch.config.yaml";
const EXPERTISE_DIR = "expertise";

export const GITATTRIBUTES_LINE = ".mulch/expertise/*.jsonl merge=union";

export const MULCH_README = `# .mulch/

This directory is managed by [mulch](https://github.com/jayminwest/mulch) — a structured expertise layer for coding agents.

## Key Commands

- \`mulch init\`      — Initialize a .mulch directory
- \`mulch add\`       — Add a new domain
- \`mulch record\`    — Record an expertise record
- \`mulch edit\`      — Edit an existing record
- \`mulch query\`     — Query expertise records
- \`mulch prime [domain]\` — Output a priming prompt (optionally scoped to one domain)
- \`mulch search\`   — Search records across domains
- \`mulch status\`    — Show domain statistics
- \`mulch validate\`  — Validate all records against the schema
- \`mulch prune\`     — Remove expired records

## Structure

- \`mulch.config.yaml\` — Configuration file
- \`expertise/\`        — JSONL files, one per domain
`;

export function getMulchDir(cwd: string = process.cwd()): string {
  return join(cwd, MULCH_DIR);
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return join(getMulchDir(cwd), CONFIG_FILE);
}

export function getExpertiseDir(cwd: string = process.cwd()): string {
  return join(getMulchDir(cwd), EXPERTISE_DIR);
}

export function validateDomainName(domain: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(domain)) {
    throw new Error(
      `Invalid domain name: "${domain}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
    );
  }
}

export function getExpertisePath(
  domain: string,
  cwd: string = process.cwd(),
): string {
  validateDomainName(domain);
  return join(getExpertiseDir(cwd), `${domain}.jsonl`);
}

export async function readConfig(
  cwd: string = process.cwd(),
): Promise<MulchConfig> {
  const configPath = getConfigPath(cwd);
  let content: string;
  try {
    content = await readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "No .mulch/ directory found. Run `mulch init` to set up this project.",
      );
    }
    throw err;
  }
  return yaml.load(content) as MulchConfig;
}

export async function addDomain(
  domain: string,
  cwd: string = process.cwd(),
): Promise<void> {
  validateDomainName(domain);
  const config = await readConfig(cwd);
  if (!config.domains.includes(domain)) {
    config.domains.push(domain);
    await writeConfig(config, cwd);
  }
  const filePath = getExpertisePath(domain, cwd);
  if (!existsSync(filePath)) {
    await createExpertiseFile(filePath);
  }
}

export async function writeConfig(
  config: MulchConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const configPath = getConfigPath(cwd);
  const content = yaml.dump(config, { lineWidth: -1 });
  await writeFile(configPath, content, "utf-8");
}

export async function initMulchDir(cwd: string = process.cwd()): Promise<void> {
  const mulchDir = getMulchDir(cwd);
  const expertiseDir = getExpertiseDir(cwd);
  await mkdir(mulchDir, { recursive: true });
  await mkdir(expertiseDir, { recursive: true });

  // Only write default config if none exists — preserve user customizations
  const configPath = getConfigPath(cwd);
  if (!existsSync(configPath)) {
    await writeConfig({ ...DEFAULT_CONFIG }, cwd);
  }

  // Create or append .gitattributes with merge=union for JSONL files
  const gitattributesPath = join(cwd, ".gitattributes");
  let existing = "";
  try {
    existing = await readFile(gitattributesPath, "utf-8");
  } catch {
    // File doesn't exist yet — will create it
  }
  if (!existing.includes(GITATTRIBUTES_LINE)) {
    const separator =
      existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(
      gitattributesPath,
      `${existing + separator + GITATTRIBUTES_LINE}\n`,
      "utf-8",
    );
  }

  // Create .mulch/README.md if missing
  const readmePath = join(mulchDir, "README.md");
  if (!existsSync(readmePath)) {
    await writeFile(readmePath, MULCH_README, "utf-8");
  }
}
