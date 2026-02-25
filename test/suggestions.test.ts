import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../src/cli.ts");

async function run(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("typo suggestions", () => {
  test("misspelled 'recor' suggests 'record'", async () => {
    const { stderr, exitCode } = await run(["recor"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Did you mean 'record'?");
  });

  test("misspelled 'serch' suggests 'search'", async () => {
    const { stderr, exitCode } = await run(["serch"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Did you mean 'search'?");
  });

  test("completely unrelated string does not suggest", async () => {
    const { stderr, exitCode } = await run(["zzzznotacommand"]);
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("Did you mean");
  });

  test("unknown command shows help hint", async () => {
    const { stderr, exitCode } = await run(["zzzznotacommand"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Run 'mulch --help' for usage.");
  });

  test("--json mode outputs structured error", async () => {
    const { stderr, exitCode } = await run(["recor", "--json"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr);
    expect(parsed.success).toBe(false);
    expect(parsed.command).toBe("recor");
    expect(parsed.error).toContain("Unknown command: recor");
    expect(parsed.error).toContain("Did you mean 'record'?");
  });

  test("--json mode with no suggestion", async () => {
    const { stderr, exitCode } = await run(["zzzznotacommand", "--json"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stderr);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("Unknown command: zzzznotacommand");
    expect(parsed.error).not.toContain("Did you mean");
  });
});
