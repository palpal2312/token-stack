import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { enrichEmails, dedupe, type Lead } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {leads} → fill missing emails (Hunter) + drop ones we've pulled before.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { leads } = await req.json().catch(() => ({}));
  if (!Array.isArray(leads)) return Response.json({ error: "No leads to enrich." }, { status: 400 });
  try {
    const enriched = await enrichEmails((leads as Lead[]).slice(0, 500));
    const { fresh, skipped } = await dedupe(enriched);
    return Response.json({ leads: fresh, skipped, total: enriched.length }, { headers: { "cache-control": "no-store" } });
  } catch (e: unknown) {
    return Response.json({ error: (e as Error)?.message || "Enrich failed" }, { status: 502 });
  }
}
