import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import {
  startSession, writeInput, resize, killSession, subscribe, terminalState,
  clampCols, clampRows,
} from "@/lib/herdrTerminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This route spawns an interactive shell — the most powerful endpoint in the
// dashboard. Both verbs are origin-guarded; the server binds 127.0.0.1 only.
//
// POST { op } drives the terminal: start, input, resize, restart.
// Live I/O uses the duplex WebSocket at /api/herdr/terminal/ws (server.ts).
// GET SSE + POST input/resize remain for tooling / emergency escape only —
// the Code Space UI does not open EventSource anymore.

interface OpBody { op?: unknown; data?: unknown; cols?: unknown; rows?: unknown }

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => null) as OpBody | null;
  const op = typeof body?.op === "string" ? body.op : "";
  const cols = clampCols(body?.cols);
  const rows = clampRows(body?.rows);

  switch (op) {
    case "start": {
      const r = await startSession(cols, rows);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
      return NextResponse.json({ ok: true, ...terminalState() });
    }
    case "restart": {
      killSession();
      const r = await startSession(cols, rows);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
      return NextResponse.json({ ok: true, ...terminalState() });
    }
    case "input": {
      const data = typeof body?.data === "string" ? body.data : "";
      if (!data) return NextResponse.json({ ok: true });
      if (!writeInput(data)) {
        return NextResponse.json({ error: "The terminal is not running. Start it first." }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    }
    case "resize": {
      resize(cols, rows);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: `Unknown op "${op}". Use start, input, resize, or restart.` }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!terminalState().running && !terminalState().exited) {
    return NextResponse.json({ error: "The terminal is not running. POST {op:\"start\"} first." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)); }
        catch { closed = true; }
      };
      const unsubscribe = subscribe(send);
      // Herdr's TUI repaints only on state changes; the heartbeat keeps proxies
      // and browsers from reaping an otherwise silent connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": ping\n\n")); }
        catch { closed = true; }
      }, 15_000);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
