/**
 * Cross-process writer queue for the append-only journals.
 *
 * mkdir is atomic on every OS, so a `<journal>.lock` directory works as a
 * mutual-exclusion token between node and PowerShell writers alike. A lock
 * older than the stale threshold is assumed crashed and removed.
 */

import * as fs from "node:fs";

export interface LockOptions {
  timeoutMs?: number;
  retryMs?: number;
  staleMs?: number;
}

function sleepMs(ms: number): void {
  // Synchronous sleep without setTimeout: block briefly on an empty wait.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withJournalLock<T>(
  resourcePath: string,
  opts: LockOptions,
  fn: () => T,
): T {
  const lockPath = `${resourcePath}.lock`;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retryMs = opts.retryMs ?? 50;
  const staleMs = opts.staleMs ?? 10000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch {
      const held = (() => {
        try {
          return Date.now() - fs.statSync(lockPath).mtimeMs;
        } catch {
          return 0;
        }
      })();
      if (held > staleMs) {
        // Holder crashed without releasing; drop the stale lock and retry.
        try {
          fs.rmdirSync(lockPath);
        } catch {
          /* raced by another writer */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`writer queue timeout: another writer holds ${lockPath}`);
      }
      sleepMs(retryMs);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      /* lock already reclaimed as stale by a peer; nothing to release */
    }
  }
}
