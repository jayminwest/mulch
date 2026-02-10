import { Command } from "commander";

export function registerPruneCommand(program: Command): void {
  program
    .command("prune")
    .description("Remove outdated or low-value expertise records")
    .action(async () => {
      console.log("TODO: implement prune");
    });
}
