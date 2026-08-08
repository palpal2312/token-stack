import { NextResponse } from "next/server";
import { getOpenCodeState, OPENCODE_MODELS, OPENCODE_DEFAULT_MODEL } from "@/lib/opencode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...getOpenCodeState(), models: OPENCODE_MODELS, defaultModel: OPENCODE_DEFAULT_MODEL });
}
