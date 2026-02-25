import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

describe("completions command", () => {
  it("outputs bash completion script", () => {
    const result = execSync("bun src/cli.ts completions bash", {
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(result).toContain("complete");
    expect(result).toContain("mulch");
    expect(result).toContain("record");
    expect(result).toContain("prime");
  });

  it("outputs zsh completion script", () => {
    const result = execSync("bun src/cli.ts completions zsh", {
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(result).toContain("compdef");
    expect(result).toContain("mulch");
    expect(result).toContain("record");
    expect(result).toContain("prime");
  });

  it("outputs fish completion script", () => {
    const result = execSync("bun src/cli.ts completions fish", {
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(result).toContain("complete -c mulch");
    expect(result).toContain("record");
    expect(result).toContain("prime");
  });

  it("includes ml alias in bash completions", () => {
    const result = execSync("bun src/cli.ts completions bash", {
      encoding: "utf-8",
      timeout: 15000,
    });
    expect(result).toContain("ml");
  });

  it("errors on unsupported shell", () => {
    const result = Bun.spawnSync(
      ["bun", "src/cli.ts", "completions", "powershell"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("Unsupported shell");
  });

  it("does not include hidden commands (update)", () => {
    const result = execSync("bun src/cli.ts completions bash", {
      encoding: "utf-8",
      timeout: 15000,
    });
    // update is hidden, upgrade should be present
    expect(result).toContain("upgrade");
    expect(result).not.toContain("update");
  });
});
