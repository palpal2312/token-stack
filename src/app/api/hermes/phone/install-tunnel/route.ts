import { NextResponse } from "next/server";
import { installCloudflared, installerRunning } from "@/lib/hermesPhone";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  return NextResponse.json({ ...installCloudflared(), installing: installerRunning() });
}
