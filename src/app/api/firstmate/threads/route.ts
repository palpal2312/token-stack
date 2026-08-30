// The Agent tab's sessions list: every thread in the runs store, newest
// activity first. Derived from the state files themselves — no new schema,
// the store stays single-writer, and a thread from before this endpoint
// existed lists exactly like a new one.

import { checkLocalRequest } from "@/lib/localOnly";
import { NextResponse } from "next/server";
import path from "node:path";
import { AGENTIC_HOME } from "@/lib/builders/registry";
import { FileStateStore } from "@/lib/agentRuntime/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy home, same reason as lib/approvals.ts: QA redirects AGENTIC_OS_HOME
// after import time.
function home(): string { return process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME; }

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const store = new FileStateStore(path.join(home(), "runtime", "runs"));
    const threads = await store.listThreads();
    // sessions is a compatibility alias of threads for Go shadow field-level comparison.
    return NextResponse.json({ threads, sessions: threads }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
