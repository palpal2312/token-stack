// Probe one MCP server: connect, list what it offers, report. This is the
// "detect and report" half of the Integrations philosophy made into a button —
// it never installs, never fixes, and a failure comes back explained.
//
// Guarded like every mutation: the probe replays the server's stored auth
// header to its URL, so a foreign page must not get to choose when that fires.

import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { getMcpServer } from "@/lib/mcpServers";
import { McpClient } from "@/lib/agentRuntime/mcp";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let server;
  try { server = await getMcpServer(id); }
  catch (e) {
    if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    throw e;
  }
  if (!server) return NextResponse.json({ error: `No MCP server "${id}".` }, { status: 404 });

  const client = new McpClient(server);
  try {
    await client.connect();
    const tools = await client.runtimeTools();
    return NextResponse.json({
      ok: true,
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
      filtered: Boolean(server.allowedTools?.length),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: `Could not reach "${server.name}": ${String((e as Error)?.message ?? e)}`,
    });
  } finally {
    await client.close();
  }
}
