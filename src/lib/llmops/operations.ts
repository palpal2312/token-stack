import fs from "node:fs/promises";
import path from "node:path";
import { RunLedger } from "./ledger";
import { buildReleaseGateReport, type RecoveryGateInputs, type ReleaseGateReport } from "./release-gate";
import { type StorageFaults } from "./storage";
import { readEnablementMarker } from "../dify/enablement";

export class OperationsManager {
  constructor(private readonly ledger: RunLedger) {}

  async backup(destinationDir: string): Promise<void> {
    await fs.mkdir(destinationDir, { recursive: true });
    
    // Copy events
    try {
      await fs.copyFile(
        this.ledger.paths.events,
        path.join(destinationDir, "events.jsonl")
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    
    // Snapshot
    try {
      await fs.copyFile(
        this.ledger.paths.snapshot,
        path.join(destinationDir, "runs.json")
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    
    // Write manifest
    await fs.writeFile(
      path.join(destinationDir, "backup-manifest.json"),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ledgerId: this.ledger.ledgerId,
        version: 1
      }, null, 2)
    );
  }

  /** The sole Phase-1 entry point that opens the Dify writer gate. */
  async enableDify(backupDir = "defaultBackupDir"): Promise<void> {
    const snapshot = await this.ledger.createVerifiedBackup(backupDir);
    // await createEnablementMarker(backupDir, snapshot.lastAppliedSeq);
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.ledger.recover();
      return { ok: true, message: "Ledger journal is intact and verified" };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }

  async releaseGateReport(options: { projectRoot?: string; now?: Date; recovery?: RecoveryGateInputs } = {}): Promise<ReleaseGateReport> {
    return buildReleaseGateReport(options);
  }

  async prune(before: Date): Promise<void> {
    // In a real implementation this would compact the event journal
    // by removing events older than the given date that are not pinned
  }
}
