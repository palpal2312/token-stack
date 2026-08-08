// One interface over anything that can answer a chat turn: a Router endpoint,
// a Builder CLI, or (later) a built-in engine. The runner only ever sees this
// shape, which is what lets a cheap API model and a local CLI be brains for
// the same agent definition.
//
// The interface is deliberately one method — complete(messages, tools) — and
// one turn. The loop, the policies, and the trace all live in the runner;
// asking the brain for anything richer would couple every backend to runtime
// concerns before a second consumer has proven they belong here.
//
// routerBrain is built on routers/toolLoop with maxTurns 1: one pass of the
// loop IS one completion. The loop's own executor is a capture shim — the
// runner executes tools itself, because policy checks and step tracing have
// to happen between the model asking for a tool and the tool running, and
// only the runner sits there.

import { getRouter, type Router } from "../routers/registry";
import { runToolLoop } from "../routers/toolLoop";
import type { ChatMessage, ChatTool } from "../routers/adapters/base";

export interface BrainToolCall {
  id: string;
  name: string;
  /** Parsed arguments ({} when the model sent none). */
  arguments: unknown;
  /** The same arguments as JSON text, for the assistant message that goes back on the wire. */
  argumentsText: string;
}

export interface BrainResult {
  /** Whatever the model said this turn — may be "" beside tool calls. */
  text: string;
  toolCalls: BrainToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  /** Real CLI session identity, only when reported or used by a verified resume. */
  sessionId?: string;
  /** Honest reason no session identity can be persisted. */
  sessionUnavailableReason?: string;
  /** Optional Builder-native capability telemetry; tool calls remain empty. */
  capability?: { 
    governedExecution: boolean; 
    nativeActivityTelemetry: boolean; 
    structuredToolCalls?: boolean;
    toolResultContinuation?: boolean;
    unsupportedReason?: string;
  };
}

export interface Brain {
  complete(messages: ChatMessage[], tools: ChatTool[], signal?: AbortSignal): Promise<BrainResult>;
}

/** A turn that could not complete: endpoint down, no model configured, bad key. */
export class BrainError extends Error {}

/**
 * A brain over an already-resolved Router. QA uses this with fixture routers;
 * production code usually wants routerBrain(routerId), which resolves lazily.
 */
export function routerBrainFromRouter(router: Router, model?: string, effort?: string): Brain {
  return {
    async complete(messages, tools, signal) {
      const useModel = model ?? router.defaultModel;
      if (!useModel) {
        throw new BrainError(
          `Router "${router.name}" has no model to run. Set a default model on the Router, or pass one to routerBrain.`,
        );
      }
      // The capture shim stands in for real execution: the loop assembles the
      // streamed fragments into whole calls, hands them here, and gets a
      // placeholder result it will discard with the rest of its one turn.
      const captured: BrainToolCall[] = [];
      const res = await runToolLoop({
        router,
        model: useModel,
        messages,
        tools,
        maxTurns: 1,
        signal,
        effort,
        executeTool: async (c) => {
          captured.push({
            id: c.id,
            name: c.name,
            arguments: c.arguments,
            argumentsText: JSON.stringify(c.arguments ?? {}),
          });
          return "{}";
        },
      });
      if (res.error) throw new BrainError(res.error);
      return { text: res.text, toolCalls: captured, usage: res.usage };
    },
  };
}

/**
 * A brain over a Router id, resolved on first use and cached after. Resolving
 * late — not at agent declaration time — is what keeps a renamed or recreated
 * Router from stranding every agent that points at it.
 */
export function routerBrain(routerId: string, model?: string, effort?: string): Brain {
  let inner: Brain | null = null;
  return {
    async complete(messages, tools, signal) {
      if (!inner) {
        const router = await getRouter(routerId);
        if (!router) {
          throw new BrainError(
            `No Router "${routerId}". Create one on the Routers page first — an agent cannot pick an account on its own.`,
          );
        }
        inner = routerBrainFromRouter(router, model, effort);
      }
      return inner.complete(messages, tools, signal);
    },
  };
}
