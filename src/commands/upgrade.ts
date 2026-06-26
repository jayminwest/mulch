import type { Command } from "commander";
import { outputJson } from "../utils/json-output.ts";
import { printError, printSuccess, printWarning } from "../utils/palette.ts";
import { compareSemver, getCurrentVersion, getLatestVersion } from "../utils/version.ts";

const PACKAGE_NAME = "@os-eco/mulch-cli";

export function registerUpgradeCommand(program: Command): void {
	program
		.command("upgrade")
		.description("Upgrade mulch to the latest version")
		.option("--check", "Check for updates without installing")
		.action(async (options: { check?: boolean }) => {
			const jsonMode = program.opts().json === true;

			const latest = getLatestVersion();
			if (latest === null) {
				if (jsonMode) {
					outputJson({
						success: false,
						command: "upgrade",
						error: "Unable to reach npm registry. Check your internet connection.",
					});
				} else {
					printError("Failed to check for updates: Unable to reach npm registry");
				}
				process.exitCode = 1;
				return;
			}

			const current = getCurrentVersion();
			const upToDate = compareSemver(current, latest) >= 0;

			if (upToDate) {
				if (jsonMode) {
					outputJson({
						success: true,
						command: "upgrade",
						current,
						latest,
						up_to_date: true,
						updated: false,
					});
				} else {
					printSuccess(`mulch is up to date (v${current})`);
				}
				return;
			}

			if (options.check) {
				if (jsonMode) {
					outputJson({
						success: true,
						command: "upgrade",
						current,
						latest,
						up_to_date: false,
						updated: false,
					});
				} else {
					printWarning(`Update available: v${current} → v${latest}`);
				}
				return;
			}

			const result = Bun.spawnSync(["bun", "install", "-g", `${PACKAGE_NAME}@latest`], {
				stdout: jsonMode ? "pipe" : "inherit",
				stderr: jsonMode ? "pipe" : "inherit",
			});

			if (result.exitCode !== 0) {
				if (jsonMode) {
					outputJson({
						success: false,
						command: "upgrade",
						error: `bun install failed with exit code ${result.exitCode}`,
					});
				} else {
					printError(`Failed to upgrade: bun install failed with exit code ${result.exitCode}`);
				}
				process.exitCode = 1;
				return;
			}

			if (jsonMode) {
				outputJson({
					success: true,
					command: "upgrade",
					current,
					latest,
					up_to_date: false,
					updated: true,
				});
			} else {
				printSuccess(`Updated mulch v${current} → v${latest}`);
			}
		});
}
