import { NextResponse } from "next/server";
import { herdrStatus } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await herdrStatus());
}
