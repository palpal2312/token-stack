import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkLocalRequest } from "@/lib/localOnly";
import { shadowObserveResponse } from "@/lib/senShadowProxy";
import { mapCanonicalChatReceipt } from "@/lib/sen/canonical-chat-adapter";
import { goApiAvailable, goApiFetch } from "@/lib/goApiProxy";
import {
  GET as firstmateChatGet,
  POST as firstmateChatPost,
  PATCH as firstmateChatPatch,
  DELETE as firstmateChatDelete,
} from "../../firstmate/chat/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 08b C4: the canonical Go chat is the default authority when the Go
// listener is configured. The legacy FirstMate writer stays ONLY behind the
// explicit rollback flag SEN_CHAT_LEGACY_WRITER=1 — never silently dual-write:
//
//   configured + flag off  -> canonical Go commands/queries (this file proxies)
//   configured + flag on   -> legacy FirstMate delegation (rollback window)
//   unconfigured + flag off -> 503 offline error (no writer at all)
//   unconfigured + flag on  -> legacy FirstMate delegation
//
// The proxy normalizes envelopes but cannot execute the Builder and is not a
// second writer: POST is a pure forward of SendTurn; the Go side owns
// persist-before-ack and command-id replay.

async function canonicalEnabled(): Promise<boolean> {
  if (process.env.SEN_CHAT_LEGACY_WRITER === "1") return false;
  return goApiAvailable();
}

function refuse(guard: NonNullable<ReturnType<typeof checkLocalRequest>>) {
  const res = NextResponse.json({ error: guard.error }, { status: guard.status });
  void shadowObserveResponse("sen/chat", res);
  return res;
}

function offline() {
  return NextResponse.json(
    { error: "canonical chat is not configured and the legacy writer is disabled (SEN_CHAT_LEGACY_WRITER)" },
    { status: 503 },
  );
}

// SEN_DAEMON_URL flips POST/GET to the sen-plane daemon /api/v1/sen/chat
// (fixed contract: {session_id, sender, text} -> {command_id, turn_seq,
// session_id, created_at}). When unset every code path below runs exactly as
// before — the daemon is opt-in, legacy/canonical behavior is unchanged.
function senDaemonURL(): string | null {
  const v = process.env.SEN_DAEMON_URL?.trim();
  return v || null;
}

async function daemonChatGet(base: string, req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = new URL(`/api/v1/sen/chat?${url.searchParams.toString()}`, base);
  try {
    const res = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => null);
    if (body !== null && typeof body === "object") {
      return NextResponse.json({ ...body, canonical: true }, { status: res.status });
    }
    return NextResponse.json({ error: "sen daemon returned invalid JSON" }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "sen daemon unreachable" }, { status: 503 });
  }
}

async function daemonChatPost(base: string, req: Request): Promise<NextResponse> {
  let body: { sessionId?: unknown; content?: unknown; prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const text = (typeof body.content === "string" ? body.content : typeof body.prompt === "string" ? body.prompt : "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  try {
    const res = await fetch(new URL("/api/v1/sen/chat", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, sender: "user", text }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await res.json().catch(() => null);
    // S15 P1: canonical receipt is snake_case; expose the consumer shape.
    const canonical =
      result && typeof result.command_id === "string"
        ? mapCanonicalChatReceipt(result)
        : result;
    return NextResponse.json(canonical, { status: res.status });
  } catch {
    return NextResponse.json({ error: "sen daemon unreachable" }, { status: 503 });
  }
}

// GET: session list, or one session's thread with ?session=. Canonical mode
// answers from the Go read models and stamps canonical:true so the UI picks
// the canonical interaction path.
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return refuse(guard);
  const daemon = senDaemonURL();
  if (daemon) return await daemonChatGet(daemon, req);
  if (!(await canonicalEnabled())) {
    if (process.env.SEN_CHAT_LEGACY_WRITER === "1") {
      const res = await firstmateChatGet(req);
      void shadowObserveResponse("sen/chat", res);
      return res;
    }
    return offline();
  }
  const url = new URL(req.url);
  const session = url.searchParams.get("session");
  if (!session) {
    const result = await goApiFetch("/v1/sen/chat/sessions");
    if (!result.ok) {
      return NextResponse.json({ error: "canonical chat sessions unavailable" }, { status: 503 });
    }
    const body = result.body as { sessions?: { sessionId: string; title: string; createdAt: string; updatedAt: string; selectedBuilderPolicy: string }[] | null };
    const sessions = (body.sessions ?? []).map((s) => ({
      id: s.sessionId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      builder: s.selectedBuilderPolicy || undefined,
    }));
    return NextResponse.json({ sessions, canonical: true });
  }
  const result = await goApiFetch(`/v1/sen/chat/sessions/${encodeURIComponent(session)}/thread`);
  if (result.status === 404) {
    return NextResponse.json({ turns: [], canonical: true });
  }
  if (!result.ok) {
    return NextResponse.json({ error: "canonical chat thread unavailable" }, { status: 503 });
  }
  const body = result.body as {
    turns?: { role: string; content: string; recordedAt: string; chatAttemptId: string }[] | null;
  };
  const turns = (body.turns ?? []).map((t) => ({
    role: t.role === "assistant" ? "assistant" : "user",
    text: t.content,
    ts: t.recordedAt,
  }));
  return NextResponse.json({ turns, canonical: true });
}

// POST: canonical SendTurn. The proxy forwards the client's command id (or
// mints one) as the receipt key; the ack carries the canonical ids.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return refuse(guard);
  const daemon = senDaemonURL();
  if (daemon) return await daemonChatPost(daemon, req);
  if (!(await canonicalEnabled())) {
    if (process.env.SEN_CHAT_LEGACY_WRITER === "1") {
      const res = await firstmateChatPost(req);
      void shadowObserveResponse("sen/chat", res);
      return res;
    }
    return offline();
  }
  let body: { sessionId?: string; content?: string; prompt?: string; builderPolicy?: string; builderId?: string; workspaceId?: string; commandId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const content = (body.content ?? body.prompt ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  // The client owns the session id (chat-client mints s-<uuid> for a new
  // chat): a proxy-minted id would break command-id replay, since the replay
  // check compares the receipt's session against the request's.
  const sessionId = (body.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  const commandId = body.commandId ?? randomUUID();
  const result = await goApiFetch("/v1/sen/chat/send", {
    method: "POST",
    commandId,
    body: {
      sessionId,
      workspaceId: body.workspaceId ?? "",
      content,
      builderPolicy: body.builderPolicy ?? body.builderId ?? "",
    },
  });
  if (!result.ok) {
    const errBody = result.body as { message?: string } | null;
    return NextResponse.json(
      { error: errBody?.message ?? "canonical chat send failed" },
      { status: result.status === 400 ? 400 : 503 },
    );
  }
  return NextResponse.json(result.body, { status: 201 });
}

// PATCH/DELETE mutate legacy session metadata (builder/model binding,
// deletion) — they have no canonical counterpart yet, so they run only in the
// rollback window. With the flag off they fail closed instead of dual-writing.
export async function PATCH(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return refuse(guard);
  if (process.env.SEN_CHAT_LEGACY_WRITER !== "1") {
    return NextResponse.json({ error: "session metadata writes are legacy-only and disabled (SEN_CHAT_LEGACY_WRITER)" }, { status: 501 });
  }
  const res = await firstmateChatPatch(req);
  void shadowObserveResponse("sen/chat", res);
  return res;
}

export async function DELETE(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return refuse(guard);
  if (process.env.SEN_CHAT_LEGACY_WRITER !== "1") {
    return NextResponse.json({ error: "session deletion is legacy-only and disabled (SEN_CHAT_LEGACY_WRITER)" }, { status: 501 });
  }
  const res = await firstmateChatDelete(req);
  void shadowObserveResponse("sen/chat", res);
  return res;
}
