import { checkLocalRequest } from "@/lib/localOnly";
import { getBuilder } from "@/lib/builders/registry";
import type { Builder } from "@/lib/builders/registry";
import {
  runArena, appendRun, pruneOldWork, MAX_LANES, LANE_TIMEOUT_MS,
  type LaneEvent, type ArenaRun,
} from "@/lib/builders/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonLine(status: number, body: unknown) {
  return new Response(JSON.stringify(body) + "\n", {
    status, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

/**
 * Race 2–4 Builder profiles against one prompt.
 *
 * Guarded: this spawns several CLIs at once and can spend real money on several
 * accounts at the same time, so it must not be reachable from another origin.
 */
export async function POST(req: Request) {
  const bad = checkLocalRequest(req);
  if (bad) return jsonLine(bad.status, { t: "error", m: bad.error });

  const body = await req.json().catch(() => null) as { prompt?: string; builderIds?: string[] } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const ids = Array.isArray(body?.builderIds) ? body.builderIds.filter((x) => typeof x === "string") : [];

  if (!prompt.trim()) return jsonLine(400, { t: "error", m: "Enter a prompt to race." });
  if (prompt.length > 16_000) return jsonLine(413, { t: "error", m: "That prompt is too long (16k max)." });
  if (ids.length < 2) return jsonLine(400, { t: "error", m: "Pick at least two profiles — one profile is not a race." });
  if (ids.length > MAX_LANES) return jsonLine(400, { t: "error", m: `At most ${MAX_LANES} profiles at once.` });
  if (new Set(ids).size !== ids.length) return jsonLine(400, { t: "error", m: "The same profile was picked twice." });

  const builders: Builder[] = [];
  for (const id of ids) {
    const b = await getBuilder(id).catch(() => null);
    if (!b) return jsonLine(400, { t: "error", m: `No Builder profile "${id}".` });
    builders.push(b);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(o) + "\n")); }
        catch { closed = true; }
      };

      (async () => {
        send({ t: "start", runId, lanes: builders.map((b) => ({ id: b.id, cli: b.cli, name: b.name })) });

        // Sweeping here rather than on a timer keeps it visible: the run that
        // pays the cost is the run that reports what it removed.
        try {
          const pruned = await pruneOldWork();
          if (pruned.length) send({ t: "note", m: `Removed ${pruned.length} work folder(s) older than 14 days.` });
        } catch { /* never block a race on housekeeping */ }

        let lanes;
        try {
          lanes = await runArena({
            prompt, builders, runId,
            timeoutMs: LANE_TIMEOUT_MS,
            emit: (e: LaneEvent) => send(e),
          });
        } catch (e) {
          send({ t: "error", m: `The race failed to run: ${String((e as Error)?.message ?? e)}` });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        const record: ArenaRun = { runId, ts: new Date().toISOString(), prompt, lanes };
        try { await appendRun(record); }
        catch (e) { send({ t: "note", m: `The race finished but could not be saved to history: ${String((e as Error)?.message ?? e)}` }); }

        send({ t: "final", run: record });
        closed = true;
        try { controller.close(); } catch {}
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
