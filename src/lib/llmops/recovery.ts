import { JobQueue } from "./jobs";

export interface OrphanRecoveryReport {
  /** Jobs inspected during this scan; 0 with `unsupported` set means fail-closed. */
  scanned: number;
  /** Job ids this scan actually transitioned to orphaned (CAS winners only). */
  orphaned: string[];
  /** Per-stream scan errors (e.g. corrupt job files); the scan continues past them. */
  errors: string[];
  /** Set when the repository cannot enumerate jobs; no reconciliation happened. */
  unsupported?: string;
}

/**
 * Reconciles leased/running jobs against the live process set. A job is
 * orphaned when its lease owner is absent from the active set or its lease has
 * expired. Orphaned jobs become claimable again (`JobQueue.claim` accepts the
 * orphaned status), which is what lets a fresh worker pick the work up.
 *
 * Assumption: `activeProcessRefs` is authoritative and lease durations
 * comfortably exceed heartbeat intervals. An owner that is alive but late on
 * heartbeats can still be orphaned via lease expiry and re-claimed by another
 * worker before it notices — the runtime lease/fence layer (not this job
 * queue) is responsible for preventing double execution.
 */
export class OrphanRecovery {
  constructor(private jobs: JobQueue) {}

  public reconcile(activeProcessRefs: string[], now = Date.now()): OrphanRecoveryReport {
    const result = this.jobs.listJobs();
    if (!result) {
      return { scanned: 0, orphaned: [], errors: [], unsupported: "job listing is unavailable on this repository" };
    }
    const active = new Set(activeProcessRefs);
    const orphaned: string[] = [];
    for (const { snapshot } of result.jobs) {
      if (snapshot.status !== "leased" && snapshot.status !== "running") continue;
      const ownerDead = !snapshot.leaseOwner || !active.has(snapshot.leaseOwner);
      const leaseExpired = snapshot.leaseExpiry !== undefined && snapshot.leaseExpiry <= now;
      if ((ownerDead || leaseExpired) && this.jobs.markOrphaned(snapshot.jobId, now)) {
        orphaned.push(snapshot.jobId);
      }
    }
    orphaned.sort();
    return { scanned: result.jobs.length, orphaned, errors: result.errors };
  }
}
