// Schedule a wake-up probe for when the earliest quota reset arrives. The
// whole fallback chain was dead; at the reset time the server re-probes the
// chain and records the outcome in the firstmate config (wakeResult), which
// the page polls — there is no push channel, and a setTimeout in this
// long-running local server is the honest mechanism. Cap 6h.

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import { getBuilder } from "@/lib/builders/registry";
import { readAukerConfig, writeAukerConfig } from "@/lib/sen-config";
import { isQuotaRecovered, parseRemainingPct } from "@/lib/quota-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
let armed = false;

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const at = Date.parse(String(body.at ?? ""));
  if (!Number.isFinite(at)) return NextResponse.json({ error: "Missing/invalid `at` (ISO time)." }, { status: 400 });
  const delay = at - Date.now();
  if (delay <= 0) return NextResponse.json({ error: "Thờờii điểm đó đã qua — probe ngay bằng nút health ở CLI Config." }, { status: 400 });
  if (delay > MAX_DELAY_MS) return NextResponse.json({ error: "Xa quá 6 giờ — hẹn gần hơn." }, { status: 400 });
  if (armed) return NextResponse.json({ error: "Đã có một lịch wake đang chờ rồi." }, { status: 409 });

  armed = true;
  const timer = setTimeout(async () => {
    armed = false;
    try {
      const { probeBuilder } = await import("@/lib/builders/health");
      const { fallbackBuilders, handoffTriggerPct } = await readAukerConfig();
      const back: string[] = [];
      const stillDead: string[] = [];
      for (const id of fallbackBuilders) {
        const b = await getBuilder(id);
        if (!b) continue;
        try {
          const h = await probeBuilder(b);
          const pct = h.quota ? parseRemainingPct(h.quota, b.cli) : null;
          if (isQuotaRecovered(h.state, pct, handoffTriggerPct)) back.push(b.name);
          else stillDead.push(b.name);
        } catch { stillDead.push(b.name); }
      }
      await writeAukerConfig({ wakeResult: { firedAt: new Date().toISOString(), back, stillDead } });
    } catch { /* the next page poll simply shows nothing new */ }
  }, delay);
  timer.unref();

  return NextResponse.json({ ok: true, firesAt: new Date(at).toISOString() });
}
