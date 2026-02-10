import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type { MulchConfig } from "../schemas/config.js";
import { DEFAULT_CONFIG } from "../schemas/config.js";

const MULCH_DIR = ".mulch";
const CONFIG_FILE = "mulch.config.yaml";
const EXPERTISE_DIR = "expertise";

export function getMulchDir(cwd: string = process.cwd()): string {
  return join(cwd, MULCH_DIR);
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return join(getMulchDir(cwd), CONFIG_FILE);
}

export function getExpertiseDir(cwd: string = process.cwd()): string {
  return join(getMulchDir(cwd), EXPERTISE_DIR);
}

export function getExpertisePath(
  domain: string,
  cwd: string = process.cwd(),
): string {
  return join(getExpertiseDir(cwd), `${domain}.jsonl`);
}

export async function readConfig(
  cwd: string = process.cwd(),
): Promise<MulchConfig> {
  const configPath = getConfigPath(cwd);
  const content = await readFile(configPath, "utf-8");
  return yaml.load(content) as MulchConfig;
}

export async function writeConfig(
  config: MulchConfig,
  cwd: string = process.cwd(),
): Promise<void> {
  const configPath = getConfigPath(cwd);
  const content = yaml.dump(config, { lineWidth: -1 });
  await writeFile(configPath, content, "utf-8");
}

export async function initMulchDir(
  cwd: string = process.cwd(),
): Promise<void> {
  const mulchDir = getMulchDir(cwd);
  const expertiseDir = getExpertiseDir(cwd);
  await mkdir(mulchDir, { recursive: true });
  await mkdir(expertiseDir, { recursive: true });
  await writeConfig({ ...DEFAULT_CONFIG }, cwd);
}
