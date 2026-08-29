import { NextResponse } from "next/server";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loopbackOrigin(raw: string | null): boolean {
  if (!raw) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export interface MasterNote {
  time: string;
  text: string;
  /** Which MASTER-card line the note fills; legacy notes mean "situation". */
  field?: string;
}

const NOTE_FIELDS = new Set(["situation", "close"]);

function notesPath(): string {
  const base = process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os");
  return path.join(base, "orchestration-notes.jsonl");
}

function readNotes(): MasterNote[] {
  const file = notesPath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MasterNote);
}

/** Control characters other than tab/newline are rejected. */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/** Rejects foreign origins/notes without content or with control characters. */
function guard(request: Request, body: { text?: string; field?: string }): { error: string; status: number } | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if ((origin && !loopbackOrigin(origin)) || (!origin && referer && !loopbackOrigin(referer))) {
    return { error: "foreign_origin", status: 403 };
  }
  if (request.method === "POST") {
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return { error: "text_required", status: 400 };
    }
    if (body.text.length > 500) return { error: "note_too_long", status: 413 };
    if (CONTROL_CHAR_RE.test(body.text)) {
      return { error: "control_characters_rejected", status: 422 };
    }
    if (body.field !== undefined && !NOTE_FIELDS.has(body.field)) {
      return { error: "invalid_field", status: 422 };
    }
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = guard(request, {});
  if (blocked) {
    return NextResponse.json(
      { schemaVersion: 1, result: null, error: blocked },
      { status: blocked.status },
    );
  }
  return NextResponse.json({
    schemaVersion: 1,
    result: { notes: readNotes() },
    error: null,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string; field?: string };
  const blocked = guard(request, body);
  if (blocked) {
    return NextResponse.json(
      { schemaVersion: 1, result: null, error: blocked },
      { status: blocked.status },
    );
  }
  const note: MasterNote = {
    time: new Date().toISOString(),
    text: body.text!.trim(),
    field: body.field ?? "situation",
  };
  const file = notesPath();
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(note)}\n`, "utf8");
  return NextResponse.json(
    { schemaVersion: 1, result: { note, notes: readNotes() }, error: null },
    { status: 201 },
  );
}
