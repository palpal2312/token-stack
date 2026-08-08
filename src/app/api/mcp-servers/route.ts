// The MCP server registry API. Read shape is masked (publicMcpServer); every
// mutation is origin-guarded because a created stdio server is a command this
// machine will later spawn.

import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { createMcpServer, listMcpServers, publicMcpServer } from "@/lib/mcpServers";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
}

export async function GET() {
  try {
    const servers = (await listMcpServers()).map(publicMcpServer);
    return NextResponse.json({ servers });
  } catch (e) { return failed(e); }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  try {
    const server = await createMcpServer({
      name: String(body.name ?? ""),
      transport: body.transport === "stdio" ? "stdio" : "http",
      command: body.command === undefined ? undefined : String(body.command),
      args: Array.isArray(body.args) ? body.args.map(String) : undefined,
      env: body.env as Record<string, string> | undefined,
      url: body.url === undefined ? undefined : String(body.url),
      headers: body.headers as Record<string, string> | undefined,
      allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools.map(String) : undefined,
      usePrefix: body.usePrefix === undefined ? true : Boolean(body.usePrefix),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      notes: body.notes === undefined ? "" : String(body.notes),
    });
    return NextResponse.json({ server: publicMcpServer(server) }, { status: 201 });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}
