// The delegation toolkit: builders as workers.
//
// Sen is the orchestrator; Builder profiles are the workers. This toolkit is
// the bridge between the two — the same shape OpenWorker uses to fan a goal out
// over its tools: list who is available, hand each subtask to
// one, read the results back, merge. Every delegated turn goes through
// runBuilderChat, so it spawns, isolates, streams, times out, and dies
// exactly like a chat turn typed by hand — delegation adds orchestration,
// not a second spawner.
//
// Two guardrails are structural, not prompt-level:
//
//   * delegate_task is riskLevel "external" with requiresApproval forced on:
//     it spends real quota on a real account, so under the Sen gate a human
//     sees the ask in the inbox before a token moves.
//   * DELEGATE_DEPTH caps recursion. A delegated builder can itself be an
//     agent runtime carrying this same toolkit; the counter rides the spawn
//     env down one hop per delegation, and at the cap the tool refuses as
//     its own result — the model reads the no and does the work itself
//     instead of a worker pyramid spending quota unchecked.
//
// Failures are results, never throws: an unknown builder id, a broken
// profile, a timeout — all come back as { error } so the orchestrator sees
// its delegation failed and routes around it instead of the run dying on
// one bad subtask. One failure shape gets extra structure: when the worker
// died of quota or rate-limit, the error also carries quotaExhausted and the
// next-ranked alternatives, so the orchestrator can fail over to another
// lane instead of retrying a dead one.

import { getBuilder, listBuilders } from "../../builders/registry";
import { cliSpec } from "../../builders/clis";
import { runBuilderChat } from "../../builders/chat";
import { refreshStaleQuota } from "../../builders/quotaRefresh";
import type { RuntimeTool } from "../agent";

/**
 * A delegated turn gets its own clock, never the runtime's turn budget:
 * five minutes wall-clock, separate from CHAT_TIMEOUT_MS so an env-tuned
 * chat timeout does not silently retune delegation too.
 */
const DEFAULT_DELEGATE_TIMEOUT_MS = 5 * 60_000;

/** Depth at which delegate_task starts refusing. Depth 0 and 1 may delegate. */
const MAX_DELEGATE_DEPTH = 2;

export interface DelegateToolkitOptions {
  /** Working directory for delegated turns when the call does not name one. */
  defaultCwd?: string;
  timeoutMs?: number;
}

function delegateDepth(): number {
  return Number(process.env.DELEGATE_DEPTH ?? 0) || 0;
}

/**
 * The orchestrator-facing view of a CLI's workflow contract: everything the
 * model needs to choose knob values, none of the machinery (argsFor) it must
 * never see — knob values go through delegate_task's validation, not raw args.
 */
function workflowView(cli: string) {
  const wf = cliSpec(cli)?.workflow;
  if (!wf) return null;
  return {
    summary: wf.summary,
    knobs: wf.knobs.map((k) => ({
      id: k.id, description: k.description, values: k.values,
      ...(k.printCompatible === false ? { printCompatible: false } : {}),
    })),
  };
}

/**
 * Validate a delegate_task `workflow` argument against the builder's CLI
 * contract and translate it into argv. Every failure is a plain-language
 * string naming the valid knobs/values — the model reads it and corrects the
 * call, same as any other tool error here.
 */
function resolveWorkflowArgs(
  cli: string,
  workflow: Record<string, unknown>,
): { args: string[]; error?: string } {
  const spec = cliSpec(cli);
  const knobs = spec?.workflow?.knobs ?? [];
  const label = spec?.label ?? cli;
  const validList = () =>
    knobs.length
      ? knobs.map((k) => `${k.id} (${k.values.join(" | ")})`).join("; ")
      : "none — this CLI exposes no workflow knobs";

  for (const [id, raw] of Object.entries(workflow)) {
    const knob = knobs.find((k) => k.id === id);
    if (!knob) {
      return { args: [], error: `Unknown workflow knob "${id}" for ${label}. Valid knobs: ${validList()}.` };
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || !knob.values.includes(value)) {
      return {
        args: [],
        error: `Invalid value "${String(raw)}" for workflow knob "${id}" (${label}). Valid values: ${knob.values.join(", ")}.`,
      };
    }
    if (value !== "default" && knob.printCompatible === false) {
      return {
        args: [],
        error: `Workflow knob "${id}" is interactive-only for ${label} — the CLI rejects it in print mode, and delegation always runs print mode. Leave it unset ("default").`,
      };
    }
  }
  const args = knobs.flatMap((k) => {
    const v = workflow[k.id];
    return typeof v === "string" && v.trim() ? k.argsFor(v.trim()) : [];
  });
  return { args };
}

// ------------------------------------------------------------------ readiness
//
// list_workers ranks workers so the orchestrator reads the best lane first.
// The score is deliberately crude — verified-recency buckets plus quota
// headroom — and every uncertainty surfaces as a warning string instead of
// fake precision: an unparseable quota is "unknown", never 0% used.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Largest used-percent actually present in a stored quota reading, from the
 * patterns the probes really produce: "Weekly 56% · 5h 12%" (kimi), "weekly
 * 0% used" (codex), "$1.23 used of $10.00" (OpenRouter, → 12.3). Unparseable
 * text returns null — unknown is honest, zero would be a lie.
 */
export function parseQuotaUsedPercent(text: string): number | null {
  let best: number | null = null;
  const consider = (v: number) => {
    if (Number.isFinite(v) && (best === null || v > best)) best = v;
  };
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) consider(parseFloat(m[1]));
  const dollars = /\$\s*([\d.]+)\s*used\s+of\s+\$\s*([\d.]+)/i.exec(text);
  if (dollars) {
    const total = parseFloat(dollars[2]);
    if (total > 0) consider((parseFloat(dollars[1]) / total) * 100);
  }
  return best;
}

/** What list_workers scores and warns over — the registry's per-builder state. */
export interface WorkerReadinessInput {
  verifiedAt?: string;
  quota?: { text: string; checkedAt: string };
}

/**
 * Verified recency (≤1h 40, ≤24h 25, ≤7d 10, older or absent 0) plus quota
 * headroom ((100 − used%) × 0.6; an unknown reading a cautious flat 20).
 */
export function readinessScore(w: WorkerReadinessInput, nowMs = Date.now()): number {
  let score = 0;
  if (w.verifiedAt) {
    const age = nowMs - Date.parse(w.verifiedAt);
    if (Number.isFinite(age) && age >= 0) {
      if (age <= HOUR_MS) score += 40;
      else if (age <= DAY_MS) score += 25;
      else if (age <= 7 * DAY_MS) score += 10;
    }
  }
  const used = w.quota ? parseQuotaUsedPercent(w.quota.text) : null;
  score += used === null ? 20 : (100 - used) * 0.6;
  return Math.round(score * 10) / 10;
}

/** Loud, plain-language caveats — the model routes around these, not around the score. */
export function workerWarnings(w: WorkerReadinessInput, nowMs = Date.now()): string[] {
  const warnings: string[] = [];
  const used = w.quota ? parseQuotaUsedPercent(w.quota.text) : null;
  if (used !== null && used > 80) warnings.push("quota >80% used");
  if (!w.verifiedAt) warnings.push("never probed");
  if (w.quota?.checkedAt) {
    const age = nowMs - Date.parse(w.quota.checkedAt);
    if (Number.isFinite(age) && age > DAY_MS) warnings.push("stale reading >24h");
  }
  if (used === null) warnings.push("quota unknown");
  return warnings;
}

// ------------------------------------------------------------ quota failover
//
// A worker that dies of quota or rate-limit is a routing problem, not a
// mystery: the orchestrator should fail over to the next lane, not stall.
// Detection is deliberately conservative — only the shapes CLIs actually
// print when the account runs dry count, so a plain crash stays a plain
// error and never masquerades as quota (a false positive would hide the
// real error behind a failover).

const QUOTA_FAILURE_PATTERNS: RegExp[] = [
  /\b429\b/i,
  /rate.?limit/i,
  /quota/i,
  /out of (credits|credit)/i,
  /insufficient.(credit|quota|balance)/i,
  /payment.?required|402/i,
];

/** True only for quota/rate-limit failure shapes — anything else is a plain error. */
export function isQuotaFailure(text: string): boolean {
  return QUOTA_FAILURE_PATTERNS.some((p) => p.test(text));
}

/** The ranked worker view list_workers returns — also the pool quota failover picks alternatives from. */
interface RankedWorker {
  id: string;
  name: string;
  cli: string;
  verifiedAt?: string;
  quota?: string;
  readiness: number;
  warnings: string[];
  workflow?: ReturnType<typeof workflowView>;
}

/**
 * The one worker-listing path: registry read, inline refresh of stale
 * cheap-to-probe readings, readiness scoring, best-first sort. list_workers
 * exposes it to the model; delegate_task's quota failover reuses it so the
 * alternatives it names are exactly the ranking the model already saw.
 */
async function rankedWorkers(): Promise<{ workers: RankedWorker[] } | { error: string }> {
  try {
    let builders = await listBuilders();
    const now = Date.now();
    // Stale readings on cheap-to-probe workers (codex wham, API-key
    // probes) refresh inline before ranking — HTTP-class only,
    // concurrency-capped. Heavyweight probes (kimi TUI) are never fired
    // automatically: those keep their dated reading and the stale
    // warning workerWarnings already emits.
    const refreshed = await refreshStaleQuota(builders, { nowMs: now });
    if (refreshed.length) builders = await listBuilders();
    const workers = builders.map((b) => ({
      id: b.id,
      name: b.name,
      cli: b.cli,
      ...(b.verifiedAt ? { verifiedAt: b.verifiedAt } : {}),
      ...(b.quota ? { quota: b.quota.text } : {}),
      readiness: readinessScore(b, now),
      warnings: workerWarnings(b, now),
      ...(workflowView(b.cli) ? { workflow: workflowView(b.cli) } : {}),
    }));
    // Best-first: readiness descending, ties broken by the fresher probe.
    const probeTs = (s?: string) => {
      const t = s ? Date.parse(s) : NaN;
      return Number.isFinite(t) ? t : 0;
    };
    workers.sort((x, y) =>
      y.readiness - x.readiness || probeTs(y.verifiedAt) - probeTs(x.verifiedAt));
    return { workers };
  } catch (e) {
    return { error: `Could not list workers: ${String((e as Error)?.message ?? e)}` };
  }
}

/**
 * The lanes to try after a quota death: the same ranking list_workers shows,
 * minus the worker that just died and minus any lane with a quota warning.
 * A lane with exhausted, unknown, or stale quota is not a reliable failover
 * target; only workers with a current, usable quota reading remain. At most
 * three are returned, trimmed to what the model needs to pick the next one.
 */
async function quotaAlternatives(deadId: string) {
  const out = await rankedWorkers();
  const workers = "workers" in out ? out.workers : [];
  return workers
    .filter((w) => w.id !== deadId && !w.warnings.some((x) => x.includes("quota") || x.startsWith("stale reading")))
    .slice(0, 3)
    .map((w) => ({ id: w.id, name: w.name, cli: w.cli, readiness: w.readiness }));
}

export function delegateToolkit(opts: DelegateToolkitOptions = {}): RuntimeTool[] {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS;

  return [
    {
      name: "list_workers",
      description:
        "List the Builder profiles available as workers, ranked best-first by readiness (verified "
        + "recency + quota headroom), each with its readiness score and any warnings (e.g. "
        + "\"quota >80% used\", \"never probed\", \"stale reading >24h\", \"quota unknown\"). Also "
        + "shown: id, name, cli, verifiedAt, quota (the last quota reading — stale data is normal, "
        + "treat it as a hint), and workflow (the worker CLI's loop contract: a summary of how it "
        + "works and the knobs delegate_task accepts). Use this before delegate_task to pick a "
        + "worker AND its workflow knobs; take the first worker that fits the task and avoid ones "
        + "with quota warnings unless the user asked for them.",
      schema: { type: "object", properties: {} },
      metadata: { riskLevel: "read" },
      async execute() {
        return rankedWorkers();
      },
    },
    {
      name: "delegate_task",
      description:
        "Hand one subtask to one Builder profile (a worker) and wait for its answer. The task text "
        + "is the whole prompt the worker sees — make it self-contained. The optional workflow "
        + "arg sets the worker CLI's own loop knobs (see the workflow contract in list_workers): "
        + "pass { knobId: value } and it is validated and translated into the CLI's native args — "
        + "never invent flags yourself. Returns { builder, text, durationMs } on success or "
        + "{ error } on failure; a failed delegation is information, not the end of the run. "
        + "When the failure is quota or rate-limit, the error also carries quotaExhausted: true "
        + "and alternatives — the next-ranked workers, minus the dead one and any already low on "
        + "quota — so you can delegate the same subtask to alternatives[0] instead of retrying a "
        + "dead lane. Costs real quota, so a human approves each call.",
      schema: {
        type: "object",
        properties: {
          builder_id: { type: "string", description: "The worker's profile id, from list_workers." },
          task: { type: "string", description: "The subtask, self-contained — the worker sees nothing else." },
          cwd: { type: "string", description: "Working directory for the worker. Defaults to the agent's workspace." },
          workflow: {
            type: "object",
            description:
              "Optional workflow knob settings, { knobId: value } from the worker's workflow contract "
              + "in list_workers — e.g. { sandbox: \"read-only\" } for a careful run. Invalid ids or "
              + "values come back as an error naming the valid ones.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["builder_id", "task"],
      },
      metadata: { riskLevel: "external", requiresApproval: true },
      async execute(args, ctx) {
        const a = args as Record<string, unknown>;
        const builderId = typeof a?.builder_id === "string" ? a.builder_id.trim() : "";
        if (!builderId) return { error: "Give builder_id as a string. Call list_workers to see the ids." };
        const task = typeof a?.task === "string" ? a.task : "";
        if (!task.trim()) {
          return { error: "Give task as a non-empty string — it is the whole prompt the worker sees." };
        }

        const depth = delegateDepth();
        if (depth >= MAX_DELEGATE_DEPTH) {
          return {
            error: `Refused: delegation depth ${depth} is already at the cap (${MAX_DELEGATE_DEPTH}). `
              + "A worker may not delegate further — do this part yourself.",
          };
        }

        let builder;
        try {
          builder = await getBuilder(builderId);
        } catch (e) {
          return { error: `Could not read the builder registry: ${String((e as Error)?.message ?? e)}` };
        }
        if (!builder) {
          return { error: `No Builder profile "${builderId}". Call list_workers to see the ids — do not guess.` };
        }

        // Workflow knobs: validated against the CLI's contract and translated
        // into its own native args. A bad knob or value refuses BEFORE anything
        // spawns — quota is only spent on a delegation whose workflow is sound.
        let workflowArgs: string[] = [];
        if (a?.workflow !== undefined) {
          if (typeof a.workflow !== "object" || a.workflow === null || Array.isArray(a.workflow)) {
            return { error: "Give workflow as an object, { knobId: value } — see the workflow contract in list_workers." };
          }
          const resolvedWf = resolveWorkflowArgs(builder.cli, a.workflow as Record<string, unknown>);
          if (resolvedWf.error) return { error: resolvedWf.error };
          workflowArgs = resolvedWf.args;
        }

        const cwd = typeof a?.cwd === "string" && a.cwd.trim() ? a.cwd : opts.defaultCwd;
        const result = await runBuilderChat({
          builder,
          prompt: task,
          cwd,
          timeoutMs,
          signal: ctx.signal,
          argsSuffix: workflowArgs,
          // One hop deeper: if this worker is itself an agent runtime with
          // this toolkit, its own delegate_task reads the raised value.
          extraEnv: { DELEGATE_DEPTH: String(depth + 1) },
          // The worker's stream has no listener here — the result object IS the report.
          emit: () => {},
        });

        if (result.error) {
          // A quota/rate-limit death names its own successors: the error goes
          // back flagged, with the next-ranked lanes attached. The detector
          // reads both the error and whatever the worker printed — a CLI that
          // says "429" and exits nonzero may report either way. Plain crashes
          // stay plain errors: no flag, no alternatives, nothing to fail over to.
          if (isQuotaFailure(result.error) || isQuotaFailure(result.text)) {
            return {
              builder: builder.id, name: builder.name, error: result.error, durationMs: result.durationMs,
              quotaExhausted: true, alternatives: await quotaAlternatives(builder.id),
            };
          }
          return { builder: builder.id, name: builder.name, error: result.error, durationMs: result.durationMs };
        }
        return { builder: builder.id, name: builder.name, text: result.text, durationMs: result.durationMs };
      },
    },
  ];
}
