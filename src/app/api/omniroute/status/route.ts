import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/omniroute/status — is OmniRoute running locally?
// OmniRoute serves a dashboard on :20128 and an OpenAI-compatible API at /v1.
// We probe /v1/models (fast, unauthenticated list on most builds) and fall back
// to the dashboard root, so the section can show a live green/red state.

const BASE = "http://localhost:20128";

async function ping(path: string, ms = 1500): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(BASE + path, { signal: ctrl.signal, cache: "no-store" });
    return r.status;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  // Try the API first, then the dashboard.
  const api = await ping("/v1/models");
  const dash = api == null ? await ping("/") : 200;
  const running = api != null || dash != null;

  let models: number | null = null;
  if (api === 200) {
    try {
      const r = await fetch(BASE + "/v1/models", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      const arr = j?.data ?? j?.models ?? [];
      if (Array.isArray(arr)) models = arr.length;
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({
    running,
    base: BASE,
    api: `${BASE}/v1`,
    dashboard: BASE,
    apiStatus: api,
    models,
  });
}
