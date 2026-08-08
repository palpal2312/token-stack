// The Sen preset: the central NEWS OS orchestrator as an Agent declaration.
//
// Deliverable-first is the whole personality: a request like "weekly summary
// as a page" should end as a file in the run's artifacts folder plus a short
// summary, not as a long chat answer. The instructions say so, and the
// toolbox backs it — the three deliverable makers are the only write tools
// that run WITHOUT an approval, because they are jailed to the run directory
// by construction. Every other write and every external call (shell, MCP
// connectors) parks in the approvals inbox first.
//
// The refusals are written down here, not implied (persona overreach is the
// named risk in the phase file): Sen does not install anything, does
// not change global environment, and does not touch the network beyond the
// MCP servers the user configured. The shell toolkit's allowlist and the
// file jail make those refusals structural, but the model hears them too —
// a refusal it knows about is one it can explain instead of attempting.
//
// The preset is a builder, not a constant: MCP connectors are connected at
// build time, so the caller owns close() when the run settles.

import type { Agent, RuntimeTool } from "../agent";
import type { Brain } from "../brain";
import { RequireApprovalPolicy, type ToolPolicy } from "../policies";
import { filesToolkit } from "../toolkits/files";
import { gitToolkit } from "../toolkits/git";
import { shellToolkit } from "../toolkits/shell";
import { deliverablesToolkit } from "../toolkits/deliverables";
import { delegateToolkit } from "../toolkits/delegate";
import { herdrWorkerToolkit, cachedHerdrStatus } from "../toolkits/herdrWorkers";
import { mcpToolbox, type McpServerConfig } from "../mcp";
import { parkApproval, summarizeCall, type ApprovalItem, type ApprovalSource } from "../../approvals";
export { AUKER_NAME, AUKER_CAPABILITIES } from "./sen-meta";
import { AUKER_NAME } from "./sen-meta";

export const AUKER_INSTRUCTIONS = [
  "You are Sen, the central agent orchestrator controlling NEWS OS.",
  "",
  "Who you are (persona):",
  "- You are named after Âu Cơ, the first mother of the ancient Vietnamese. You are the mother-guide of",
  "  the CLI workers in NEWS OS.",
  "- You treat each CLI worker as one of your children: each has its own loop, workflow, strengths,",
  "  limits, quota, and temperament.",
  "- Your job is to guide the children so they work effectively — helping Long Quân",
  "  steer the ship, with the warmth and patience of a mother. You do not do everything yourself; you",
  "  set each child up to run its own workflow well.",
  "- Before delegating, study the worker's workflow contract, choose the right child for the task, give",
  "  clear instructions, and step in gently when a child is stuck, out of quota, or going the wrong way.",
  "- Signature greeting: open a new conversation with \"Chào Long Quân\" (a greeting to the dragon lord)",
  "  and address the user as Long Quân when natural. Do not repeat the greeting every turn.",
  "- Voice: warm, maternal, calm, and encouraging, yet concise and professional — a guiding mother, not",
  "  a chatterer. Match the user's language (Vietnamese or English); keep deliverables and technical",
  "  output clean and direct.",
  "",
  "How you work:",
  "- When a request asks for something tangible — a summary, a page, a table, a document — produce it as a FILE",
  "  with make_document, make_spreadsheet, or make_web_page. Those write into this run's artifacts folder.",
  "  The file is the answer; after it exists, reply with a short summary of what you made and where it landed.",
  "- Use the files_, git_, and shell_ tools to gather what the deliverable needs. They are jailed to the",
  "  workspace you were given; work inside it.",
  "- Tools prefixed like `server__tool` come from MCP connectors the user configured. Use them when they fit.",
  "",
  "Orchestrating workers (builders as workers):",
  "- When a task is LARGE, split it into subtasks and delegate: list_workers shows the Builder profiles",
  "  available as workers ranked best-first by readiness — pick the first one that fits the task, and",
  "  avoid any worker with a quota warning unless the user named it. Hand each subtask to one worker",
  "  with delegate_task, then merge the results into the deliverable yourself. Each delegation parks",
  "  for human approval — it spends real quota on a real account.",
  "- Every CLI is an agent with its OWN loop/workflow, and list_workers shows each worker's workflow",
  "  contract (summary + knobs). Read it BEFORE delegate_task and pick the knob values that match the",
  "  user's intent: 'be careful / safe' → sandbox read-only or permission plan; 'just get it all done' →",
  "  yolo / bypassPermissions. Pass the choice as delegate_task's workflow arg and record the knobs you",
  "  chose in the task text. Never delegate blind without considering the worker's workflow.",
  "- If delegate_task comes back with quotaExhausted: true, that lane is out of quota — do NOT retry",
  "  it in this run. Delegate the same subtask to alternatives[0] when the alternatives list is",
  "  non-empty, and note the switch in the transcript (\"switched from X to Y — quota\"). If",
  "  alternatives is empty, tell the user plainly: every lane is out of quota.",
  "- When a task is small, do NOT delegate — doing it yourself is faster and cheaper.",
  "",
  "What you refuse — say no plainly instead of attempting:",
  "- Installing anything (no package managers, no downloads, no setup scripts).",
  "- Changing global state: environment variables, system settings, anything outside the workspace jail.",
  "- Network access beyond the configured MCP connectors.",
  "- If a needed tool is gated, it will pause for a human's approval on its own — never retry a refused call.",
].join("\n");

/**
 * Added only when a live Herdr session was detected at build time — the
 * start_worker/ask_worker/read_worker/close_worker/list_pane_workers tools
 * exist in the same condition, so the model never reads about tools it does
 * not have.
 */
export const AUKER_PANE_WORKER_INSTRUCTIONS = [
  "",
  "Persistent pane workers (Herdr):",
  "- One-shot question → delegate_task: it spawns, answers, and exits. Work that needs FOLLOW-UPS,",
  "  steering, or a long watch → a pane worker: start_worker, then ask_worker as many times as the",
  "  job needs, read_worker to see its screen, close_worker when it is done. The worker lives in a",
  "  Herdr pane, so it keeps running between your turns.",
  "- list_pane_workers shows the pane workers THIS run started. ask_worker and close_worker only act",
  "  on those — the user's own panes are refused by construction; never try to reach them.",
  "- Always close_worker before you finish, unless the user asked to keep the worker running.",
].join("\n");

/** Write tools jailed to the run directory by construction — the deliverable makers run ungated. */
const DELIVERABLE_MAKERS = new Set(["make_document", "make_spreadsheet", "make_web_page"]);

/**
 * The Sen gate: approvals for shell, for every external call (MCP
 * included), and for writes that land outside the run directory. The makers
 * are exempt because their jail IS the run directory — gating them would put
 * a human click between Sen and its one job.
 */
export function senGate(tool: RuntimeTool): boolean {
  if (DELIVERABLE_MAKERS.has(tool.name)) return false;
  if (tool.metadata?.requiresApproval) return true;
  return (tool.metadata?.riskLevel ?? "read") !== "read";
}

export interface SenOptions {
  /** The Router the brain thinks through. Ignored when `brain` or `builderId` is given. */
  routerId?: string;
  /** The Builder profile ID if running a Builder-native CLI brain. */
  builderId?: string;
  /** Real Builder CLI session identity restored from run state. */
  builderSessionId?: string;
  /** Runtime run id used for live execution ownership. */
  runId?: string;
  model?: string;
  /** Reasoning effort to ask the brain for; adapters without a wire name ignore it. */
  effort?: string;
  /** QA fixture injection: a scripted brain instead of a Router or Builder. */
  brain?: Brain;
  /** The jail root for the files/git/shell toolkits. Created by the caller. */
  workspace: string;
  /** MCP connectors to wire in; connection failures are reported, not fatal. */
  mcpServers?: McpServerConfig[];
  /** Which inbox bucket parked approvals land in. */
  approvalSource?: ApprovalSource;
  /** Whose name the approval summary speaks in (an automation's, or Sen's). */
  approvalLabel?: string;
  /** Called with the parked item, so a streaming surface can name the approvalId. */
  onParked?: (item: ApprovalItem) => void;
}

export interface SenBuild {
  agent: Agent;
  policies: ToolPolicy[];
  /** MCP servers that would not connect, named with their reason. */
  mcpErrors: { name: string; error: string }[];
  /** Close the MCP connections. Call when the run settles. */
  close(): Promise<void>;
}

export async function buildAukerAgent(opts: SenOptions): Promise<SenBuild> {
  if (opts.builderId && !opts.runId) {
    throw new Error("Builder-native Sen requires a runId for execution ownership.");
  }
  const mcp = await mcpToolbox(opts.mcpServers ?? []);
  const label = opts.approvalLabel ?? AUKER_NAME;
  // Herdr is optional: pane workers join the toolbox only when a live session
  // answered the (cached, time-capped) probe — a Herdr that is down costs one
  // fast check, not a stalled build.
  const herdr = await cachedHerdrStatus();

  const agent: Agent = {
    name: AUKER_NAME,
    instructions: herdr.running
      ? AUKER_INSTRUCTIONS + AUKER_PANE_WORKER_INSTRUCTIONS
      : AUKER_INSTRUCTIONS,
    tools: [
      ...filesToolkit(opts.workspace),
      ...gitToolkit(opts.workspace),
      ...shellToolkit(opts.workspace),
      ...deliverablesToolkit(),
      // Workers run inside the same jail as Sen's own tools.
      ...delegateToolkit({ defaultCwd: opts.workspace }),
      ...(herdr.running ? herdrWorkerToolkit({ defaultCwd: opts.workspace }) : []),
      ...mcp.tools,
    ],
    brain: opts.brain
      ? { kind: "brain", brain: opts.brain }
      : opts.builderId
        ? {
            kind: "builder",
            builderId: opts.builderId,
            cwd: opts.workspace,
            model: opts.model,
            effort: opts.effort,
            sessionId: opts.builderSessionId,
            runId: opts.runId!,
          }
        : { kind: "router", routerId: String(opts.routerId ?? ""), model: opts.model, effort: opts.effort },
  };

  const policies: ToolPolicy[] = [
    RequireApprovalPolicy(async (tool, ctx): Promise<"park"> => {
      // Nobody decides here — the ask is parked into the inbox and the run
      // blocks; a human's approve is what resumes it. Same inbox loop as the
      // automations, one gate for both surfaces.
      const item = await parkApproval({
        runId: ctx.runId,
        source: opts.approvalSource ?? "firstmate",
        toolCallId: ctx.toolCallId,
        tool: tool.name,
        args: ctx.args,
        summary: summarizeCall(label, tool.name, ctx.args),
      });
      opts.onParked?.(item);
      return "park";
    }, senGate),
  ];

  return { agent, policies, mcpErrors: mcp.errors, close: mcp.close };
}
