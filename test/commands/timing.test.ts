import { describe, expect, it } from "bun:test";

describe("--timing flag", () => {
  it("prints 'Done in' on stderr for normal commands", () => {
    const result = Bun.spawnSync(
      ["bun", "src/cli.ts", "--timing", "completions", "bash"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stderr = result.stderr.toString();
    expect(stderr).toContain("Done in");
    expect(stderr).toMatch(/Done in \d+ms/);
  });

  it("does not pollute stdout with timing info", () => {
    const result = Bun.spawnSync(
      ["bun", "src/cli.ts", "--timing", "completions", "bash"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = result.stdout.toString();
    expect(stdout).not.toContain("Done in");
    // stdout should still contain actual command output
    expect(stdout).toContain("mulch");
  });

  it("does not print timing without --timing flag", () => {
    const result = Bun.spawnSync(["bun", "src/cli.ts", "completions", "bash"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = result.stderr.toString();
    expect(stderr).not.toContain("Done in");
  });
});
