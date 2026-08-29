/**
 * Master notes journal (append-only JSONL), shared by the note write endpoint
 * and the read-only state endpoint so a single GET carries the whole picture.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { withJournalLock } from "./journal-lock";

export interface MasterNote {
  time: string;
  text: string;
  /** Which card line the note fills; legacy notes mean "situation".
   * Master card: situation|close. Lane cards: run|next. */
  field?: string;
  /** Which lane card a run/next note belongs to (lane-a|lane-b|lane-c). */
  lane?: string;
  /** Who wrote this note (redacted label); legacy notes mean "master". */
  writer?: string;
}

export function notesPath(): string {
  const base = process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os");
  return path.join(base, "orchestration-notes.jsonl");
}

export function readNotes(): MasterNote[] {
  const file = notesPath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MasterNote);
}

/** Queues concurrent writers on the same mkdir lock as the state journal. */
export function appendNote(note: MasterNote): void {
  const file = notesPath();
  // Lock lives beside the journal, so the directory must exist first.
  mkdirSync(path.dirname(file), { recursive: true });
  withJournalLock(file, {}, () => {
    appendFileSync(file, `${JSON.stringify(note)}\n`, "utf8");
  });
}

/** A pending "send a fresh report" request for one board seat. */
export interface BoardPing {
  target: string;
  time: string;
  from: string;
}

export function pingPath(target: string): string {
  const base = process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os");
  return path.join(base, "orchestration-pings", `${target}.json`);
}

/**
 * Drops/refreshes the pending-report request file for one board seat. One
 * file per seat (last click wins), so no journal lock is needed; the seat's
 * lane-report hook surfaces it and clears it once the report lands.
 */
export function writePing(target: string): BoardPing {
  const ping: BoardPing = { target, time: new Date().toISOString(), from: "board" };
  const file = pingPath(target);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ping)}\n`, "utf8");
  return ping;
}
