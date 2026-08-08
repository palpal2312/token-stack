import { NextResponse } from "next/server";
import { RunLedger } from "@/lib/llmops/ledger";
import { computeMetrics } from "@/lib/llmops/metrics";
import { checkLocalRequest } from "@/lib/localOnly";
import { shadowCompare } from "@/lib/senShadowProxy";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const ledger = new RunLedger();
    const runs = await ledger.listRuns();
    const metrics = computeMetrics(runs);

    const payload = {
      metrics: {
        ...metrics,
        activeBuilders: Array.from(metrics.activeBuilders)
      }
    };
    // Shadow mode (phase 05): the Go control plane's /v1/sen/metrics is
    // compared against this payload and divergences logged; this route stays
    // authoritative until parity is measured. Note the two sides intentionally
    // differ today (llmops run metrics vs canonical domain counts) — shadow
    // mode exists to quantify exactly that gap.
    void shadowCompare("sen/metrics", "/v1/sen/metrics", payload);
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
