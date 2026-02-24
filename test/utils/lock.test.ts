import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../../src/utils/lock.ts";

describe("withFileLock", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mulch-lock-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("executes the wrapped function and returns its result", async () => {
    const filePath = join(tmpDir, "test.jsonl");
    await writeFile(filePath, "", "utf-8");

    const result = await withFileLock(filePath, async () => {
      return 42;
    });

    expect(result).toBe(42);
  });

  it("cleans up lock file after success", async () => {
    const filePath = join(tmpDir, "test.jsonl");
    await writeFile(filePath, "", "utf-8");

    await withFileLock(filePath, async () => {});

    // Lock file should be removed
    await expect(stat(join(tmpDir, "test.jsonl.lock"))).rejects.toThrow();
  });

  it("cleans up lock file after error", async () => {
    const filePath = join(tmpDir, "test.jsonl");
    await writeFile(filePath, "", "utf-8");

    await expect(
      withFileLock(filePath, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lock file should still be cleaned up
    await expect(stat(join(tmpDir, "test.jsonl.lock"))).rejects.toThrow();
  });

  it("serializes concurrent access to the same file", async () => {
    const filePath = join(tmpDir, "counter.jsonl");
    await writeFile(filePath, "0", "utf-8");

    // Run 5 concurrent increment operations
    const increments = Array.from({ length: 5 }, () =>
      withFileLock(filePath, async () => {
        const val = Number.parseInt(await readFile(filePath, "utf-8"), 10);
        // Small delay to increase chance of race without lock
        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeFile(filePath, String(val + 1), "utf-8");
      }),
    );

    await Promise.all(increments);

    const finalVal = Number.parseInt(await readFile(filePath, "utf-8"), 10);
    expect(finalVal).toBe(5);
  });

  it("removes stale lock files and acquires lock", async () => {
    const filePath = join(tmpDir, "test.jsonl");
    const lockPath = `${filePath}.lock`;
    await writeFile(filePath, "", "utf-8");

    // Create a "stale" lock file with an old mtime
    await writeFile(lockPath, "", "utf-8");
    const thirtyOneSecondsAgo = new Date(Date.now() - 31_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(lockPath, thirtyOneSecondsAgo, thirtyOneSecondsAgo);

    // Should succeed despite existing lock (it's stale)
    const result = await withFileLock(filePath, async () => "acquired");
    expect(result).toBe("acquired");
  });

  it("handles symlink lock files without following the symlink target", async () => {
    const filePath = join(tmpDir, "test.jsonl");
    const lockPath = `${filePath}.lock`;
    const targetFile = join(tmpDir, "target-file.txt");
    await writeFile(filePath, "", "utf-8");
    await writeFile(targetFile, "important data", "utf-8");

    // Create a symlink lock pointing to a different file
    await symlink(targetFile, lockPath);

    // Back-date the symlink's own mtime to make it "stale"
    const thirtyOneSecondsAgo = new Date(Date.now() - 31_000);
    const { lutimes } = await import("node:fs/promises");
    await lutimes(lockPath, thirtyOneSecondsAgo, thirtyOneSecondsAgo);

    // withFileLock should treat the stale symlink lock correctly
    const result = await withFileLock(filePath, async () => "acquired");
    expect(result).toBe("acquired");

    // The target file should not have been affected
    const targetContent = await readFile(targetFile, "utf-8");
    expect(targetContent).toBe("important data");
  });

  it("times out when lock is held and not stale", async () => {
    const filePath = join(tmpDir, "test.jsonl");
    const lockPath = `${filePath}.lock`;
    await writeFile(filePath, "", "utf-8");

    // Create a fresh lock file (not stale)
    await writeFile(lockPath, "", "utf-8");

    // Should time out trying to acquire — use a short timeout by racing
    await expect(
      Promise.race([
        withFileLock(filePath, async () => "never"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("test timeout")), 6_000),
        ),
      ]),
    ).rejects.toThrow(/lock|timeout/i);

    // Clean up the lock file we created manually
    await rm(lockPath, { force: true });
  }, 10_000);
});
