import { NextResponse } from "next/server";
import { syncAgent } from "@/lib/hermesPhone";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let phoneNumberId: string | undefined;
  try { phoneNumberId = (await req.json())?.phoneNumberId; } catch { /* optional */ }
  try {
    const r = await syncAgent(phoneNumberId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
