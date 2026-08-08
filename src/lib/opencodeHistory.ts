// opencode history + Obsidian linking. Every build is recorded two ways:
//   1. ~/.agentic-os/opencode/history.jsonl        — durable machine history
//   2. <vault>/Agentic OS/opencode Log.md          — a human log in your Obsidian vault
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VAULT_ROOT, AGENTIC_DIR, todayISO, nowHM } from "@/lib/vaultWriter";

const HIST_DIR = path.join(os.homedir(), ".agentic-os", "opencode");
const HIST_FILE = path.join(HIST_DIR, "history.jsonl");

export interface OpenCodeHistoryEntry {
  ts: number;
  prompt: string;
  project: string;
  ok: boolean;
  cost?: number;
  turns?: number;
  ms?: number;
  model?: string;
}

export async function appendOpenCodeHistory(e: OpenCodeHistoryEntry): Promise<void> {
  try {
    await mkdir(HIST_DIR, { recursive: true });
    await appendFile(HIST_FILE, JSON.stringify(e) + "\n", "utf8");
  } catch { /* non-fatal */ }
  await appendToObsidian(e);
}

async function appendToObsidian(e: OpenCodeHistoryEntry): Promise<void> {
  if (!VAULT_ROOT || !AGENTIC_DIR) return;
  try {
    await mkdir(AGENTIC_DIR, { recursive: true });
    const file = path.join(AGENTIC_DIR, "opencode Log.md");
    const header = "---\ntitle: opencode Log\n---\n\nEvery build made with **opencode** — the open-source terminal coding agent (opencode.ai) running headless inside the Agent OS. Auto-logged from the opencode terminal.\n";
    const day = todayISO(new Date(e.ts));
    const time = nowHM(new Date(e.ts));
    const cost = e.cost != null ? `$${e.cost.toFixed(3)}` : "—";
    const status = e.ok ? "✅" : "⚠️";
    const prompt = e.prompt.replace(/\s+/g, " ").trim().slice(0, 220);
    const model = e.model ? ` · ${e.model}` : "";
    const line = `- ${status} **${time}** — \`${e.project}\` · ${e.turns ?? "—"} steps · ${cost}${model} — "${prompt}"`;

    let body = "";
    try { body = await readFile(file, "utf8"); } catch { body = header; }
    const stamp = `## ${day}`;
    if (!body.includes(stamp)) body = body.replace(/\s+$/, "") + `\n\n${stamp}\n`;
    body = body.replace(/\s+$/, "") + `\n${line}\n`;
    await writeFile(file, body, "utf8");
  } catch { /* vault may be unavailable — non-fatal */ }
}

export async function readOpenCodeHistory(limit = 40): Promise<OpenCodeHistoryEntry[]> {
  try {
    const txt = await readFile(HIST_FILE, "utf8");
    const out = txt.trim().split("\n")
      .map((l) => { try { return JSON.parse(l) as OpenCodeHistoryEntry; } catch { return null; } })
      .filter((x): x is OpenCodeHistoryEntry => !!x);
    return out.slice(-limit).reverse();
  } catch { return []; }
}

export function obsidianLogPath(): string | null {
  return AGENTIC_DIR ? path.join(AGENTIC_DIR, "opencode Log.md") : null;
}
