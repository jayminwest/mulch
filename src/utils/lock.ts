import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";

const LOCK_STALE_MS = 30_000; // 30 seconds
const LOCK_RETRY_INTERVAL_MS = 50;
const LOCK_TIMEOUT_MS = 5_000; // 5 seconds

/**
 * Advisory file-level lock using O_CREAT | O_EXCL.
 * Wraps an async function with lock acquisition and guaranteed cleanup.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const fd = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      );
      await fd.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }

      // Lock file exists — check if it's stale
      if (await isStaleLock(lockPath)) {
        try {
          await unlink(lockPath);
        } catch {
          // Another process may have already removed it
        }
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for lock on ${lockPath}. If no other mulch process is running, delete the lock file manually.`,
        );
      }

      await sleep(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const stats = await lstat(lockPath);
    return Date.now() - stats.mtimeMs > LOCK_STALE_MS;
  } catch {
    // Lock file disappeared between check — not stale, just gone
    return false;
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // Lock file already gone — acceptable
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
