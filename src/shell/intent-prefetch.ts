/**
 * Intent prefetch controller (Phase 19a U1, intent prefetch).
 *
 * Drives module intent prefetch: when a nav entry is hovered / focused, the
 * caller `start`s a prefetch that (a) preloads the module's lazy chunk and (b)
 * runs its prefetch data query. The controller enforces the strict
 * cancel/dedupe contract and is decoupled from navigation-pending state — it
 * only fires prefetch work, it never begins a nav.
 *
 * Per-key state machine: idle | in-flight | done | cancelled
 *
 * - Same-key dedupe: a second `start` while a key is in-flight is ignored (one
 *   load for the key).
 * - Cancel on intent change: starting a different key cancels any other
 *   in-flight prefetch (one active intent, stale work is dropped).
 * - `cancel` / `cancelAll` drop in-flight work via a generation token; a late
 *   resolve from a cancelled key is discarded (it cannot relabel the key done).
 * - `commit` is "committed navigation wins": it cancels an in-flight prefetch so
 *   the real navigation load is the ONLY fetch (no double-fetch) and then marks
 *   the key done so later intent for the just-committed module is a no-op.
 *
 * Pure module: no React, no Next.js, no DOM, no navigation state. Unit-tested
 * under node:test with fake import()/fetch work functions injected into `start`.
 */

/** Per-key prefetch lifecycle. */
export type PrefetchState = "idle" | "in-flight" | "done" | "cancelled";

/** Prefetch identity; shell callers use the module id. */
export type PrefetchKey = string;

export interface PrefetchController {
  /**
   * Begin an intent prefetch for `key`. Deduped when the same key is already
   * in-flight or done; cancels any OTHER in-flight prefetch first (intent
   * change). `work` is the caller-provided lazy-chunk + data-query subscribe.
   */
  start(key: PrefetchKey, work: () => Promise<unknown>): void;
  /** Cancel an in-flight prefetch; a late resolve stays cancelled. */
  cancel(key: PrefetchKey): void;
  /** Cancel every in-flight prefetch (intent cleared). */
  cancelAll(): void;
  /** Committed navigation wins: cancel in-flight and mark done (no double fetch). */
  commit(key: PrefetchKey): void;
  /** Current state for a key (defaults to idle). */
  state(key: PrefetchKey): PrefetchState;
  /** Read-only snapshot of every tracked key -> state. */
  snapshot(): Readonly<Record<string, PrefetchState>>;
}

/** Create a fresh, isolate-free prefetch controller. */
export function createPrefetchController(): PrefetchController {
  const states = new Map<string, PrefetchState>();
  const tokens = new Map<string, number>();
  let seq = 0;

  const cancelKey = (k: string) => {
    if (states.get(k) === "in-flight") {
      tokens.delete(k); // invalidate the generation so a pending resolve is dropped
      states.set(k, "cancelled");
    }
  };

  return {
    start(key, work) {
      const k = String(key);
      const cur = states.get(k) ?? "idle";
      // Same-key dedupe + already-satisfied guard (one load per key).
      if (cur === "in-flight" || cur === "done") return;
      // Intent change: a single active intent, so cancel any other in-flight.
      for (const other of tokens.keys()) if (other !== k) cancelKey(other);

      const token = ++seq;
      tokens.set(k, token);
      states.set(k, "in-flight");
      work().then(
        () => {
          if (tokens.get(k) !== token) return; // cancelled / superseded — drop
          tokens.delete(k);
          states.set(k, "done");
        },
        () => {
          if (tokens.get(k) !== token) return; // cancelled / superseded — drop
          tokens.delete(k);
          states.set(k, "idle"); // retryable on rejection
        },
      );
    },

    cancel(key) {
      cancelKey(String(key));
    },

    cancelAll() {
      for (const k of [...tokens.keys()]) cancelKey(k);
    },

    commit(key) {
      const k = String(key);
      // Committed navigation wins: cancel in-flight so only the navigation load
      // is issued, then mark done so later intent for this module is a no-op.
      cancelKey(k);
      states.set(k, "done");
    },

    state(key) {
      return states.get(String(key)) ?? "idle";
    },

    snapshot() {
      const out: Record<string, PrefetchState> = {};
      for (const [k, s] of states) out[k] = s;
      return out;
    },
  };
}