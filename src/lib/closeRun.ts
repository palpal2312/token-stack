// Closing an abandoned run: the honest end state for a run whose waiter is
// never coming — its automation was deleted, or the user simply walks away
// from a parked ask.
//
// A blocked run is not broken; it is *waiting*. Leaving it blocked forever
// lies to every surface that lists runs ("still needs you") and holds its
// parked approvals hostage in the Inbox. closeRun gives it the same terminal
// shape a real failure would have: status "failed", a finish step that says
// who closed it and why, the transcript re-rendered, and every pending
// approval of the run rejected ("run abandoned").
//
// Only blocked runs close. A done/failed/max-turns run already has its ending,
// and a running run has a live writer — touching either would be the silent
// state edit this module exists to avoid. Those callers get closed: false.

import type { StateStore } from "./agentRuntime/state";
import { writeTranscript } from "./agentRuntime/transcript";
import { listApprovals, decideApproval } from "./approvals";
import { readRunRecord, writeRunRecord } from "./automations";

export interface CloseRunResult {
  /** False when the run was not blocked — nothing was changed. */
  closed: boolean;
  reason: string;
  /** How many parked approvals this closure rejected. */
  rejectedApprovals: number;
}

/**
 * Close a blocked run with a reason on the record. Throws when no such run
 * exists. Idempotent in effect: a second close finds a failed run and reports
 * closed: false without rewriting history.
 */
export async function closeRun(
  store: StateStore,
  runId: string,
  reason: string,
  opts: { by?: string } = {},
): Promise<CloseRunResult> {
  const by = opts.by ?? "user";
  const state = await store.load(runId);
  if (!state) throw new Error(`No run "${runId}".`);
  if (state.status !== "blocked") return { closed: false, reason, rejectedApprovals: 0 };

  // Reject first, so a crash after this point leaves decided asks and a
  // still-blocked run — retriable — never a closed run with pending asks.
  let rejectedApprovals = 0;
  for (const a of await listApprovals()) {
    if (a.runId !== runId || a.status !== "pending") continue;
    const { won } = await decideApproval(a.id, "reject");
    if (won) rejectedApprovals += 1;
  }

  const now = new Date().toISOString();
  state.status = "failed";
  state.pendingApproval = undefined;
  state.steps.push({
    kind: "finish",
    name: "failed",
    text:
      `Run closed by ${by}: ${reason}. `
      + (rejectedApprovals > 0
        ? `${rejectedApprovals} parked approval(s) rejected — run abandoned.`
        : "No parked approvals to reject — run abandoned."),
    at: now,
  });
  state.updatedAt = now;
  state.revision += 1;
  await store.save(state);
  if (store.runDir) await writeTranscript(store.runDir(runId), state);

  // The automation run record rides along, when the run has one: a list that
  // still says "blocked" would re-offer a wait nobody can end. Sen chat runs
  // have no record; the catch is the distinction, not an error.
  const rec = await readRunRecord(runId).catch(() => null);
  if (rec && rec.status === "blocked") {
    await writeRunRecord({
      ...rec,
      status: "failed",
      output: rec.output.kind === "runtime"
        ? { ...rec.output, finalText: `${rec.output.finalText}\n\nClosed by ${by}: ${reason}` }
        : rec.output,
    });
  }

  return { closed: true, reason, rejectedApprovals };
}
