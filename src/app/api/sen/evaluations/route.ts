import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  EvaluationEngine,
  type EvaluationResult,
  type EvaluatorContext,
} from "@/lib/llmops/evaluation";
import { RunLedger } from "@/lib/llmops/ledger";
import { AssetRepository, type AssetSnapshot } from "@/lib/llmops/assets";
import { JsonlStorageRepository } from "@/lib/llmops/storage";
import {
  isNonEmptyString,
  isRecord,
  type AssetRef,
  type RunEnvelope,
} from "@/lib/llmops/contracts";
import { checkLocalRequest } from "@/lib/localOnly";

/**
 * SEN evaluation quality gate. This endpoint is fail-closed: it never derives
 * run state from the request body, never registers a caller-influenced
 * evaluator, and never answers before the evaluation record is persisted to
 * $AGENTIC_OS_HOME/llmops/evaluations/<runId>.jsonl. Any missing piece (run,
 * asset snapshot, suite, evidence) is a hard failure — there is no code path
 * that returns passed:true without durable, inspectable evidence.
 */

const EVALUATOR_VERSION = "1.0.0";
const STREAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const TERMINAL_STATUSES: ReadonlySet<RunEnvelope["status"]> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

interface CheckEvidence {
  check: string;
  passed: boolean;
  detail: string;
}

interface IntegrityResult extends EvaluationResult {
  checks: CheckEvidence[];
}

interface EvaluationRecord {
  schemaVersion: 1;
  runId: string;
  suiteId: string;
  baselineRef: string | null;
  policyId: string | null;
  evaluatorVersion: string;
  artifactHash: string;
  score: number;
  passed: boolean;
  checks: CheckEvidence[];
  evaluatedAt: string;
}

/** Server-side suite registry. An unknown suiteId is a 422, never a pass. */
const SUITES: Record<string, { requiredEvaluators: string[] }> = {
  "run-integrity": { requiredEvaluators: ["run-integrity"] },
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Content hash of a persisted artifact ref; claims are verified against it. */
function artifactRefHash(ref: AssetRef): string {
  return sha256(canonicalJson(ref));
}

/**
 * Deterministic evaluator over the persisted RunEnvelope. Every check emits a
 * per-check evidence entry; the score is derived from the checks, never fixed.
 */
async function runIntegrityEvaluator(ctx: EvaluatorContext): Promise<IntegrityResult> {
  const checks: CheckEvidence[] = [];

  const terminal = TERMINAL_STATUSES.has(ctx.run.status);
  checks.push({
    check: "terminal-status",
    passed: terminal,
    detail: terminal
      ? `run reached terminal status ${ctx.run.status}`
      : `run status ${ctx.run.status} is not terminal`,
  });

  const usage = ctx.run.usage;
  const hasUsage = !!usage && (["input", "output", "thinking"] as const)
    .some((key) => typeof usage[key] === "number" && (usage[key] ?? 0) > 0);
  const hasError = !!ctx.run.error;
  checks.push({
    check: "execution-evidence",
    passed: hasUsage || hasError,
    detail: hasUsage
      ? "usage totals recorded on the run envelope"
      : hasError
        ? `run carries error evidence (${ctx.run.error?.class})`
        : "no usage totals or error evidence recorded",
  });

  const persistedArtifacts = ctx.run.artifacts ?? [];
  const mismatched = ctx.artifacts
    .map((claim) => claim.content)
    .filter((claim) => !persistedArtifacts.some((ref) => artifactRefHash(ref) === claim));
  checks.push({
    check: "artifact-hashes",
    passed: mismatched.length === 0,
    detail: mismatched.length === 0
      ? `${ctx.artifacts.length} artifact claim(s) match persisted artifacts`
      : `${mismatched.length} artifact claim(s) do not match persisted artifacts`,
  });

  const failed = checks.filter((check) => !check.passed);
  return {
    evaluatorId: "run-integrity",
    passed: failed.length === 0,
    score: Math.round((100 * (checks.length - failed.length)) / checks.length),
    ...(failed.length ? { reason: `failed checks: ${failed.map((c) => c.check).join(", ")}` } : {}),
    checks,
    executedAt: new Date().toISOString(),
  };
}

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Body must be valid JSON.");
  }
  if (!isRecord(body)) return errorResponse(400, "Body must be a JSON object.");

  const { runId, suiteId, evaluatorVersion, baselineRef, policyId, artifacts } = body;
  if (!isNonEmptyString(runId) || !STREAM_ID_RE.test(runId)) {
    return errorResponse(400, "runId is required and must be a valid ledger id.");
  }
  if (!isNonEmptyString(suiteId)) return errorResponse(400, "suiteId is required.");
  if (!isNonEmptyString(evaluatorVersion)) {
    return errorResponse(400, "evaluatorVersion is required.");
  }
  if (baselineRef !== undefined && !isNonEmptyString(baselineRef)) {
    return errorResponse(400, "baselineRef must be a non-empty string when present.");
  }
  if (policyId !== undefined && !isNonEmptyString(policyId)) {
    return errorResponse(400, "policyId must be a non-empty string when present.");
  }
  if (artifacts !== undefined
    && (!Array.isArray(artifacts) || artifacts.some((claim) => !isNonEmptyString(claim)))) {
    return errorResponse(400, "artifacts must be an array of artifact hash strings when present.");
  }

  const suite = SUITES[suiteId];
  if (!suite) return errorResponse(422, `Unknown evaluation suite: ${suiteId}.`);
  if (evaluatorVersion !== EVALUATOR_VERSION) {
    return errorResponse(422,
      `Unsupported evaluatorVersion ${evaluatorVersion}; this gate serves ${EVALUATOR_VERSION}.`);
  }
  if (typeof policyId === "string" && policyId !== suiteId) {
    return errorResponse(422, `Unknown release policy: ${policyId}.`);
  }

  // The envelope is authoritative — the caller can name a run, never describe one.
  const run = await new RunLedger().getRun(runId);
  if (!run) return errorResponse(404, `Run ${runId} not found in the ledger.`);

  let asset: AssetSnapshot | null = null;
  if (run.assetVersion) {
    asset = await new AssetRepository().loadSnapshot(run.assetVersion);
    if (!asset) {
      return errorResponse(409,
        `Asset snapshot ${run.assetVersion} referenced by run ${runId} is missing.`);
    }
  }

  const claims = (artifacts as string[] | undefined) ?? [];
  const persistedArtifacts = run.artifacts ?? [];
  const mismatched = claims
    .filter((claim) => !persistedArtifacts.some((ref) => artifactRefHash(ref) === claim));
  if (mismatched.length) {
    return errorResponse(409,
      `Artifact claims do not match the run's persisted artifacts: ${mismatched.join(", ")}.`);
  }

  const engine = new EvaluationEngine();
  engine.registerEvaluator("run-integrity", runIntegrityEvaluator);
  engine.registerPolicy({
    id: suiteId,
    requiredEvaluators: suite.requiredEvaluators,
    minimumScore: 100,
  });

  const ctx: EvaluatorContext = {
    run,
    asset: asset ?? { hash: "", kind: "agent", content: null, createdAt: run.createdAt },
    artifacts: claims.map((claim) => ({ path: claim, content: claim })),
  };

  let evaluation: { passed: boolean; results: EvaluationResult[] };
  try {
    evaluation = await engine.evaluateRun(ctx, suiteId);
  } catch (error) {
    // Missing evaluators/policies fail closed, never silently pass.
    return errorResponse(422, String((error as Error)?.message ?? error));
  }

  const result = evaluation.results[0] as (EvaluationResult & { checks?: CheckEvidence[] }) | undefined;
  const checks = result?.checks ?? [];
  if (!result || checks.length === 0) {
    return errorResponse(422, "Evaluator produced no per-check evidence; refusing to pass.");
  }

  const record: EvaluationRecord = {
    schemaVersion: 1,
    runId,
    suiteId,
    baselineRef: typeof baselineRef === "string" ? baselineRef : null,
    policyId: typeof policyId === "string" ? policyId : null,
    evaluatorVersion: EVALUATOR_VERSION,
    artifactHash: sha256(canonicalJson({
      runId,
      suiteId,
      evaluatorVersion: EVALUATOR_VERSION,
      baselineRef: typeof baselineRef === "string" ? baselineRef : null,
      policyId: typeof policyId === "string" ? policyId : null,
      artifactClaims: claims,
      run: {
        status: run.status,
        assetVersion: run.assetVersion ?? null,
        usage: run.usage ?? null,
        error: run.error ?? null,
        artifacts: persistedArtifacts,
      },
      checks,
    })),
    score: result.score ?? 0,
    passed: evaluation.passed,
    checks,
    evaluatedAt: new Date().toISOString(),
  };

  // Evidence is durable before the response exists. A persistence failure is a
  // 500, never an unpersisted pass.
  try {
    new JsonlStorageRepository<EvaluationRecord>("evaluations").append(runId, record);
  } catch (error) {
    return errorResponse(500,
      `Failed to persist evaluation evidence: ${String((error as Error)?.message ?? error)}`);
  }

  return NextResponse.json({ record });
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const runId = new URL(req.url).searchParams.get("runId");
  if (!runId || !STREAM_ID_RE.test(runId)) {
    return errorResponse(400, "runId query parameter is required and must be a valid ledger id.");
  }

  let records: EvaluationRecord[];
  try {
    records = new JsonlStorageRepository<EvaluationRecord>("evaluations").readEvents(runId);
  } catch (error) {
    return errorResponse(500,
      `Failed to read evaluation evidence: ${String((error as Error)?.message ?? error)}`);
  }
  if (records.length === 0) {
    return errorResponse(404, `No evaluations recorded for run ${runId}.`);
  }
  return NextResponse.json({ records });
}
