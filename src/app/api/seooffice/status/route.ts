import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Is the local SEO Office dev server responding on :3000?
// SEO Office (github.com/AgriciDaniel/seo-os) runs from ~/seo-office via `pnpm dev`.
// AGPL-3.0 — cloned by each member from GitHub, never bundled in the member zip.
export async function GET() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch("http://127.0.0.1:3000/office", { signal: ctrl.signal, cache: "no-store", redirect: "follow" });
    clearTimeout(t);
    return NextResponse.json({ running: r.ok, status: r.status });
  } catch {
    clearTimeout(t);
    return NextResponse.json({ running: false });
  }
}
