import { join } from "path";
import { mkdir, writeFile, stat, unlink, readdir } from "fs/promises";
import { randomUUID } from "crypto";

// For tracking staged files in memory (MVP limits)
type StagedFile = {
  id: string;
  connectionId: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
  expiresAt: number;
};

const stagedFiles = new Map<string, StagedFile>();
let totalStagedBytes = 0;

export async function addStagedFile(
  connectionId: string,
  name: string,
  mimeType: string,
  size: number,
  tempPath: string,
  ttlMs: number
): Promise<string> {
  const id = randomUUID();
  const file: StagedFile = {
    id,
    connectionId,
    name,
    mimeType,
    size,
    path: tempPath,
    expiresAt: Date.now() + ttlMs,
  };

  stagedFiles.set(id, file);
  totalStagedBytes += size;

  // Cleanup will be done via a separate process or periodic check,
  // but we can schedule a timeout for MVP
  setTimeout(() => {
    removeStagedFile(id).catch(console.error);
  }, ttlMs);

  return id;
}

export async function removeStagedFile(id: string) {
  const file = stagedFiles.get(id);
  if (!file) return;

  stagedFiles.delete(id);
  totalStagedBytes -= file.size;

  try {
    await unlink(file.path);
  } catch (error) {
    // Ignore ENOENT
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function getStagedFile(id: string): StagedFile | undefined {
  const file = stagedFiles.get(id);
  if (!file) return undefined;
  if (file.expiresAt < Date.now()) {
    removeStagedFile(id).catch(console.error);
    return undefined;
  }
  return file;
}

export function getStagedFilesForConnection(connectionId: string): StagedFile[] {
  const files: StagedFile[] = [];
  const now = Date.now();

  for (const [id, file] of stagedFiles.entries()) {
    if (file.expiresAt < now) {
      removeStagedFile(id).catch(console.error);
      continue;
    }
    if (file.connectionId === connectionId) {
      files.push(file);
    }
  }
  return files;
}

export function getTotalStagedBytes(): number {
  return totalStagedBytes;
}
