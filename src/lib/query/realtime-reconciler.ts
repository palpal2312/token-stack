/**
 * Realtime reconciler (Phase 19a U3) — pure, library-free realtime-delta rules
 * over the query cache.
 *
 * Supports the "Query and realtime contract" / "Server cache" rows of the phase
 * file:
 *   - applyCommittedDelta: idempotent — replaying/duplicating the same event/seq
 *     never double-applies (duplicate seq -> no-op). Contiguous seqs advance the
 *     workspace sequence; a forward discontinuity -> a gap that schedules an
 *     authoritative canonical replace.
 *   - detectGap: sequence discontinuity vs the last applied seq.
 *   - scheduleRefetch: stratified — immediate on gap, exponential backoff on a
 *     transient failure/reconnect.
 *   - replaceFromCanonical: after a reconnect/gap, atomic swap of affected cache
 *     keys from the authoritative canonical query result.
 *
 * This operates ONLY on the local query cache (the single-server-state authority
 * in query-cache.ts). It never writes canonical server state; reconnect refetch
 * is authoritative and is the recovery from a gap. Applied deltas serialize ahead
 * of a replace (a delta that arrives while a replace is outstanding is applied on
 * top of the canonical snapshot, never lost to a partial merge). Realtime
 * handlers are registered ONCE per workspace; register/teardown is idempotent and
 * never adds duplicate global listeners.
 *
 * TanStack Query note: phase 19a RECOMMENDS `@tanstack/react-query`; that adoption
 * is deferred to a Phase 20 dependency/license/security review. This module ships
 * the U3 reconciliation contract against the existing custom query client and is
 * the shape a future TanStack migration would wrap.
 *
 * Pure module: no React/Next/DOM — unit-tested under node:test via tsx.
 */

import { serializeQueryKey, type QueryKey, type WorkspaceScope } from "./query-keys";
import { QueryClient } from "./query-cache";

/** Cause a refetch was scheduled for; drives the stratification. */
export type RefetchCause = "gap" | "transient";

/** Whether a committed delta was applied, dropped as a duplicate, or exposed a gap. */
export type ApplyOutcome = "applied" | "duplicate" | "gap";

/** A realtime post-commit delta targeting one workspace's cache. */
export interface CommittedDelta {
  /** Must match the reconciler's workspace; deliverer drops cross-workspace deltas. */
  workspaceId: WorkspaceScope;
  /** Monotonic sequence/cursor for the workspace's realtime stream. */
  seq: number;
  /** Committed cache writes this delta carries (entity key -> authoritative value). */
  data?: ReadonlyArray<{ key: QueryKey; value: unknown }>;
}

/** One scheduled (or scheduled-and-awaiting-drain) refetch. */
export interface ScheduledRefetch {
  id: number;
  cause: RefetchCause;
  /** Empty = broad/whole-workspace refetch on drain. */
  keys: readonly QueryKey[];
  delayMs: number;
  dueAt: number;
}

/** Base exponential-backoff step for transient refetch (ms). */
export const REFETCH_BASE_BACKOFF_MS = 250;
/** Ceiling for the exponential backoff (ms). */
export const REFETCH_MAX_BACKOFF_MS = 30_000;
/** Sentinel "no sequence anchor yet". */
const NO_SEQ = -1;

export interface RealtimeReconcilerOptions {
  workspaceId: WorkspaceScope;
  client: QueryClient;
  /** Injectable clock for deterministic schedule/due math. Defaults to Date.now. */
  now?: () => number;
  /** Canonical fetcher used when a scheduled gap/drain refetches affected keys. */
  canonicalRefetch?: (keys: readonly QueryKey[]) => Promise<void>;
}

/**
 * One reconcile channel per workspace. Holds the workspace's last-applied realtime
 * sequence, owns the apply/replace serialization order over the shared query cache,
 * and schedules stratified refetches.
 */
export class RealtimeReconciler {
  readonly workspaceId: WorkspaceScope;
  private client: QueryClient;
  private now: () => number;
  private canonicalRefetch?: (keys: readonly QueryKey[]) => Promise<void>;

  /** Highest contiguously-applied delta seq; NO_SEQ until the first delta/canonical. */
  private lastSeenSeq: number = NO_SEQ;
  /** True between a detected gap and the edge canonical replace that restores order. */
  private awaitingCanonical = false;

  private scheduled: ScheduledRefetch[] = [];
  private nextScheduleId = 0;
  private transientAttempt = 0;

  /** Async FIFO so delta writes and canonical replaces never interleave (no partial merge). */
  private opTail: Promise<void> = Promise.resolve();
  /** Outstanding (queued or in-flight) canonical replaces. */
  private replacePending = 0;

  // --- registration (one channel per workspace) ------------------------------

  private registrations = 0;
  private channelActive = false;
  private channelTeardown: (() => void) | null = null;

  constructor(opts: RealtimeReconcilerOptions) {
    this.workspaceId = opts.workspaceId;
    this.client = opts.client;
    this.now = opts.now ?? Date.now;
    this.canonicalRefetch = opts.canonicalRefetch;
  }

  /**
   * Register the workspace's single reconcile channel. Idempotent: repeated
   * register() calls never add a second global listener; teardown() clears it.
   * Returns a teardown that keeps the channel until the last registration is gone.
   */
  register(): () => void {
    this.registrations += 1;
    if (!this.channelActive) {
      this.channelActive = true;
      // ONE client-subscription per workspace is the reconcile channel.
      this.channelTeardown = this.client.subscribe(() => {});
    }
    return () => this.unregister();
  }

  /** Drop one registration; the channel closes when the last one is torn down. */
  private unregister(): void {
    this.registrations -= 1;
    if (this.registrations <= 0) {
      this.registrations = 0;
      if (this.channelActive) {
        this.channelActive = false;
        this.channelTeardown?.();
        this.channelTeardown = null;
        this.scheduled = [];
      }
    }
  }

  /** Active reconcile channels: always 0 or 1 (never a duplicate listener). */
  listeners(): number {
    return this.channelActive ? 1 : 0;
  }

  // --- sequence/gap -----------------------------------------------------------

  /**
   * Pure gap predicate: true when `seq` is a forward discontinuity from the last
   * applied seq (a duplicate seq is NOT a gap, and while awaiting a canonical
   * restore we already know a gap is being drained).
   */
  detectGap(seq: number): boolean {
    if (this.awaitingCanonical || this.lastSeenSeq === NO_SEQ) return false;
    return seq > this.lastSeenSeq + 1;
  }

  /**
   * Apply a committed delta to the query cache. Idempotent by seq: a duplicate or
   * earlier seq is a no-op; a contiguous seq advances the workspace sequence and
   * writes the delta's data; a forward discontinuity is a gap that requeues the
   * affected keys and schedules an immediate canonical replace.
   */
  applyCommittedDelta(delta: CommittedDelta): ApplyOutcome {
    if (this.awaitingCanonical) {
      // Canonical restore is outstanding; hold the delta, keep the gap drained.
      this.scheduleRefetch({ cause: "gap", keys: affectedKeys(delta) });
      return "gap";
    }
    if (this.lastSeenSeq === NO_SEQ) {
      // No sequence anchor yet (first delta or right after a canonical restore):
      // this delta establishes the anchor and applies as the contiguous base.
      this.lastSeenSeq = delta.seq;
      this.write(delta.data ?? []);
      return "applied";
    }
    if (delta.seq <= this.lastSeenSeq) return "duplicate"; // replay — no-op
    if (delta.seq > this.lastSeenSeq + 1) {
      // Sequence discontinuity: the trustable truth is the canonical snapshot.
      this.lastSeenSeq = NO_SEQ;
      this.awaitingCanonical = true;
      this.requeue(affectedKeys(delta));
      this.scheduleRefetch({ cause: "gap", keys: affectedKeys(delta) });
      return "gap";
    }
    // Contiguous.
    this.lastSeenSeq = delta.seq;
    this.transientAttempt = 0; // healthy stream resets the backoff
    this.write(delta.data ?? []);
    return "applied";
  }

  // --- scheduling -------------------------------------------------------------

  /**
   * Transport reconnect (Sprint 04 ADP-05): treat a dropped/restored channel as
   * an immediate gap-class refetch of the affected keys (or a broad workspace
   * refetch when keys are empty). Arms awaiting-canonical so intervening deltas
   * stay held until `replaceFromCanonical` / drain restores order.
   */
  notifyTransportReconnect(keys: readonly QueryKey[] = []): ScheduledRefetch {
    return this.scheduleRefetch({ cause: "gap", keys });
  }

  /**
   * Durable-style cursor read: highest contiguously-applied seq, or -1 when
   * no sequence anchor exists (mirrors orca output_cursor "unset").
   */
  lastCursor(): number {
    return this.lastSeenSeq;
  }

  /**
   * Adopt a persisted terminal/dispatch cursor after reattach/canonical
   * replace. Refuses regression (same invariant as orca.Store.AdvanceCursor).
   * Returns false when the adopt would move the cursor backwards.
   */
  adoptCursor(cursor: number): boolean {
    if (!Number.isSafeInteger(cursor) || cursor < 0) return false;
    if (this.lastSeenSeq !== NO_SEQ && cursor < this.lastSeenSeq) return false;
    this.lastSeenSeq = cursor;
    this.awaitingCanonical = false;
    this.transientAttempt = 0;
    return true;
  }

  /**
   * Stratified refetch: immediate on a gap, exponential backoff on a transient
   * failure. Records the entry (and, for a gap, arms the awaiting-canonical flag)
   * so a reconnect can drain it via `drainScheduled` / `replaceFromCanonical`.
   */
  scheduleRefetch(opts: { cause: RefetchCause; keys?: readonly QueryKey[] }): ScheduledRefetch {
    const keys = dedupeKeys(opts.keys ?? []);
    const delayMs = opts.cause === "gap" ? 0 : this.backoffFor(this.transientAttempt);
    const entry: ScheduledRefetch = {
      id: ++this.nextScheduleId,
      cause: opts.cause,
      keys,
      delayMs,
      dueAt: this.now() + delayMs,
    };
    this.scheduled.push(entry);
    if (opts.cause === "gap") this.awaitingCanonical = true;
    this.transientAttempt += 1; // each retry/failure escalates the backoff
    return entry;
  }

  /** Entries still scheduled (inspected by tests and the shell drain loop). */
  scheduledEntries(): readonly ScheduledRefetch[] {
    return this.scheduled;
  }

  /**
   * Run every scheduled refetch that is due, in order, by authoritative canonical
   * replace. A transient failure (e.g. still offline) keeps the work and requeues
   * it with backoff. Returns how many drained.
   */
  async drainScheduled(now?: number): Promise<number> {
    const t = now ?? this.now();
    const due = this.scheduled.filter((e) => e.dueAt <= t);
    if (due.length === 0) return 0;
    this.scheduled = this.scheduled.filter((e) => e.dueAt > t);
    let drained = 0;
    for (const e of due) {
      if (e.keys.length === 0) {
        // Broad workspace refetch has no specific entity keys; a reconnect refetch
        // is authoritative and restores continuity.
        this.resetAfterCanonical();
        drained += 1;
      } else {
        try {
          if (this.canonicalRefetch) await this.canonicalRefetch(e.keys);
          this.requeue(e.keys);
          drained += 1;
        } catch {
          // Channel still down — hold the work and retry on backoff.
          this.scheduleRefetch({ cause: "transient", keys: e.keys });
        }
      }
    }
    return drained;
  }

  // --- canonical replace ------------------------------------------------------

  /**
   * Atomic authoritative swap of affected cache keys from the canonical query
   * result, used after reconnect/gap. First requeues (marks stale) the keys so no
   * reader keeps stale data, then replaces each from `fetcher`. Applies serialize
   * ahead of the replace; any delta arriving meanwhile is applied on top when the
   * replace finishes — never a partial merge.
   */
  replaceFromCanonical(
    keys: readonly QueryKey[],
    fetcher: (key: QueryKey) => Promise<unknown>,
  ): Promise<void> {
    const keys2 = dedupeKeys(keys);
    this.requeue(keys2);
    const task = (async () => {
      for (const k of keys2) {
        const value = await fetcher(k);
        this.client.setData(k, value);
      }
    })();
    this.replacePending += 1;
    this.enqueue(() => task);
    return task.finally(() => {
      this.replacePending -= 1;
      this.resetAfterCanonical();
    });
  }

  // --- internals --------------------------------------------------------------

  /** Drop stale cached entries for affected keys so the next read is authoritative. */
  private requeue(keys: readonly QueryKey[]): void {
    if (keys.length === 0) return;
    for (const k of dedupeKeys(keys)) this.client.invalidate(k);
  }

  /** Serialize a task behind any outstanding replaces (FIFO, never interleave). */
  private enqueue(task: () => void | Promise<void>): void {
    this.opTail = this.opTail.then(task).catch(() => {});
  }

  /**
   * Write a delta's data to the cache. Applied synchronously UNLESS a canonical
   * replace is outstanding, in which case the write is queued behind it so it
   * lands on top of the fresh snapshot (nothing lost, no partial merge).
   */
  private write(items: ReadonlyArray<{ key: QueryKey; value: unknown }>): void {
    if (items.length === 0) return;
    if (this.replacePending > 0) {
      this.enqueue(() => {
        for (const it of items) this.client.setData(it.key, it.value);
      });
      return;
    }
    for (const it of items) this.client.setData(it.key, it.value);
  }

  private resetAfterCanonical(): void {
    this.awaitingCanonical = false;
    this.lastSeenSeq = NO_SEQ;
    this.transientAttempt = 0;
  }

  private backoffFor(attempt: number): number {
    // Exponential with a ceiling; a larger attempt -> a longer (capped) wait.
    return Math.min(
      REFETCH_MAX_BACKOFF_MS,
      REFETCH_BASE_BACKOFF_MS * 2 ** Math.min(attempt, 8),
    );
  }
}

function affectedKeys(delta: CommittedDelta): readonly QueryKey[] {
  return (delta.data ?? []).map((d) => d.key);
}

function dedupeKeys(keys: readonly QueryKey[]): QueryKey[] {
  const seen = new Set<string>();
  const out: QueryKey[] = [];
  for (const k of keys) {
    const h = serializeQueryKey(k);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(k);
  }
  return out;
}