import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { readSandboxWorkers } from "@/lib/agentRuntime/go-builder-exec-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  // Resolve the flag at request time, matching the snapshot route's
  // per-request resolution. Module-load capture made the ON half of the
  // runtime-boundary spec stay flag-OFF under shared loaders.
  const enabled = process.env.SEN_GO_SANDBOX_WORKERS === "1";
  if (!enabled) return NextResponse.json({ available: false, workers: [] }, { headers: { "cache-control": "no-store" } });
  try {
    return NextResponse.json(
      { available: true, ...(await readSandboxWorkers()) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { available: false, workers: [], error: error instanceof Error ? error.message : String(error) },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
