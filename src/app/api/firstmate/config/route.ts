// Sen chat settings: which worker automatically takes over when the current
// one dies of quota. Server-side (lib/sen-config.ts) because the chat route
// reads it mid-turn, not just the page.

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import { getBuilder } from "@/lib/builders/registry";
import { readAukerConfig, writeAukerConfig } from "@/lib/sen-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  return NextResponse.json(await readAukerConfig());
}

export async function PUT(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const patch: Parameters<typeof writeAukerConfig>[0] = {};
  if ("fallbackBuilders" in body || "fallbackBuilder" in body) {
    const raw = "fallbackBuilders" in body ? body.fallbackBuilders : body.fallbackBuilder;
    const ids = Array.isArray(raw)
      ? raw.map(String).filter(Boolean).slice(0, 3)
      : (raw === null || raw === "" || raw === undefined ? [] : [String(raw)]);
    for (const id of ids) {
      const b = await getBuilder(id);
      if (!b) return NextResponse.json({ error: `No Builder profile "${id}".` }, { status: 404 });
      // A fallback that cannot answer is worse than none — it would fail the
      // turn twice instead of once.
      if (!b.verifiedAt) {
        return NextResponse.json({ error: `Worker "${id}" chưa có tick xanh — verify ở CLI Config trước.` }, { status: 409 });
      }
    }
    patch.fallbackBuilders = ids;
  }
  for (const k of ["handoffWatchPct", "handoffTriggerPct"] as const) {
    if (k in body) {
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v <= 0 || v >= 100) {
        return NextResponse.json({ error: `${k} phải là số trong khoảng 1-99.` }, { status: 400 });
      }
      patch[k] = v;
    }
  }
  const cur = await readAukerConfig();
  const effectiveWatch = patch.handoffWatchPct ?? cur.handoffWatchPct;
  const effectiveTrigger = patch.handoffTriggerPct ?? cur.handoffTriggerPct;
  if (effectiveWatch <= effectiveTrigger) {
    return NextResponse.json({ error: `handoffWatchPct (${effectiveWatch}) phải lớn hơn handoffTriggerPct (${effectiveTrigger}).` }, { status: 400 });
  }
  const next = await writeAukerConfig(patch);
  return NextResponse.json({ ok: true, ...next });
}
