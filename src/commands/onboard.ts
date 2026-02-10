import { Command } from "commander";

export function registerOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description("Interactive onboarding to capture existing expertise")
    .action(async () => {
      console.log("TODO: implement onboard");
    });
}
