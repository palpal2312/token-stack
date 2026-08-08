// The agent declaration: a name, a standing instruction, a toolbox, and a
// brain to think with. Everything here is data except the tools' execute
// functions — an agent is something you can show a user, diff, and persist,
// not a tangle of closures.
//
// BrainRef is a union rather than a class so the declaration can name a
// backend without holding it: "router" resolves through the Router registry
// at run time, "brain" injects an implementation directly (QA fixtures, and
// later the built-in engines migrating onto this runtime). "builder" is a
// declared-but-unwired slot — the CLI one-shot protocol has no tool-call
// vocabulary yet, so it fails loudly at resolve time instead of silently
// pretending to work.

import { routerBrain, BrainError, type Brain } from "./brain";
import { builderBrain } from "./builder-brain";

export type RiskLevel = "read" | "write" | "external";

/** What the runner hands a tool when it executes it. */
export interface ToolContext {
  runId: string;
  threadId: string;
  agentName: string;
  signal?: AbortSignal;
  /**
   * The run's on-disk folder, when the state store has one. Deliverable
   * tools jail into this; memory-backed runs leave it undefined.
   */
  runDir?: string;
}

export interface RuntimeTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments, sent to the model as the tool's parameters. */
  schema: Record<string, unknown>;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
  metadata?: {
    /**
     * What the tool can touch. Policies key off this: RequireApproval gates
     * writes and external calls while letting reads through, which keeps a
     * human in the loop exactly where the blast radius is.
     */
    riskLevel?: RiskLevel;
    /** Force an approval check even for a read-level tool. */
    requiresApproval?: boolean;
    /**
     * The tool's result is a { path, kind } deliverable the runner should
     * copy into the run's artifact registry — the UI reads the registry, so
     * the tool only has to return the shape, not know the state exists.
     */
    producesArtifacts?: boolean;
  };
}

export type BrainRef =
  | { kind: "router"; routerId: string; model?: string; effort?: string }
  | {
      kind: "builder";
      builderId: string;
      cwd?: string;
      model?: string;
      effort?: string;
      sessionId?: string;
      runId: string;
      capability?: any;
    }
  | { kind: "brain"; brain: Brain };

export interface Agent {
  name: string;
  /** Becomes the system message at the head of every run. */
  instructions: string;
  tools: RuntimeTool[];
  brain: BrainRef;
  /** Model round-trips before the run stops with "max-turns". Default 10. */
  maxTurns?: number;
}

/** Turn a declaration into a runnable brain. */
export function resolveBrain(ref: BrainRef): Brain {
  switch (ref.kind) {
    case "router":
      return routerBrain(ref.routerId, ref.model, ref.effort);
    case "brain":
      return ref.brain;
    case "builder":
      return builderBrain({
        builderId: ref.builderId,
        cwd: ref.cwd,
        model: ref.model,
        effort: ref.effort,
        sessionId: ref.sessionId,
        runId: ref.runId,
      });
  }
}
