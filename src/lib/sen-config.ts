// Sen chat settings that the server must read — the auto-takeover fallback
// worker lives here (not in localStorage) because the route needs it when a
// turn dies of quota while nobody is watching.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { AGENT_CHATS } from "@/lib/builders/history";
import { parseRemainingPct } from "@/lib/quota-parse";

// legacy compatibility folder: existing Sen settings live under the old
// `firstmate` chat namespace.
const FILE = path.join(AGENT_CHATS, "firstmate", "config.json");
const HISTORY_FILE = path.join(AGENT_CHATS, "firstmate", "quota-history.json");

export interface SenConfig {
  /** Ordered fallback chain (≤3): the first alive member takes over. */
  fallbackBuilders: string[];
  /** Below this remaining %, burn is watched (default 15). */
  handoffWatchPct: number;
  /** At/below this remaining % — or projected to cross it next turn — the
   * fallback takes over BEFORE the wall (default 10). */
  handoffTriggerPct: number;
  /** Result of the latest scheduled wake, when one has fired. */
  wakeResult?: { firedAt: string; back: string[]; stillDead: string[] } | null;
}

const DEFAULTS: SenConfig = { fallbackBuilders: [], handoffWatchPct: 15, handoffTriggerPct: 10, wakeResult: null };

export async function readAukerConfig(): Promise<SenConfig> {
  try {
    const j = JSON.parse(await readFile(FILE, "utf8")) as Record<string, unknown>;
    const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 && v < 100 ? v : d);
    // Back-compat: the old single fallbackBuilder folds into the chain.
    const chain = Array.isArray(j?.fallbackBuilders)
      ? (j.fallbackBuilders as unknown[]).filter((x): x is string => typeof x === "string" && Boolean(x)).slice(0, 3)
      : (typeof j?.fallbackBuilder === "string" && j.fallbackBuilder ? [j.fallbackBuilder] : []);
    return {
      fallbackBuilders: chain,
      handoffWatchPct: num(j?.handoffWatchPct, DEFAULTS.handoffWatchPct),
      handoffTriggerPct: num(j?.handoffTriggerPct, DEFAULTS.handoffTriggerPct),
      wakeResult: (j?.wakeResult && typeof j.wakeResult === "object") ? j.wakeResult as SenConfig["wakeResult"] : null,
    };
  } catch { return { ...DEFAULTS }; }
}

export async function writeAukerConfig(cfg: Partial<SenConfig>): Promise<SenConfig> {
  const cur = await readAukerConfig();
  const next: SenConfig = {
    fallbackBuilders: cfg.fallbackBuilders !== undefined ? cfg.fallbackBuilders.slice(0, 3) : cur.fallbackBuilders,
    handoffWatchPct: cfg.handoffWatchPct ?? cur.handoffWatchPct,
    handoffTriggerPct: cfg.handoffTriggerPct ?? cur.handoffTriggerPct,
    wakeResult: cfg.wakeResult !== undefined ? cfg.wakeResult : (cur.wakeResult ?? null),
  };
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

// --- quota readings, one per post-turn probe -------------------------------

export interface QuotaReading { pct: number; at: string }

/** Append a parsed reading for a builder (last 10 kept). Unparseable texts
 * record nothing — the feature stays silent rather than inventing numbers. */
export async function recordQuotaReading(builderId: string, quotaText: string, cli: string): Promise<void> {
  const pct = parseRemainingPct(quotaText, cli);
  if (pct === null) return;
  const all = await readQuotaHistory();
  const list = [...(all[builderId] ?? []), { pct, at: new Date().toISOString() }].slice(-10);
  all[builderId] = list;
  await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(all, null, 2) + "\n", "utf8");
}

export async function readQuotaHistory(): Promise<Record<string, QuotaReading[]>> {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8")) as Record<string, QuotaReading[]>;
  } catch { return {}; }
}

export async function readBuilderQuotaHistory(builderId: string): Promise<QuotaReading[]> {
  return (await readQuotaHistory())[builderId] ?? [];
}
