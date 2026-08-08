import { NextResponse } from "next/server";
import { APPS_REPO, CATALOG, appRunning, openrouterKey } from "@/lib/appslab";
import { existsSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    repo: APPS_REPO,
    repoCloned: existsSync(APPS_REPO),
    keyPresent: !!openrouterKey(),
    apps: CATALOG.map((a) => ({ ...a, running: appRunning(a.slug) })),
  });
}
