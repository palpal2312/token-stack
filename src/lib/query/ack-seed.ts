/**
 * Ack-seed coordinator — Phase 8b committed ack into the unified query cache
 * (Phase 19a U3, "Seed Phase 8b committed ack before changing active session;
 * derive pending state from canonical active attempt; keep draft on send
 * failure").
 *
 * This is the "Send UX" contract row: the committed ack (commandId +
 * chatAttemptId + canonical turn ids) is INSERTED INTO THE QUERY CACHE once, so
 * an active-session switch renders the committed transcript from the single
 * cache authority — never a skeleton flash from a second store, and never an
 * optimistic fake id outside the compose surface.
 *
 *   - insert-once: a retried command id (persist-before-ack replay via the
 *     canonical /api/sen/chat envelope) returns the ORIGINAL committed result
 *     and must never double-insert a turn. The commandId is the dedupe key.
 *   - pending derive: pending/queued presentation is DERIVED from the canonical
 *     active chat-attempt state stored in the cache — it is a pure function of
 *     that record, never a second local store. Reads recompute, so when the
 *     attempt advances or terminates the pending decoration follows.
 *   - draft survival: draft clearing is CONDITIONAL on the acknowledged compose
 *     target. A committed ack for session S clears the draft for S only; an ack
 *     landing for any other session never clears S's draft (a background send
 *     finishing must not wipe the text the user is still composing).
 *   - channel: each coordinator registers ONE client subscription (≤1 per
 *     channel), idempotent and torn down with the last registration — the same
 *     listener invariant the realtime reconciler owns.
 *
 * Pure module: no React/Next/DOM. Unit-tested under node:test via tsx.
 */

import type { ChatAttempt } from "../sen/chat-client";
import { type QueryKey, type WorkspaceScope, queryKeys } from "./query-keys";
import { QueryClient } from "./query-cache";

/** The canonical Phase 8b committed ack, as landed after persist-before-ack. */
export interface CommittedChatAck {
  /** Client receipt key; the dedupe identity for a (re)played send. */
  commandId: string;
  /** Canonical session the turn was committed to. */
  sessionId: string;
  /** Canonical turn id the ack produced. */
  turnId: string;
  /** Monotonic canonical turn sequence for the session thread. */
  turnSeq: number;
  /** Canonical chat-attempt id the ack opened/advanced. */
  chatAttemptId: string;
  /** Committed attempt state (queued/claimed/running after persist-before-ack). */
  status?: ChatAttempt["state"];
  /** User text committed (display + canonical read; never overwrites server). */
  content?: string;
  /** Canonical commit timestamp. */
  recordedAt?: string;
}

/** Canonical active-attempt record as stored in the cache (chat-attempt.active). */
export interface ActiveAttemptRecord {
  chatAttemptId: string;
  sessionId: string;
  state: ChatAttempt["state"];
  inputFirstTurnSeq: number;
  inputLastTurnSeq: number;
  updatedAt: number;
}

/** Result of an idempotent seed of a committed ack. */
export type AckSeedOutcome = "inserted" | "duplicate";

/** Derived pending view (never stored — recomputed from the canonical attempt). */
export interface PendingView {
  /** True when the canonical attempt is not yet terminal. */
  pending: boolean;
  /** queued | active (claimed/running) | terminal | none. */
  kind: "queued" | "active" | "terminal" | "none";
  /** The canonical attempt.id the pending view is derived from. */
  chatAttemptId: string | null;
  /** Pending turn seqs while non-terminal (derived, not a mirror). */
  pendingTurnSeqs: readonly number[];
}

/** The compose the user is authoring (the conditional draft-clear target). */
export interface ComposeTarget {
  /** Canonical session the composer is typing into. */
  sessionId: string;
  /** Surface the composer is mounted on (optional stricter match). */
  surface?: "page" | "side-panel" | "floating";
}

export interface AckSeedCoordinatorOptions {
  workspaceId: WorkspaceScope;
  client: QueryClient;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

const TERMINAL_STATES: readonly ChatAttempt["state"][] = [
  "succeeded",
  "failed",
  "cancelled",
  "no_response",
];

/** Pure pending-state classifier over the canonical attempt state. */
export function pendingKind(state: ChatAttempt["state"] | undefined): PendingView["kind"] {
  if (!state) return "none";
  if (state === "queued") return "queued";
  if (state === "claimed" || state === "running") return "active";
  return "terminal";
}

/**
 * Derive the pending/queued presentation from the CANONICAL active attempt
 * (in the cache). Pure and stateless: given the same attempt it always yields
 * the same view, and it follows advance/termination automatically — there is no
 * second store to desync.
 */
export function derivePendingFromAttempt(attempt: ActiveAttemptRecord | undefined): PendingView {
  if (!attempt) return { pending: false, kind: "none", chatAttemptId: null, pendingTurnSeqs: [] };
  const kind = pendingKind(attempt.state);
  const pending = kind === "queued" || kind === "active";
  const pendingTurnSeqs: number[] = [];
  if (pending) {
    for (let s = attempt.inputFirstTurnSeq; s <= attempt.inputLastTurnSeq; s += 1) {
      pendingTurnSeqs.push(s);
    }
  }
  return { pending, kind, chatAttemptId: attempt.chatAttemptId, pendingTurnSeqs };
}

/**
 * Draft-clear predicate. A draft for a compose target is cleared ONLY when the
 * canonical ack lands for THAT target (same canonical session; optionally the
 * same surface). An ack for any other session — e.g. a background send that
 * finished after the user pivoted — never clears the currently-authored draft.
 */
export function shouldClearDraft(
  ack: Pick<CommittedChatAck, "sessionId">,
  compose: ComposeTarget,
): boolean {
  return ack.sessionId === compose.sessionId;
}

/**
 * One ack-seed coordinator per workspace: seeds Phase 8b committed acks into
 * the single query cache (insert-once), derives pending from canonical attempt
 * state, and owns the conditional draft-clear rule. Reads/writes the same cache
 * the realtime reconciler and components use — there is no second authority.
 */
export class AckSeedCoordinator {
  readonly workspaceId: WorkspaceScope;
  private client: QueryClient;
  private now: () => number;

  /** commandIds already seeded for this workspace (replay -> duplicate, no re-insert). */
  private seededCommandIds = new Map<string, ActiveAttemptRecord>();

  // --- channel (≤1 per workspace) --------------------------------------------
  private registrations = 0;
  private channelActive = false;
  private channelTeardown: (() => void) | null = null;

  constructor(opts: AckSeedCoordinatorOptions) {
    this.workspaceId = opts.workspaceId;
    this.client = opts.client;
    this.now = opts.now ?? Date.now;
  }

  /** One registered client-subscription channel; idempotent, torn down at last. */
  register(): () => void {
    this.registrations += 1;
    if (!this.channelActive) {
      this.channelActive = true;
      this.channelTeardown = this.client.subscribe(() => {});
    }
    return () => this.unregister();
  }

  private unregister(): void {
    this.registrations -= 1;
    if (this.registrations <= 0) {
      this.registrations = 0;
      if (this.channelActive) {
        this.channelActive = false;
        this.channelTeardown?.();
        this.channelTeardown = null;
      }
    }
  }

  /** Active ack-seed channels: always 0 or 1 (no duplicate listener). */
  listeners(): number {
    return this.channelActive ? 1 : 0;
  }

  // --- seed before switch ----------------------------------------------------

  /**
   * Insert the committed ack into the query cache BEFORE any selection renders.
   * Idempotent by commandId: a replay (persist-before-ack retry of the canonical
   * envelope) returns "duplicate" and never double-inserts the turn. Writes only
   * canonical ids — no optimistic fake ids escape to the cache here.
   */
  seedCommittedAck(ack: CommittedChatAck): AckSeedOutcome {
    if (ack.sessionId !== undefined && this.isSeeded(ack.commandId)) return "duplicate";
    this.markSeeded(ack);
    this.writeAck(ack);
    return "inserted";
  }

  /** True when the commandId was already committed and seeded once. */
  isSeeded(commandId: string): boolean {
    return this.seededCommandIds.has(commandId);
  }

  /** Number of distinct committed acks seeded (test/diagnostic). */
  seededCount(): number {
    return this.seededCommandIds.size;
  }

  /** Read a session's canonical active-attempt record from the cache. */
  activeAttempt(sessionId: string): ActiveAttemptRecord | undefined {
    return this.client.getData<Record<string, ActiveAttemptRecord>>(
      this.activeKey(),
    )?.[sessionId];
  }

  /** Derive the pending view for a session from the canonical attempt (cache). */
  pendingFor(sessionId: string): PendingView {
    return derivePendingFromAttempt(this.activeAttempt(sessionId));
  }

  /** Canonical committed turns for a session (the single thread authority). */
  threadRows(sessionId: string): ReadonlyArray<{
    turnId: string;
    turnSeq: number;
    role: string;
    chatAttemptId: string;
    clientCommandId: string;
    content: string;
  }> {
    const thread = this.client.getData<ReadonlyArray<Record<string, unknown>>>(this.threadKey(sessionId)) ?? [];
    return thread.map((t) => ({
      turnId: String(t.turnId ?? ""),
      turnSeq: Number(t.turnSeq ?? 0),
      role: String(t.role ?? ""),
      chatAttemptId: String(t.chatAttemptId ?? ""),
      clientCommandId: String(t.clientCommandId ?? ""),
      content: String(t.content ?? ""),
    }));
  }

  private activeKey(): QueryKey {
    return queryKeysChatAttemptActive(this.workspaceId);
  }

  private threadKey(sessionId: string): QueryKey {
    return queryKeysThreadDetail(this.workspaceId, sessionId);
  }

  private attemptDetailKey(chatAttemptId: string): QueryKey {
    return queryKeysChatAttemptDetail(this.workspaceId, chatAttemptId);
  }

  private markSeeded(ack: CommittedChatAck): void {
    this.seededCommandIds.set(ack.commandId, {
      chatAttemptId: ack.chatAttemptId,
      sessionId: ack.sessionId,
      state: ack.status ?? "running",
      inputFirstTurnSeq: ack.turnSeq,
      inputLastTurnSeq: ack.turnSeq,
      updatedAt: this.now(),
    });
  }

  /** Apply the canonical ack to the cache: thread turn + attempt records. */
  private writeAck(ack: CommittedChatAck): void {
    const now = this.now();
    const record: ActiveAttemptRecord = {
      chatAttemptId: ack.chatAttemptId,
      sessionId: ack.sessionId,
      state: ack.status ?? "running",
      inputFirstTurnSeq: ack.turnSeq,
      inputLastTurnSeq: ack.turnSeq,
      updatedAt: now,
    };

    // Canonical active-attempt summary per session (the pending authority).
    const active = this.client.getData<Record<string, ActiveAttemptRecord>>(this.activeKey()) ?? {};
    this.client.setData(this.activeKey(), { ...active, [ack.sessionId]: record });

    // Canonical attempt record (detail), the single entity authority.
    const priorAttempt = this.client.getData<unknown>(this.attemptDetailKey(ack.chatAttemptId));
    if (priorAttempt === undefined) {
      this.client.setData(this.attemptDetailKey(ack.chatAttemptId), {
        chatAttemptId: ack.chatAttemptId,
        sessionId: ack.sessionId,
        state: ack.status ?? "running",
        inputFirstTurnSeq: ack.turnSeq,
        inputLastTurnSeq: ack.turnSeq,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Canonical thread turn — idempotent by canonical turn seq (never a phantom).
    const thread = this.client.getData<ReadonlyArray<Record<string, unknown>>>(this.threadKey(ack.sessionId)) ?? [];
    if (!thread.some((t) => t.turnSeq === ack.turnSeq)) {
      this.client.setData(this.threadKey(ack.sessionId), [
        ...thread,
        {
          turnId: ack.turnId,
          turnSeq: ack.turnSeq,
          sessionId: ack.sessionId,
          role: "user",
          chatAttemptId: ack.chatAttemptId,
          clientCommandId: ack.commandId,
          content: ack.content ?? "",
          recordedAt: ack.recordedAt ?? new Date(now).toISOString(),
        },
      ]);
    }
  }

  /** Clear a session's active-attempt record (e.g. after a canonical replace). */
  clearActive(sessionId: string): void {
    const active = this.client.getData<Record<string, ActiveAttemptRecord>>(this.activeKey());
    if (active && sessionId in active) {
      const next = { ...active };
      delete next[sessionId];
      this.client.setData(this.activeKey(), next);
    }
  }
}

// Query-key helpers (local aliases so this module stays framework-free).
function queryKeysChatAttemptActive(workspaceId: WorkspaceScope): QueryKey {
  return queryKeys.chatAttempt.active(workspaceId);
}
function queryKeysChatAttemptDetail(workspaceId: WorkspaceScope, attemptId: string): QueryKey {
  return queryKeys.chatAttempt.detail(workspaceId, attemptId);
}
function queryKeysThreadDetail(workspaceId: WorkspaceScope, sessionId: string): QueryKey {
  return queryKeys.thread.detail(workspaceId, sessionId);
}