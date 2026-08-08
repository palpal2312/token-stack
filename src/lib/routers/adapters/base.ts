// The contract every Router chat adapter speaks.
//
// One interface is the whole point of the layer: chat.ts used to know how to
// talk OpenAI wire format, which meant adding a provider meant editing the
// facade. Here the facade knows chunks, and each adapter knows one provider's
// wire format — adding a provider is adding one file, not reopening the
// streaming loop everyone else depends on.
//
// The chunk shape is OpenAI's delta model, because that is what the rest of the
// dashboard already understands. Adapters speaking something else (Anthropic's
// content-block events, say) translate into this shape rather than asking the
// facade to learn a second vocabulary.

import type { Router } from "../registry";

export interface ToolCallDelta {
  /** Which tool call this piece belongs to, counted across tool calls only. */
  index: number;
  id?: string;
  name?: string;
  /** A fragment of the JSON arguments, to be concatenated across deltas. */
  argumentsText?: string;
}

export interface NormalizedChunk {
  deltaText?: string;
  toolCallDeltas?: ToolCallDelta[];
  /** OpenAI vocabulary: "stop", "length", "tool_calls", ... */
  finishReason?: string | null;
  usage?: { promptTokens?: number; completionTokens?: number };
  /**
   * An error the endpoint sent mid-stream, after the 200. Not an exception —
   * the status line is already gone, so the partial answer stays valid and the
   * facade reports this as a failed turn that still showed its words.
   */
  error?: string;
}

/** One tool call, fully assembled from its deltas. */
export interface AssembledToolCall {
  id: string;
  name: string;
  /** The JSON arguments, still as text — parsing is the tool loop's job. */
  argumentsText: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant turns that asked for tools: the whole calls, assembled. */
  toolCalls?: AssembledToolCall[];
  /** Tool-result turns: which call this answers. */
  toolCallId?: string;
}

/** A tool definition in OpenAI wire format — the format callers already hold. */
export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatRequest {
  router: Router;
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  /**
   * Requested reasoning effort ("low" | "medium" | "high" | "xhigh"), when the
   * caller asked for one. Adapters that have a wire name for it send it;
   * adapters that do not leave it out — best-effort by contract, the trace
   * says what was asked rather than pretending the endpoint honored it.
   */
  effort?: string;
  /** Owned by the facade: timeout and page-teardown both abort through it. */
  signal: AbortSignal;
  /**
   * The adapter writes the HTTP status here so the facade can report it. The
   * done-event protocol carries the status, but the response object never
   * leaves the adapter — this slot is how the two meet without the facade
   * fetching anything itself.
   */
  meta: { status: number | null };
}

export interface ChatAdapter {
  /** Explicit, never derived from a file or class name — see index.ts. */
  id: string;
  stream(req: ChatRequest): AsyncIterable<NormalizedChunk>;
  /** Dig the endpoint's own explanation out of a non-2xx body. */
  normalizeError(status: number, body: string, statusText: string): string;
}

/**
 * A non-2xx answer. Thrown rather than yielded because no words can follow it:
 * the facade fails the turn immediately, formats the message with the Router's
 * name, and adds its key hint for 401/403.
 *
 * An empty detail is the adapter saying "the status line was fine but the body
 * never arrived" — the facade has its own message for that, since there is no
 * endpoint explanation to quote.
 */
export class AdapterHttpError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail || `HTTP ${status}`);
  }
}
