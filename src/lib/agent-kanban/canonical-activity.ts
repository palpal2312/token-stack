// Canonical-first activity read shared by the compat events routes. When the
// Go control plane is configured, the activity timeline comes from the
// canonical event spine (GET /v1/kanban/activity); callers fall back to the
// legacy JSONL store when this returns null.

import { goApiAvailable, goApiFetch } from "@/lib/goApiProxy";
import {
  goActivityToKanbanEvents,
  type GoActivityResponse,
} from "./go-adapter";
import type { KanbanEvent } from "./types";

/**
 * Read canonical activity with legacy getEvents paging semantics. Returns null
 * when the canonical path is unavailable/unreachable — never throws.
 *
 * Legacy semantics exclude seq <= since in both modes, so the cursor always
 * starts at `since`. Backward paging (`before` set) loops until the window
 * reaches `before` (or the spine is exhausted): one canonical page holds at
 * most 1000 entries.
 */
export async function fetchCanonicalEvents(
  since: number,
  opts: { cardId?: string; limit: number; before?: number },
): Promise<KanbanEvent[] | null> {
  if (!(await goApiAvailable())) return null;
  const backward = opts.before !== undefined;
  const collected: KanbanEvent[] = [];
  let after = since;
  let exhausted = false;
  for (let page = 0; page < 20; page++) {
    const result = await goApiFetch(`/v1/kanban/activity?after=${after}&limit=1000`);
    if (!result.ok || !result.body || typeof result.body !== "object") return null;
    const raw = (result.body as GoActivityResponse).activity ?? [];
    const batch = goActivityToKanbanEvents(raw);
    // The Go endpoint fills each page to 1000 raw entries unless the spine
    // ended, so a short RAW page means there is nothing more to read. (The
    // adapted batch can be shorter when the adapter drops an unknown kind —
    // that must not read as exhaustion.)
    if (raw.length < 1000) exhausted = true;
    if (batch.length === 0) {
      if (exhausted) break;
      after = raw[raw.length - 1].Seq ?? after;
      continue;
    }
    collected.push(...batch);
    after = batch[batch.length - 1].seq;
    if (exhausted || !backward || after >= Number(opts.before) - 1) break;
  }
  // If the page cap was hit before the window reached `before`, serving the
  // partial window would silently return the wrong page — fall back to the
  // legacy store instead (it reads the full tail uncapped). A genuinely
  // exhausted spine is complete, not partial, so it never triggers this.
  if (backward && !exhausted && after < Number(opts.before) - 1) return null;
  let events = collected;
  if (opts.cardId) events = events.filter((event) => event.cardId === opts.cardId);
  if (backward) events = events.filter((event) => event.seq < Number(opts.before));
  return backward || since === 0
    ? events.slice(-opts.limit)
    : events.slice(0, opts.limit);
}

/** True when the canonical activity path is configured (no reachability probe). */
export async function canonicalActivityAvailable(): Promise<boolean> {
  return goApiAvailable();
}
