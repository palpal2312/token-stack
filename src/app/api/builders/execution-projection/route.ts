// Authenticated, local-origin-only read of the strict Builder execution
// projection (PX lane, SO0F). This is the ONLY Builder contract the Go
// control plane may consume; `/api/builders` and raw `builders.json` are
// forbidden as execution inputs because they carry secrets and fallbacks.
//
// Errors deliberately say nothing about the offending Builder: echoing raw
// input here could carry secret-bearing fields into logs/responses.

import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { listBuilders, RegistryCorrupt } from "@/lib/builders/registry";
import {
  EXECUTION_PROJECTION_REVISION,
  projectBuildersExecution,
} from "@/lib/builders/execution-projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const builders = await listBuilders();
    return NextResponse.json({
      projectionRevision: EXECUTION_PROJECTION_REVISION,
      builders: projectBuildersExecution(builders),
    });
  } catch (e) {
    if (e instanceof RegistryCorrupt) {
      return NextResponse.json({ error: "Builder registry unreadable.", corrupt: true }, { status: 409 });
    }
    return NextResponse.json({ error: "Execution projection unavailable." }, { status: 500 });
  }
}
