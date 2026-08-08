import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getBuilder, listBuilders, setBuilderQuota } from "@/lib/builders/registry";
import { probeBuilder } from "@/lib/builders/health";
import { persistProbeResult } from "@/lib/builders/quotaRefresh";
import { sameAccountSiblings } from "@/lib/builders/credentialIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST, not GET: this starts a real process. Guarded for the same reason — a page
// that could trigger spawns on your machine is a page that can spend your tokens.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  try {
    const b = await getBuilder(id);
    if (!b) return NextResponse.json({ error: `No profile "${id}".` }, { status: 404 });

    const health = await probeBuilder(b);

    // The registry write is shared with the automatic staleness refresh
    // (lib/builders/quotaRefresh.ts) so a manual probe and an auto-refresh
    // leave the record in exactly the same shape.
    await persistProbeResult(id, health);

    // The quota belongs to the ACCOUNT, not this one profile — a manual probe
    // of one kimi profile refreshes the reading on every profile of the same
    // identity, just like the automatic lanes.
    if (health.quota) {
      const all = await listBuilders();
      for (const s of sameAccountSiblings(b, all)) {
        try { await setBuilderQuota(s.id, health.quota); } catch { /* best-effort */ }
      }
    }

    return NextResponse.json({ health });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
