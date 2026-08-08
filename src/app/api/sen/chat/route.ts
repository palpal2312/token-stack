import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { shadowObserveResponse } from "@/lib/senShadowProxy";
import {
  GET as firstmateChatGet,
  POST as firstmateChatPost,
  PATCH as firstmateChatPatch,
  DELETE as firstmateChatDelete,
} from "../../firstmate/chat/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alias for firstmate chat; this route stays the authority. Shadow mode
// (phase 05) is OBSERVATION-ONLY here — there is deliberately no live replay
// against the Go control plane:
//
//   - POST /v1/sen/chat/turns is a live canonical COMMAND (command-id receipt
//     + replay, turns persisted atomically into sen_session_turns). Shadow
//     mode must never re-issue a mutation into Go: exactly one authority owns
//     side effects (red-team contract), and a shadow replay would append
//     canonical turns/receipts that diverge from everything the legacy path
//     wrote. ROLLBACK.md §4 keeps chat turns at "no Next.js caller yet" for
//     the same reason.
//   - GET/PATCH/DELETE have no replay-safe canonical counterpart either (the
//     canonical session read model intentionally does not mirror legacy
//     Node-store transcripts yet), so they are observed the same way.
//
// shadowObserveResponse only records the legacy response envelope/shape
// (comparison="observation-only", replayed=false) and never calls the Go
// listener. The response object is returned unchanged, so behavior stays
// byte-identical with shadow on or off.
//
// The guard runs here as well as in the delegated firstmate handlers (same
// options, same refusal bytes): this file exports the mutating handlers, so
// it carries the guard reference the origin-guard static sweep requires —
// and a refusal is observed like any other response this route returns.

function refuse(guard: NonNullable<ReturnType<typeof checkLocalRequest>>) {
  const res = NextResponse.json({ error: guard.error }, { status: guard.status });
  void shadowObserveResponse("sen/chat", res);
  return res;
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false, allowQueryToken: false });
  if (guard) return refuse(guard);
  const res = await firstmateChatGet(req);
  void shadowObserveResponse("sen/chat", res);
  return res;
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return refuse(guard);
  const res = await firstmateChatPost(req);
  void shadowObserveResponse("sen/chat", res);
  return res;
}

export async function PATCH(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return refuse(guard);
  const res = await firstmateChatPatch(req);
  void shadowObserveResponse("sen/chat", res);
  return res;
}

export async function DELETE(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return refuse(guard);
  const res = await firstmateChatDelete(req);
  void shadowObserveResponse("sen/chat", res);
  return res;
}
