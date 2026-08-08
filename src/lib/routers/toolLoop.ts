// The max_turns tool driver, on the aisuite pattern (client.py's tool runner):
// ask the model; if it answers with words, that is the reply; if it answers
// with tool calls, run them, append the calls and their results to the
// conversation, and ask again — at most maxTurns times.
//
// Two rules come straight from aisuite and both are about not making the
// model pay for the harness's problems:
//
//   * A tool that throws does not end the loop. The exception becomes the
//     tool's result — {"error": "..."} — so the model sees its tool failed
//     and can apologize, retry, or route around it. Denial as a tool result,
//     not as an exception.
//   * Running out of turns is not an error either. The last thing the model
//     said is still the best answer available, and the caller can see from
//     `turns` that the budget was spent.
//
// This module owns no timeout: the caller's AbortSignal covers the whole
// loop, turn after turn, the same way one slow turn would be covered.
//
// The chat facade (chat.ts) does not call this — its one-shot turn predates
// tools and its event protocol has no word for them. This is for the agent
// runtime that Phase 3 wires up, and for anything else that hands a Router a
// toolbox.

import { routerKind, type Router } from "./registry";
import { getAdapter } from "./adapters";
import type {
  AssembledToolCall,
  ChatAdapter,
  ChatMessage,
  ChatTool,
  NormalizedChunk,
} from "./adapters/base";

export interface ToolLoopCall {
  id: string;
  name: string;
  /** The parsed arguments, or {} when the model sent none. */
  arguments: unknown;
}

export interface ToolLoopOptions {
  router: Router;
  model: string;
  /** System prompt and prior history. Tool-loop messages are appended, not merged in. */
  messages: ChatMessage[];
  tools: ChatTool[];
  maxTurns: number;
  executeTool: (call: ToolLoopCall) => Promise<string>;
  signal?: AbortSignal;
  /** Reasoning effort to ask the adapter for; unsupported adapters ignore it. */
  effort?: string;
  /** Every chunk of every turn, as it arrives — for callers that stream to a user. */
  emit?: (chunk: NormalizedChunk) => void;
  /** Resolved from the Router's kind when absent; QA passes its own. */
  adapter?: ChatAdapter;
}

export interface ToolLoopResult {
  /** The final answer, or the last thing the model said if turns ran out. */
  text: string;
  /** The assistant tool-call turns and their tool results, in order. The final
   *  text answer is not in here — it was never appended to the conversation. */
  intermediateMessages: ChatMessage[];
  /** How many model round-trips actually happened. */
  turns: number;
  /** Summed across turns — each turn bills its own prompt. */
  usage?: { promptTokens: number; completionTokens: number };
  error: string | null;
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const adapter = opts.adapter
    ?? getAdapter(routerKind(opts.router.kind)?.adapter ?? "openai-compatible");
  if (!adapter) {
    return {
      text: "", intermediateMessages: [], turns: 0,
      error: `The Router kind "${opts.router.kind}" has no registered chat adapter.`,
    };
  }

  const signal = opts.signal ?? new AbortController().signal;
  const intermediate: ChatMessage[] = [];
  let usage: { promptTokens: number; completionTokens: number } | undefined;
  let lastText = "";

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    let text = "";
    let streamError: string | null = null;
    // Deltas arrive indexed and fragmented; the wire only makes sense whole.
    const calls = new Map<number, AssembledToolCall>();

    try {
      const meta = { status: null as number | null };
      for await (const chunk of adapter.stream({
        router: opts.router,
        model: opts.model,
        messages: [...opts.messages, ...intermediate],
        tools: opts.tools,
        signal,
        meta,
        effort: opts.effort,
      })) {
        opts.emit?.(chunk);
        if (chunk.error) { streamError = chunk.error; continue; }
        if (chunk.deltaText) text += chunk.deltaText;
        for (const d of chunk.toolCallDeltas ?? []) {
          const c = calls.get(d.index) ?? { id: "", name: "", argumentsText: "" };
          if (d.id) c.id = d.id;
          if (d.name) c.name = d.name;
          if (d.argumentsText) c.argumentsText += d.argumentsText;
          calls.set(d.index, c);
        }
        if (chunk.usage) {
          usage = usage ?? { promptTokens: 0, completionTokens: 0 };
          usage.promptTokens += chunk.usage.promptTokens ?? 0;
          usage.completionTokens += chunk.usage.completionTokens ?? 0;
        }
      }
    } catch (e) {
      return {
        text, intermediateMessages: intermediate, turns: turn, usage,
        error: String((e as Error)?.message ?? e),
      };
    }

    if (streamError) {
      return { text, intermediateMessages: intermediate, turns: turn, usage, error: streamError };
    }

    const toolCalls = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c);

    if (!toolCalls.length) {
      return { text, intermediateMessages: intermediate, turns: turn, usage, error: null };
    }

    // The model's turn goes back in whole — its words and its calls — because
    // the next request must show it its own hand before it sees the results.
    intermediate.push({ role: "assistant", content: text, toolCalls });
    lastText = text;

    for (const call of toolCalls) {
      let result: string;
      let args: unknown = {};
      let argsBad = false;
      try { args = call.argumentsText.trim() ? JSON.parse(call.argumentsText) : {}; }
      catch { argsBad = true; }
      if (argsBad) {
        // Told as a tool result, the model can fix its own call; thrown, the
        // whole conversation dies over one malformed string.
        result = JSON.stringify({
          error: `Tool arguments were not valid JSON: ${call.argumentsText.slice(0, 200)}`,
        });
      } else {
        try {
          result = await opts.executeTool({ id: call.id, name: call.name, arguments: args });
        } catch (e) {
          result = JSON.stringify({ error: String((e as Error)?.message ?? e) });
        }
      }
      intermediate.push({ role: "tool", content: result, toolCallId: call.id });
    }
  }

  return {
    text: lastText, intermediateMessages: intermediate, turns: opts.maxTurns, usage, error: null,
  };
}
