import chalk from "chalk";

export interface JsonResult {
	success: boolean;
	command: string;
	[key: string]: unknown;
}

export function outputJson(result: JsonResult): void {
	console.log(JSON.stringify(result, null, 2));
}

export function outputJsonError(command: string, error: string): void {
	console.error(JSON.stringify({ success: false, command, error }, null, 2));
}

const NO_MULCH_DIR_MESSAGE = "No .mulch/ directory found. Run `mulch init` first.";

/**
 * Report a command failure in JSON or text mode and set a non-zero exit code.
 * A missing `.mulch/` directory (ENOENT) is reported with the standard init hint.
 */
export function reportCommandError(command: string, jsonMode: boolean, err: unknown): void {
	const message =
		(err as NodeJS.ErrnoException | null)?.code === "ENOENT"
			? NO_MULCH_DIR_MESSAGE
			: err instanceof Error
				? err.message
				: String(err);
	if (jsonMode) {
		outputJsonError(command, message);
	} else {
		console.error(chalk.red(`Error: ${message}`));
	}
	process.exitCode = 1;
}
