import chalk from "chalk";

// Mulch brand color: brown / soil
export const brand = chalk.rgb(139, 90, 43);

// Shared semantic colors
export const accent = chalk.rgb(255, 183, 77); // amber — IDs, references
export const muted = chalk.rgb(120, 120, 110); // stone gray — metadata

// Status icons (Set D — minimal, maximum terminal compatibility)
export const icons = {
  pass: brand("✓"), // success / pass
  warn: chalk.yellow("!"), // warning / blocked
  fail: chalk.red("✗"), // error / fail
  open: brand("-"), // open / pending
  active: chalk.cyan(">"), // in_progress / active
  done: chalk.dim("x"), // closed / done
} as const;

// Quiet mode state
let _quiet = false;

export function setQuiet(v: boolean): void {
  _quiet = v;
}

export function isQuiet(): boolean {
  return _quiet;
}

// Message formatters — mirroring visual-spec.md patterns
export function printSuccess(msg: string): void {
  if (_quiet) return;
  console.log(`${icons.pass} ${brand(msg)}`);
}

export function printError(msg: string): void {
  console.error(`${icons.fail} ${chalk.red(msg)}`);
}

export function printWarning(msg: string): void {
  if (_quiet) return;
  console.log(`${icons.warn} ${chalk.yellow(msg)}`);
}
