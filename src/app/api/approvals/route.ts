import { NextResponse } from "next/server";
import { listRedactedApprovals, pendingCount } from "@/lib/approvals";
import { RegistryCorrupt } from "@/lib/builders/registry";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: the inbox. Pending first; expired/decided items follow so the UI
// can dim them instead of hiding what happened. Reading sweeps the 48h expiry.
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const approvals = await listRedactedApprovals();
    return NextResponse.json({ approvals, pending: await pendingCount() });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
