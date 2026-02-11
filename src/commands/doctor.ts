import { existsSync } from "node:fs";
import { readFile, readdir, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import _Ajv from "ajv";
const Ajv = _Ajv.default ?? _Ajv;
import chalk from "chalk";
import { readConfig, getExpertisePath, getExpertiseDir, getMulchDir, writeConfig } from "../utils/config.js";
import {
  readExpertiseFile,
  writeExpertiseFile,
  findDuplicate,
  createExpertiseFile,
} from "../utils/expertise.js";
import { isStale } from "./prune.js";
import { recordSchema } from "../schemas/record-schema.js";
import type { MulchConfig } from "../schemas/config.js";
import type { ExpertiseRecord } from "../schemas/record.js";
import { outputJson, outputJsonError } from "../utils/json-output.js";
import { getCurrentVersion, getLatestVersion, compareSemver } from "../utils/version.js";

interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fixable: boolean;
  details: string[];
}

async function checkConfig(cwd?: string): Promise<DoctorCheck> {
  try {
    const mulchDir = getMulchDir(cwd);
    if (!existsSync(mulchDir)) {
      return { name: "config", status: "fail", message: "No .mulch/ directory found", fixable: false, details: [] };
    }
    await readConfig(cwd);
    return { name: "config", status: "pass", message: "Config is valid", fixable: false, details: [] };
  } catch (err) {
    return { name: "config", status: "fail", message: `Config error: ${(err as Error).message}`, fixable: false, details: [] };
  }
}

async function checkJsonlIntegrity(config: MulchConfig, cwd?: string): Promise<DoctorCheck> {
  const details: string[] = [];
  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      try {
        JSON.parse(line);
      } catch {
        details.push(`${domain}:${i + 1} - Invalid JSON`);
      }
    }
  }
  if (details.length > 0) {
    return { name: "jsonl-integrity", status: "fail", message: `${details.length} invalid JSON line(s) found`, fixable: true, details };
  }
  return { name: "jsonl-integrity", status: "pass", message: "All JSONL lines are valid JSON", fixable: true, details: [] };
}

async function checkSchemaValidation(config: MulchConfig, cwd?: string): Promise<DoctorCheck> {
  const ajv = new Ajv();
  const validate = ajv.compile(recordSchema);
  const details: string[] = [];

  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // Already caught by integrity check
      }
      if (!validate(parsed)) {
        const errors = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
        details.push(`${domain}:${i + 1} - ${errors}`);
      }
    }
  }
  if (details.length > 0) {
    return { name: "schema-validation", status: "fail", message: `${details.length} record(s) failed schema validation`, fixable: true, details };
  }
  return { name: "schema-validation", status: "pass", message: "All records pass schema validation", fixable: true, details: [] };
}

async function checkStaleRecords(config: MulchConfig, cwd?: string): Promise<DoctorCheck> {
  const now = new Date();
  const shelfLife = config.classification_defaults.shelf_life;
  const details: string[] = [];
  let staleCount = 0;

  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    const records = await readExpertiseFile(filePath);
    for (const record of records) {
      if (isStale(record, now, shelfLife)) {
        staleCount++;
        details.push(`${domain}: stale ${record.type} (${record.classification})`);
      }
    }
  }
  if (staleCount > 0) {
    return { name: "stale-records", status: "warn", message: `${staleCount} stale record(s) found`, fixable: true, details };
  }
  return { name: "stale-records", status: "pass", message: "No stale records", fixable: true, details: [] };
}

async function checkOrphanedDomains(config: MulchConfig, cwd?: string): Promise<DoctorCheck> {
  const expertiseDir = getExpertiseDir(cwd);
  const details: string[] = [];

  // Check for JSONL files not in config
  try {
    const files = await readdir(expertiseDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const domain = file.replace(".jsonl", "");
        if (!config.domains.includes(domain)) {
          details.push(`File "${file}" exists but domain "${domain}" is not in config`);
        }
      }
    }
  } catch {
    // expertise dir doesn't exist
  }

  // Check for config domains without JSONL files
  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    if (!existsSync(filePath)) {
      details.push(`Domain "${domain}" in config but no JSONL file exists`);
    }
  }

  if (details.length > 0) {
    return { name: "orphaned-domains", status: "warn", message: `${details.length} orphaned domain issue(s)`, fixable: true, details };
  }
  return { name: "orphaned-domains", status: "pass", message: "No orphaned domains", fixable: true, details: [] };
}

async function checkDuplicates(config: MulchConfig, cwd?: string): Promise<DoctorCheck> {
  const details: string[] = [];
  let dupCount = 0;

  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    const records = await readExpertiseFile(filePath);
    for (let i = 1; i < records.length; i++) {
      const dup = findDuplicate(records.slice(0, i), records[i]);
      if (dup) {
        dupCount++;
        details.push(`${domain}: duplicate ${records[i].type} at index ${i + 1} (matches #${dup.index + 1})`);
      }
    }
  }
  if (dupCount > 0) {
    return { name: "duplicates", status: "warn", message: `${dupCount} duplicate record(s) found`, fixable: false, details };
  }
  return { name: "duplicates", status: "pass", message: "No duplicates", fixable: false, details: [] };
}

async function checkGovernance(config: MulchConfig, cwd?: string): Promise<DoctorCheck> {
  const details: string[] = [];
  let worstStatus: "pass" | "warn" | "fail" = "pass";

  for (const domain of config.domains) {
    const filePath = getExpertisePath(domain, cwd);
    const records = await readExpertiseFile(filePath);
    const count = records.length;

    if (count >= config.governance.hard_limit) {
      details.push(`${domain}: ${count} records (over hard limit of ${config.governance.hard_limit})`);
      worstStatus = "fail";
    } else if (count >= config.governance.warn_entries) {
      details.push(`${domain}: ${count} records (over warn threshold of ${config.governance.warn_entries})`);
      if (worstStatus !== "fail") worstStatus = "warn";
    } else if (count >= config.governance.max_entries) {
      details.push(`${domain}: ${count} records (approaching limit of ${config.governance.max_entries})`);
      if (worstStatus !== "fail") worstStatus = "warn";
    }
  }

  if (details.length > 0) {
    return { name: "governance", status: worstStatus, message: `${details.length} domain(s) over governance thresholds`, fixable: false, details };
  }
  return { name: "governance", status: "pass", message: "All domains within governance limits", fixable: false, details: [] };
}

async function checkUpdateAvailable(): Promise<DoctorCheck> {
  const current = getCurrentVersion();
  const latest = getLatestVersion();

  if (latest === null) {
    return { name: "update", status: "pass", message: `Version ${current} (unable to check registry)`, fixable: false, details: [] };
  }

  const cmp = compareSemver(current, latest);
  if (cmp >= 0) {
    return { name: "update", status: "pass", message: `Version ${current} is up to date`, fixable: false, details: [] };
  }

  return { name: "update", status: "warn", message: `Update available: ${current} → ${latest}`, fixable: false, details: [`Run \`mulch update\` to update`] };
}

async function applyFixes(checks: DoctorCheck[], config: MulchConfig, cwd?: string): Promise<string[]> {
  const fixed: string[] = [];

  for (const check of checks) {
    if (check.status === "pass" || !check.fixable) continue;

    switch (check.name) {
      case "jsonl-integrity": {
        // Remove invalid JSON lines
        for (const domain of config.domains) {
          const filePath = getExpertisePath(domain, cwd);
          let content: string;
          try {
            content = await readFile(filePath, "utf-8");
          } catch {
            continue;
          }
          const lines = content.split("\n");
          const valid: string[] = [];
          let removed = 0;
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            try {
              JSON.parse(trimmed);
              valid.push(trimmed);
            } catch {
              removed++;
            }
          }
          if (removed > 0) {
            await fsWriteFile(filePath, valid.map((l) => l).join("\n") + (valid.length > 0 ? "\n" : ""), "utf-8");
            fixed.push(`Removed ${removed} invalid JSON line(s) from ${domain}`);
          }
        }
        break;
      }

      case "schema-validation": {
        const ajv = new Ajv();
        const validate = ajv.compile(recordSchema);
        for (const domain of config.domains) {
          const filePath = getExpertisePath(domain, cwd);
          const records = await readExpertiseFile(filePath);
          const valid = records.filter((r) => validate(r));
          const removed = records.length - valid.length;
          if (removed > 0) {
            await writeExpertiseFile(filePath, valid);
            fixed.push(`Removed ${removed} invalid record(s) from ${domain}`);
          }
        }
        break;
      }

      case "stale-records": {
        const now = new Date();
        const shelfLife = config.classification_defaults.shelf_life;
        for (const domain of config.domains) {
          const filePath = getExpertisePath(domain, cwd);
          const records = await readExpertiseFile(filePath);
          const kept = records.filter((r) => !isStale(r, now, shelfLife));
          const pruned = records.length - kept.length;
          if (pruned > 0) {
            await writeExpertiseFile(filePath, kept);
            fixed.push(`Pruned ${pruned} stale record(s) from ${domain}`);
          }
        }
        break;
      }

      case "orphaned-domains": {
        const expertiseDir = getExpertiseDir(cwd);
        // Add missing domains to config
        try {
          const files = await readdir(expertiseDir);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const domain = file.replace(".jsonl", "");
              if (!config.domains.includes(domain)) {
                config.domains.push(domain);
                fixed.push(`Added orphaned domain "${domain}" to config`);
              }
            }
          }
        } catch {
          // expertise dir doesn't exist
        }
        // Create missing JSONL files
        for (const domain of config.domains) {
          const filePath = getExpertisePath(domain, cwd);
          if (!existsSync(filePath)) {
            await createExpertiseFile(filePath);
            fixed.push(`Created missing JSONL file for domain "${domain}"`);
          }
        }
        if (fixed.length > 0) {
          await writeConfig(config, cwd);
        }
        break;
      }
    }
  }

  return fixed;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run health checks on expertise records")
    .option("--fix", "auto-fix fixable issues")
    .action(async (options: { fix?: boolean }) => {
      const jsonMode = program.opts().json === true;

      // Check config first — if it fails, we can't run other checks
      const configCheck = await checkConfig();
      if (configCheck.status === "fail") {
        const checks = [configCheck];
        const summary = { pass: 0, warn: 0, fail: 1 };
        if (jsonMode) {
          outputJson({ success: false, command: "doctor", checks, summary });
        } else {
          console.log("Mulch Doctor");
          console.log(chalk.red(`  ✘ ${configCheck.message}`));
          console.log(`\n0 passed, 0 warnings, 1 failed`);
        }
        process.exitCode = 1;
        return;
      }

      const config = await readConfig();

      const checks: DoctorCheck[] = [configCheck];
      checks.push(await checkJsonlIntegrity(config));
      checks.push(await checkSchemaValidation(config));
      checks.push(await checkStaleRecords(config));
      checks.push(await checkOrphanedDomains(config));
      checks.push(await checkDuplicates(config));
      checks.push(await checkGovernance(config));
      checks.push(await checkUpdateAvailable());

      const summary = {
        pass: checks.filter((c) => c.status === "pass").length,
        warn: checks.filter((c) => c.status === "warn").length,
        fail: checks.filter((c) => c.status === "fail").length,
      };

      let fixed: string[] = [];
      if (options.fix) {
        fixed = await applyFixes(checks, config);
      }

      if (jsonMode) {
        outputJson({
          success: summary.fail === 0,
          command: "doctor",
          checks,
          summary,
          ...(options.fix && { fixed }),
        });
      } else {
        console.log("Mulch Doctor");
        for (const check of checks) {
          const icon = check.status === "pass"
            ? chalk.green("✔")
            : check.status === "warn"
              ? chalk.yellow("⚠")
              : chalk.red("✘");
          const msg = check.status === "pass"
            ? check.message
            : `${check.message}`;
          console.log(`  ${icon} ${msg}`);
        }
        console.log(`\n${summary.pass} passed, ${summary.warn} warning(s), ${summary.fail} failed`);

        if (fixed.length > 0) {
          console.log(`\n${chalk.green("Fixed:")}`);
          for (const f of fixed) {
            console.log(`  ${chalk.green("✔")} ${f}`);
          }
        }
      }

      if (summary.fail > 0) {
        process.exitCode = 1;
      }
    });
}
