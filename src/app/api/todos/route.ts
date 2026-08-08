import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { checkLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily todo lists — one JSON per day at ~/.agentic-os/todos/YYYY-MM-DD.json,
// so history is just the directory listing.
const ROOT = path.join(os.homedir(), ".agentic-os", "todos");

type Status = "todo" | "doing" | "done";
// kind "heading" = a Google-Doc-style section title row (no checkbox, excluded
// from progress counts). indent 0-3 = sub-bullet nesting.
interface Todo { id: string; text: string; done: boolean; ts: number; status?: Status; kind?: "task" | "heading"; indent?: number; }
// `done` kept in sync with status for back-compat with older day files.
function migrate(t: Todo): Todo {
  if (!t.status) t.status = t.done ? "done" : "todo";
  t.done = t.status === "done";
  if (!t.kind) t.kind = "task";
  if (typeof t.indent !== "number") t.indent = 0;
  return t;
}
const isTask = (t: Todo) => t.kind !== "heading";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function today(): string {
  // Local date, not UTC — the user's day boundary.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function ensure() { await fs.mkdir(ROOT, { recursive: true }); }
async function load(date: string): Promise<Todo[]> {
  try { return (JSON.parse(await fs.readFile(path.join(ROOT, date + ".json"), "utf8")) as Todo[]).map(migrate); }
  catch { return []; }
}
async function save(date: string, todos: Todo[]) {
  const file = path.join(ROOT, date + ".json");
  // Keep the previous version as a one-level undo (data-loss safety net).
  await fs.copyFile(file, file + ".prev").catch(() => {});
  // Atomic write: tmp + rename, so a concurrent read can never see a torn file.
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(todos, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// Serialize all mutations — two rapid clicks used to race (load/load/save/save)
// and a torn read once wiped the whole day file.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

// GET            → { date: today, todos, days: [{date, total, done}] }
// GET ?date=YYYY-MM-DD → same shape for that day
export async function GET(req: Request) {
  await ensure();
  const q = new URL(req.url).searchParams.get("date");
  const date = q && DATE_RE.test(q) ? q : today();
  const files = (await fs.readdir(ROOT).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const days = (await Promise.all(files.map(async (f) => {
    const d = f.replace(/\.json$/, "");
    const t = await load(d);
    const tasks = t.filter(isTask);
    return { date: d, total: tasks.length, done: tasks.filter((x) => x.done).length };
  }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  return NextResponse.json({ date, today: today(), todos: await load(date), days });
}

// POST { action: "add", text } | { action: "toggle"|"delete", id } | { action: "edit", id, text }
//    | { action: "status", id, status: "todo"|"doing"|"done" } | { action: "reorder", ids } — all take optional date
export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  await ensure();
  const body = await req.json().catch(() => ({}));
  const date = typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : today();
  return serialize(() => mutate(date, body));
}

async function mutate(date: string, body: Record<string, unknown> & { action?: string; id?: string; status?: string }) {
  const todos = await load(date);
  if (body.action === "add") {
    let text = String(body.text || "").trim().slice(0, 300);
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    // "# Title" → heading row (Google-Doc-style section)
    const heading = /^#\s+/.test(text);
    if (heading) text = text.replace(/^#\s+/, "");
    todos.push({ id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, done: false, ts: Date.now(), status: "todo", kind: heading ? "heading" : "task", indent: 0 });
  } else if (body.action === "indent") {
    const t = todos.find((x) => x.id === body.id);
    const delta = body.delta === -1 ? -1 : 1;
    if (t) t.indent = Math.max(0, Math.min(3, (t.indent ?? 0) + delta));
  } else if (body.action === "toggle") {
    const t = todos.find((x) => x.id === body.id);
    if (t) { t.status = t.status === "done" ? "todo" : "done"; t.done = t.status === "done"; }
  } else if (body.action === "status") {
    const t = todos.find((x) => x.id === body.id);
    const s = body.status;
    if (t && (s === "todo" || s === "doing" || s === "done")) { t.status = s; t.done = s === "done"; }
  } else if (body.action === "edit") {
    const t = todos.find((x) => x.id === body.id);
    let text = String(body.text || "").trim().slice(0, 300);
    if (t && text) {
      // typing "# " at the start converts to a heading (and vice versa by removing it)
      if (/^#\s+/.test(text)) { t.kind = "heading"; text = text.replace(/^#\s+/, ""); }
      t.text = text;
    }
  } else if (body.action === "delete") {
    const i = todos.findIndex((x) => x.id === body.id);
    if (i >= 0) todos.splice(i, 1);
  } else if (body.action === "reorder" && Array.isArray(body.ids)) {
    // Client sends the full desired order; unknown ids ignored, missing ones kept at end.
    const rank = new Map((body.ids as string[]).map((id, i) => [id, i]));
    todos.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  await save(date, todos);
  return NextResponse.json({ ok: true, todos });
}
