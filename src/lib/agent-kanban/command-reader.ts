import { watch, type FSWatcher } from "node:fs";
import { mkdir as mkdirAsync, readFile as readFileAsync, readdir } from "node:fs/promises";
import path from "node:path";
import { kanbanSubscriberCount } from "./event-bus";
import { kanbanRoot, listCards, transitionCard } from "./store";
import { isWorkflowStage } from "./types";

interface CommandRecord {
  id?: unknown;
  at?: unknown;
  cardId?: unknown;
  attemptId?: unknown;
  type?: unknown;
  to?: unknown;
  note?: unknown;
}

const offsets = new Map<string, number>();
let watcher: FSWatcher | null = null;
let timer: NodeJS.Timeout | null = null;
let debounce: NodeJS.Timeout | null = null;
let scanning: Promise<void> | null = null;

function commandDir(): string { return path.join(kanbanRoot(), "commands"); }

async function hasActiveAttempts(): Promise<boolean> {
  const cards = await listCards().catch(() => []);
  return cards.some((card) => card.attempts.some((attempt) =>
    attempt.status === "created" || attempt.status === "queued"
    || attempt.status === "running" || attempt.status === "needs_input"));
}

async function processLine(line: string): Promise<void> {
  let command: CommandRecord;
  try { command = JSON.parse(line) as CommandRecord; } catch { return; }
  if (command.type !== "request_transition"
    || typeof command.id !== "string"
    || typeof command.at !== "string"
    || typeof command.cardId !== "string"
    || typeof command.attemptId !== "string"
    || !isWorkflowStage(command.to)) return;
  const age = Date.now() - new Date(command.at).getTime();
  if (!Number.isFinite(age) || age < -60_000 || age > 5 * 60_000) return;
  await transitionCard({
    cardId: command.cardId,
    attemptId: command.attemptId,
    actor: command.to === "reviewed" || command.to === "doing" ? "reviewer" : "owner",
    to: command.to,
    commandId: command.id,
    ...(typeof command.note === "string" ? { note: command.note } : {}),
  }).catch(() => { /* invalid commands are deliberately non-authoritative */ });
}

async function scanFile(file: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,80}\.jsonl$/.test(path.basename(file))) return;
  let offset = offsets.get(file) ?? 0;
  let text = "";
  try { text = await readFileAsync(file, "utf8"); } catch { return; }
  if (text.length < offset) offset = 0;
  if (text.length === offset) return;
  // Commands are small and the per-file size is bounded by one attempt. The
  // offset still prevents reprocessing on every watcher coalescence.
  const delta = text.slice(offset);
  offsets.set(file, text.length);
  for (const line of delta.split(/\r?\n/)) if (line.trim()) await processLine(line);
}

export async function reconcileKanbanCommands(): Promise<void> {
  if (scanning) return scanning;
  scanning = (async () => {
    await mkdirAsync(commandDir(), { recursive: true });
    let files: string[] = [];
    try { files = (await readdir(commandDir())).map((name) => path.join(commandDir(), name)); }
    catch { return; }
    for (const file of files) await scanFile(file);
  })().finally(() => { scanning = null; });
  return scanning;
}

function scheduleScan(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { void reconcileKanbanCommands(); }, 80);
}

async function refreshLifecycle(): Promise<void> {
  const active = await hasActiveAttempts();
  if (!active && kanbanSubscriberCount() === 0) {
    stopKanbanCommandMonitor();
    return;
  }
  if (!timer) {
    timer = setInterval(() => { void reconcileKanbanCommands(); }, 2_000);
    timer.unref();
  }
}

export async function ensureKanbanCommandMonitor(): Promise<void> {
  await mkdirAsync(commandDir(), { recursive: true });
  if (!watcher) {
    try {
      watcher = watch(commandDir(), () => scheduleScan());
      watcher.unref();
      watcher.on("error", () => { watcher?.close(); watcher = null; });
    } catch { watcher = null; }
  }
  await reconcileKanbanCommands();
  await refreshLifecycle();
}

export function notifyKanbanActivityChanged(): void {
  void refreshLifecycle();
}

export function stopKanbanCommandMonitor(): void {
  watcher?.close();
  watcher = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (debounce) clearTimeout(debounce);
  debounce = null;
}

export async function commandFileForAttempt(attemptId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(attemptId)) throw new Error("Bad attempt id.");
  await mkdirAsync(commandDir(), { recursive: true });
  return path.join(commandDir(), `${attemptId}.jsonl`);
}
