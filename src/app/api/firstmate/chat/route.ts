// Chat with Sen, streamed as NDJSON — the chatbot half of the /sen page
// (/firstmate and /api/firstmate stay as legacy compatibility aliases).
//
// This is the same act as /api/builders/[id]/chat with two fixed choices:
// the working directory is always the upstream firstmate home, so the CLI reads
// the distro's AGENTS.md and *is* Sen; and conversations are sessions
// (see lib/sen-sessions.ts; storage keys remain firstmate for compatibility) — one transcript per entry in the page's
// left panel.
//
//   GET                       → { sessions: SessionMeta[] }
//   GET ?session=<id>         → { session, turns }
//   POST {prompt, builderId?, session?} → NDJSON stream; without a session id
//                               a new one is created and announced first as
//                               {t:"session", id} so the client can adopt it
//   DELETE ?session=<id>      → forget that session

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import { getBuilder, listBuilders } from "@/lib/builders/registry";
import { cliSpec } from "@/lib/builders/clis";
import { runBuilderChat, type ChatEvent } from "@/lib/builders/chat";
import { readHistory, appendTurn, packPrompt } from "@/lib/builders/history";
import {
  createSession, getSession, listSessions, removeSession, sessionAgentId, sessionValid, touchSession,
} from "@/lib/sen-sessions";
import { readAukerConfig, readBuilderQuotaHistory, recordQuotaReading } from "@/lib/sen-config";
import { burnPerTurn, parseEarliestReset } from "@/lib/quota-parse";
import { fmHome } from "@/lib/sen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT = 16_000;
// An auth/config refusal is not something the mate said — saving it would
// pollute every later prompt and keep the UI's login banner stuck on.
const AUTH_WALL = /not logged in|no model configured|please run \/login|use \/login to sign in/i;
// Cold turns only: the bootstrap digest is an interactive-session ritual the
// dashboard chat does not need. Resumed turns skip this — the CLI session
// already carries it. (AGENTS.md itself is never edited: it is upstream.)
const CHAT_PREFACE = "[Quick chat turn from the Agent OS dashboard, not an interactive session. "
  + "Skip the session-start bootstrap and digest — that context is unchanged. Answer the message directly.]\n\n";

// Takeover preface: a worker of a DIFFERENT cli cannot resume the previous
// worker's session, so instead of a raw transcript dump it receives a
// structured handoff and is told to read it before acting. Deterministic and
// free — the old worker may be quota-dead and unable to summarize for itself.
const TAKEOVER_PREFACE = (fromName: string, fromCli: string) =>
  `[Bạn đang tiếp quản cuộc hội thoại này từ worker khác: ${fromName} (${fromCli}). `
  + "Đọc kỹ HANDOFF bên dưới TRƯỚC KHI trả lờờii. Mở đầu bằng ĐÚNG 1 câu xác nhận phần việc bạn sẽ làm tiếp, "
  + "rồi thực hiện yêu cầu của user.]\n\n";

/** Structured handoff for a cross-cli takeover — sections beat a raw dump:
 * shorter, on-focus, and auditable. Capped ~6000 chars. */
function packHandoff(history: { role: "user" | "assistant"; text: string; builder?: string; model?: string }[], prompt: string): string {
  const MAX_TOTAL = 6000, MAX_TURNS = 10, MAX_TURN = 600;
  const firstUser = history.find((t) => t.role === "user")?.text ?? "";
  const recent = history.slice(-MAX_TURNS);
  const lines = recent.map((t) => {
    const who = t.role === "user" ? "User" : `Assistant${t.builder ? ` (${t.builder}${t.model ? `/${t.model}` : ""})` : ""}`;
    const text = t.text.length > MAX_TURN ? `${t.text.slice(0, MAX_TURN)}…` : t.text;
    return `- ${who}: ${text}`;
  });
  const workers = [...new Set(history.filter((t) => t.role === "assistant" && t.builder).map((t) => `${t.builder}${t.model ? `/${t.model}` : ""}`))];
  const lastAssistant = [...history].reverse().find((t) => t.role === "assistant")?.text ?? "Chưa có câu trả lời từ assistant.";
  let body = `## Mục tiêu\n${firstUser.length > 300 ? `${firstUser.slice(0, 300)}…` : firstUser}\n\n## Diễn biến gần nhất\n${lines.join("\n")}\n\n## Worker đã dùng\n${workers.length ? workers.map((worker) => `- ${worker}`).join("\n") : "- Chưa có"}\n\n## Tình trạng cuối\n${lastAssistant.length > MAX_TURN ? `${lastAssistant.slice(0, MAX_TURN)}…` : lastAssistant}`;
  if (body.length > MAX_TOTAL) body = `${body.slice(0, MAX_TOTAL)}…\n(handoff bị cắt bớt vì quá dài)`;
  return `# HANDOFF\n${body}\n\nUser: ${prompt}`;
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const session = new URL(req.url).searchParams.get("session");
    if (session) {
      if (!sessionValid(session)) return NextResponse.json({ error: "Bad session id." }, { status: 400 });
      const meta = await getSession(session);
      return NextResponse.json({
        session,
        turns: await readHistory(sessionAgentId(session)),
        builder: meta?.builder ?? null,
        model: meta?.model ?? null,
      });
    }
    return NextResponse.json({ sessions: await listSessions() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Type something to send." }, { status: 400 });
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `That prompt is ${prompt.length} characters; the limit is ${MAX_PROMPT}.` },
      { status: 413 },
    );
  }

  let builder = body.builderId ? await getBuilder(String(body.builderId)) : null;
  if (!builder && !body.builderId) {
    // No profile asked for: fall back to the first one that exists (profiles
    // are the user's to create and delete; a hardcoded name may be gone).
    builder = (await listBuilders())[0] ?? null;
  }
  if (!builder) {
    if (body.builderId) {
      // The id names a profile that is gone (deleted) — distinct from "never
      // existed", because a session can outlive its worker and the UI should
      // offer a rebind instead of a bare failure.
      return NextResponse.json(
        { error: `Worker "${String(body.builderId)}" của session này đã bị xóa.`, code: "builder-gone" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "No Builder profiles exist yet — create one in CLI Config." },
      { status: 404 },
    );
  }

  // Pasted images: at most 3, ~4MB of base64 each — bigger gets a clear refusal.
  const MAX_IMAGES = 3, MAX_IMAGE_B64 = 4 * 1024 * 1024;
  const images: { data: string; mimeType: string }[] = [];
  if (Array.isArray(body.images)) {
    if (body.images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `At most ${MAX_IMAGES} images per message.` }, { status: 413 });
    }
    for (const img of body.images as { data?: unknown; mimeType?: unknown }[]) {
      const data = typeof img?.data === "string" ? img.data : "";
      const mimeType = typeof img?.mimeType === "string" && /^image\/(png|jpe?g|gif|webp)$/.test(img.mimeType) ? img.mimeType : "";
      if (!data || !mimeType) {
        return NextResponse.json(
          { error: "One pasted image has no data or an unsupported type (png/jpg/gif/webp only)." },
          { status: 400 },
        );
      }
      if (data.length > MAX_IMAGE_B64) {
        return NextResponse.json({ error: `One image is over 3MB of base64 — resize it and paste again.` }, { status: 413 });
      }
      images.push({ data, mimeType });
    }
  }

  const requested = body.session ? String(body.session) : null;
  if (requested && !sessionValid(requested)) {
    return NextResponse.json({ error: "Bad session id." }, { status: 400 });
  }

  // Images make sense on lanes that accept image input blocks: the kimi ACP
  // lane (image content blocks) and the codex appserver lane (image url
  // blocks). The duplex (claude) and headless lanes have none — refuse clearly
  // BEFORE the stream opens: a 400 inside ReadableStream.start would hang the client.
  const spec = cliSpec(builder!.cli);
  const laneProtocol = spec?.laneProtocol ?? "acp";
  const laneTakesImages = Boolean(spec?.acpArgv)
    && (laneProtocol === "acp" || laneProtocol === "codex-appserver" || laneProtocol === "claude-duplex")
    && String(builder!.env?.AGENTIC_OS_ACP ?? "") !== "0";
  if (images.length > 0 && !laneTakesImages) {
    return NextResponse.json(
      { error: "Worker này đang đi lane không nhận ảnh (chỉ kimi/codex/claude lane mới nhận). Switch worker để gửi ảnh." },
      { status: 400 },
    );
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const dbg = process.env.AGENTIC_OS_ACP_DEBUG === "1"
        ? (o: unknown) => console.error("[firstmate-chat send]", JSON.stringify(o).slice(0, 120))
        : () => {};
      const send = (o: unknown) => {
        if (!open) return;
        dbg(o);
        try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); }
        catch { open = false; }
      };

      // Adopt the requested session, or open a fresh one titled by this prompt.
      const meta = requested ? await getSession(requested) : await createSession(prompt, builder!.id);
      const sid = requested ?? meta!.id;
      send({ t: "session", id: sid });

      const agentId = sessionAgentId(sid);
      // Model precedence: this turn's explicit choice → the session's stored
      // choice → the profile's → the CLI default.
      const model = (typeof body.model === "string" && body.model.trim())
        ? body.model.trim()
        : meta?.model ?? builder!.model;
      const effort = builder!.effort;

      // Cross-cli takeover: the client marked this turn (first send after a
      // "Tiếp quản" switch) — the new worker gets the structured handoff
      // instead of the raw packed transcript. Names ride from the client
      // because the session was already rebound to the new worker at switch
      // time (local-only route, origin-guarded).
      const handoffBody = (body.handoff && typeof body.handoff === "object")
        ? body.handoff as { fromName?: unknown; fromCli?: unknown }
        : null;
      const takeover = handoffBody && typeof handoffBody.fromName === "string" && typeof handoffBody.fromCli === "string"
        ? { fromName: handoffBody.fromName, fromCli: handoffBody.fromCli }
        : null;
      if (takeover) {
        send({ t: "note", c: `${builder!.name} tiếp quản từ ${takeover.fromName} — handoff có cấu trúc đã chuyển (không gửi lại raw transcript).` });
      }

      const emit = (e: ChatEvent) => send(e);

      // One full turn attempt against one builder: lane → resume → fresh, in
      // that order. Extracted so an auto-takeover can re-run the same turn on
      // the fallback worker without duplicating the three paths.
      const executeTurn = async (
        b: NonNullable<typeof builder>,
        tk: { fromName: string; fromCli: string } | null,
        turnImages: typeof images,
      ) => {
        const bSpec = cliSpec(b.cli);
        // A takeover turn ignores the session's stored model — it almost
        // certainly names a model the new cli does not have.
        const bModel = tk ? b.model : model;
        const bEffort = b.effort;
        // The ACP lane: one warm process with token streaming, instead of a
        // cold CLI boot per turn. Opt-out per builder with env AGENTIC_OS_ACP=0.
        const bAcp = Boolean(bSpec?.acpArgv) && String(b.env?.AGENTIC_OS_ACP ?? "") !== "0";
        let res = null;
        if (bAcp) {
          const { acpChat } = await import("@/lib/builders/acp");
          const history = await readHistory(agentId);
          const freshPrompt = tk
            ? TAKEOVER_PREFACE(tk.fromName, tk.fromCli) + packHandoff(history, prompt)
            : CHAT_PREFACE + packPrompt(history, prompt).text;
          res = await acpChat({
            builder: b,
            key: sid,
            prompt,
            freshPrompt,
            model: bModel,
            effort: bEffort,
            images: turnImages,
            // A stored CLI session from before a restart — the lane continues it
            // instead of cold-starting and re-packing the transcript.
            resumeSessionId: meta?.resume && meta.resume.builderId === b.id && meta.resume.cli === b.cli
              ? meta.resume.sessionId
              : null,
            cwd: fmHome(),
            signal: req.signal,
            emit,
          });
          // A startup failure (binary gone, handshake refused) falls back to
          // the headless lane; a mid-turn failure is reported as-is.
          if (res.error && !res.text && !req.signal.aborted) {
            send({ t: "note", c: "The ACP lane failed to start — falling back to the headless lane for this turn." });
            res = null;
          }
        }

        // The fast path: the CLI already holds this conversation. Resume it —
        // no packed history, no repeated bootstrap. Only when the stored
        // resume id belongs to THIS builder and the CLI has a resume argv.
        const resume = meta?.resume;
        const canResume = !res && Boolean(
          resume && resume.builderId === b.id && resume.cli === b.cli && bSpec?.resumeArgs,
        );
        if (canResume && resume) {
          send({ t: "note", c: "Continuing the previous CLI session — context carried by the worker, not re-sent." });
          res = await runBuilderChat({
            builder: b,
            prompt,
            argsOverride: bSpec!.resumeArgs!(resume.sessionId, prompt, { model: bModel, effort: bEffort }),
            cwd: fmHome(), // upstream firstmate home — AGENTS.md turns the CLI into Sen
            signal: req.signal,
            emit,
          });
          if (res.error && !res.timedOut && !req.signal.aborted) {
            send({ t: "note", c: "The previous CLI session could not be resumed — starting fresh with the transcript re-sent." });
            res = null;
          }
        }
        if (!res) {
          const history = await readHistory(agentId);
          const freshPrompt = tk
            ? TAKEOVER_PREFACE(tk.fromName, tk.fromCli) + packHandoff(history, prompt)
            : CHAT_PREFACE + (() => {
                const packed = packPrompt(history, prompt);
                if (packed.dropped) {
                  send({ t: "note", c: `Carrying the last ${history.length - packed.dropped} turns; ${packed.dropped} older ones did not fit.` });
                }
                return packed.text;
              })();
          res = await runBuilderChat({
            builder: b,
            prompt: freshPrompt,
            // The session's model choice must reach the cold path too — without
            // an override the spawn silently uses the profile's model.
            argsOverride: bSpec?.execArgs(freshPrompt, { model: bModel, effort: bEffort }),
            cwd: fmHome(),
            signal: req.signal,
            emit,
          });
        }
        return res;
      };

      let active = builder!;

      // Proactive handoff — the user's rule: never ride a worker into the
      // quota wall. At/below the trigger threshold, or projected to cross it
      // next turn at the measured burn rate (% quota lost per turn — which
      // absorbs context growth on its own), the fallback takes over NOW,
      // before this turn ever touches the dying worker. Readings come from
      // the post-turn probes; without readings the feature stays silent.
      let proactive: { fromName: string; fromCli: string } | null = null;
      if (!takeover) {
        const fmCfg = await readAukerConfig();
        const fbId = fmCfg.fallbackBuilders.find((id) => id !== active.id) ?? null;
        if (fbId) {
          const hist = await readBuilderQuotaHistory(active.id);
          const last = hist.at(-1);
          if (last) {
            const burn = burnPerTurn(hist);
            const crossing = last.pct <= fmCfg.handoffTriggerPct;
            const projected = !crossing && burn > 0 && last.pct <= fmCfg.handoffWatchPct
              && (last.pct - burn) <= fmCfg.handoffTriggerPct;
            if (crossing || projected) {
              const fallback = await getBuilder(fbId);
              if (fallback) {
                proactive = { fromName: active.name, fromCli: active.cli };
                send({ t: "note", c: crossing
                  ? `${active.name} chỉ còn ~${last.pct}% quota — ${fallback.name} tiếp quản SỚM, trước khi chạm tường.`
                  : `${active.name} còn ~${last.pct}% và đang hao ~${burn.toFixed(1)}%/lượt — sẽ chạm ngưỡng ${fmCfg.handoffTriggerPct}% lượt này, ${fallback.name} tiếp quản sớm.` });
                active = fallback;
              }
            }
          }
        }
      }

      let result = await executeTurn(active, takeover ?? proactive, images);

      // Quota-death = the automatic takeover trigger: the turn died on a
      // quota-class error and a fallback chain is configured. The chain is
      // walked in order; each hop carries the handoff. When EVERY link is
      // dead, report the earliest quota reset and offer to schedule a wake.
      const QUOTA_DEATH = /quota|rate.?limit|429|insufficient|credit|exceeded/i;
      const tried = new Set([builder!.id]);
      while (result.error && !result.text?.trim() && !req.signal.aborted && QUOTA_DEATH.test(result.error)) {
        const { fallbackBuilders } = await readAukerConfig();
        const nextId = fallbackBuilders.find((id) => id !== active.id && !tried.has(id));
        if (!nextId) break;
        tried.add(nextId);
        const fallback = await getBuilder(nextId);
        if (!fallback) continue;
        send({ t: "note", c: `${active.name} hết quota — ${fallback.name} tự động tiếp quản (handoff có cấu trúc).` });
        let fbImages = images;
        const fbSpec = cliSpec(fallback.cli);
        const fbLane = fbSpec?.laneProtocol ?? "acp";
        const fbTakesImages = Boolean(fbSpec?.acpArgv)
          && (fbLane === "acp" || fbLane === "codex-appserver" || fbLane === "claude-duplex")
          && String(fallback.env?.AGENTIC_OS_ACP ?? "") !== "0";
        if (images.length && !fbTakesImages) {
          send({ t: "note", c: "Ảnh đính kèm bị bỏ qua — worker dự phòng không nhận ảnh." });
          fbImages = [];
        }
        active = fallback;
        result = await executeTurn(fallback, { fromName: builder!.name, fromCli: builder!.cli }, fbImages);
      }

      // The whole chain is dead — say when the earliest quota comes back
      // (parsed from each worker's latest probe text) and offer a wake-up.
      if (result.error && !result.text?.trim() && !req.signal.aborted && QUOTA_DEATH.test(result.error)) {
        const fmCfg = await readAukerConfig();
        const ids = [...new Set([builder!.id, ...fmCfg.fallbackBuilders])];
        let best: { at: Date; window: string; name: string } | null = null;
        for (const id of ids) {
          const b = await getBuilder(id);
          const checkedAt = Date.parse(b?.quota?.checkedAt ?? "");
          const r = b?.quota?.text
            ? parseEarliestReset(b.quota.text, Number.isFinite(checkedAt) ? checkedAt : Date.now())
            : null;
          if (r && (!best || r.at < best.at)) best = { ...r, name: b!.name };
        }
        if (best) {
          const mins = Math.max(1, Math.round((best.at.getTime() - Date.now()) / 60_000));
          send({ t: "note", c: `Cả chuỗi dự phòng đều hết quota. Quota hồi sớm nhất: ${best.name} (${best.window}) lúc ${best.at.toLocaleTimeString("vi-VN")} — sau ~${mins} phút.` });
          send({ t: "reset-offer", at: best.at.toISOString(), worker: best.name });
        } else {
          send({ t: "note", c: "Cả chuỗi dự phòng đều hết quota, và không đọc được thờờii điểm hồi từ probe gần nhất — thử lại sau thủ công." });
        }
      }

      // The transcript records the user's own words, not the packed prompt.
      try {
        await appendTurn(agentId, { role: "user", text: prompt, ts: new Date().toISOString() });
        // A partial answer is not an answer: aborts, timeouts, and provider
        // rejections leave text that reads complete but is not.
        if (result.text.trim() && !result.error && !AUTH_WALL.test(result.text)) {
          await appendTurn(agentId, {
            role: "assistant", text: result.text, ts: new Date().toISOString(),
            builder: active.id, ...(result.actualModel ? { model: result.actualModel } : {}),
          });
        }
        await touchSession(sid, {
          title: prompt,
          builder: active.id,
          resume: result.sessionId ? { builderId: active.id, cli: active.cli, sessionId: result.sessionId } : null,
          // An explicit choice this turn becomes the session's model.
          ...(typeof body.model === "string" && body.model.trim() ? { model: body.model.trim() } : {}),
        });
      } catch (e) {
        send({ t: "note", c: `The answer arrived but could not be saved: ${String((e as Error)?.message ?? e)}` });
      }

      send({ t: "final", ok: !result.error, error: result.error, ms: result.durationMs, builder: active.id, model: result.actualModel ?? null, ttfb: result.ttfbMs ?? null, effort: active.effort ?? null, usage: result.usage ?? null });

      // Fresh usage after the turn, after the final event — a probe that never
      // delays the answer. Failures stay silent: the last-known figure stands.
      if (!result.error) {
        try {
          const { probeBuilder } = await import("@/lib/builders/health");
          const { setBuilderVerified, setBuilderQuota, getBuilder: gb } = await import("@/lib/builders/registry");
          const h = await probeBuilder(active);
          const detail = h.connectionDetail ?? h.message;
          // Only strengthen, never strip: a transient probe failure after a
          // successful turn must not remove the worker's green tick.
          if (h.state === "ok") await setBuilderVerified(active.id, { at: new Date().toISOString(), detail });
          if (h.quota) await setBuilderQuota(active.id, h.quota);
          const fresh = await gb(active.id);
          if (fresh?.quota) {
            send({ t: "quota", text: fresh.quota.text, checkedAt: fresh.quota.checkedAt });
            // Feed the proactive-handoff trigger: one parsed reading per turn.
            await recordQuotaReading(active.id, fresh.quota.text, active.cli);
          }
        } catch { /* the figure just stays last-known */ }
      }
      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
    },
  });
}

/** Assign what a session runs next: the worker (builderId) and/or the model.
 * Returns the last-known usage so the UI can report it immediately. */
export async function PATCH(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const session = String(body.session ?? "");
  if (!sessionValid(session)) return NextResponse.json({ error: "Bad session id." }, { status: 400 });
  const meta = await getSession(session);
  if (!meta) return NextResponse.json({ error: `No session "${session}".` }, { status: 404 });

  const builderId = body.builderId ? String(body.builderId) : (meta.builder ?? "");
  const builder = builderId ? await getBuilder(builderId) : null;
  if (body.builderId && !builder) return NextResponse.json({ error: `No Builder profile "${builderId}".` }, { status: 404 });

  const touch: Parameters<typeof touchSession>[1] = {};
  if (body.builderId) touch.builder = String(body.builderId);
  let model: string | null | undefined;
  if (body.model !== undefined) {
    model = String(body.model ?? "").trim() || null;
    touch.model = model;
  }
  await touchSession(session, touch);

  // The immediate report: what runs now, and the last-known usage on record.
  // No live RPC here — the PATCH path must answer in milliseconds (the model
  // dropdown does its own live fetch on open).
  const modelInUse = model ?? meta.model ?? builder?.model ?? "CLI default";
  return NextResponse.json({
    ok: true,
    model: modelInUse,
    usage: builder?.quota ?? null,
    verifiedAt: builder?.verifiedAt ?? null,
    verifiedDetail: builder?.verifiedDetail ?? null,
  });
}

/** Forget one session: transcript, scratch dir, index row. */
export async function DELETE(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const session = new URL(req.url).searchParams.get("session");
  if (!session || !sessionValid(session)) {
    return NextResponse.json({ error: "Which session? (?session=<id>)" }, { status: 400 });
  }
  await removeSession(session);
  return NextResponse.json({ ok: true });
}
