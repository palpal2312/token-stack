// Chat sessions for Sen — the ChatGPT-style list in the left panel.
//
// One session = one transcript, stored through the same per-agent history the
// Agents system already uses (legacy key `firstmate-<session-id>`), so read/pack/
// append/purge are all reused unchanged. This file only owns the *index*:
// which sessions exist, their titles, and their order.
//
// The pre-sessions single transcript (`firstmate/chat.jsonl`) is migrated on
// first read into a real session rather than orphaned.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { AGENT_CHATS, readHistory, purgeAgentData } from "@/lib/builders/history";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The Builder that answered this session's last turn. Sessions may use
   * different workers; reopening one restores whoever answered it last. */
  builder?: string;
  /** The CLI session to resume on the next turn with the same builder — the
   * fast path that skips re-packing history and re-running the bootstrap. */
  resume?: { builderId: string; cli: string; sessionId: string };
  /** Model override for this session — each conversation may run a different
   * model on the same worker. Absent = the builder's model, else CLI default. */
  model?: string;
  /** Internal sessions (for example a Kanban attempt) stay out of the normal
   * chat rail but remain addressable through a deep link. */
  kind?: "chat" | "kanban";
  cardId?: string;
  attemptId?: string;
  /** Phase 12: the canonical Goal this session's planning formed, when any.
   * The kanban handoff prefers it — a goal-linked handoff creates the
   * canonical Task with a brief reference instead of raw transcript text. */
  goalId?: string;
}

// legacy compatibility storage folder and agent-id prefix; do not rename or
// existing chat transcripts disappear.
const HOME_DIR = path.join(AGENT_CHATS, "firstmate");
const INDEX_FILE = path.join(HOME_DIR, "sessions.json");
const LEGACY_ID = "firstmate";
const SID_RE = /^s-[a-z0-9-]+$/;

export function sessionValid(id: string): boolean { return SID_RE.test(id); }
export function sessionAgentId(id: string): string { return `firstmate-${id}`; }

function newId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function readIndex(): Promise<SessionMeta[]> {
  try {
    const j = JSON.parse(await readFile(INDEX_FILE, "utf8")) as { sessions?: SessionMeta[] };
    return Array.isArray(j.sessions) ? j.sessions : [];
  } catch { return []; }
}

async function writeIndex(sessions: SessionMeta[]): Promise<void> {
  await mkdir(HOME_DIR, { recursive: true });
  const tmp = INDEX_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify({ sessions }, null, 2), "utf8");
  await rename(tmp, INDEX_FILE);
}

/**
 * The index, with the legacy single transcript folded in as a session the
 * first time the new world sees it. A legacy file with no turns is just
 * deleted by the next purge — nothing to migrate.
 */
export async function listSessions(opts: { includeInternal?: boolean } = {}): Promise<SessionMeta[]> {
  let sessions = await readIndex();
  if (sessions.length === 0 && !existsSync(INDEX_FILE)) {
    const legacy = await readHistory(LEGACY_ID, 1);
    if (legacy.length > 0) {
      const meta: SessionMeta = {
        id: newId(),
        title: titleFrom(legacy[0].text),
        createdAt: legacy[0].ts ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Rename the legacy history dir key by copying turns into the session's.
      const all = await readHistory(LEGACY_ID, 10_000);
      const { appendTurn } = await import("@/lib/builders/history");
      for (const t of all) await appendTurn(sessionAgentId(meta.id), t);
      sessions = [meta];
      await writeIndex(sessions);
    }
  }
  return sessions
    .filter((session) => opts.includeInternal || session.kind !== "kanban")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function titleFrom(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  // Filler scaffolding makes rotten titles ("Trả lứng đúng một từ: OK") —
  // cut it, then take the first clause at a word boundary.
  t = t.replace(/^(trả lờờii|reply|answer|hãy|please|cho tôi biết|cho tôi|giúp tôi)\s+/i, "");
  t = t.replace(/^(đúng|exactly|with|với)\s+/i, "");
  t = t.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!t) return "New chat";
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","), cut.lastIndexOf(";"));
  return `${boundary > 24 ? cut.slice(0, boundary) : cut}…`;
}

export async function createSession(
  title: string,
  builder?: string,
  extra: Pick<SessionMeta, "kind" | "cardId" | "attemptId"> = {},
): Promise<SessionMeta> {
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    id: newId(), title: titleFrom(title), createdAt: now, updatedAt: now, builder,
    ...extra,
  };
  const sessions = await readIndex();
  sessions.push(meta);
  await writeIndex(sessions);
  return meta;
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  if (!sessionValid(id)) return null;
  return (await readIndex()).find((x) => x.id === id) ?? null;
}

export interface SessionTouch {
  title?: string;
  builder?: string;
  /** null clears a stale slot — without it every later turn pays one failed
   * resume spawn before falling back. */
  resume?: SessionMeta["resume"] | null;
  /** null clears the session's model override back to the builder default. */
  model?: string | null;
}

export async function touchSession(id: string, touch: SessionTouch): Promise<void> {
  const sessions = await readIndex();
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  s.updatedAt = new Date().toISOString();
  if (touch.title && s.title === "New chat") s.title = titleFrom(touch.title);
  if (touch.builder) s.builder = touch.builder;
  if (touch.resume !== undefined) {
    if (touch.resume) s.resume = touch.resume;
    else delete s.resume;
  }
  if (touch.model !== undefined) {
    if (touch.model) s.model = touch.model;
    else delete s.model;
  }
  await writeIndex(sessions);
}

/** Forget one session: transcript, scratch dir, and its index row. */
export async function removeSession(id: string): Promise<void> {
  if (!sessionValid(id)) return;
  await purgeAgentData(sessionAgentId(id));
  await writeIndex((await readIndex()).filter((x) => x.id !== id));
}
