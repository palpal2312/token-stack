import { writeFile, mkdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { APPLAB_STATE, appBySlug, appRunning, pidFile, startApp } from "@/lib/appslab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const { slug } = body;
  const app = appBySlug(String(slug));
  if (!app) return NextResponse.json({ error: "unknown app" }, { status: 404 });
  if (appRunning(app.slug)) return NextResponse.json({ ok: true, already: true, port: app.port });

  await mkdir(APPLAB_STATE, { recursive: true });
  const pid = await startApp(app);
  await writeFile(pidFile(app.slug), String(pid));
  // give streamlit a moment to bind
  await new Promise((r) => setTimeout(r, 2500));
  return NextResponse.json({ ok: true, pid, port: app.port });
}
