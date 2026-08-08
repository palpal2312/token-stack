import type { RunEnvelope } from "./contracts";
import { RunLedger } from "./ledger";

export class OutboxProjector {
  constructor(private ledger: RunLedger) {}

  public async projectToLegacy(runId: string): Promise<void> {
    // Read the authoritative run and convert to legacy JSON formats if needed
    // This allows gradual migration where UI/API still reads the old format
    // while the canonical truth is the event ledger.
    const run = await this.ledger.getRun(runId);
    if (!run) return;

    this.writeLegacyFormat(run);
  }

  private writeLegacyFormat(snapshot: RunEnvelope): void {
    // Stub for now. Will map RunSnapshot to the old JSON structure
    // and write to the old paths (e.g. workspace builds or run files).
  }
}
