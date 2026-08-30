import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Thin retry proxy: ask the Go control plane to re-queue a terminal attempt.
// Idempotent envelope — the caller's commandId is the replay key. No model
// spawn and no filesystem authority in this route.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  let body: { commandId?: string } = {};
  try {
    body = (await req.json()) as { commandId?: string };
  } catch {
    body = {};
  }
  const result = await goApiFetch(`/v1/sen/chat/attempts/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    commandId: body.commandId,
    body: { commandId: body.commandId },
  });
  if (!result.ok) {
    const errBody = result.body as { message?: string; error?: string } | null;
    return NextResponse.json(
      { error: errBody?.error ?? errBody?.message ?? "canonical chat retry failed" },
      { status: result.status === 404 ? 404 : result.status === 400 ? 400 : 503 },
    );
  }
  return NextResponse.json(result.body);
}
