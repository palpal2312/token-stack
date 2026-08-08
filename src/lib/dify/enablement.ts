import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

/**
 * Dify enablement gate manager.
 * Ensures ledger backup exists before allowing Dify producer events.
 */

export interface DifyEnablementMarker {
  enabled: boolean;
  backupPath?: string;
  backupHash?: string;
  baselineRevision?: string;
  createdAt: string;
  verifiedAt?: string;
}

const ENABLEMENT_MARKER_FILENAME = "dify-enablement.json";

/**
 * Get the enablement marker file path.
 */
export function getEnablementMarkerPath(): string {
  const home = process.env.AGENTIC_OS_HOME || path.join(os.homedir(), ".agentic-os");
  return path.join(home, ENABLEMENT_MARKER_FILENAME);
}

/**
 * Read the enablement marker.
 */
export async function readEnablementMarker(): Promise<DifyEnablementMarker | null> {
  const markerPath = getEnablementMarkerPath();

  try {
    const content = await fs.readFile(markerPath, "utf-8");
    return JSON.parse(content) as DifyEnablementMarker;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write the enablement marker atomically.
 */
export async function writeEnablementMarker(marker: DifyEnablementMarker): Promise<void> {
  const markerPath = getEnablementMarkerPath();
  const dir = path.dirname(markerPath);
  const tempPath = `${markerPath}.tmp-${crypto.randomBytes(4).toString("hex")}`;

  try {
    await fs.mkdir(dir, { recursive: true });

    const content = JSON.stringify(marker, null, 2);
    await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });

    await fs.rename(tempPath, markerPath);

    try {
      await fs.chmod(markerPath, 0o600);
    } catch {
      // Non-fatal on Windows
    }
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Best effort
    }
    throw error;
  }
}

/**
 * Check if Dify is enabled and verified.
 */
export async function isDifyEnabled(): Promise<boolean> {
  const marker = await readEnablementMarker();
  return marker?.enabled === true && marker.backupPath !== undefined && marker.backupHash !== undefined;
}

/**
 * Get enablement status with details.
 */
export async function getEnablementStatus(): Promise<{
  enabled: boolean;
  backupExists: boolean;
  backupVerified: boolean;
  marker: DifyEnablementMarker | null;
}> {
  const marker = await readEnablementMarker();

  if (!marker) {
    return {
      enabled: false,
      backupExists: false,
      backupVerified: false,
      marker: null,
    };
  }

  const backupExists = marker.backupPath ? await checkFileExists(marker.backupPath) : false;
  const backupVerified = marker.enabled && backupExists && marker.backupHash !== undefined;

  return {
    enabled: marker.enabled,
    backupExists,
    backupVerified,
    marker,
  };
}

/**
 * Create or verify the Dify enablement backup.
 * This is a placeholder for Phase 3 ledger integration.
 */
export async function createOrVerifyBackup(): Promise<{
  ok: boolean;
  error?: string;
  backupPath?: string;
  backupHash?: string;
}> {
  // Phase 1/2: Just create the marker without actual backup
  // Phase 3 will implement the real ledger backup logic
  const now = new Date().toISOString();
  const home = process.env.AGENTIC_OS_HOME || path.join(os.homedir(), ".agentic-os");
  const backupPath = path.join(home, "ledger-backup-dify-enablement");
  const backupHash = crypto.randomBytes(32).toString("hex");

  const marker: DifyEnablementMarker = {
    enabled: true,
    backupPath,
    backupHash,
    baselineRevision: "phase-1-contracts-only",
    createdAt: now,
    verifiedAt: now,
  };

  try {
    await writeEnablementMarker(marker);
    return { ok: true, backupPath, backupHash };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to create enablement marker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Disable Dify (mark as disabled but keep marker for rollback).
 */
export async function disableDify(): Promise<void> {
  const marker = await readEnablementMarker();
  if (!marker) {
    return;
  }

  marker.enabled = false;
  marker.verifiedAt = new Date().toISOString();

  await writeEnablementMarker(marker);
}

/**
 * Check if a file exists.
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Assert Dify is enabled before producer writes.
 * Throws if enablement gate is not satisfied.
 */
export async function assertDifyEnabled(): Promise<void> {
  const status = await getEnablementStatus();

  if (!status.enabled) {
    throw new Error("Dify is not enabled. Create enablement backup first.");
  }

  if (!status.backupVerified) {
    throw new Error("Dify enablement backup is missing or unverified.");
  }
}
