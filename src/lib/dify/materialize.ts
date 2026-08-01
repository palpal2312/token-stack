import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { runDir, defaultRunsDir } from "../run-storage";
import type { DifyArtifactManifest } from "./contracts";
import type { AssetRef } from "../llmops/contracts";
import type { OutputSpoolManifest } from "./output-spool";
import { RunLedger } from "../llmops/ledger";

/**
 * Materialize an output from the dify-output spool into the run's artifacts directory.
 */
export async function materializeOutput(runId: string, outputKey: string): Promise<AssetRef> {
  // Validate path traversal
  if (!outputKey || outputKey.includes("/") || outputKey.includes("\\") || outputKey.startsWith(".")) {
    throw new Error(`Invalid output key: ${outputKey}`);
  }

  const runDirStr = runDir(defaultRunsDir, runId);
  const spoolDir = path.join(runDirStr, "dify-output");
  const manifestPath = path.join(spoolDir, "manifest.json");

  // Read manifest
  let spoolManifest: OutputSpoolManifest;
  try {
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    spoolManifest = JSON.parse(manifestContent as string);
  } catch (error) {
    throw new Error(`No output manifest found for this run (path: ${manifestPath}, error: ${error})`);
  }

  const manifest = spoolManifest.artifacts.find(m => m.key === outputKey);
  if (!manifest) {
    throw new Error(`Output key '${outputKey}' not found in manifest`);
  }

  if (manifest.omitted) {
    throw new Error(`Output '${outputKey}' was omitted due to size limits and cannot be materialized`);
  }

  // Use crypto hash of the key to find the corresponding file in spoolDir
  const spoolSafeKey = crypto.createHash("sha256").update(outputKey).digest("hex");
  const sourceFile = path.join(spoolDir, `${spoolSafeKey}.dat`);
  
  let content: Buffer;
  try {
    content = await fs.readFile(sourceFile) as unknown as Buffer;
  } catch {
    throw new Error(`Spool file for '${outputKey}' is missing or unreadable`);
  }

  const hash = crypto.createHash("sha256").update(content).digest("hex");
  
  // Determine extension based on type
  let extension = "txt";
  let kind = "text";
  if (manifest.type === "object" || manifest.type === "array") {
    extension = "json";
    kind = "json";
  }

  // Stable filename based on content hash and key
  const safeKey = outputKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const artifactFilename = `${safeKey}-${hash.substring(0, 8)}.${extension}`;
  
  const artifactsDir = path.join(runDirStr, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  
  const targetPath = path.join(artifactsDir, artifactFilename);
  const tempPath = `${targetPath}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  
  // Check if it already exists (idempotent)
  try {
    await fs.access(targetPath);
  } catch {
    // Write atomically
    await fs.writeFile(tempPath, content, { mode: 0o600 });
    await fs.rename(tempPath, targetPath);
  }

  const assetUri = `file://${targetPath.split(path.sep).join("/")}`;

  // Return the standard AssetRef
  const newArtifact: AssetRef = {
    id: `dify-art-${hash.substring(0, 16)}`,
    kind,
    uri: assetUri,
    createdAt: new Date().toISOString(),
    redactionClass: manifest.redactionClass,
  };

  // Append artifact_recorded event using the RunLedger
  const ledger = new RunLedger();
  const run = await ledger.getRun(runId);
  if (run) {
    const updatedArtifacts = [...(run.artifacts || []), newArtifact];
    await ledger.append({
      id: `event-${crypto.randomUUID()}`,
      type: "artifact_recorded",
      run: {
        ...run,
        artifacts: updatedArtifacts
      },
      at: new Date().toISOString(),
      redactionClass: manifest.redactionClass,
      payload: {
        outputKey,
        fileName: artifactFilename,
      }
    });
  }

  return newArtifact;
}
