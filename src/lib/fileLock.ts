// Cross-process advisory file lock for the local stores under
// $AGENTIC_OS_HOME. The in-process promise chains (agent-kanban/store.ts,
// llmops/storage.ts) serialize writers inside one server process; this lock is
// the barrier that keeps a SECOND server process pointed at the same home from
// interleaving event appends or clobbering a shared snapshot temp file.
//
// The primitive is mkdir: directory creation is atomic on both NTFS and POSIX
// filesystems, so exactly one contender wins. The winner drops an owner.json
// ({pid, hostname, acquiredAt}) inside the lock dir so a later contender can
// detect a holder that died without releasing: once the lock is older than
// staleMs AND the owner pid no longer exists locally, the lock is broken and
// acquisition retried. process.kill(pid, 0) reports ESRCH for a dead pid and
// EPERM for a live one we may not signal — only ESRCH means dead. Same-pid-
// different-host is impossible here because the store is a local directory.
//
// Usage is always `withFileLock` around a critical section that is ALSO inside
// the store's in-process chain — lock inside the chain, never the reverse, so
// a process can never deadlock against itself.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export class FileLockError extends Error {
  constructor(message: string, public readonly code: "FILE_LOCK_TIMEOUT") {
    super(message);
    this.name = "FileLockError";
  }
}

export interface FileLockOwner {
  pid: number;
  hostname: string;
  acquiredAt: string;
}

export interface FileLockOptions {
  /** Locks older than this whose owner pid is dead are broken. Default 30s. */
  staleMs?: number;
  /** Total time to wait for a held lock before failing. Default 5s. */
  timeoutMs?: number;
  /** First retry delay; grows ~1.5x per attempt, capped at 250ms. Default 25ms. */
  retryMs?: number;
}

export interface FileLockHandle {
  readonly dir: string;
  readonly owner: FileLockOwner;
  release(): Promise<void>;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_MS = 25;
const MAX_RETRY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process → the owner is dead and the lock is stale.
    // EPERM: alive but not ours to signal → treat as alive. Anything else is
    // inconclusive, so err on the side of "alive" and keep waiting.
    return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}

async function readOwner(dir: string): Promise<FileLockOwner | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, "owner.json"), "utf8")) as Partial<FileLockOwner>;
    if (typeof raw.pid !== "number" || typeof raw.acquiredAt !== "string") return null;
    return { pid: raw.pid, hostname: String(raw.hostname ?? ""), acquiredAt: raw.acquiredAt };
  } catch {
    return null;
  }
}

/** Age of the lock in ms: owner.json timestamp first, dir mtime as fallback. */
async function lockAgeMs(dir: string, owner: FileLockOwner | null): Promise<number> {
  const acquired = owner ? Date.parse(owner.acquiredAt) : Number.NaN;
  if (Number.isFinite(acquired)) return Date.now() - acquired;
  try {
    return Date.now() - (await stat(dir)).mtimeMs;
  } catch {
    return 0; // vanished under us → not stale, the retry will re-mkdir
  }
}

/**
 * Remove the lock dir when it is provably abandoned: older than staleMs and
 * either the owner pid is dead or owner.json never landed (a live holder
 * writes it immediately after mkdir, so an old dir without one is debris).
 * Returns true when the dir was removed and acquisition should retry at once.
 */
async function breakIfStale(dir: string, staleMs: number): Promise<boolean> {
  const owner = await readOwner(dir);
  if (await lockAgeMs(dir, owner) < staleMs) return false;
  if (owner && pidAlive(owner.pid)) return false;
  // Two contenders can both observe "stale" and race to break the lock: one
  // removes the dir, re-acquires, writes a fresh owner.json — and the other's
  // in-flight rm would then delete that FRESH lock. Move the dir to a unique
  // tombstone first instead: rename is atomic, so exactly one contender moves
  // the dir it observed; losers get ENOENT and simply retry acquisition.
  const tombstone = `${dir}.stale-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await rename(dir, tombstone);
  } catch {
    return true; // dir vanished or was reclaimed concurrently — retry acquire
  }
  // Re-validate the tombstone: in the sub-ms gap between our staleness check
  // and the rename, a fresh lock with a live owner cannot appear AT THIS DIR —
  // rename moved the exact dir we observed — but a fresh owner.json may have
  // landed inside it if the holder was mid-acquire. Never destroy that.
  const movedOwner = await readOwner(tombstone);
  if (movedOwner && Date.now() - Date.parse(movedOwner.acquiredAt) < staleMs && pidAlive(movedOwner.pid)) {
    await rename(tombstone, dir).catch(() => {}); // best-effort restore
    return false;
  }
  await rm(tombstone, { recursive: true, force: true });
  return true;
}

export async function acquireFileLock(
  storeDir: string,
  name: string,
  opts: FileLockOptions = {},
): Promise<FileLockHandle> {
  if (!NAME_RE.test(name)) throw new Error(`fileLock: invalid lock name "${name}".`);
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dir = path.join(storeDir, ".locks", `${name}.lock`);
  await mkdir(path.dirname(dir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let delay = opts.retryMs ?? DEFAULT_RETRY_MS;
  for (;;) {
    try {
      await mkdir(dir, { recursive: false });
      const owner: FileLockOwner = {
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
      };
      await writeFile(path.join(dir, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
      return {
        dir,
        owner,
        release: async () => { await rm(dir, { recursive: true, force: true }); },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
    if (await breakIfStale(dir, staleMs)) continue;
    if (Date.now() + delay > deadline) {
      const holder = await readOwner(dir);
      throw new FileLockError(
        `Timed out after ${timeoutMs}ms waiting for lock "${name}" at ${dir}`
        + (holder ? ` (held by pid ${holder.pid} since ${holder.acquiredAt}).` : "."),
        "FILE_LOCK_TIMEOUT",
      );
    }
    await sleep(delay);
    delay = Math.min(MAX_RETRY_MS, Math.round(delay * 1.5));
  }
}

export async function withFileLock<T>(
  storeDir: string,
  name: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const handle = await acquireFileLock(storeDir, name, opts);
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}
