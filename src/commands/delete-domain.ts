import { createInterface } from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { getExpertisePath, readConfig, removeDomain } from "../utils/config.ts";
import { readExpertiseFile } from "../utils/expertise.ts";
import { outputJson, outputJsonError } from "../utils/json-output.ts";
import { withFileLock } from "../utils/lock.ts";
import { accent, brand, isQuiet } from "../utils/palette.ts";

async function confirmAction(prompt: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`${prompt} (y/N): `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

export function registerDeleteDomainCommand(program: Command): void {
	program
		.command("delete-domain")
		.argument("<domain>", "expertise domain to delete")
		.description("Delete an expertise domain and its expertise file")
		.option("--yes", "skip confirmation prompt")
		.option("--dry-run", "preview what would be deleted without making changes", false)
		.action(async (domain: string, options: { yes?: boolean; dryRun: boolean }) => {
			const jsonMode = program.opts().json === true;

			try {
				const config = await readConfig();

				if (!config.domains.includes(domain)) {
					if (jsonMode) {
						outputJsonError(
							"delete-domain",
							`Domain "${domain}" not found in config. Available domains: ${config.domains.join(", ") || "(none)"}`,
						);
					} else {
						console.error(chalk.red(`Error: domain "${domain}" not found in config.`));
						console.error(
							chalk.red(
								`Hint: Run \`mulch add ${domain}\` to create it, or check \`mulch status\` for existing domains.`,
							),
						);
					}
					process.exitCode = 1;
					return;
				}

				const filePath = getExpertisePath(domain);
				const records = await readExpertiseFile(filePath);
				const recordCount = records.length;

				if (options.dryRun) {
					if (jsonMode) {
						outputJson({
							success: true,
							command: "delete-domain",
							domain,
							dryRun: true,
							recordCount,
						});
					} else {
						if (!isQuiet()) {
							console.log(
								`${chalk.yellow("[DRY RUN]")} Would delete domain ${accent(domain)} (${recordCount} record${recordCount === 1 ? "" : "s"}) and its expertise file.`,
							);
						}
					}
					return;
				}

				// Confirmation (skip in JSON mode or when --yes is passed)
				if (!jsonMode && !options.yes) {
					const confirmed = await confirmAction(
						`This will delete domain "${domain}" (${recordCount} record${recordCount === 1 ? "" : "s"}) and its expertise file. Continue?`,
					);
					if (!confirmed) {
						console.log(chalk.yellow("Cancelled."));
						return;
					}
				}

				await withFileLock(filePath, async () => {
					await removeDomain(domain, process.cwd());
				});

				if (jsonMode) {
					outputJson({
						success: true,
						command: "delete-domain",
						domain,
						deletedFile: true,
						recordCount,
					});
				} else {
					if (!isQuiet()) {
						console.log(
							`${brand("✓")} ${brand("Removed domain")} ${accent(domain)} and deleted expertise file.`,
						);
					}
				}
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					if (jsonMode) {
						outputJsonError("delete-domain", "No .mulch/ directory found. Run `mulch init` first.");
					} else {
						console.error(chalk.red("Error: No .mulch/ directory found. Run `mulch init` first."));
					}
				} else {
					if (jsonMode) {
						outputJsonError("delete-domain", (err as Error).message);
					} else {
						console.error(chalk.red(`Error: ${(err as Error).message}`));
					}
				}
				process.exitCode = 1;
			}
		});
}
