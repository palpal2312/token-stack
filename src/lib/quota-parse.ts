// Parse a worker's quota text into a single "remaining %" number, normalizing
// each CLI's own semantics — they do NOT agree:
//   - kimi / codex: the probe text is percent USED ("Weekly 84%", "weekly 1%
//     used") → remaining = 100 - used, worst window wins.
//   - antigravity (agy): the text is percent REMAINING per model
//     (`remainingPercentage`, health.ts) → the smallest listed model wins.
// Anything unparseable returns null and the proactive-handoff feature stays
// silent for that worker — a guess is worse than no trigger.

export function parseRemainingPct(text: string, cli: string): number | null {
  if (!text) return null;

  if (cli === "antigravity") {
    const vals = [...text.matchAll(/(\d+(?:\.\d+)?)%\s*\(resets/g)].map((m) => parseFloat(m[1]));
    return vals.length ? Math.min(...vals) : null;
  }

  // "Plus · weekly 1% used (resets in 6d)" · "Weekly 84% (resets in 4d) · 5h 67% (…)"
  const used = [...text.matchAll(/(?:weekly|5h)[^0-9]*(\d+(?:\.\d+)?)\s*%\s*(?:used)?\s*\(resets/gi)]
    .map((m) => parseFloat(m[1]));
  if (!used.length) return null;
  return Math.max(0, 100 - Math.max(...used));
}

/** Percent of quota consumed per turn between the two latest readings
 * (remaining drops). 0 when the reading went up or there is one reading. */
export function burnPerTurn(readings: { pct: number }[]): number {
  if (readings.length < 2) return 0;
  const a = readings[readings.length - 2].pct;
  const b = readings[readings.length - 1].pct;
  return Math.max(0, a - b);
}

/** A scheduled wake is successful only with both a healthy probe and a parsed
 * remaining-quota reading strictly above the handoff trigger. Unknown quota is
 * not evidence of recovery. */
export function isQuotaRecovered(state: string, remainingPct: number | null, triggerPct: number): boolean {
  return state === "ok" && remainingPct !== null && remainingPct > triggerPct;
}

/** Earliest quota reset named in a quota text ("resets in 6d 23h", "resets in
 * 28m"…) as an absolute time. Used when the whole fallback chain is exhausted
 * and the user needs to know when ANY quota comes back. */
export function parseEarliestReset(text: string, now = Date.now()): { at: Date; window: string } | null {
  let best: { at: Date; window: string } | null = null;
  for (const m of text.matchAll(/([A-Za-z0-9 .()]*?)\s*(\d+(?:\.\d+)?)%\s*(?:used)?\s*\(resets in ([^)]+)\)/g)) {
    const label = m[1].trim() || "quota";
    const dur = m[3];
    let ms = 0;
    const d = dur.match(/(\d+)\s*d/); if (d) ms += Number(d[1]) * 86_400_000;
    const h = dur.match(/(\d+)\s*h/); if (h) ms += Number(h[1]) * 3_600_000;
    const min = dur.match(/(\d+)\s*m(?!s)/); if (min) ms += Number(min[1]) * 60_000;
    if (!ms) continue;
    const at = new Date(now + ms);
    if (!best || at < best.at) best = { at, window: label };
  }
  return best;
}
