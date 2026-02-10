import { Command } from "commander";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .argument("<provider>", "agent provider to set up")
    .description("Set up mulch for a specific agent provider")
    .action(async (provider: string) => {
      console.log("TODO: implement setup");
    });
}
