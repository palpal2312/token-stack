// Anthropic's native Messages API — the proof that the adapter layer earns its
// keep. Everything the OpenAI-compatible adapter gets for free is different
// here: the path is /v1/messages, the key travels in an x-api-key header (not a
// Bearer token), the system prompt is a top-level parameter rather than a
// message, max_tokens is mandatory, tool specs rename `parameters` to
// `input_schema`, and the stream arrives as typed content-block events instead
// of choice deltas.
//
// The translation follows aisuite's anthropic provider
// (vendor/aisuite/aisuite/providers/anthropic_provider.py), with two deliberate
// simplifications: parameters passes through to input_schema whole (it is
// already the JSON Schema Anthropic expects; rebuilding it from properties +
// required would only drop fields), and every system message is extracted, not
// just the first — a second system message left in the array is a 400, not a
// system prompt.

import {
  AdapterHttpError,
  type ChatAdapter,
  type ChatMessage,
  type ChatTool,
  type NormalizedChunk,
} from "./base";

const ANTHROPIC_VERSION = "2023-06-01";

// Anthropic rejects a request with no max_tokens, so the adapter has to invent
// one when the caller stays silent. 4096 is aisuite's default, chosen for the
// same reason: large enough that an ordinary answer is never truncated.
const DEFAULT_MAX_TOKENS = 4096;

/** Anthropic stop_reason → the OpenAI finish vocabulary the facade speaks. */
const FINISH_REASON: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
};

function messagesUrl(baseUrl: string): string {
  // The kind's default base URL is https://api.anthropic.com with no version
  // suffix, so the /v1 lives here. A user who typed it themselves gets it
  // neither doubled nor stripped.
  return baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
}

function convertTools(tools: ChatTool[]) {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
}

/** tool_use.input must be an object; a garbled argument string becomes one. */
function safeInput(argumentsText: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* fall through to the envelope below */ }
  // Sending the raw text wrapped keeps the failure visible to the model
  // instead of silently arguing for nothing.
  return { _invalid_arguments: argumentsText };
}

type AnthropicBlock = Record<string, unknown>;
interface AnthropicMessage { role: string; content: string | AnthropicBlock[] }

/**
 * ChatMessage → Anthropic messages. Two translations matter, both from the
 * tool loop: an assistant turn that called tools becomes content blocks (text
 * plus one tool_use block per call), and a tool result becomes a tool_result
 * block inside a *user* message — Anthropic has no tool role. Consecutive
 * tool results merge into one user message, because Anthropic expects the
 * whole batch of results in the single user turn that follows the tool_use,
 * and rejects consecutive same-role messages.
 */
function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") continue; // extracted separately, below
    if (m.role === "tool") {
      const block: AnthropicBlock = {
        type: "tool_result",
        tool_use_id: m.toolCallId ?? "",
        content: m.content,
      };
      const prev = out[out.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content)
        && (prev.content[0] as AnthropicBlock | undefined)?.type === "tool_result") {
        prev.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: AnthropicBlock[] = [];
      // An empty text block is a 400, so a silent assistant turn is blocks only.
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: safeInput(tc.argumentsText) });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: { usage?: { input_tokens?: number } };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
}

export const anthropicAdapter: ChatAdapter = {
  id: "anthropic",

  normalizeError(status, body, statusText) {
    // Anthropic's error envelope is {"type":"error","error":{"type","message"}}
    // — the same dig the OpenAI-compatible adapter does, kept separate because
    // the two providers' shapes are free to drift apart.
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

    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = toAnthropicMessages(req.messages);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (router.apiKey) headers["x-api-key"] = router.apiKey;

    const res = await fetch(messagesUrl(router.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model,
        messages,
        max_tokens: DEFAULT_MAX_TOKENS,
        stream: true,
        ...(system ? { system } : {}),
        ...(req.tools?.length ? { tools: convertTools(req.tools) } : {}),
      }),
      signal: req.signal,
    });
    req.meta.status = res.status;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AdapterHttpError(res.status, this.normalizeError(res.status, body, res.statusText));
    }
    if (!res.body) throw new AdapterHttpError(res.status, "");

    // The stream is one JSON event per "data:" line (the "event:" lines are
    // decorative — the type is inside the payload). The state machine below
    // carries two things across events: a map from Anthropic's content-block
    // indices to tool-call indices (Anthropic numbers every block, the
    // normalized shape numbers only tool calls), and the prompt-token count
    // reported at message start until usage is emitted at message end.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const toolPositions = new Map<number, number>();
    let inputTokens = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let event: AnthropicEvent;
        try { event = JSON.parse(line.slice(5).trim()); }
        catch { continue; }

        switch (event.type) {
          case "message_start":
            inputTokens = event.message?.usage?.input_tokens ?? 0;
            break;

          case "content_block_start": {
            const block = event.content_block;
            if (block?.type !== "tool_use") break;
            const position = toolPositions.size;
            toolPositions.set(event.index ?? 0, position);
            yield {
              toolCallDeltas: [{ index: position, id: block.id, name: block.name, argumentsText: "" }],
            };
            break;
          }

          case "content_block_delta": {
            const d = event.delta;
            if (d?.type === "text_delta" && d.text) {
              yield { deltaText: d.text };
            } else if (d?.type === "input_json_delta" && d.partial_json) {
              const position = toolPositions.get(event.index ?? -1);
              if (position !== undefined) {
                yield { toolCallDeltas: [{ index: position, argumentsText: d.partial_json }] };
              }
            }
            break;
          }

          case "message_delta": {
            const stop = event.delta?.stop_reason;
            const outputTokens = event.usage?.output_tokens;
            if (stop == null && outputTokens == null) break;
            const chunk: NormalizedChunk = {};
            if (stop) chunk.finishReason = FINISH_REASON[stop] ?? "stop";
            if (outputTokens != null) {
              chunk.usage = { promptTokens: inputTokens, completionTokens: outputTokens };
            }
            yield chunk;
            break;
          }

          // The mid-stream error, same as the OpenAI wire's: after the 200, so
          // the partial answer stays shown and the turn still fails.
          case "error": {
            const err = event.error;
            yield { error: String(err?.message ?? JSON.stringify(event)).slice(0, 400) };
            break;
          }

          // content_block_stop, message_stop, ping: nothing to surface.
        }
      }
    }
  },
};
