import { existsSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { getExpertisePath, getMulchDir, readConfig, writeConfig } from "../utils/config.ts";
import { createExpertiseFile } from "../utils/expertise.ts";
import { outputJson, reportCommandError } from "../utils/json-output.ts";
import { isQuiet } from "../utils/palette.ts";

export function registerAddCommand(program: Command): void {
	program
		.command("add")
		.argument("<domain>", "expertise domain to add")
		.description("Add a new expertise domain")
		.action(async (domain: string) => {
			const jsonMode = program.opts().json === true;
			const mulchDir = getMulchDir();

			if (!existsSync(mulchDir)) {
				reportCommandError("add", jsonMode, "No .mulch/ directory found. Run `mulch init` first.");
				return;
			}

			const config = await readConfig();

			if (domain in config.domains) {
				reportCommandError("add", jsonMode, `Domain "${domain}" already exists.`);
				return;
			}

			const expertisePath = getExpertisePath(domain);
			await createExpertiseFile(expertisePath);

			config.domains[domain] = {};
			await writeConfig(config);

			if (jsonMode) {
				outputJson({ success: true, command: "add", domain });
			} else if (!isQuiet()) {
				console.log(chalk.green(`Added domain "${domain}".`));
			}
		});
}
