// Typed client for the canonical Go SEN Chat surface (phase 08b C4).
//
// The UI talks to the Next.js compatibility proxy routes under /api/sen/chat;
// the proxy forwards to the Go control plane. Canonical IDs everywhere;
// localStorage is never a history store — only view preferences.

export interface ChatSession {
  sessionId: string;
  workspaceId: string;
  title: string;
  status: string;
  selectedBuilderPolicy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTurnRow {
  turnId: string;
  turnSeq: number;
  sessionId: string;
  role: string;
  messageKind: string;
  content: string;
  chatAttemptId: string;
  clientCommandId: string;
  recordedAt: string;
}

export interface ChatAttempt {
  chatAttemptId: string;
  sessionId: string;
  inputFirstTurnSeq: number;
  inputLastTurnSeq: number;
  ordinal: number;
  state: "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled" | "no_response";
  builderId: string;
  leaseOwner: string;
  leaseGeneration: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStreamEvent {
  chatAttemptId: string;
  seq: number;
  eventKind: string;
  payload: unknown;
  redactionClass: string;
  recordedAt: string;
}

export interface SendTurnReceipt {
  commandId: string;
  sessionId: string;
  turnId: string;
  turnSeq: number;
  chatAttemptId: string;
  status: string;
}

export function newSessionId(): string {
  return `s-${crypto.randomUUID()}`;
}

export function newCommandId(): string {
  return crypto.randomUUID();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface SendTurnInput {
  sessionId?: string;
  content: string;
  builderPolicy?: string;
  workspaceId?: string;
  commandId?: string;
}

// sendTurn is persist-before-ack: the receipt only exists after the canonical
// commit. A retried command id replays the original receipt.
export async function sendTurn(input: SendTurnInput): Promise<SendTurnReceipt> {
  return request<SendTurnReceipt>("/api/sen/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId ?? newSessionId(),
      content: input.content,
      builderPolicy: input.builderPolicy,
      workspaceId: input.workspaceId,
      commandId: input.commandId ?? newCommandId(),
    }),
  });
}

export interface SessionListResult {
  sessions: ChatSession[];
  canonical: boolean;
}

export async function listSessions(): Promise<SessionListResult> {
  return request<SessionListResult>("/api/sen/chat");
}

export interface ThreadResult {
  sessionId: string;
  turns: ChatTurnRow[];
  nextAfterSeq: number;
}

export async function getThread(sessionId: string, afterSeq = 0, limit = 200): Promise<ThreadResult> {
  return request<ThreadResult>(
    `/api/sen/chat/sessions/${encodeURIComponent(sessionId)}/thread?after_seq=${afterSeq}&limit=${limit}`,
  );
}

// getActiveAttempt returns null when no attempt is queued/claimed/running.
export async function getActiveAttempt(sessionId: string): Promise<ChatAttempt | null> {
  const res = await fetch(`/api/sen/chat/sessions/${encodeURIComponent(sessionId)}/active`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ChatAttempt;
}

export async function getEventsAfter(chatAttemptId: string, afterSeq = 0, limit = 200): Promise<ChatStreamEvent[]> {
  const res = await request<{ events: ChatStreamEvent[] | null }>(
    `/api/sen/chat/attempts/${encodeURIComponent(chatAttemptId)}/events?after_seq=${afterSeq}&limit=${limit}`,
  );
  return res.events ?? [];
}

// mergeEventsBySeq is the reconnect rule: stream events dedupe by seq and
// come back in order, so a refetched tail never double-renders.
export function mergeEventsBySeq(existing: Map<number, ChatStreamEvent>, incoming: ChatStreamEvent[]): ChatStreamEvent[] {
  for (const event of incoming) {
    if (!existing.has(event.seq)) existing.set(event.seq, event);
  }
  return [...existing.values()].sort((a, b) => a.seq - b.seq);
}

export function hasEventGap(lastApplied: number, incoming: ChatStreamEvent[]): boolean {
  if (incoming.length === 0) return false;
  const seqs = [...new Set(incoming.map((event) => event.seq))].sort((a, b) => a - b);
  let expected = lastApplied + 1;
  for (const seq of seqs) {
    if (seq <= lastApplied) continue;
    if (seq !== expected) return true;
    expected += 1;
  }
  return false;
}

// eventText extracts display text from a stream event payload
// ({kind, text} as normalized by the Go executor).
export function eventText(event: ChatStreamEvent): string {
  const payload = event.payload as { text?: unknown } | null;
  return payload && typeof payload.text === "string" ? payload.text : "";
}

export type TerminalAttemptState = "succeeded" | "failed" | "cancelled" | "no_response";

export function isTerminalAttemptState(state: string): state is TerminalAttemptState {
  return state === "succeeded" || state === "failed" || state === "cancelled" || state === "no_response";
}

// formatTerminalOutcome is the browser-facing label for a terminal attempt
// (failure / cancel / no-response / success) so reload and live completion
// share one display rule.
export function formatTerminalOutcome(state: string): string {
  switch (state) {
    case "succeeded":
      return "Turn completed.";
    case "failed":
      return "Turn failed.";
    case "cancelled":
      return "Turn cancelled.";
    case "no_response":
      return "No response from the builder.";
    default:
      return `Turn ended (${state}).`;
  }
}

export interface AttemptActionReceipt {
  commandId: string;
  chatAttemptId: string;
  status: string;
}

// stopAttempt asks the control plane to cancel a live attempt (idempotent
// commandId). The UI still aborts its local poll after this ack.
export async function stopAttempt(chatAttemptId: string, commandId?: string): Promise<AttemptActionReceipt> {
  return request<AttemptActionReceipt>(`/api/sen/chat/attempts/${encodeURIComponent(chatAttemptId)}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commandId: commandId ?? newCommandId() }),
  });
}

// retryAttempt re-queues a terminal attempt via the thin proxy. Exact
// commandId retries replay the original receipt.
export async function retryAttempt(chatAttemptId: string, commandId?: string): Promise<AttemptActionReceipt> {
  return request<AttemptActionReceipt>(`/api/sen/chat/attempts/${encodeURIComponent(chatAttemptId)}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commandId: commandId ?? newCommandId() }),
  });
}

// terminalStateFromEvent pulls a terminal attempt state out of a stream
// event (kind=terminal|outcome, or payload.state/outcome).
export function terminalStateFromEvent(event: ChatStreamEvent): TerminalAttemptState | null {
  const payload = event.payload as { state?: unknown; outcome?: unknown } | null;
  const raw =
    (payload && typeof payload.state === "string" && payload.state) ||
    (payload && typeof payload.outcome === "string" && payload.outcome) ||
    (event.eventKind === "terminal" || event.eventKind === "outcome" ? event.eventKind : "");
  return isTerminalAttemptState(raw) ? raw : null;
}
