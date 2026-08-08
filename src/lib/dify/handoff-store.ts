import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { globalCapacity, getHandoffExpiration } from "./capacity";
import { DIFY_MAX_OUTSTANDING_HANDOFF_BYTES, DIFY_MAX_OUTSTANDING_HANDOFFS } from "./limits";

export type HandoffStatus = "created" | "claiming" | "completed" | "failed" | "expired";

export interface HandoffRecord {
  id: string;
  sourceRunId: string;
  targetRunId: string;
  artifactIds: string[];
  goal?: string;
  bytes: number;
  status: HandoffStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  leaseExpiresAt?: string;
}

interface HandoffRegistry {
  version: 1;
  records: HandoffRecord[];
}

const REGISTRY_FILENAME = "dify-handoffs.json";

function getRegistryPath(): string {
  const home = process.env.AGENTIC_OS_HOME || path.join(os.homedir(), ".agentic-os");
  return path.join(home, REGISTRY_FILENAME);
}

export async function readHandoffs(): Promise<HandoffRegistry> {
  const registryPath = getRegistryPath();
  try {
    const content = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(content) as HandoffRegistry;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return { version: 1, records: [] };
    }
    throw error;
  }
}

export async function writeHandoffs(registry: HandoffRegistry): Promise<void> {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  const tempPath = `${registryPath}.tmp-${crypto.randomBytes(4).toString("hex")}`;

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(registry, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tempPath, registryPath);
  try {
    await fs.chmod(registryPath, 0o600);
  } catch {}
}

export async function getHandoff(id: string): Promise<HandoffRecord | null> {
  const registry = await readHandoffs();
  return registry.records.find(r => r.id === id) || null;
}

export async function createHandoff(record: Omit<HandoffRecord, "status" | "createdAt" | "updatedAt" | "expiresAt">): Promise<HandoffRecord> {
  const now = new Date().toISOString();
  const expiresAt = getHandoffExpiration();
  const fullRecord: HandoffRecord = {
    ...record,
    status: "created",
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  globalCapacity.reserve({
    id: `handoff-${fullRecord.id}`,
    type: "handoff",
    bytes: fullRecord.bytes,
    createdAt: now,
    expiresAt,
  });

  const registry = await readHandoffs();
  registry.records.push(fullRecord);
  await writeHandoffs(registry);

  return fullRecord;
}

export async function claimHandoff(id: string, targetRunId: string, leaseDurationMs: number = 60000): Promise<HandoffRecord | null> {
  const registry = await readHandoffs();
  const index = registry.records.findIndex(r => r.id === id);
  if (index === -1) return null;

  const record = registry.records[index];
  const now = new Date();

  if (record.status !== "created" && record.status !== "claiming") {
    throw new Error(`Cannot claim handoff ${id} in status ${record.status}`);
  }

  if (record.status === "claiming" && record.leaseExpiresAt && new Date(record.leaseExpiresAt) > now) {
     if (record.targetRunId !== targetRunId) {
        throw new Error(`Handoff ${id} is already claimed by another run`);
     }
  }

  record.status = "claiming";
  record.targetRunId = targetRunId;
  record.updatedAt = now.toISOString();
  record.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();

  await writeHandoffs(registry);
  return record;
}

export async function completeHandoff(id: string, status: "completed" | "failed" = "completed"): Promise<HandoffRecord | null> {
  const registry = await readHandoffs();
  const index = registry.records.findIndex(r => r.id === id);
  if (index === -1) return null;

  const record = registry.records[index];
  record.status = status;
  record.updatedAt = new Date().toISOString();

  globalCapacity.release(`handoff-${id}`);

  await writeHandoffs(registry);
  return record;
}

export async function evictExpiredHandoffs(): Promise<number> {
    const registry = await readHandoffs();
    const now = new Date();
    let count = 0;

    for (const record of registry.records) {
        if ((record.status === "created" || record.status === "claiming") && new Date(record.expiresAt) <= now) {
            record.status = "expired";
            record.updatedAt = now.toISOString();
            globalCapacity.release(`handoff-${record.id}`);
            count++;
        }
    }

    if (count > 0) {
        await writeHandoffs(registry);
    }
    return count;
}

