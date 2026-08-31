import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { RunLedger } from "@/lib/llmops/ledger";
import { computeMetrics } from "@/lib/llmops/metrics";
import { checkLocalRequest } from "@/lib/localOnly";
import { shadowCompareResponse } from "@/lib/senShadowProxy";

type Runs = Awaited<ReturnType<RunLedger["listRuns"]>>;

// A fresh RunLedger per request replays the entire events.jsonl. The journal
// only changes through appends (which rewrite both files), so (mtime,size) of
// events.jsonl + runs.json keys the replay result. Module-level because the
// route constructs the ledger per request; paths in the key keep QA's
// redirected AGENTIC_OS_HOME from colliding.
let runsCache: { key: string; runs: Runs } | null = null;

async function cachedListRuns(ledger: RunLedger): Promise<Runs> {
  let key: string | null = null;
  try {
    const [e, s] = await Promise.all([stat(ledger.paths.events), stat(ledger.paths.snapshot)]);
    key = `${ledger.paths.events}:${e.mtimeMs}:${e.size}:${s.mtimeMs}:${s.size}`;
  } catch { /* files absent — the ledger answers that itself; skip caching */ }
  if (key && runsCache?.key === key) return runsCache.runs;
  const runs = await ledger.listRuns();
  if (key) runsCache = { key, runs };
  return runs;
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const ledger = new RunLedger();
    const runs = await cachedListRuns(ledger);
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
    // mode exists to quantify exactly that gap. Observation clones the
    // response so the returned body stays byte-identical with shadow on.
    const res = NextResponse.json(payload);
    void shadowCompareResponse("sen/metrics", "/v1/sen/metrics", res);
    return res;
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
