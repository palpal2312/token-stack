"use client";

/**
 * Ack-seed provider (Phase 19a U3) — binds the pure `AckSeedCoordinator` to the
 * shell query stack and mounts the SINGLE canonical transcript authority.
 *
 * Mounted exactly once per workspace under the shell (flag-gated by
 * DESKTOP_SHELL_V2). It seeds Phase 8b committed acks into the ONE query cache
 * BEFORE a selection renders (insert-once by commandId), derives pending from
 * the canonical active-attempt record (never a second store), and owns the
 * conditional draft-clear rule. It registers one client channel (≤1), torn down
 * on unmount.
 *
 * `ReconciledTranscript` renders the committed turns for the attested session
 * from the cache — the single authority — so an active-session switch paints the
 * committed transcript from cache with no skeleton flash from a second store,
 * and switching surfaces never double-renders the transcript (this node lives
 * above the surface frames and is mounted once). When no session is attested it
 * renders nothing, so the production default is byte-equivalent.
 *
 * `fixtureEnabled` (server-read AGENTIC_OS_ALLOW_TEST_FIXTURE, default OFF)
 * mounts a `window.__newsosAckSeed` diagnostic that drives the same
 * `seedCommittedAck` / `derivePendingFromAttempt` / `shouldClearDraft` the real
 * send-turn flow uses. It never manufactures an ack — the cache read stays
 * authoritative.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@/lib/query/query-client";
import { queryKeys, serializeQueryKey } from "@/lib/query/query-keys";
import type { ChatAttempt } from "@/lib/sen/chat-client";
import {
  AckSeedCoordinator,
  pendingKind,
  shouldClearDraft,
  type ActiveAttemptRecord,
  type CommittedChatAck,
  type ComposeTarget,
  type PendingView,
} from "@/lib/query/ack-seed";

interface AckSeedValue {
  seedCommittedAck: (ack: CommittedChatAck) => "inserted" | "duplicate";
  isSeeded: (commandId: string) => boolean;
  pendingFor: (sessionId: string) => PendingView;
  activeAttempt: (sessionId: string) => ActiveAttemptRecord | undefined;
  threadRows: (sessionId: string) => ReturnType<AckSeedCoordinator["threadRows"]>;
  shouldClearDraft: (ack: Pick<CommittedChatAck, "sessionId">, compose: ComposeTarget) => boolean;
  seededCount: () => number;
  /** The workspace this coordinator/transcript is scoped to. */
  workspaceId: string;
  /** The session the single canonical transcript attests (test-directed). */
  attestedSessionId: string | null;
  setAttestedSession: (sessionId: string | null) => void;
  /** Diagnostic handle (present only under the QA fixture flag). */
  debug: () => AckSeedDebug | null;
}

type AckSeedDebug = {
  seed: (ack: CommittedChatAck) => "inserted" | "duplicate";
  attest: (sessionId: string | null) => void;
  pending: (sessionId: string) => PendingView;
  pendingKind: (state?: ChatAttempt["state"]) => PendingView["kind"];
  clearDraft: (ack: Pick<CommittedChatAck, "sessionId">, compose: ComposeTarget) => boolean;
  thread: (sessionId: string) => ReturnType<AckSeedCoordinator["threadRows"]>;
  active: (sessionId: string) => ActiveAttemptRecord | undefined;
  seeded: () => number;
};

const AckSeedContext = createContext<AckSeedValue | null>(null);

/** Read the shell's ack-seed authority (single canonical transcript seed path). */
export function useAckSeed(): AckSeedValue {
  const v = useContext(AckSeedContext);
  if (!v) throw new Error("useAckSeed must be used within AckSeedProvider");
  return v;
}

export function AckSeedProvider({
  workspaceId,
  fixtureEnabled = false,
  children,
}: {
  workspaceId: string;
  fixtureEnabled?: boolean;
  children: ReactNode;
}) {
  const { client } = useQueryClient();
  const coordRef = useRef<AckSeedCoordinator | null>(null);
  if (coordRef.current === null) coordRef.current = new AckSeedCoordinator({ workspaceId, client });
  const coord = coordRef.current;

  useEffect(() => {
    const teardown = coord.register();
    return teardown;
  }, [coord]);

  // Single attested-session for the canonical transcript (test-directed; null default).
  const [attestedSessionId, setAttestedSession] = useState<string | null>(null);
  const attestRef = useRef(setAttestedSession);
  attestRef.current = setAttestedSession;

  const value = useMemo<AckSeedValue>(
    () => ({
      seedCommittedAck: (ack) => coord.seedCommittedAck(ack),
      isSeeded: (commandId) => coord.isSeeded(commandId),
      pendingFor: (sessionId) => coord.pendingFor(sessionId),
      activeAttempt: (sessionId) => coord.activeAttempt(sessionId),
      threadRows: (sessionId) => coord.threadRows(sessionId),
      shouldClearDraft: (ack, compose) => shouldClearDraft(ack, compose),
      seededCount: () => coord.seededCount(),
      workspaceId,
      attestedSessionId,
      setAttestedSession,
      debug: () => (fixtureEnabled ? debugHandle(coord, attestRef) : null),
    }),
    [coord, workspaceId, attestedSessionId, fixtureEnabled],
  );

  // QA fixture sink: only mounted when the server-read AGENTIC_OS_ALLOW_TEST_FIXTURE
  // is on. Drives the SAME pure seed/pending/draft functions as the real flow.
  useEffect(() => {
    if (!fixtureEnabled) return;
    window.__newsosAckSeed = debugHandle(coord, attestRef);
    return () => {
      delete window.__newsosAckSeed;
    };
  }, [fixtureEnabled, coord]);

  return (
    <AckSeedContext.Provider value={value}>
      {children}
      <ReconciledTranscript />
    </AckSeedContext.Provider>
  );
}

function debugHandle(coord: AckSeedCoordinator, attestRef: { current: (s: string | null) => void }): AckSeedDebug {
  return {
    seed: (ack) => coord.seedCommittedAck(ack),
    attest: (sessionId) => attestRef.current(sessionId),
    pending: (sessionId) => coord.pendingFor(sessionId),
    pendingKind: (state) => pendingKind(state),
    clearDraft: (ack, compose) => shouldClearDraft(ack, compose),
    thread: (sessionId) => coord.threadRows(sessionId),
    active: (sessionId) => coord.activeAttempt(sessionId),
    seeded: () => coord.seededCount(),
  };
}

/**
 * The single canonical transcript authority. Reads committed turns and the
 * derived pending decoration from the QUERY CACHE only — never a second store.
 * Renders one `<ol data-attest-transcript>` per attested session; switching
 * surfaces or sessions re-reads this same node (mounted once above the frames),
 * so it can never double-render the transcript. Renders nothing when no session
 * is attested, so the default shell is byte-equivalent.
 */
function ReconciledTranscript() {
  const ack = useAckSeed();
  const { client } = useQueryClient();
  const { workspaceId } = ack;
  const sessionId = ack.attestedSessionId;

  // Re-render whenever the canonical thread/active-attempt cache for this session
  // changes (a committed ack advances the attempt, a realtime delta patches the
  // thread, a canonical replace restores it). The transcript and its derived
  // pending decoration are pure projections of that cache — subscribing to the
  // same QueryClient snapshot keeps them fresh without a second store. Hooks must
  // be called unconditionally (before any early return).
  const snapshotKey = serializeQueryKey(queryKeys.thread.detail(workspaceId, sessionId ?? ""));
  const activeKey = serializeQueryKey(queryKeys.chatAttempt.active(workspaceId));
  // Server/SSR snapshot: nothing is cached on the server, so the first paint
  // always reports -1 (empty); the client snapshot drives subsequent renders.
  useSyncExternalStore(
    (cb) => client.subscribe(cb),
    () => {
      const snap = client.getSnapshot();
      const thread = snap.get(snapshotKey);
      const active = snap.get(activeKey);
      return `${thread?.updatedAt ?? -1}:${active?.updatedAt ?? -1}`;
    },
    () => "-1:-1",
  );

  if (!sessionId) return null;

  const turns = ack.threadRows(sessionId);
  const pending = ack.pendingFor(sessionId);
  if (turns.length === 0) return null;

  return (
    <div data-attest-transcript aria-label="Canonical SEN transcript">
      <span
        data-attest-pending
        data-kind={pending.kind}
        data-pending={pending.pending ? "true" : "false"}
      >
        {pending.pending ? "pending" : pending.kind}
      </span>
      <ol>
        {turns.map((t) => (
          <li key={t.turnSeq} data-attest-turn={t.turnSeq} data-turn-id={t.turnId} data-attempt={t.chatAttemptId}>
            {t.content}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Window diagnostic typing (client-only QA sink).
declare global {
  interface Window {
    __newsosAckSeed?: AckSeedDebug;
  }
}