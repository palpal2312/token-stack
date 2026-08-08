import { NextResponse } from "next/server";
import { checkLocalRequest } from "@/lib/localOnly";
import { appBySlug, stopApp } from "@/lib/appslab";

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
  return NextResponse.json({ ok: stopApp(app.slug) });
}
