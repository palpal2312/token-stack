/**
 * Master notes journal (append-only JSONL), shared by the note write endpoint
 * and the read-only state endpoint so a single GET carries the whole picture.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { withJournalLock } from "./journal-lock";

export interface MasterNote {
  time: string;
  text: string;
  /** Which MASTER-card line the note fills; legacy notes mean "situation". */
  field?: string;
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
