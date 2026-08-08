import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { decideAndExecute } from "@/lib/automations";
import { toApprovalInboxRow } from "@/lib/approvals";
import { RegistryCorrupt } from "@/lib/builders/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guarded: this is the button that lets a parked tool call execute.
//
// Semantics (see lib/approvals.ts): first-decider-wins, and the item is marked
// decided BEFORE the run resumes — a lost race gets 409 and executes nothing,
// an approved ask runs the parked call exactly once.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
  if (!decision) return NextResponse.json({ error: `decision must be "approve" or "reject".` }, { status: 400 });

  try {
    const result = await decideAndExecute(id, decision);
    // The stored item carries raw tool args; only the redacted, hash-bound row
    // may cross the HTTP boundary (Phase 20 approval-read redaction).
    const item = toApprovalInboxRow(result.item);
    if (!result.executed && !result.executeError) {
      // Lost the race (already decided, or expired) — say so, change nothing.
      return NextResponse.json(
        { error: `This ask is already ${result.item.status}.`, item },
        { status: 409 },
      );
    }
    return NextResponse.json({ ...result, item });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    const msg = String(e instanceof Error ? e.message : e);
    return NextResponse.json({ error: msg }, { status: msg.startsWith("No approval") ? 404 : 500 });
  }
}
