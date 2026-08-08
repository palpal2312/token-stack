import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hermes/realtime/open  { target }  → { ok }
// Opens a website (https URL) or a macOS app by name. Executes ONLY the macOS
// `open` command with a validated argument (no shell → no injection). Used by the
// Realtime butler's function-calling so it can actually act, not just talk.
// Run macOS `open` with validated args; resolves true on exit 0.
function tryOpen(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const c = spawn("open", args, { stdio: "ignore" });
      c.on("close", (code) => resolve(code === 0));
      c.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

// Resolve a spoken target to something that actually opens. Ladder:
//   1) an explicit URL → open it
//   2) an installed Mac app by name → open -a
//   3) anything else (or an app that doesn't exist) → open a web search,
//      so a vague "open my analytics" never dead-ends — it always lands somewhere.
// Returns the mode so APOLLO can narrate honestly ("opening…" vs "pulled up a search for…").
async function runOpen(target: string): Promise<"url" | "app" | "search" | ""> {
  const t = (target || "").trim();
  if (!t) return "";
  const looksUrl = /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t);
  if (looksUrl) {
    const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    if (!/^https?:\/\/[\w.\-/?=&%#~+:@]+$/i.test(url)) return "";
    return (await tryOpen([url])) ? "url" : "";
  }
  // App name (or a plain term). Try it as an installed app first…
  if (/^[\w .'&\-]{1,40}$/.test(t) && (await tryOpen(["-a", t]))) return "app";
  // …otherwise fall back to a web search so the request always does SOMETHING.
  if (t.length <= 120) {
    return (await tryOpen([`https://www.google.com/search?q=${encodeURIComponent(t)}`])) ? "search" : "";
  }
  return "";
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { target } = await req.json().catch(() => ({ target: "" }));
  if (typeof target !== "string" || !target.trim()) return NextResponse.json({ ok: false, error: "missing target" }, { status: 400 });
  const mode = await runOpen(target);
  return NextResponse.json({ ok: mode !== "", mode, target });
}
