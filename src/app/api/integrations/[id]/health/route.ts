import { NextResponse } from "next/server";
import { integration } from "@/lib/integrations/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A health check is a read: it asks the tool whether it is working, it does not
 * start, install, or configure anything. That is why it is a GET.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const entry = integration(id);
  if (!entry) return NextResponse.json({ error: `There is no "${id}" integration.` }, { status: 404 });
  if (!entry.health) {
    return NextResponse.json(
      { error: `${entry.name} has no health check — Agent OS can only tell whether its binary is present.` },
      { status: 400 },
    );
  }

  try {
    const h = await entry.health();
    return NextResponse.json({ id, ...h });
  } catch (e) {
    return NextResponse.json(
      { id, ok: false, detail: `The check itself failed: ${String(e instanceof Error ? e.message : e)}` },
    );
  }
}
