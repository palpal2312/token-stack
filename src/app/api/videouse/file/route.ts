import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { jobDir } from "@/lib/videouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".m4v": "video/x-m4v", ".srt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".json": "application/json",
};

// GET ?job=<job>&path=<rel> — serve a job file with Range support (video scrubbing).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const job = url.searchParams.get("job") || "";
  const rel = url.searchParams.get("path") || "";
  let base: string;
  try { base = jobDir(job); } catch { return new Response("bad job", { status: 400 }); }
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return new Response("forbidden", { status: 403 });
  if (!existsSync(abs)) return new Response("not found", { status: 404 });

  const s = await stat(abs);
  if (!s.isFile()) return new Response("not a file", { status: 400 });
  const total = s.size;
  const mime = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const baseHeaders: Record<string, string> = { "Content-Type": mime, "Cache-Control": "no-store", "Accept-Ranges": "bytes" };

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
      if (start <= end && start < total) {
        const stream = Readable.toWeb(createReadStream(abs, { start, end })) as unknown as globalThis.ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: { ...baseHeaders, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) },
        });
      }
      return new Response("range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
  }
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as globalThis.ReadableStream;
  return new Response(stream, { headers: { ...baseHeaders, "Content-Length": String(total) } });
}
