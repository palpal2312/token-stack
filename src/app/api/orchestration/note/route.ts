import { NextResponse } from "next/server";

import { appendNote, readNotes, type MasterNote } from "@/lib/orchestration-notes";
import { isController, isLaneId } from "@/lib/orchestration-state";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function loopbackOrigin(raw: string | null): boolean {
  if (!raw) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

// Master card lines: situation|close. Lane card lines: run|next (paired with lane).
export const NOTE_FIELDS = ["situation", "close", "run", "next"] as const;

/** Control characters other than tab/newline are rejected. */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * Restored under C10 §4 as the owner-approved note write channel. The S09-I10
 * removal (fc3cafb) deleted the unapproved mutable endpoint; this restore keeps
 * the surface read-only for anonymous callers and requires the controller flag
 * (ORCHESTRATION_CONTROLLER=1) for POST, so only the actively-owned controller
 * can append notes. GET stays loopback-only and read-only.
 */
function guard(request: Request, body: { text?: string; field?: string; writer?: string; lane?: string }): { error: string; status: number } | null {
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
    // run/next notes fill a lane card line, so they must name a real lane.
    if ((body.field === "run" || body.field === "next") && !body.lane) {
      return { error: "lane_required", status: 422 };
    }
    if (body.lane !== undefined && !isLaneId(body.lane)) {
      return { error: "invalid_lane", status: 422 };
    }
    if (body.writer !== undefined) {
      if (typeof body.writer !== "string" || body.writer.trim().length === 0) {
        return { error: "invalid_writer", status: 422 };
      }
      if (body.writer.length > 64) return { error: "writer_too_long", status: 413 };
      if (CONTROL_CHAR_RE.test(body.writer)) {
        return { error: "control_characters_rejected", status: 422 };
      }
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
  const body = (await request.json().catch(() => ({}))) as { text?: string; field?: string; writer?: string; lane?: string };
  const blocked = guard(request, body);
  if (blocked) {
    return NextResponse.json(
      { schemaVersion: 1, result: null, error: blocked },
      { status: blocked.status },
    );
  }
  if (!isController()) {
    return NextResponse.json(
      { schemaVersion: 1, result: null, error: { code: "controller_required", status: 403 } },
      { status: 403 },
    );
  }
  const note: MasterNote = {
    time: new Date().toISOString(),
    text: body.text!.trim(),
    field: body.field ?? "situation",
    lane: body.lane,
    writer: body.writer?.trim() || "master",
  };
  appendNote(note);
  return NextResponse.json(
    { schemaVersion: 1, result: { note, notes: readNotes() }, error: null },
    { status: 201 },
  );
}