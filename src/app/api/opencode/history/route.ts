import { NextResponse } from "next/server";
import { readOpenCodeHistory, obsidianLogPath } from "@/lib/opencodeHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const history = await readOpenCodeHistory(40);
  return NextResponse.json({ history, obsidian: obsidianLogPath() });
}
