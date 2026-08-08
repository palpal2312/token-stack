import { mkdir, open, readFile, rename } from "node:fs/promises";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export type StorageErrorCode = "CONCURRENCY_CONFLICT" | "CORRUPT" | "INVALID_ID";

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: StorageErrorCode,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface IAppendOnlyRepository<Event, Snapshot = unknown> {
  append(streamId: string, event: Event, expectedRevision?: number): void;
  readEvents(streamId: string): Event[];
  /** Optional stream enumeration; recovery passes need it to scan all jobs. */
  listStreams?(): string[];
}

/**
 * Compatibility repository for the synchronous JobQueue boundary. Each stream
 * gets one fsync-backed JSONL file; JavaScript's single thread serializes the
 * read/CAS/append section within a process. Cross-process writers remain
 * unsupported until Phase 3 introduces explicit leases.
 */
export class JsonlStorageRepository<Event, Snapshot = unknown>
implements IAppendOnlyRepository<Event, Snapshot> {
  private readonly root: string;

  constructor(name: string, root?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) {
      throw new StorageError("repository name is invalid", "INVALID_ID");
    }
    this.root = path.resolve(root
      ?? path.join(
        process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os"),
        "llmops",
        name,
      ));
  }

  append(streamId: string, event: Event, expectedRevision?: number): void {
    const file = this.file(streamId);
    const revision = this.readEvents(streamId).length;
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      throw new StorageError(
        `stream revision changed: expected ${expectedRevision}, current ${revision}`,
        "CONCURRENCY_CONFLICT",
      );
    }
    mkdirSync(this.root, { recursive: true });
    const descriptor = openSync(file, "a");
    try {
      writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  readEvents(streamId: string): Event[] {
    const file = this.file(streamId);
    if (!existsSync(file)) return [];
    const events: Event[] = [];
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as Event);
      } catch {
        throw new StorageError(
          `stream ${streamId} is corrupt at line ${index + 1}; file preserved`,
          "CORRUPT",
        );
      }
    }
    return events;
  }

  listStreams(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length))
      .sort();
  }

  private file(streamId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(streamId)) {
      throw new StorageError("stream id is invalid", "INVALID_ID");
    }
    return path.join(this.root, `${streamId}.jsonl`);
  }
}

export interface StorageFaults {
  beforeAppend?(file: string): void | Promise<void>;
  beforeAtomicWrite?(file: string): void | Promise<void>;
}

export interface QuarantinedTail {
  file: string;
  firstInvalidLine: number;
  reason: string;
}

export interface CorruptTail {
  firstInvalidLine: number;
  reason: string;
}

export interface JsonLinesRecovery<T> {
  records: T[];
  quarantine?: QuarantinedTail;
  corruption?: CorruptTail;
}

const writerChains = new Map<string, Promise<unknown>>();

export function withSerializedWriter<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const normalized = path.resolve(key);
  const previous = writerChains.get(normalized) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const sentinel = next.then(() => undefined, () => undefined);
  writerChains.set(normalized, sentinel);
  return next.finally(() => {
    if (writerChains.get(normalized) === sentinel) writerChains.delete(normalized);
  });
}

async function syncParentDirectory(file: string): Promise<void> {
  let handle;
  try {
    handle = await open(path.dirname(file), "r");
    await handle.sync();
  } catch {
    // Directory fsync is unsupported on some Windows/filesystem combinations.
    // The file itself is still flushed before rename/acknowledgement.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function appendJsonLineDurable(
  file: string,
  value: unknown,
  faults?: StorageFaults,
): Promise<void> {
  await faults?.beforeAppend?.(file);
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "a");
  try {
    await handle.write(`${JSON.stringify(value)}\n`, undefined, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeJsonAtomic(
  file: string,
  value: unknown,
  faults?: StorageFaults,
): Promise<void> {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, faults);
}

export async function writeTextAtomic(
  file: string,
  value: string,
  faults?: StorageFaults,
): Promise<void> {
  await faults?.beforeAtomicWrite?.(file);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
  await syncParentDirectory(file);
}

export async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

export async function recoverJsonLines<T>(
  file: string,
  validate: (value: unknown, index: number) => string | null,
  options: { quarantine?: boolean } = {},
): Promise<JsonLinesRecovery<T>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { records: [] };
    throw error;
  }

  const lines = text.split(/\r?\n/);
  const records: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let parsed: unknown;
    let reason = "";
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      reason = `invalid JSON: ${String((error as Error)?.message ?? error)}`;
    }
    if (!reason) reason = validate(parsed, index) ?? "";
    if (!reason) {
      records.push(parsed as T);
      continue;
    }
    if (!options.quarantine) {
      return {
        records,
        corruption: { firstInvalidLine: index + 1, reason },
      };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const quarantineFile = `${file}.corrupt-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
    const tail = `${lines.slice(index).join("\n").replace(/\n*$/, "")}\n`;
    await mkdir(path.dirname(file), { recursive: true });
    const quarantineHandle = await open(quarantineFile, "wx");
    try {
      await quarantineHandle.writeFile(tail, "utf8");
      await quarantineHandle.sync();
    } finally {
      await quarantineHandle.close();
    }
    const prefix = records.length
      ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
      : "";
    await writeTextAtomic(file, prefix);
    return {
      records,
      quarantine: {
        file: quarantineFile,
        firstInvalidLine: index + 1,
        reason,
      },
    };
  }
  return { records };
}
