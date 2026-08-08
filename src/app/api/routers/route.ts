import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  listRouters, createRouter, publicRouter, allRouterKinds, RegistryCorrupt,
} from "@/lib/routers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
}

// Guarded even for read: router profiles carry API keys (masked, but the base
// URLs and kinds are still sensitive), so a local process needs the token.
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const routers = await listRouters();
    return NextResponse.json({
      routers: routers.map(publicRouter),
      kinds: allRouterKinds().map((k) => ({ ...k, profileCount: routers.filter((r) => r.kind === k.id).length })),
    });
  } catch (e) { return failed(e); }
}

// Guarded: this writes an API key to disk.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  try {
    const router = await createRouter({
      kind: String(body.kind ?? ""),
      name: String(body.name ?? ""),
      baseUrl: body.baseUrl === undefined ? undefined : String(body.baseUrl),
      apiKey: body.apiKey === undefined ? undefined : String(body.apiKey),
      defaultModel: body.defaultModel === undefined ? null : (body.defaultModel as string | null),
      notes: String(body.notes ?? ""),
    });
    return NextResponse.json({ router: publicRouter(router) }, { status: 201 });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}
