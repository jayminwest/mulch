import type { Command } from "commander";
import { configSchema } from "../schemas/config-schema.ts";

export function registerConfigCommand(program: Command): void {
	const config = program.command("config").description("Read and write .mulch/mulch.config.yaml");

	config
		.command("schema")
		.description("Emit MulchConfig JSON Schema for warren and other config-UI consumers")
		.action(() => {
			process.stdout.write(`${JSON.stringify(configSchema, null, 2)}\n`);
		});
}
