import type { Command } from "commander";
import { printError } from "../utils/palette.ts";

const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SUPPORTED_SHELLS)[number];

function getVisibleCommands(program: Command): string[] {
  const helper = program.createHelp();
  return helper.visibleCommands(program).map((cmd) => cmd.name());
}

function getGlobalOptions(program: Command): string[] {
  return program.options.map((opt) => opt.long).filter(Boolean) as string[];
}

function generateBash(commands: string[], globalOptions: string[]): string {
  const allWords = [...commands, ...globalOptions].join(" ");
  return `# mulch bash completions
# Add to ~/.bashrc: eval "$(mulch completions bash)"
_mulch() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=( $(compgen -W "${allWords}" -- "\$cur") )
}
complete -F _mulch mulch
complete -F _mulch ml
`;
}

function generateZsh(commands: string[], globalOptions: string[]): string {
  const allWords = [...commands, ...globalOptions].join(" ");
  return `# mulch zsh completions
# Add to ~/.zshrc: eval "$(mulch completions zsh)"
_mulch() {
  local -a words
  words=(${allWords})
  _describe 'mulch commands' words
}
compdef _mulch mulch
compdef _mulch ml
`;
}

function generateFish(commands: string[], _globalOptions: string[]): string {
  const lines = [
    "# mulch fish completions",
    "# Save to ~/.config/fish/completions/mulch.fish",
    "",
  ];
  for (const cmd of commands) {
    lines.push(
      `complete -c mulch -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} command'`,
    );
    lines.push(
      `complete -c ml -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} command'`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function registerCompletionsCommand(program: Command): void {
  program
    .command("completions <shell>")
    .description("Output shell completion script (bash, zsh, fish)")
    .action((shell: string) => {
      const s = shell.toLowerCase();
      if (!SUPPORTED_SHELLS.includes(s as Shell)) {
        printError(
          `Unsupported shell: "${shell}". Supported: ${SUPPORTED_SHELLS.join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }

      const commands = getVisibleCommands(program);
      const globalOptions = getGlobalOptions(program);

      switch (s as Shell) {
        case "bash":
          process.stdout.write(generateBash(commands, globalOptions));
          break;
        case "zsh":
          process.stdout.write(generateZsh(commands, globalOptions));
          break;
        case "fish":
          process.stdout.write(generateFish(commands, globalOptions));
          break;
      }
    });
}
