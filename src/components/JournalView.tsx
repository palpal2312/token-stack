"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Plus, RefreshCw } from "lucide-react";
import VoiceButton from "./VoiceButton";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";

interface JournalEntry {
  time: string;
  text: string;
}

function todayISO(): string {
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + tz * 60_000);
  return local.toISOString().slice(0, 10);
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try {
    return await r.json();
  } catch {
    return { error: `The server returned ${r.status} with no explanation.` };
  }
}

export default function JournalView() {
  const [date, setDate] = useState(todayISO);
  const [days, setDays] = useState<string[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (forDate: string) => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/journal?date=${encodeURIComponent(forDate)}`, { cache: "no-store" });
      const j = await readJson(r);
      if (!r.ok && j.error) {
        setErr(String(j.error));
        setEntries([]);
        setDays([]);
        return;
      }
      setDays((j.days as string[]) ?? []);
      setEntries((j.entries as JournalEntry[]) ?? []);
      setDate(String(j.date ?? forDate));
      setErr((j.error as string) ?? null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  async function add() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, date }),
      });
      const j = await readJson(r);
      if (r.ok && Array.isArray(j.entries)) {
        setEntries(j.entries as JournalEntry[]);
        setDays((j.days as string[]) ?? days);
        setInput("");
        setErr(null);
      } else {
        setErr((j.error as string) ?? "That entry could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  const dayOptions = Array.from(new Set([date, ...days])).sort().reverse();

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
        <PageHeaderIcon gradient="linear-gradient(135deg,#c084fc,#7c3aed)">
          <BookOpen size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Journal
            <HeaderStatPills
              stats={[
                { label: date, tone: "accent" },
                { label: `${entries.length} entries`, tone: entries.length ? "ok" : "neutral" },
                { label: `${days.length} days`, tone: days.length ? "accent" : "neutral" },
              ]}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(date)}
          disabled={refreshing}
          className="ml-auto shrink-0 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
        {err && (
          <div className="panel p-3 flex items-start gap-2.5">
            <BookOpen size={15} className="mt-0.5 shrink-0 text-rose-300" />
            <div className="text-[12px] text-rose-300">{err}</div>
          </div>
        )}

        <div className="panel p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]" htmlFor="journal-date">
              Day
            </label>
            <input
              id="journal-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-2 h-[34px] text-sm text-[var(--fg)]"
            />
            {dayOptions.slice(0, 8).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                className="px-2.5 py-1 rounded-full text-[11px] border transition"
                style={{
                  background: date === d ? "rgba(192,132,252,0.16)" : "transparent",
                  borderColor: date === d ? "#c084fc" : "var(--panel-border)",
                  color: date === d ? "var(--fg)" : "var(--fg-dim)",
                }}
              >
                {d === todayISO() ? "Today" : d}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <VoiceButton
              onTranscript={(t, o) => {
                if (o.final) setInput((v) => (v ? `${v} ` : "") + t);
              }}
              size={38}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void add();
                }
              }}
              rows={3}
              placeholder="What happened today? (Ctrl/Cmd+Enter to save)"
              className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)] resize-y min-h-[76px]"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={!input.trim() || busy}
              className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
              style={{
                background: "rgba(192,132,252,0.18)",
                border: "1px solid rgba(192,132,252,0.5)",
                color: "#c084fc",
              }}
            >
              <Plus size={14} /> Save
            </button>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
            Saved to <code>Agentic OS/Journal/{date}.md</code>
          </div>
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {entries.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-[var(--fg-dim)] py-8 text-center"
              >
                No entries for this day yet. Write one above.
              </motion.div>
            )}
            {entries.map((entry, i) => (
              <motion.div
                key={`${entry.time}-${i}-${entry.text.slice(0, 24)}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel panel-hover p-3"
              >
                <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1">
                  {entry.time}
                </div>
                <div className="text-[14px] text-[var(--fg)] whitespace-pre-wrap">{entry.text}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
