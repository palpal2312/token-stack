import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { goApiFetch } from "@/lib/goApiProxy";
import {
  GoExecutionPreferenceError,
  readExecutionPreference,
  writeExecutionPreference,
} from "@/lib/agentRuntime/go-builder-exec-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATH = "/v1/sen/workspace/execution-preference";

function useDaemon(): boolean {
  return process.env.SEN_GO_EXECUTION_MODE === "1";
}

function workspaceId(): string {
  return process.env.SEN_WORKSPACE_ID ?? "default";
}

function presentDaemonPreference(pref: Awaited<ReturnType<typeof readExecutionPreference>>) {
  return {
    workspaceId: pref.workspace_id,
    requestedMode: pref.requested_mode,
    effectiveMode: pref.effective_mode,
    resolutionReason: pref.resolution_reason,
    updatedAt: pref.updated_at,
  };
}

// Proxy for the workspace execution preference (phase 12 step 11). Offline
// Go plane → available:false so the UI hides the selector.
export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  if (useDaemon()) {
    try {
      return NextResponse.json(
        { available: true, preference: presentDaemonPreference(await readExecutionPreference(workspaceId())) },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof GoExecutionPreferenceError && error.status === 409) {
        return NextResponse.json(
          { available: true, preference: null, requestedMode: error.requestedMode, reasonCodes: error.reasonCodes, error: error.message },
          { status: 409, headers: { "cache-control": "no-store" } },
        );
      }
      return NextResponse.json({ available: false, preference: null }, { headers: { "cache-control": "no-store" } });
    }
  }

  const result = await goApiFetch(PATH);
  if (!result.ok || !result.body || typeof result.body !== "object") {
    return NextResponse.json({ available: false, preference: null }, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(
    { available: true, preference: result.body },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (body.mode !== "host" && body.mode !== "agentenv") {
    return NextResponse.json({ error: "mode must be host or agentenv." }, { status: 400 });
  }
  if (useDaemon()) {
    try {
      return NextResponse.json({ available: true, preference: presentDaemonPreference(await writeExecutionPreference(body.mode, workspaceId())) });
    } catch (error) {
      if (error instanceof GoExecutionPreferenceError && error.status === 409) {
        return NextResponse.json(
          { error: error.message, requestedMode: error.requestedMode, reasonCodes: error.reasonCodes },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "daemon execution preference update failed" }, { status: 503 });
    }
  }

  const result = await goApiFetch(PATH, {
    method: "PUT",
    body: { mode: body.mode, updatedBy: "user", explanationRef: typeof body.explanationRef === "string" ? body.explanationRef : "" },
  });
  if (result.unreachable) {
    return NextResponse.json({ error: "canonical control plane is unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    const message = (result.body as { message?: string } | null)?.message ?? "preference update failed";
    return NextResponse.json({ error: message }, { status: result.status >= 500 ? 502 : 400 });
  }
  return NextResponse.json({ available: true, preference: result.body });
}
