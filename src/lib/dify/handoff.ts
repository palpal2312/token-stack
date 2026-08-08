import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { globalCapacity, getHandoffExpiration } from "./capacity";
import { readHandoffs, createHandoff as storeCreateHandoff, claimHandoff as storeClaimHandoff, completeHandoff, getHandoff, type HandoffRecord } from "./handoff-store";
import { runDir, defaultRunsDir } from "../run-storage";
import { DIFY_MAX_OUTSTANDING_HANDOFFS, DIFY_MAX_HANDOFF_ARTIFACTS, DIFY_MAX_HANDOFF_GOAL_BYTES } from "./limits";

export async function createHandoff(runId: string, artifactIds: string[], goal?: string): Promise<string> {
    if (artifactIds.length > DIFY_MAX_HANDOFF_ARTIFACTS) {
      throw new Error(`Too many artifacts: ${artifactIds.length} exceeds limit of ${DIFY_MAX_HANDOFF_ARTIFACTS}`);
    }

    if (goal && Buffer.byteLength(goal, "utf-8") > DIFY_MAX_HANDOFF_GOAL_BYTES) {
      throw new Error("Handoff goal exceeds size limit");
    }

    const registry = await readHandoffs();
    const active = registry.records.filter(r => r.status === "created" || r.status === "claiming");

    if (active.length >= DIFY_MAX_OUTSTANDING_HANDOFFS) {
      throw new Error(`Maximum outstanding handoffs exceeded: ${DIFY_MAX_OUTSTANDING_HANDOFFS}`);
    }

    const handoffId = `handoff-${crypto.randomBytes(16).toString("hex")}`;
    const targetRunId = crypto.randomUUID();

    // Calculate approximate bytes to reserve
    let reservedBytes = 0;
    const sourceDir = runDir(defaultRunsDir, runId);

    for (const artPath of artifactIds) {
      // Basic traversal check
      if (artPath.includes("..")) throw new Error("Invalid artifact path");

      const fullPath = path.join(sourceDir, "artifacts", path.basename(artPath));
      try {
        const stat = await fs.stat(fullPath);
        reservedBytes += stat.size;
      } catch {
        throw new Error(`Artifact not found: ${artPath}`);
      }
    }

    await storeCreateHandoff({
      id: handoffId,
      sourceRunId: runId,
      targetRunId,
      artifactIds,
      goal,
      bytes: reservedBytes
    });

    return handoffId;
}

export async function claimHandoff(handoffId: string, targetRunId: string): Promise<{ targetRunId: string, goal?: string }> {
    const record = await getHandoff(handoffId);
    if (!record) throw new Error("Handoff not found");

    const nowStr = new Date().toISOString();
    const now = new Date(nowStr).getTime();
    const expiresAt = new Date(record.expiresAt).getTime();

    if (now > expiresAt) {
      throw new Error("Handoff expired");
    }

    if (record.status === "completed") {
      return { targetRunId: record.targetRunId, goal: record.goal }; // Idempotent success
    }

    if (record.status !== "created" && record.status !== "claiming") {
      throw new Error(`Cannot claim handoff in state: ${record.status}`);
    }

    try {
      await storeClaimHandoff(handoffId, targetRunId, 30000);
    } catch (e: any) {
      throw new Error(`Handoff claim failed: ${e.message}`);
    }

    try {
      const sourceDir = runDir(defaultRunsDir, record.sourceRunId);
      const targetDir = runDir(defaultRunsDir, targetRunId);
      const importsDir = path.join(targetDir, "imports", "dify", record.sourceRunId);

      await fs.mkdir(importsDir, { recursive: true });

      for (const artPath of record.artifactIds) {
        const baseName = path.basename(artPath);
        const sourceFile = path.join(sourceDir, "artifacts", baseName);
        const targetFile = path.join(importsDir, baseName);

        try {
          await fs.access(targetFile);
        } catch {
          await fs.copyFile(sourceFile, targetFile);
        }
      }

      await completeHandoff(handoffId, "completed");

      return { targetRunId, goal: record.goal };

    } catch (error: any) {
      await completeHandoff(handoffId, "failed");
      throw new Error(`Handoff claim failed: ${error.message}`);
    }
}

