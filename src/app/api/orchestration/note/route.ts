import { NextResponse } from "next/server";

import { appendNote, readNotes, type MasterNote } from "@/lib/orchestration-notes";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loopbackOrigin(raw: string | null): boolean {
  if (!raw) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export const NOTE_FIELDS = ["situation", "close"] as const;

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
    if (body.field !== undefined && !NOTE_FIELDS.includes(body.field as (typeof NOTE_FIELDS)[number])) {
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
  appendNote(note);
  return NextResponse.json(
    { schemaVersion: 1, result: { note, notes: readNotes() }, error: null },
    { status: 201 },
  );
}
