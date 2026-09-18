import { createInterface } from "node:readline";

interface PromptStreams {
	input: NodeJS.ReadableStream;
	output: NodeJS.WritableStream;
}

/** Ask a yes/no question on the terminal; only `y` / `yes` (any case) confirms. */
export function confirmAction(
	prompt: string,
	streams: PromptStreams = { input: process.stdin, output: process.stdout },
): Promise<boolean> {
	const rl = createInterface({ input: streams.input, output: streams.output });
	return new Promise((resolve) => {
		rl.question(`${prompt} (y/N): `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}
