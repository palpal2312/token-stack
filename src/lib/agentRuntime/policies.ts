// Tool policies: who may run which tool, checked by the runner between the
// model asking and the tool executing.
//
// Three outcomes, three different meanings:
//   allow — run the tool.
//   deny  — the refusal becomes the tool's result ({"error": ...}) and the
//           loop continues. Denial-as-tool-result, same philosophy as the
//           tool loop: the model sees the no and can route around it, instead
//           of the whole run dying over one refused call.
//   park  — the run stops at "blocked" with the call recorded as
//           pendingApproval, so a human can approve later and resume() can
//           finish the turn exactly where it paused.
//
// Policies compose by strictest-wins: the runner evaluates them in order and
// any park beats any deny beats allow.

import type { RuntimeTool } from "./agent";

export type PolicyDecision = "allow" | "deny" | "park";

export interface PolicyContext {
  runId: string;
  threadId: string;
  agentName: string;
  /**
   * The id of the tool call being judged. An approval parked from a handler
   * must name the exact call, so a later "which ask was this?" never has to
   * guess from the tool name alone.
   */
  toolCallId: string;
  /** The arguments the model proposed for this call — approvals need to see them. */
  args: unknown;
}

export interface ToolPolicy {
  /** Shown in denial messages and traces, so a refusal names its source. */
  id: string;
  evaluate(tool: RuntimeTool, ctx: PolicyContext): PolicyDecision | Promise<PolicyDecision>;
}

export const AllowAll: ToolPolicy = { id: "allow-all", evaluate: () => "allow" };
export const DenyAll: ToolPolicy = { id: "deny-all", evaluate: () => "deny" };

/** Only the named tools may run; everything else is denied. */
export function AllowTools(names: string[]): ToolPolicy {
  const set = new Set(names);
  return {
    id: `allow-tools(${names.join(",")})`,
    evaluate: (tool) => (set.has(tool.name) ? "allow" : "deny"),
  };
}

export type ApprovalVerdict = "approve" | "deny" | "park";

export type ApprovalHandler = (
  tool: RuntimeTool,
  ctx: PolicyContext,
) => ApprovalVerdict | Promise<ApprovalVerdict>;

/**
 * Gates the tools a human should see before they run: anything marked
 * requiresApproval, plus every tool whose riskLevel is "write" or "external"
 * unless the caller overrides the gate. Reads pass unasked — an approval
 * prompt for a file read teaches users to click approve without reading.
 *
 * The handler answers "park" when it cannot decide now (nobody at the
 * keyboard, an async approval queue). The runner then blocks the run and
 * records the call in RunState.pendingApproval; Phase 5's approval store and
 * Phase 6's resume-after-approve build on exactly that.
 */
export function RequireApprovalPolicy(
  handler: ApprovalHandler,
  gate: (tool: RuntimeTool) => boolean = defaultGate,
): ToolPolicy {
  return {
    id: "require-approval",
    evaluate: async (tool, ctx) => {
      if (!gate(tool)) return "allow";
      const verdict = await handler(tool, ctx);
      return verdict === "approve" ? "allow" : verdict;
    },
  };
}

function defaultGate(tool: RuntimeTool): boolean {
  if (tool.metadata?.requiresApproval) return true;
  const risk = tool.metadata?.riskLevel ?? "read";
  return risk !== "read";
}
