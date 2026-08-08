import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import type { DifyProfile, DifyProfileRegistry, DifyConnectionRevision } from "./contracts";

/**
 * Profile registry manager for Dify workflow connections.
 * Follows the Router registry's serialized atomic-write pattern.
 */

const REGISTRY_FILENAME = "dify-workflows.json";

/**
 * Get the registry file path.
 */
export function getRegistryPath(): string {
  const home = process.env.AGENTIC_OS_HOME || path.join(os.homedir(), ".agentic-os");
  return path.join(home, REGISTRY_FILENAME);
}

/**
 * Generate a stable profile ID.
 */
export function generateProfileId(): string {
  return `dify-${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Generate an immutable revision ID.
 */
export function generateRevisionId(): string {
  return `rev-${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Create a masked key hint (first 4 + last 4 characters).
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return "***";
  }
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

/**
 * Read the profile registry.
 */
export async function readRegistry(): Promise<DifyProfileRegistry> {
  const registryPath = getRegistryPath();

  try {
    const content = await fs.readFile(registryPath, "utf-8");
    const data = JSON.parse(content) as DifyProfileRegistry;

    if (data.version !== 1) {
      throw new Error(`Unsupported registry version: ${data.version}`);
    }

    return data;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Registry doesn't exist yet, return empty
      const now = new Date().toISOString();
      return {
        version: 1,
        profiles: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    // Preserve corrupt file for inspection
    if (error instanceof SyntaxError) {
      const backupPath = `${registryPath}.corrupt-${Date.now()}`;
      try {
        await fs.copyFile(registryPath, backupPath);
      } catch {
        // Best effort
      }
      throw new Error(`Registry file is corrupt (backed up to ${backupPath}): ${error.message}`);
    }

    throw error;
  }
}

/**
 * Write the profile registry atomically.
 */
export async function writeRegistry(registry: DifyProfileRegistry): Promise<void> {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  const tempPath = `${registryPath}.tmp-${crypto.randomBytes(4).toString("hex")}`;

  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Update timestamp
    registry.updatedAt = new Date().toISOString();

    // Write to temp file
    const content = JSON.stringify(registry, null, 2);
    await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });

    // Atomic rename
    await fs.rename(tempPath, registryPath);

    // Best-effort chmod on final file (Windows may ignore)
    try {
      await fs.chmod(registryPath, 0o600);
    } catch {
      // Non-fatal on Windows
    }
  } catch (error) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tempPath);
    } catch {
      // Best effort
    }
    throw error;
  }
}

/**
 * Get a profile by ID.
 */
export async function getProfile(profileId: string): Promise<DifyProfile | null> {
  const registry = await readRegistry();
  return registry.profiles.find((p) => p.id === profileId) || null;
}

/**
 * Get all profiles (sanitized for public use).
 */
export async function listProfiles(): Promise<DifyProfile[]> {
  const registry = await readRegistry();
  return registry.profiles.filter((p) => !p.tombstone);
}

/**
 * Create or update a profile.
 */
export async function upsertProfile(profile: DifyProfile): Promise<void> {
  const registry = await readRegistry();
  const existingIndex = registry.profiles.findIndex((p) => p.id === profile.id);

  if (existingIndex >= 0) {
    registry.profiles[existingIndex] = profile;
  } else {
    registry.profiles.push(profile);
  }

  await writeRegistry(registry);
}

/**
 * Delete a profile (tombstone if referenced, hard delete otherwise).
 */
export async function deleteProfile(profileId: string, hasReferences: boolean): Promise<void> {
  const registry = await readRegistry();
  const profileIndex = registry.profiles.findIndex((p) => p.id === profileId);

  if (profileIndex < 0) {
    throw new Error(`Profile ${profileId} not found`);
  }

  if (hasReferences) {
    // Tombstone: mark as deleted but keep for running/blocked runs
    registry.profiles[profileIndex].tombstone = true;
  } else {
    // Hard delete: no references, safe to remove completely
    registry.profiles.splice(profileIndex, 1);
  }

  await writeRegistry(registry);
}

/**
 * Purge oldest unreferenced inactive revision.
 * Returns true if a revision was purged, false if none available.
 */
export async function purgeOldestRevision(profileId: string, referencedRevisions: Set<string>): Promise<boolean> {
  const registry = await readRegistry();
  const profile = registry.profiles.find((p) => p.id === profileId);

  if (!profile || profile.revisions.length <= 1) {
    return false;
  }

  // Find oldest inactive, unreferenced revision
  const candidates = profile.revisions
    .filter((rev) => rev.revisionId !== profile.revisionId && !referencedRevisions.has(rev.revisionId))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (candidates.length === 0) {
    return false;
  }

  // Remove oldest
  const toRemove = candidates[0].revisionId;
  profile.revisions = profile.revisions.filter((rev) => rev.revisionId !== toRemove);

  await writeRegistry(registry);
  return true;
}

/**
 * Get a specific revision from a profile.
 */
export async function getRevision(profileId: string, revisionId: string): Promise<DifyConnectionRevision | null> {
  const profile = await getProfile(profileId);
  if (!profile) return null;
  return profile.revisions.find((rev) => rev.revisionId === revisionId) || null;
}

/**
 * Get the current active revision for a profile.
 */
export async function getCurrentRevision(profileId: string): Promise<DifyConnectionRevision | null> {
  const profile = await getProfile(profileId);
  if (!profile) return null;
  return profile.revisions.find((rev) => rev.revisionId === profile.revisionId) || null;
}

/**
 * Count revisions for a profile.
 */
export async function countRevisions(profileId: string): Promise<number> {
  const profile = await getProfile(profileId);
  return profile?.revisions.length || 0;
}
