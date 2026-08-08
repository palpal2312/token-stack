import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LATEST = path.join(os.homedir(), ".agentic-os", "astros", "latest.json");

export async function GET() {
  try {
    const d = JSON.parse(await readFile(LATEST, "utf8"));
    return Response.json(d);
  } catch {
    return Response.json({ ok: false, topics: [], scannedAt: null });
  }
}
