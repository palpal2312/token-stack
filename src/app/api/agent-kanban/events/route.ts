import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getEvents } from "@/lib/agent-kanban/store";
import { fetchCanonicalEvents } from "@/lib/agent-kanban/canonical-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const url = new URL(req.url);
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const cardId = url.searchParams.get("cardId") || undefined;
  const beforeRaw = Number(url.searchParams.get("before"));
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : undefined;

  // Canonical-first: when the Go control plane is configured, the activity
  // timeline reads the canonical event spine; otherwise the legacy JSONL
  // store serves during migration.
  const canonical = await fetchCanonicalEvents(since, { cardId, limit, before });
  if (canonical) {
    return NextResponse.json({ events: canonical }, {
      headers: { "cache-control": "no-store", "x-kanban-source": "canonical" },
    });
  }
  return NextResponse.json({ events: await getEvents(since, { cardId, limit, before }) }, {
    headers: { "cache-control": "no-store", "x-kanban-source": "legacy-fallback" },
  });
}
