import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { publicBuilder, RegistryCorrupt } from "@/lib/builders/registry";
import { useRouterWithCli } from "@/lib/routerToCli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn a Router into a Builder profile of a CLI (`codex -p <slug>`, or a claude
 * profile with ANTHROPIC_BASE_URL). Writes codex-native config under
 * $CODEX_HOME, so it is guarded like every other credential-writing route.
 *
 * The response names files and env vars; the key value never appears in it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as { cli?: unknown; name?: unknown } | null;
  const cli = typeof body?.cli === "string" ? body.cli.trim() : "";
  if (!cli) return NextResponse.json({ error: 'Which CLI? Send {cli: "codex"} or {cli: "claude"}.' }, { status: 400 });
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;

  try {
    const { builder, created, detail } = await useRouterWithCli(id, cli, name);
    return NextResponse.json({ builder: publicBuilder(builder), created, detail }, { status: created ? 201 : 200 });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    const msg = String(e instanceof Error ? e.message : e);
    // "No Router x" is the caller addressing something that is not there.
    return NextResponse.json({ error: msg }, { status: /^No Router/.test(msg) ? 404 : 400 });
  }
}
