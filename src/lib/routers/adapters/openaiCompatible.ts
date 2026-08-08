// The OpenAI wire format: POST {baseUrl}/chat/completions, SSE deltas out.
//
// This is the fetch-and-parse logic that used to live inside chat.ts, moved
// behind the adapter interface unchanged in behaviour. It covers every kind
// that speaks this wire — OpenRouter, OmniRoute, Sub2API, and anything
// custom-openai points at (Ollama, LM Studio, vLLM, a company gateway) —
// because what differs between them is where they live and who issues the key,
// not the bytes on the wire.
//
// Three endpoint quirks are handled here, and all three are load-bearing:
//
//   1. A gateway can put an error object mid-stream, after the 200 — running
//      out of credit and hitting a rate limit both arrive this way. The status
//      line cannot be taken back, so it surfaces as a chunk error: a failed
//      turn, not a remark.
//   2. Plenty of endpoints ignore stream:true and answer with one whole JSON
//      body, sometimes pretty-printed across many lines. The line-oriented SSE
//      reader throws every line of that away, so the raw body is kept whole
//      and re-read as a fallback.
//   3. Some answer as NDJSON with no `data:` framing at all, which the same
//      fallback reads line by line.

import {
  AdapterHttpError,
  type ChatAdapter,
  type ChatMessage,
  type NormalizedChunk,
  type ToolCallDelta,
} from "./base";

/**
 * ChatMessage → the OpenAI wire shape. Plain turns pass through untouched;
 * tool-loop turns get their wire names — `tool_calls` with nested function
 * objects, and `tool_call_id` on the result — because those are the names
 * every gateway in this family validates against.
 */
function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      // Null, not "": an empty string with tool_calls trips strict gateways.
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argumentsText },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

/**
 * Pull the text out of one streamed chunk.
 *
 * Gateways disagree about the shape: OpenAI-style servers put it in
 * `choices[0].delta.content`, some non-streaming replies come back whole in
 * `choices[0].message.content`, and a few send `content` as an array of parts.
 * All three are read rather than assumed, because the alternative is a chat
 * that silently prints nothing against a working endpoint.
 */
function deltaText(chunk: unknown): string {
  const choice = (chunk as { choices?: unknown[] })?.choices?.[0] as
    | { delta?: { content?: unknown }; message?: { content?: unknown }; text?: unknown }
    | undefined;
  if (!choice) return "";
  const raw = choice.delta?.content ?? choice.message?.content ?? choice.text;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p) => (typeof p === "string" ? p : String((p as { text?: unknown })?.text ?? "")))
      .join("");
  }
  return "";
}

/** One streamed chunk, normalized. Null when the chunk carries nothing. */
function normalizeChunk(chunk: unknown): NormalizedChunk | null {
  const c = chunk as {
    choices?: Array<{
      delta?: {
        content?: unknown;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = c?.choices?.[0];
  const out: NormalizedChunk = {};

  const text = deltaText(chunk);
  if (text) out.deltaText = text;

  const calls = choice?.delta?.tool_calls;
  if (calls?.length) {
    const deltas: ToolCallDelta[] = calls.map((t) => ({
      index: t.index ?? 0,
      id: t.id,
      name: t.function?.name,
      argumentsText: t.function?.arguments,
    }));
    out.toolCallDeltas = deltas;
  }

  if (choice?.finish_reason !== undefined) out.finishReason = choice.finish_reason;
  if (c?.usage) {
    out.usage = { promptTokens: c.usage.prompt_tokens, completionTokens: c.usage.completion_tokens };
  }

  return Object.keys(out).length ? out : null;
}

export const openaiCompatibleAdapter: ChatAdapter = {
  id: "openai-compatible",

  normalizeError(status, body, statusText) {
    try {
      const j = JSON.parse(body) as { error?: unknown; message?: unknown };
      const e = j.error;
      if (typeof e === "string") return e;
      const m = (e as { message?: unknown })?.message ?? j.message;
      if (typeof m === "string" && m.trim()) return m;
    } catch { /* not JSON — the raw body is the best we have */ }
    const trimmed = body.trim().slice(0, 300);
    return trimmed || `${status} ${statusText}`;
  },

  async *stream(req) {
    const { router } = req;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
    };
    if (router.apiKey) headers.authorization = `Bearer ${router.apiKey}`;

    const res = await fetch(`${router.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages.map(toWireMessage),
        stream: true,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        // OpenAI's reasoning_effort, passed through as asked. Gateways that do
        // not know the parameter ignore it; the ones that do (OpenRouter,
        // vLLM, the codex-shaped endpoints) honor it per model.
        ...(req.effort ? { reasoning_effort: req.effort } : {}),
      }),
      signal: req.signal,
    });
    req.meta.status = res.status;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AdapterHttpError(res.status, this.normalizeError(res.status, body, res.statusText));
    }
    // No body at all: the facade has its own message for this, signalled by an
    // empty detail.
    if (!res.body) throw new AdapterHttpError(res.status, "");

    // Server-sent events, parsed by hand: the payload is one JSON object per
    // "data:" line, terminated by the literal [DONE].
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // Kept whole and separately: the loop below throws away every line it does
    // not recognise, so without this the fallback further down would be parsing
    // whatever happened to survive after the last newline.
    let raw = "";
    let yieldedText = "";
    let done = false;
    while (!done) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      const decoded = dec.decode(value, { stream: true });
      raw += decoded;
      buf += decoded;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") { done = true; break; }
        let chunk: unknown;
        try { chunk = JSON.parse(payload); }
        catch { continue; }
        // Quirk 1 from the header: a mid-stream error after the 200.
        const err = (chunk as { error?: { message?: string } }).error;
        if (err) {
          yield { error: String(err.message ?? JSON.stringify(err)).slice(0, 400) };
          continue;
        }
        const normalized = normalizeChunk(chunk);
        if (normalized) {
          if (normalized.deltaText) yieldedText += normalized.deltaText;
          yield normalized;
        }
      }
    }

    // Quirks 2 and 3: stream:true ignored, the answer arriving as one whole
    // JSON body or as bare NDJSON. Reading it here is the difference between a
    // working gateway and "the reply carried no text" on every single turn.
    if (!yieldedText && raw.trim()) {
      const whole = raw.trim();
      let recovered = "";
      try {
        recovered = deltaText(JSON.parse(whole));
      } catch {
        for (const line of whole.split("\n")) {
          const s = line.trim();
          if (!s || s.startsWith("data:") || s.startsWith(":")) continue;
          try { recovered += deltaText(JSON.parse(s)); } catch { /* not a chunk */ }
        }
      }
      if (recovered) yield { deltaText: recovered };
    }
  },
};
