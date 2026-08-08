// Builder-to-Brain adapter for Sen native LLMOps runtime.
//
// Wraps a capability-gated Builder CLI as a Brain interface implementation.
// Post-hoc tool activity events from native CLIs remain telemetry; they are never
// converted into BrainToolCall objects unless a pre-execution pause/continuation
// protocol is proven for that CLI.

import type { Brain, BrainResult } from "./brain";
import type { ChatMessage, ChatTool } from "../routers/adapters/base";
import { assertGovernedBuilderPreflight, executeGovernedBuilder } from "./builder-execution";

export interface BuilderBrainOptions {
  builderId: string;
  cwd?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  runId: string;
}

export interface BuilderBrainDependencies {
  preflight?: typeof assertGovernedBuilderPreflight;
  execute?: typeof executeGovernedBuilder;
}

export function builderBrain(
  opts: BuilderBrainOptions,
  dependencies: BuilderBrainDependencies = {},
): Brain {
  const preflight = dependencies.preflight ?? assertGovernedBuilderPreflight;
  const execute = dependencies.execute ?? executeGovernedBuilder;
  let sessionId = opts.sessionId;
  return {
    async complete(messages: ChatMessage[], tools: ChatTool[], signal?: AbortSignal): Promise<BrainResult> {
      await preflight(opts.builderId);

      // Extract latest user prompt or pack messages
      const userMessage = [...messages].reverse().find((m) => m.role === "user");
      const prompt = userMessage?.content ?? "Proceed";
      const cwd = opts.cwd ?? process.cwd();

      const result = await execute({
        builderId: opts.builderId,
        prompt,
        cwd,
        model: opts.model,
        effort: opts.effort,
        sessionId,
        runId: opts.runId,
        signal,
      });

      if (!result.ok && result.error) {
        throw new Error(`Builder execution failed: ${result.error}`);
      }

      if (result.sessionId) sessionId = result.sessionId;
      return {
        text: result.text,
        toolCalls: [], // Native CLI tool execution is self-contained unless pre-execution protocol is proven
        usage: typeof result.usage?.input === "number" && typeof result.usage.output === "number"
          ? { promptTokens: result.usage.input, completionTokens: result.usage.output }
          : undefined,
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(result.sessionUnavailableReason
          ? { sessionUnavailableReason: result.sessionUnavailableReason }
          : {}),
        ...(result.capability ? { capability: result.capability } : {}),
      };
    },
  };
}
