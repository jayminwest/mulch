import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { confirmAction } from "../../src/utils/prompt.ts";

async function answer(text: string): Promise<{ confirmed: boolean; written: string }> {
	const input = new PassThrough();
	const output = new PassThrough();
	let written = "";
	output.on("data", (chunk: Buffer) => {
		written += chunk.toString();
	});
	const pending = confirmAction("Proceed?", { input, output });
	input.write(`${text}\n`);
	input.end();
	const confirmed = await pending;
	return { confirmed, written };
}

describe("confirmAction", () => {
	it("renders the prompt with a (y/N) suffix", async () => {
		const { written } = await answer("y");
		expect(written).toContain("Proceed? (y/N): ");
	});

	it("accepts y and yes in any case", async () => {
		expect((await answer("y")).confirmed).toBe(true);
		expect((await answer("Y")).confirmed).toBe(true);
		expect((await answer("yes")).confirmed).toBe(true);
		expect((await answer("YES")).confirmed).toBe(true);
	});

	it("treats anything else, including empty input, as a decline", async () => {
		expect((await answer("")).confirmed).toBe(false);
		expect((await answer("n")).confirmed).toBe(false);
		expect((await answer("yep")).confirmed).toBe(false);
	});
});
