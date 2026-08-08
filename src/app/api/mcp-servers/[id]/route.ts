// One MCP server: patch it or remove it. Both are origin-guarded — a PATCH
// can repoint where credentials get sent, a DELETE changes what agents reach.

import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { deleteMcpServer, publicMcpServer, updateMcpServer } from "@/lib/mcpServers";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  try {
    const server = await updateMcpServer(id, {
      transport: body.transport === undefined ? undefined : (body.transport === "stdio" ? "stdio" : "http"),
      command: body.command === undefined ? undefined : String(body.command),
      args: Array.isArray(body.args) ? body.args.map(String) : undefined,
      env: body.env as Record<string, string> | undefined,
      url: body.url === undefined ? undefined : String(body.url),
      headers: body.headers as Record<string, string> | undefined,
      allowedTools: body.allowedTools === undefined ? undefined
        : body.allowedTools === null ? null
        : (body.allowedTools as unknown[]).map(String),
      usePrefix: body.usePrefix === undefined ? undefined : Boolean(body.usePrefix),
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      notes: body.notes === undefined ? undefined : String(body.notes),
    });
    return NextResponse.json({ server: publicMcpServer(server) });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;
  try {
    await deleteMcpServer(id);
    return NextResponse.json({ ok: true });
  } catch (e) { return failed(e); }
}
