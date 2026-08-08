import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { listBuilders } from "@/lib/builders/registry";
import { readAukerConfig } from "@/lib/sen-config";
import { listSessions } from "@/lib/sen-sessions";
import { listCards } from "@/lib/agent-kanban/store";
import { RUNTIME_STATES, WORKFLOW_STAGES } from "@/lib/agent-kanban/types";
import { RunLedger } from "@/lib/llmops/ledger";
import { computeMetrics } from "@/lib/llmops/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const ledger = new RunLedger();
    const [builders, config, cards, sessions, runs] = await Promise.all([
      listBuilders(), readAukerConfig(), listCards(), listSessions({ includeInternal: true }), ledger.listRuns()
    ]);
    const verified = builders.filter((builder) => Boolean(builder.verifiedAt));
    const workflow = Object.fromEntries(WORKFLOW_STAGES.map((stage) => [
      stage, cards.filter((card) => card.workflowStage === stage).length,
    ]));
    const runtime = Object.fromEntries(RUNTIME_STATES.map((state) => [
      state, cards.filter((card) => card.runtimeState === state).length,
    ]));
    const attentionStates = new Set(["needs_input", "blocked", "quota_wait", "failed"]);
    const recentAttempts = cards
      .flatMap((card) => card.attempts.map((attempt) => ({
        id: attempt.id,
        cardId: card.id,
        title: card.title,
        status: attempt.status,
        builder: attempt.builderId,
        sessionId: attempt.sessionId,
        updatedAt: attempt.endedAt ?? attempt.startedAt ?? card.updatedAt,
      })))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    const metrics = computeMetrics(runs);

    return NextResponse.json({
      workers: verified.map((builder) => ({
        id: builder.id,
        name: builder.name,
        cli: builder.cli,
        quota: builder.quota ?? null,
        verifiedAt: builder.verifiedAt,
      })),
      fallbackBuilders: config.fallbackBuilders,
      board: {
        total: cards.length,
        workflow,
        runtime,
        attention: cards.filter((card) => attentionStates.has(card.runtimeState)).length,
        activeAttempts: cards.reduce((sum, card) => sum + card.attempts.filter((attempt) =>
          attempt.status === "queued" || attempt.status === "running" || attempt.status === "needs_input").length, 0),
      },
      firstmate: {
        sessions: sessions.length,
        kanbanSessions: sessions.filter((session) => session.kind === "kanban").length,
        recent: sessions.slice(0, 5).map((session) => ({
          id: session.id, title: session.title, kind: session.kind ?? "chat", updatedAt: session.updatedAt,
        })),
      },
      recent: {
        attempts: recentAttempts,
      },
      llmops: {
        totalRuns: metrics.totalRuns,
        successRuns: metrics.successRuns,
        failedRuns: metrics.failedRuns,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        totalDurationMs: metrics.totalDurationMs,
      }
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
  }
}
