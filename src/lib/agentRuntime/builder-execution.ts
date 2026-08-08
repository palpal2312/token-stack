// Capability-gated native CLI execution wrapper for Sen LLMOps runtime.
//
// Governed execution mandates that a Coding CLI run only under a verified safe CLI profile.
// Unsafe native profiles (danger-full-access, bypassPermissions, etc.) or non-Builder
// brains fail preflight before spawning binaries or spending quota.

import { getBuilder, type Builder } from "../builders/registry";
import { runBuilderChat, type ChatEvent, type ChatResult } from "../builders/chat";
import { cliSpec, type CliSpec } from "../builders/clis";
import type { PreExecutionToolCapability } from "../builders/clis/base";
import { isPinnedQaFixture } from "../builders/spawn";
import {
  validateGovernedExecutionSelection,
  type GovernedExecutionSelection,
} from "../llmops/contracts";
import { BrainError } from "./brain";
import { ExecutionManager } from "../llmops/execution-manager";
import {
  executeViaGoAuthority,
  type GoBuilderExecRequest,
} from "./go-builder-exec-client";

export interface GovernedBuilderExecutionOptions {
  builderId: string;
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  runId: string;
  signal?: AbortSignal;
  emit?: (event: ChatEvent) => void;
  // Phase 08 Step 7: Go authority context
  taskId?: string;
  attemptId?: string;
  traceId?: string;
  ownerId?: string;
  env?: Record<string, string>;
}

export interface BuilderCapabilityTelemetry {
  governedExecution: boolean;
  nativeActivityTelemetry: boolean;
  structuredToolCalls?: boolean;
  toolResultContinuation?: boolean;
  unsupportedReason?: string;
}

export interface GovernedBuilderExecutionResult {
  ok: boolean;
  text: string;
  durationMs: number;
  builderId: string;
  sessionId?: string;
  sessionUnavailableReason?: string;
  actualModel?: string;
  usage?: { input?: number; output?: number; thinking?: number };
  capability?: BuilderCapabilityTelemetry;
  error?: string;
  // Phase 08 Step 7: Go authority pane identity
  paneId?: string;
}

export interface GovernedBuilderProfile {
  builder: Builder;
  spec: CliSpec;
  safetyProfile: string;
  safetyArgs: string[];
  capability: BuilderCapabilityTelemetry;
}

export function governedTurnArgs(
  spec: CliSpec,
  input: { prompt: string; model?: string | null; effort?: string | null; sessionId?: string },
): string[] {
  if (input.sessionId) {
    if (!spec.resumeArgs) {
      throw new BrainError(
        `${spec.label} cannot resume session "${input.sessionId}" because no verified resume protocol exists.`,
      );
    }
    return spec.resumeArgs(input.sessionId, input.prompt, {
      model: input.model,
      effort: input.effort,
    });
  }
  return spec.execArgs(input.prompt, { model: input.model, effort: input.effort });
}

const UNSAFE_ARG = /(?:danger-full-access|bypasspermissions|bypass-permissions|dangerously-skip-permissions|(?:^|\s)--?yolo(?:\s|$))/i;

export function resolveGovernedBuilderProfile(builder: Builder): GovernedBuilderProfile {
  if (!builder.verifiedAt) {
    throw new BrainError(
      `Governed Builder execution refused for "${builder.name}": profile has no successful health verification.`,
    );
  }
  const spec = cliSpec(builder.cli);
  if (!spec) {
    throw new BrainError(`Governed Builder execution refused for "${builder.name}": unknown CLI ${builder.cli}.`);
  }
  const configuredArgs = builder.args.join(" ");
  if (UNSAFE_ARG.test(configuredArgs)) {
    throw new BrainError(
      `Governed Builder execution refused for "${builder.name}": configured arguments disable safety controls.`,
    );
  }
  const pinnedFixture = isPinnedQaFixture(builder);
  const freeEnvKeys = Object.keys(builder.env ?? {})
    .filter((key) => key !== "AGENTIC_OS_CLI_SAFETY_PROFILE")
    .filter((key) => !(pinnedFixture && key === "FIXTURE_SESSION" && builder.env?.[key] === "1"));
  if (freeEnvKeys.length) {
    throw new BrainError(
      `Governed Builder execution refused for "${builder.name}": free-form environment `
      + `is not allowed in a governed profile (${freeEnvKeys.join(", ")}).`,
    );
  }

  const safetyProfile = String(builder.env?.AGENTIC_OS_CLI_SAFETY_PROFILE ?? "").trim();
  const selection: GovernedExecutionSelection = {
    brainKind: "builder",
    builderId: builder.id,
    cliSafetyProfile: safetyProfile,
  };
  const validation = validateGovernedExecutionSelection(selection);
  if (!validation.ok) {
    throw new BrainError(
      `Governed Builder execution refused for "${builder.name}": ${validation.errors.join("; ")}`,
    );
  }

  const capability: BuilderCapabilityTelemetry = {
    governedExecution: spec.capability?.governedExecution === true,
    nativeActivityTelemetry: spec.capability?.nativeActivityTelemetry === true,
    structuredToolCalls: spec.capability?.preExecutionTools?.status === "proven",
    toolResultContinuation: spec.capability?.preExecutionTools?.status === "proven" && spec.capability.preExecutionTools.toolResultContinuation === true,
    ...(spec.capability?.unsupportedReason ? { unsupportedReason: spec.capability.unsupportedReason } : {}),
  };
  if (safetyProfile === "tool-free" && spec.id === "fixture") {
    if (!isPinnedQaFixture(builder)) {
      throw new BrainError(
        `Governed Builder execution refused for "${builder.name}": QA fixture execution `
        + "is disabled or its executable/script identity is not pinned.",
      );
    }
    return { builder, spec, safetyProfile, safetyArgs: [], capability };
  }
  if (spec.id === "codex" && safetyProfile === "read-only" && builder.args.length) {
    throw new BrainError(
      `Governed Builder execution refused for "${builder.name}": Codex governed read-only `
      + "profiles cannot add prefix arguments or config overrides.",
    );
  }
  if (!capability.governedExecution) {
    const unsupportedReason = capability.unsupportedReason
      ?? `${spec.label} has no proven governed execution capability.`;
    throw new BrainError(
      `Governed Builder execution refused for "${builder.name}": no verified network boundary exists. `
      + `${unsupportedReason} Configure a CLI/profile with verified workspace and network boundaries.`,
    );
  }
  throw new BrainError(
    `Governed Builder execution refused for "${builder.name}": safety profile `
    + `"${safetyProfile}" has no governed ${spec.label} descriptor with proven workspace and network boundaries.`,
  );
}

/**
 * Preflight check for governed CLI execution: asserts that the requested Builder
 * profile exists, is verified, and carries a safe CLI profile.
 */
export async function assertGovernedBuilderPreflight(
  builderId: string,
): Promise<GovernedBuilderProfile> {
  const builder = await getBuilder(builderId);
  if (!builder) {
    throw new BrainError(`Builder profile "${builderId}" was not found in registry.`);
  }

  return resolveGovernedBuilderProfile(builder);
}

/**
 * Run a governed turn using native CLI execution.
 *
 * Phase 08 Step 7: When SEN_GO_BUILDER_EXEC_AUTHORITY=1, routes to Go daemon.
 * Otherwise preserves legacy Node CLI execution path.
 */
export async function executeGovernedBuilder(
  opts: GovernedBuilderExecutionOptions,
): Promise<GovernedBuilderExecutionResult> {
  // Feature flag: Phase 08 Step 7 write authority cutover
  const useGoAuthority = process.env.SEN_GO_BUILDER_EXEC_AUTHORITY === "1";

  if (useGoAuthority) {
    // Go daemon authority path (Phase 08 Step 7+)
    return await executeViaGoDaemon(opts);
  }

  // Legacy Node CLI path (default, preserved for rollback)
  return await executeLegacyNodeBuilder(opts);
}

/**
 * Legacy Node builder execution path.
 * Preserved for rollback verification (Phase 08 Step 10).
 */
async function executeLegacyNodeBuilder(
  opts: GovernedBuilderExecutionOptions,
): Promise<GovernedBuilderExecutionResult> {
  const { builder, spec, safetyArgs, capability } = await assertGovernedBuilderPreflight(opts.builderId);

  const model = opts.model ?? builder.model;
  const effort = opts.effort ?? builder.effort;

  const argsOverride = governedTurnArgs(spec, {
    prompt: opts.prompt,
    model,
    effort,
    sessionId: opts.sessionId,
  });
  const owner = opts.runId
    ? ExecutionManager.register(opts.runId, `builder:${builder.id}`)
    : null;
  const signal = owner && opts.signal
    ? AbortSignal.any([owner.signal, opts.signal])
    : owner?.signal ?? opts.signal;
  let result: ChatResult;
  try {
    result = await runBuilderChat({
      builder,
      prompt: opts.prompt,
      argsOverride,
      argsSuffix: safetyArgs,
      cwd: opts.cwd,
      signal,
      emit: opts.emit ?? (() => {}),
    });
  } finally {
    if (owner) ExecutionManager.unregister(opts.runId, owner);
  }
  if (opts.sessionId && result.sessionId && result.sessionId !== opts.sessionId) {
    throw new BrainError(
      `${spec.label} resume returned session "${result.sessionId}" instead of requested "${opts.sessionId}".`,
    );
  }
  const exitError = result.exitCode === 0
    ? undefined
    : result.error ?? `${spec.label} exited with code ${String(result.exitCode)}.`;

  return {
    ok: !exitError && !result.timedOut,
    text: result.text,
    durationMs: result.durationMs,
    builderId: builder.id,
    sessionId: result.sessionId ?? (opts.sessionId ? opts.sessionId : undefined),
    ...(!result.sessionId && !opts.sessionId
      ? { sessionUnavailableReason: `${spec.label} did not report a session identity.` }
      : {}),
    actualModel: result.actualModel ?? undefined,
    usage: result.usage ?? undefined,
    capability,
    error: exitError,
  };
}

/**
 * Go daemon builder execution path (Phase 08 Step 7+).
 * Calls Go HTTP authority with fail-closed error handling.
 */
async function executeViaGoDaemon(
  opts: GovernedBuilderExecutionOptions,
): Promise<GovernedBuilderExecutionResult> {
  try {
    if (!opts.taskId || !opts.attemptId || !opts.traceId || !opts.runId) {
      throw new BrainError(
        "Go builder execution requires canonical taskId, attemptId, traceId, and runId.",
      );
    }
    const { builder, capability } = await assertGovernedBuilderPreflight(opts.builderId);

    if (!opts.cwd) {
      throw new BrainError(
        "Go builder execution requires explicit cwd (worktree path). Got undefined.",
      );
    }

    const req: GoBuilderExecRequest = {
      taskId: opts.taskId,
      attemptId: opts.attemptId,
      builderId: opts.builderId,
      worktreePath: opts.cwd,
      prompt: opts.prompt,
      model: opts.model ?? builder.model ?? undefined,
      effort: opts.effort ?? builder.effort ?? undefined,
      sessionId: opts.sessionId,
      runId: opts.runId,
      traceId: opts.traceId,
      ownerId: opts.ownerId,
      env: opts.env,
    };
    const resp = await executeViaGoAuthority(req);

    if (!resp.ok) {
      throw new BrainError(
        resp.error ?? "Go builder execution failed without error detail.",
      );
    }

    return {
      ok: true,
      text: "", // Go daemon streams to pane, no inline text return
      durationMs: resp.durationMs,
      builderId: opts.builderId,
      sessionId: resp.sessionId ?? opts.sessionId,
      actualModel: opts.model ?? builder.model ?? undefined,
      usage: resp.usage,
      capability,
      paneId: resp.paneId, // Go-specific: terminal pane identity
    };
  } catch (err) {
    // Every failure after selecting Go authority carries explicit authority
    // context, including governed preflight and worktree validation failures.
    // Never fall back to Node here: that would create an authority collision.
    const msg = err instanceof Error ? err.message : String(err);
    throw new BrainError(`Go builder execution authority failed: ${msg}`);
  }
}
