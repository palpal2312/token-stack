import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/v1/sen/workspace/execution-preference";

// Proxy for the workspace execution preference (phase 12 step 11). Offline
// Go plane → available:false so the UI hides the selector.
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const result = await goApiFetch(PATH);
  if (!result.ok || !result.body || typeof result.body !== "object") {
    return NextResponse.json({ available: false, preference: null }, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(
    { available: true, preference: result.body },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (body.mode !== "host" && body.mode !== "agentenv") {
    return NextResponse.json({ error: "mode must be host or agentenv." }, { status: 400 });
  }
  const result = await goApiFetch(PATH, {
    method: "PUT",
    body: { mode: body.mode, updatedBy: "user", explanationRef: typeof body.explanationRef === "string" ? body.explanationRef : "" },
  });
  if (result.unreachable) {
    return NextResponse.json({ error: "canonical control plane is unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    const message = (result.body as { message?: string } | null)?.message ?? "preference update failed";
    return NextResponse.json({ error: message }, { status: result.status >= 500 ? 502 : 400 });
  }
  return NextResponse.json({ available: true, preference: result.body });
}
