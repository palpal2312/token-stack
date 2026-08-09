"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Target, X, Check, Tag, RefreshCw } from "lucide-react";
import VoiceButton from "./VoiceButton";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";
import {
  CachePresets,
  ClientCacheKeys,
  cachedFetchJson,
  invalidateCache,
  readCache,
  setCache,
} from "@/lib/client-data-cache";

interface Goal { id: string; text: string; done: boolean; category?: string; createdAt: string; }

const CATEGORIES = ["Work", "Business", "Content", "SEO", "Health", "Personal", "Learning"];

export default function GoalsView({ embedded = false }: { embedded?: boolean }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [input, setInput] = useState("");
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"active" | "done" | "all">("active");
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Never assume the body is JSON: a route that dies mid-flight sends nothing,
  // and res.json() would then throw where nobody catches it.
  async function readJson(r: Response): Promise<Record<string, unknown>> {
    try { return await r.json(); }
    catch { return { error: `The server returned ${r.status} with no explanation.` }; }
  }

  async function load(opts?: { force?: boolean }) {
    const key = ClientCacheKeys.goals;
    const policy = CachePresets.semi;

    if (!opts?.force) {
      const hit = readCache<Record<string, unknown>>(key, policy);
      if (hit?.usable) {
        setGoals((hit.data.goals as Goal[]) ?? []);
        setErr((hit.data.error as string) ?? null);
        if (hit.fresh) return;
      }
    } else {
      invalidateCache(key);
    }

    setRefreshing(true);
    try {
      const { data: j } = await cachedFetchJson(
        key,
        async () => readJson(await fetch("/api/goals", { cache: "no-store" })),
        { ...policy, force: true },
      );
      setGoals((j.goals as Goal[]) ?? []);
      setErr((j.error as string) ?? null);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function add() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, category: category || undefined }),
      });
      const j = await readJson(r);
      if (j.goal) {
        setGoals((g) => {
          const next = [j.goal as Goal, ...g];
          setCache(ClientCacheKeys.goals, { goals: next });
          return next;
        });
        setInput("");   // keep what they typed when it did not save
        setErr(null);
      } else {
        setErr((j.error as string) ?? "That goal could not be saved.");
      }
    } finally { setBusy(false); }
  }

  async function toggle(g: Goal) {
    const next = { ...g, done: !g.done };
    setGoals((arr) => {
      const updated = arr.map((x) => (x.id === g.id ? next : x));
      setCache(ClientCacheKeys.goals, { goals: updated });
      return updated;
    });
    await fetch("/api/goals", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: g.id, done: next.done }),
    });
  }

  async function remove(id: string) {
    setGoals((arr) => {
      const updated = arr.filter((x) => x.id !== id);
      setCache(ClientCacheKeys.goals, { goals: updated });
      return updated;
    });
    await fetch(`/api/goals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  const visible = useMemo(() => {
    if (filter === "active") return goals.filter((g) => !g.done);
    if (filter === "done") return goals.filter((g) => g.done);
    return goals;
  }, [goals, filter]);

  const stats = useMemo(() => {
    const total = goals.length;
    const done = goals.filter((g) => g.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, open: total - done, pct };
  }, [goals]);

  const body = (
    <>
      {err && (
        <div className="panel p-3 flex items-start gap-2.5">
          <Target size={15} className="mt-0.5 shrink-0 text-rose-300" />
          <div className="text-[12px] text-rose-300">{err}</div>
        </div>
      )}

      {embedded && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total" value={String(stats.total)} accent="#22d3ee" compact />
          <Stat label="Active" value={String(stats.open)} accent="#a855f7" compact />
          <Stat label="Completed" value={String(stats.done)} accent="#86efac" compact />
          <Stat label="Progress" value={`${stats.pct}%`} accent="#fbbf24" progress={stats.pct} compact />
        </div>
      )}

      {/* Composer */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target size={16} className="text-[var(--accent-cyan)]" />
          <h3 className="text-sm font-medium">Add a goal</h3>
        </div>
        <div className="flex items-end gap-2">
          <VoiceButton onTranscript={(t, o) => { if (o.final) setInput((v) => (v ? v + " " : "") + t); }} size={38} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="What's the goal? (Enter to add)"
            className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] text-[var(--fg)]"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-2 h-[38px] text-sm text-[var(--fg-dim)]"
          >
            <option value="">No category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={add}
            disabled={!input.trim() || busy}
            className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40"
            style={{
              background: "rgba(34,211,238,0.18)",
              border: "1px solid rgba(34,211,238,0.5)",
              color: "#22d3ee",
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2">
        {(["active", "done", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-[12px] border transition"
            style={{
              background: filter === f ? "rgba(168,85,247,0.16)" : "transparent",
              borderColor: filter === f ? "#a855f7" : "var(--panel-border)",
              color: filter === f ? "var(--fg)" : "var(--fg-dim)",
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} · {f === "active" ? stats.open : f === "done" ? stats.done : stats.total}
          </button>
        ))}
        <div className="ml-auto text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
          Saved to <code>Agentic OS/Goals.md</code>
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {visible.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-[var(--fg-dim)] py-8 text-center">
              {filter === "active" ? "Nothing to chase right now. Add one above." :
               filter === "done"   ? "No completed goals yet." :
                                     "No goals yet."}
            </motion.div>
          )}
          {visible.map((g) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="panel panel-hover p-3 flex items-center gap-3"
            >
              <button
                onClick={() => toggle(g)}
                className="grid place-items-center w-6 h-6 rounded-full border transition"
                style={{
                  borderColor: g.done ? "#86efac" : "var(--panel-border-hot)",
                  background: g.done ? "rgba(134,239,172,0.18)" : "transparent",
                }}
                title={g.done ? "Mark as active" : "Mark as done"}
              >
                {g.done && <Check size={12} className="text-emerald-300" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-[14px] ${g.done ? "line-through text-[var(--fg-dimmer)]" : "text-[var(--fg)]"}`}>
                  {g.text}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mt-0.5 flex items-center gap-2">
                  {g.category && <span className="inline-flex items-center gap-1"><Tag size={9} />{g.category}</span>}
                  <span>{new Date(g.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                </div>
              </div>
              <button
                onClick={() => remove(g.id)}
                className="opacity-40 hover:opacity-100 text-[var(--fg-dim)] hover:text-rose-300 transition"
                title="Delete"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Target size={16} style={{ color: "#fbbf24" }} />
          <h2 className="text-[15px] font-medium text-[var(--cream)]">Goals & Workflows</h2>
          <a
            href="/goals"
            className="ml-auto text-[11px] underline"
            style={{ color: "var(--cream-mute)" }}
          >
            Open full page
          </a>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
          <PageHeaderIcon gradient="linear-gradient(135deg,#fbbf24,#d97706)">
          <Target size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Goals & Workflows
            <HeaderStatPills
              stats={[
                { label: `${stats.open} active`, tone: stats.open ? "ok" : "neutral" },
                { label: `${stats.done} done`, tone: stats.done ? "accent" : "neutral" },
                { label: `${stats.pct}% of ${stats.total}`, tone: stats.total ? "accent" : "neutral" },
              ]}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load({ force: true })}
          disabled={refreshing}
          className="ml-auto shrink-0 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
        {body}
      </div>
    </div>
  );
}

function Stat({
  label, value, accent, progress, compact = false,
}: { label: string; value: string; accent: string; progress?: number; compact?: boolean }) {
  return (
    <div className={`panel relative overflow-hidden ${compact ? "p-3" : "p-4"}`}>
      <div
        className="absolute -right-12 -top-12 w-32 h-32 rounded-full blur-3xl opacity-30"
        style={{ background: accent }}
      />
      <div className="relative text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">{label}</div>
      <div className={`relative metric mt-1 ${compact ? "text-2xl" : "text-3xl"}`} style={{ color: accent }}>{value}</div>
      {progress !== undefined && (
        <div className={`relative h-1.5 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden ${compact ? "mt-2" : "mt-3"}`}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${progress}%`, background: accent, boxShadow: `0 0 12px ${accent}` }}
          />
        </div>
      )}
    </div>
  );
}
