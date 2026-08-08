import { checkLocalRequest } from "@/lib/localOnly";
import { getEvents } from "@/lib/agent-kanban/store";
import { subscribeKanbanEvents } from "@/lib/agent-kanban/event-bus";
import { ensureKanbanCommandMonitor, notifyKanbanActivityChanged } from "@/lib/agent-kanban/command-reader";
import { fetchCanonicalEvents } from "@/lib/agent-kanban/canonical-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return Response.json({ error: guard.error }, { status: guard.status });
  const since = Math.max(0, Number(new URL(req.url).searchParams.get("since")) || 0);

  // Canonical-first: when the Go control plane serves the replay, the stream
  // tails the canonical event spine by polling and never starts the legacy
  // command monitor. Otherwise the legacy event bus path serves unchanged.
  const canonicalReplay = await fetchCanonicalEvents(since, { limit: 500 });
  const canonical = canonicalReplay !== null;
  if (!canonical) await ensureKanbanCommandMonitor();

  const encoder = new TextEncoder();
  let cleanupStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cleaned = false;
      const send = (event: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { closed = true; }
      };
      // Flush the response immediately even when there is no replay event.
      // Otherwise some clients wait for the 15-second heartbeat before they
      // consider the SSE connection open.
      controller.enqueue(encoder.encode(": connected\n\n"));

      let unsubscribe = () => {};
      let poll: ReturnType<typeof setInterval> | null = null;
      if (canonical) {
        let cursor = since;
        for (const event of canonicalReplay) {
          send(event);
          if (event.seq > cursor) cursor = event.seq;
        }
        // Poll the canonical spine for new activity. A transient Go outage
        // skips a tick (fetchCanonicalEvents returns null); the cursor only
        // advances on delivered events, so nothing is lost across a gap. The
        // in-flight guard prevents overlapping polls from double-sending.
        let polling = false;
        poll = setInterval(() => {
          if (polling) return;
          polling = true;
          void fetchCanonicalEvents(cursor, { limit: 1000 }).then((events) => {
            if (!events) return;
            for (const event of events) {
              if (event.seq <= cursor) continue;
              send(event);
              cursor = event.seq;
            }
          }).catch(() => { /* polling is best-effort; the next tick retries */ })
            .finally(() => { polling = false; });
        }, 2_000);
        poll.unref?.();
      } else {
        for (const event of await getEvents(since, { limit: 500 })) send(event);
        unsubscribe = subscribeKanbanEvents(send);
        notifyKanbanActivityChanged();
      }

      const heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(": ping\n\n")); }
          catch { closed = true; }
        }
      }, 15_000);
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        closed = true;
        clearInterval(heartbeat);
        if (poll) clearInterval(poll);
        unsubscribe();
        if (!canonical) notifyKanbanActivityChanged();
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already closed */ }
      };
      cleanupStream = cleanup;
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanupStream();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-kanban-source": canonical ? "canonical" : "legacy-fallback",
    },
  });
}
