import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { hermesHome } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hy3coder/status — is Hy3 reachable? Hy3 is cloud (OpenRouter), so
// "running" just means we have an OpenRouter key on disk. No local gateway.

function haveKey(): boolean {
  if (process.env.OPENROUTER_API_KEY) return true;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(hermesHome(), "auth.json"), "utf8"));
    const v = raw.openrouter;
    if (typeof v === "string" ? v : v?.api_key) return true;
  } catch { /* ignore */ }
  for (const file of [
    path.join(hermesHome(), "profiles", "julian", ".env"),
    path.join(hermesHome(), "profiles", "fusion", ".env"),
    path.join(hermesHome(), ".env"),
  ]) {
    try {
      if (/^OPENROUTER_API_KEY=.+$/m.test(fs.readFileSync(file, "utf8"))) return true;
    } catch { /* ignore */ }
  }
  return false;
}

export async function GET() {
  const running = haveKey();
  return NextResponse.json({
    running,
    model: "tencent/hy3",
    label: "Hy3 · Hunyuan 3",
    provider: "OpenRouter",
  });
}
