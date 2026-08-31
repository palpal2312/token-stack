// One thread's transcript: the messages of its newest run, minus the system
// line (the persona is the agent's own standing instruction, not
// conversation content). This is what the Agent tab renders when a session
// is reopened.

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

// Same alphabet as run ids — a thread id is only ever matched against state
// files, but a request has no business asking for anything outside it.
const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await ctx.params;
  if (!THREAD_ID.test(id)) {
    return NextResponse.json({ error: `"${id}" is not a thread id.` }, { status: 400 });
  }

  try {
    const store = new FileStateStore(path.join(home(), "runtime", "runs"));
    const state = await store.latestInThread(id);
    if (!state) return NextResponse.json({ error: `No thread "${id}" in this store.` }, { status: 404 });
    const messages = state.messages.filter((m) => m.role !== "system");
    return NextResponse.json(
      {
        threadId: id,
        agentName: state.agentName,
        messages,
        turns: messages,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
