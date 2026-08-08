import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { VIDEOUSE_ROOT, jobDir, listJobs, slugify } from "@/lib/videouse";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  return NextResponse.json({ jobs: await listJobs() });
}

// POST multipart: field "video" (file) [+ optional "job" name] → new job dir with the upload inside.
export async function POST(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const form = await req.formData();
  const file = form.get("video");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no video file" }, { status: 400 });
  }
  const requested = String(form.get("job") || "");
  const job = /^[a-z0-9-]{1,60}$/.test(requested) ? requested : `${slugify(file.name)}-${Date.now().toString(36).slice(-4)}`;
  const dir = jobDir(job);
  await mkdir(dir, { recursive: true });

  const safeName = file.name.replace(/[^\w.\- ]+/g, "_") || "source.mp4";
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, safeName), buf);

  return NextResponse.json({ job, file: safeName, bytes: buf.length, root: VIDEOUSE_ROOT });
}
