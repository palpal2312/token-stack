// One event shape for every CLI output protocol.
//
// The hard part of talking to coding CLIs is not spawning them, it is that
// every one reports itself differently. `claude -p --output-format stream-json`
// emits one JSON event per line with the assistant's words buried in content
// deltas; `codex exec --json` uses a different envelope again; kimi's stream is
// role-shaped; the rest just print. parseChunk() turns one line of any of them
// into NormalizedEvents so skins render one shape instead of hand-parsing four.
//
// The golden chunks in qa/tests/cli-protocols.spec.ts are the tripwire: when a
// vendor changes their output format, a failing test names the CLI and the
// expectation instead of a chat tab silently going blank.

import type { Protocol } from "./clis";

export interface NormalizedEvent {
  type: "text" | "tool_use" | "status" | "error" | "done";
  /** Payload for text/status/error events. */
  text?: string;
  /** Tool name, for tool_use events. */
  name?: string;
  /** Tool target (path, command, url) or a human note, when the stream carries one. */
  detail?: string;
  /** Set when this event names the CLI's own session — chat callers store it
   * to resume next turn instead of packing history. */
  sessionId?: string;
  /** Set when the stream names the model that is actually answering (agy's
   * init event carries it). */
  model?: string;
  /** Per-turn token accounting when the CLI reports one (agy's result event). */
  usage?: { input?: number; output?: number; thinking?: number };
}

/**
 * Turn one line of a CLI's stdout into normalized events.
 *
 * Returns [] for the many valid lines that carry token counts or session
 * bookkeeping. Direct display consumers still suppress malformed JSON, while
 * LineExtractor records it as a protocol failure so execution callers fail
 * closed rather than reporting a successful empty turn.
 *
 * This is line-oriented; use LineBuffer (or LineExtractor) to reassemble lines
 * from arbitrary byte chunks first.
 */
export function parseChunk(line: string, protocol: Protocol | string): NormalizedEvent[] {
  const t = line.trim();
  if (!t) return [];

  if (protocol === "text") {
    // The QA fixture names its fake session in a magic line; surface it as a
    // status event and strip the marker so consumers see clean text.
    const m = t.match(/^SESSION:(\S+)$/);
    if (m) {
      const rest = t.replace(m[0], "").trim();
      const events: NormalizedEvent[] = [{ type: "status", sessionId: m[1] }];
      if (rest) events.push({ type: "text", text: rest });
      return events;
    }
    return [{ type: "text", text: line }];
  }

  let e: Record<string, unknown>;
  try { e = JSON.parse(t); } catch { return []; }

  if (protocol === "claude-stream-json") return claudeEvents(e);
  if (protocol === "kimi-stream-json") return kimiEvents(e);
  if (protocol === "codex-exec-json") return codexEvents(e);
  if (protocol === "agy-stream-json") return agyEvents(e);
  return [];
}

// ------------------------------------------------------------------- claude

function claudeEvents(e: Record<string, unknown>): NormalizedEvent[] {
  if (e.type === "system" && e.subtype === "init" && typeof e.session_id === "string") {
    return [{ type: "status", sessionId: e.session_id }];
  }
  // Partial deltas as they are typed. Subagent chatter carries
  // parent_tool_use_id; only the top-level answer belongs in the stream.
  if (e.type === "stream_event" && !e.parent_tool_use_id) {
    const ev = e.event as Record<string, unknown> | undefined;
    if (ev?.type === "content_block_delta") {
      const d = ev.delta as Record<string, unknown> | undefined;
      return typeof d?.text === "string" && d.text ? [{ type: "text", text: d.text }] : [];
    }
    return [];
  }
  // Whole assistant messages, for CLIs that do not send partials.
  if (e.type === "assistant" && !e.parent_tool_use_id) {
    const msg = e.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg.content : [];
    const events: NormalizedEvent[] = [];
    let text = "";
    for (const c of content) {
      const b = c as { type?: string; text?: unknown; name?: unknown; input?: unknown };
      if (b?.type === "text" && typeof b.text === "string") text += b.text;
      if (b?.type === "tool_use" && typeof b.name === "string") {
        events.push({ type: "tool_use", name: b.name, detail: toolTarget(b.input) });
      }
    }
    if (text) events.unshift({ type: "text", text });
    return events;
  }
  if (e.type === "result") {
    if (e.is_error === true) {
      return [{ type: "error", text: typeof e.result === "string" ? e.result : "The CLI reported an error result." }];
    }
    return [{ type: "done" }];
  }
  return [];
}

// --------------------------------------------------------------------- kimi

function kimiEvents(e: Record<string, unknown>): NormalizedEvent[] {
  // Kimi ≥0.29's stream-json is role-shaped, not event-shaped:
  // {"role":"assistant","content":"…"} — one whole message per line, with
  // {"role":"meta",…} bookkeeping lines around it.
  if (e.role === "meta") {
    return typeof e.session_id === "string" ? [{ type: "status", sessionId: e.session_id }] : [];
  }
  if (e.role === "assistant") {
    const events: NormalizedEvent[] = [];
    const text = contentText(e.content);
    if (text) events.push({ type: "text", text });
    if (Array.isArray(e.tool_calls)) {
      for (const tc of e.tool_calls as { function?: { name?: string; arguments?: string } }[]) {
        const name = tc?.function?.name ?? "tool";
        let target = "";
        try {
          const args = JSON.parse(tc?.function?.arguments ?? "{}") as Record<string, unknown>;
          const v = args.path ?? args.file_path ?? args.command ?? args.url ?? "";
          if (typeof v === "string") target = v;
        } catch { /* arguments are not always JSON */ }
        events.push({ type: "tool_use", name, detail: target });
      }
    }
    return events;
  }
  if (e.role === "tool") {
    const text = contentText(e.content);
    return text ? [{ type: "status", text }] : [];
  }
  return [];
}

/** Pull display text out of a Kimi message's `content` (string or blocks). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === "string" ? b : ((b as { text?: string })?.text ?? ""))).join("");
  }
  return "";
}

// -------------------------------------------------------------------- codex

function codexEvents(e: Record<string, unknown>): NormalizedEvent[] {
  if (e.type === "thread.started" && typeof e.thread_id === "string") {
    return [{ type: "status", sessionId: e.thread_id }];
  }
  if (e.type === "error" || e.type === "turn.failed") {
    const m = (e.error as { message?: unknown } | undefined)?.message ?? e.message;
    // No string message = nothing worth reporting; match the old capture,
    // which left errorText null rather than inventing a message.
    if (typeof m !== "string") return [];
    // Provider errors arrive as a JSON string inside the message — unwrap it for readability.
    try {
      const inner = JSON.parse(m) as { error?: { message?: string } };
      return [{ type: "error", text: inner.error?.message ?? m }];
    } catch { return [{ type: "error", text: m }]; }
  }
  const item = e.item as Record<string, unknown> | undefined;
  if (e.type === "item.delta" && item?.type === "agent_message" && typeof item.delta === "string") {
    return item.delta ? [{ type: "text", text: item.delta }] : [];
  }
  if (e.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
    return item.text ? [{ type: "text", text: item.text }] : [];
  }
  if (e.type === "item.completed" && item?.type === "command_execution") {
    const cmd = typeof item.command === "string" ? item.command : "";
    return [{ type: "tool_use", name: "command_execution", detail: cmd }];
  }
  return [];
}

// ---------------------------------------------------------------------- agy

// Verified on agy.exe 1.1.8 (2026-07-29 spike): `--print "<prompt>"
// --output-format=stream-json` emits one JSON event per line — init (names the
// conversation and the live model), step_update per step (agent_response
// carries the answer in text_delta chunks, ACTIVE and DONE pieces are
// continuations of one stream), result closes the turn with status + usage.
function agyEvents(e: Record<string, unknown>): NormalizedEvent[] {
  if (e.event === "init") {
    const ev: NormalizedEvent = { type: "status" };
    if (typeof e.conversation_id === "string") ev.sessionId = e.conversation_id;
    const model = (e.init as { model?: unknown } | undefined)?.model;
    if (typeof model === "string" && model) ev.model = model;
    return ev.sessionId || ev.model ? [ev] : [];
  }
  if (e.event === "step_update") {
    const su = e.step_update as { step_type?: unknown; state?: unknown; text_delta?: unknown; tool_name?: unknown } | undefined;
    if (su?.step_type === "agent_response" && typeof su.text_delta === "string" && su.text_delta) {
      return [{ type: "text", text: su.text_delta }];
    }
    // Tool steps: step_type is literally "tool" and the name rides in
    // tool_name (verified 1.1.8: list_dir, run_command, …).
    if (su?.state === "ACTIVE" && su.step_type === "tool") {
      const name = typeof su.tool_name === "string" && su.tool_name ? su.tool_name : "tool";
      return [{ type: "tool_use", name }];
    }
    // A tool step ending ERROR in request-review mode means the permission
    // prompt was auto-denied — status, not error: the turn itself goes on.
    if (su?.state === "ERROR" && su.step_type === "tool") {
      const name = typeof su.tool_name === "string" && su.tool_name ? su.tool_name : "tool";
      return [{ type: "status", text: `tool-denied:${name}` }];
    }
    // A non-answer step going ACTIVE is the agent reaching for something else.
    if (su?.state === "ACTIVE" && typeof su.step_type === "string"
      && !["user_input", "agent_response", "checkpoint", "unknown"].includes(su.step_type)) {
      return [{ type: "tool_use", name: su.step_type }];
    }
    return [];
  }
  if (e.event === "result") {
    const r = e.result as { status?: unknown; response?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown; thinking_tokens?: unknown } } | undefined;
    if (r?.status === "SUCCESS") {
      const u = r.usage;
      const usage = u && typeof u.input_tokens === "number"
        ? { input: u.input_tokens, output: typeof u.output_tokens === "number" ? u.output_tokens : undefined, thinking: typeof u.thinking_tokens === "number" ? u.thinking_tokens : undefined }
        : undefined;
      return [{ type: "done", ...(usage ? { usage } : {}) }];
    }
    const resp = typeof r?.response === "string" && r.response.trim() ? r.response : null;
    return [{ type: "error", text: resp ?? `agy turn ended with status ${String(r?.status ?? "unknown")}` }];
  }
  return [];
}

// ------------------------------------------------------------------ helpers

/** Best-effort human target for a tool call (claude-style input objects). */
function toolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const v = o.file_path ?? o.path ?? o.command ?? o.url ?? "";
  return typeof v === "string" ? v : "";
}

/**
 * Reassembles lines out of arbitrary byte chunks. stdout data events do not
 * respect line boundaries, and every JSON protocol here is one object per
 * line — so this is the first thing between a child process and parseChunk.
 */
export class LineBuffer {
  private buf = "";

  /** Feed a chunk; get back every complete line it finished. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    return lines;
  }

  /** The trailing partial line, if one is still buffered. */
  flush(): string {
    const rest = this.buf;
    this.buf = "";
    return rest;
  }
}

/**
 * Pull the assistant's visible words out of one line of a CLI's output.
 *
 * Returns "" for the many lines that carry tool calls, token counts, or session
 * bookkeeping — a lane should show what the model said, not its plumbing. An
 * unparseable line in a JSON protocol is dropped rather than printed raw,
 * because half a JSON object on screen reads as corruption.
 */
export function extractText(protocol: Protocol | string, line: string): string {
  if (protocol === "text") {
    return line.trim() ? line : "";
  }
  let out = "";
  for (const ev of parseChunk(line, protocol)) {
    if (ev.type === "text" && ev.text) out += ev.text;
  }
  return out;
}

/**
 * Feeds bytes in, gets assistant text out, keeping partial lines across chunks.
 * Also captures the two facts chat callers need that are not text: the CLI's
 * session id (to resume next turn) and any turn-level error the CLI reported
 * inside its stream.
 */
export class LineExtractor {
  private buf = "";
  /**
   * The CLI session id, once the stream names one — claude's init event,
   * kimi's resume-hint meta line, codex's thread.started. Chat callers use it
   * to resume the session next turn instead of packing history.
   */
  sessionId: string | null = null;
  /**
   * A turn-level failure the CLI reported inside its stream — codex's
   * `error`/`turn.failed` events, claude's `result` with `is_error`. Chat
   * callers (runBuilderChat) read this and fail the turn honestly instead of
   * reporting success on an exit-1-no-text rejection.
   */
  errorText: string | null = null;
  /** Invalid JSON on a structured protocol is fatal, never ignored as noise. */
  protocolError: string | null = null;
  /** The model the stream names as answering (agy's init event), when it does. */
  model: string | null = null;
  /** Per-turn token accounting, once the result event reports it (agy). */
  usage: { input?: number; output?: number; thinking?: number } | null = null;
  /**
   * Optional tap on every normalized event (including non-text ones the text
   * stream drops) — chat lanes use it to surface tool activity live without
   * changing what push()/flush() return.
   */
  onEvent: ((ev: NormalizedEvent) => void) | null = null;

  constructor(private readonly protocol: Protocol | string) {}

  push(chunk: string): string {
    if (this.protocol === "text") {
      // The QA fixture names its fake session in a magic line; capture it and
      // strip the marker so tests see clean output.
      const m = chunk.match(/^SESSION:(\S+)\s*$/m);
      if (m) {
        this.sessionId ??= m[1];
        chunk = chunk.replace(m[0], "");
      }
      return chunk;
    }
    this.buf += chunk;
    let out = "";
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      out += this.consumeLine(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + 1);
    }
    return out;
  }

  flush(): string {
    const rest = this.buf;
    this.buf = "";
    if (!rest.trim()) return "";
    return this.consumeLine(rest);
  }

  /** Text from one line, with session/error facts captured as a side effect. */
  private consumeLine(line: string): string {
    if (this.protocol !== "text" && line.trim()) {
      try { JSON.parse(line.trim()); }
      catch {
        this.protocolError ??= `Malformed ${this.protocol} frame.`;
        return "";
      }
    }
    let out = "";
    for (const ev of parseChunk(line, this.protocol)) {
      this.onEvent?.(ev);
      if (ev.type === "text" && ev.text) out += ev.text;
      if (ev.sessionId) this.sessionId ??= ev.sessionId;
      if (ev.model) this.model ??= ev.model;
      if (ev.usage) this.usage = ev.usage;
      if (ev.type === "error" && ev.text && !this.errorText) this.errorText = ev.text;
    }
    return out;
  }
}
