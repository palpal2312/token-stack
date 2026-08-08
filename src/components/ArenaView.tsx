"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Swords, Play, Crown, History, AlertTriangle, Clock, Hash, X, Square,
} from "lucide-react";

// The Arena answers one question: does this profile actually work, and how does
// it compare? Same prompt, several profiles, side by side, with honest timings.
// It spends real money on real accounts, so nothing starts without a confirm.

interface BuilderRef { id: string; cli: string; name: string; isDefault: boolean; authKind: string }
interface CliRef { id: string; label: string }

interface LaneState {
  id: string; cli: string; name: string;
  text: string; notes: string[]; error: string | null;
  ttfbMs: number | null; durationMs: number | null; exitCode: number | null; bytes: number;
  running: boolean;
}

interface LaneResult {
  builderId: string; cli: string; name: string;
  ttfbMs: number | null; durationMs: number; exitCode: number | null;
  bytes: number; outputPath: string | null; error: string | null; timedOut: boolean;
}
interface ArenaRun { runId: string; ts: string; prompt: string; lanes: LaneResult[]; winner?: string | null; note?: string }

const MAX_LANES = 4;

export default function ArenaView() {
  const [builders, setBuilders] = useState<BuilderRef[]>([]);
  const [clis, setClis] = useState<CliRef[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [lanes, setLanes] = useState<LaneState[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<ArenaRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function readJson(r: Response): Promise<Record<string, unknown>> {
    try { return await r.json(); }
    catch { return { error: `The server returned ${r.status} with no explanation.` }; }
  }

  const loadHistory = useCallback(async () => {
    const j = await readJson(await fetch("/api/arena/runs?limit=50", { cache: "no-store" }));
    setHistory((j.runs as ArenaRun[]) ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const j = await readJson(await fetch("/api/builders", { cache: "no-store" }));
      const bs = ((j.builders as BuilderRef[]) ?? []).filter((b) => !b.cli.startsWith("fixture"));
      setBuilders(bs);
      setClis(((j.clis as CliRef[]) ?? []).map((c) => ({ id: c.id, label: c.label })));
    })();
    loadHistory();
  }, [loadHistory]);

  function toggle(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_LANES ? p : [...p, id]);
  }

  async function start() {
    setConfirming(false);
    setErr(null); setNotes([]); setWinner(null); setRunId(null);
    setRunning(true);
    setLanes(picked.map((id) => {
      const b = builders.find((x) => x.id === id)!;
      return { id, cli: b.cli, name: b.name, text: "", notes: [], error: null, ttfbMs: null, durationMs: null, exitCode: null, bytes: 0, running: true };
    }));

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/arena/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, builderIds: picked }),
        signal: ac.signal,
      });
      if (!res.body) { setErr("The server sent no response body."); setRunning(false); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let e: Record<string, unknown>;
          try { e = JSON.parse(line); } catch { continue; }
          apply(e);
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setErr(String((e as Error)?.message ?? e));
    } finally {
      setRunning(false);
      setLanes((ls) => ls.map((l) => ({ ...l, running: false })));
      abortRef.current = null;
      loadHistory();
    }
  }

  function apply(e: Record<string, unknown>) {
    const lane = e.lane as string | undefined;
    const t = e.t as string;

    if (!lane) {
      if (t === "start") setRunId(String(e.runId ?? ""));
      else if (t === "note") setNotes((n) => [...n, String(e.m)]);
      else if (t === "error") setErr(String(e.m));
      else if (t === "final") setHistory((h) => [e.run as ArenaRun, ...h]);
      return;
    }

    setLanes((ls) => ls.map((l) => {
      if (l.id !== lane) return l;
      if (t === "d") return { ...l, text: l.text + String(e.c) };
      if (t === "note") return { ...l, notes: [...l.notes, String(e.c)] };
      if (t === "error") return { ...l, error: String(e.m), running: false };
      if (t === "done") return {
        ...l, running: false,
        exitCode: (e.code as number | null) ?? null,
        durationMs: Number(e.ms), bytes: Number(e.bytes),
        ttfbMs: (e.ttfbMs as number | null) ?? null,
      };
      return l;
    }));
  }

  function stop() { abortRef.current?.abort(); }

  async function crown(id: string) {
    if (!runId) return;
    setWinner(id);
    await fetch("/api/arena/runs", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, winner: id }),
    });
    loadHistory();
  }

  const byCli = useMemo(() => {
    const m: Record<string, BuilderRef[]> = {};
    for (const b of builders) (m[b.cli] ??= []).push(b);
    return m;
  }, [builders]);

  const canStart = picked.length >= 2 && prompt.trim().length > 0 && !running;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500 }}>
            Arena
          </h1>
          <p className="text-[13px] text-[var(--fg-dim)] mt-1 max-w-3xl">
            Give two to four Builder profiles the same prompt and watch them answer side by side. This is how you find out
            whether a new profile really works, and which account or model you actually prefer.
          </p>
        </div>
        <button onClick={() => { setShowHistory((s) => !s); loadHistory(); }}
                className="shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] border border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] transition">
          <History size={13} /> History
        </button>
      </div>

      {err && (
        <div className="panel p-3 flex items-start gap-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
          <div className="text-[12px] text-rose-300">{err}</div>
        </div>
      )}
      {notes.map((n, i) => (
        <div key={i} className="text-[11px] text-[var(--fg-dimmer)]">{n}</div>
      ))}

      <div className="panel p-4 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">
            Profiles · {picked.length} of {MAX_LANES}
          </div>
          {builders.length === 0 ? (
            <div className="text-[12px] text-[var(--fg-dim)] py-2">
              No Builder profiles yet. Make some in <a href="/builders" className="underline">CLI Config</a> first.
            </div>
          ) : (
            <div className="space-y-2.5">
              {clis.filter((c) => (byCli[c.id] ?? []).length).map((c) => (
                <div key={c.id}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)] mb-1">{c.label}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(byCli[c.id] ?? []).map((b) => {
                      const on = picked.includes(b.id);
                      const full = !on && picked.length >= MAX_LANES;
                      return (
                        <button key={b.id} onClick={() => toggle(b.id)} disabled={running || full}
                                title={full ? `Only ${MAX_LANES} lanes at a time` : b.id}
                                className={`px-2.5 h-8 rounded-lg text-[12px] border transition disabled:opacity-35 ${
                                  on ? "border-[rgba(251,146,60,0.6)] text-[#fb923c] bg-[rgba(251,146,60,0.10)]"
                                     : "border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)]"}`}>
                          {b.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={running}
            placeholder="One prompt, sent to every selected profile…"
            className="w-full bg-transparent border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[rgba(251,146,60,0.5)] resize-y"
          />
        </div>

        <div className="flex items-center gap-2">
          {running ? (
            <button onClick={stop}
                    className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] transition"
                    style={{ background: "rgba(251,113,133,0.14)", color: "#fb7185" }}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button onClick={() => setConfirming(true)} disabled={!canStart}
                    className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] disabled:opacity-40 transition"
                    style={{ background: "rgba(251,146,60,0.14)", color: "#fb923c" }}>
              <Swords size={13} /> Race
            </button>
          )}
          {picked.length === 1 && <span className="text-[11px] text-[var(--fg-dimmer)]">Pick one more — a single profile is not a race.</span>}
        </div>
      </div>

      {lanes.length > 0 && (
        <div className={`grid gap-3 ${lanes.length > 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 lg:grid-cols-2"}`}>
          {lanes.map((l) => (
            <Lane key={l.id} lane={l} isWinner={winner === l.id} canCrown={Boolean(runId) && !l.running} onCrown={() => crown(l.id)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {confirming && (
          <ConfirmModal
            names={picked.map((id) => builders.find((b) => b.id === id)?.name ?? id)}
            onCancel={() => setConfirming(false)}
            onGo={start}
          />
        )}
        {showHistory && <HistoryDrawer runs={history} onClose={() => setShowHistory(false)} />}
      </AnimatePresence>
    </div>
  );
}

function Lane({ lane, isWinner, canCrown, onCrown }: {
  lane: LaneState; isWinner: boolean; canCrown: boolean; onCrown: () => void;
}) {
  const bodyRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    // Follow the output while it streams, the way a terminal does.
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lane.text]);

  const failed = lane.error !== null || (lane.exitCode !== null && lane.exitCode !== 0);

  return (
    <div className="panel p-0 overflow-hidden flex flex-col"
         style={isWinner ? { boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.55)" } : undefined}>
      <div className="px-3 py-2 border-b border-[var(--panel-border)] flex items-center gap-2">
        <span className="text-[13px] truncate flex-1">{lane.name}</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)]">{lane.cli}</span>
        {lane.running && <span className="text-[10px] uppercase tracking-wider text-[#fb923c]">running</span>}
        {canCrown && (
          <button onClick={onCrown} title="Mark this one the winner"
                  className="grid place-items-center w-7 h-7 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ color: isWinner ? "#fbbf24" : "var(--fg-dim)" }}>
            <Crown size={13} />
          </button>
        )}
      </div>

      {lane.error && (
        <div className="px-3 py-2 text-[11px] text-rose-300 border-b border-[var(--panel-border)]">{lane.error}</div>
      )}
      {lane.notes.map((n, i) => (
        <div key={i} className="px-3 py-1.5 text-[10px] text-amber-300/80 border-b border-[var(--panel-border)]">{n}</div>
      ))}

      <pre ref={bodyRef} className="mono text-[11px] leading-relaxed p-3 h-64 overflow-auto whitespace-pre-wrap text-[var(--fg-dim)] flex-1">
        {lane.text || (lane.running ? "…" : lane.error ? "" : "(no output)")}
      </pre>

      <div className="px-3 py-2 border-t border-[var(--panel-border)] flex items-center gap-3 text-[10px] text-[var(--fg-dimmer)]">
        <span className="flex items-center gap-1" title="Time to first word">
          <Clock size={10} /> {lane.ttfbMs === null ? "—" : `${(lane.ttfbMs / 1000).toFixed(1)}s`}
        </span>
        <span title="Total time">{lane.durationMs === null ? "—" : `${(lane.durationMs / 1000).toFixed(1)}s total`}</span>
        <span className="flex items-center gap-1" title="Bytes of raw output"><Hash size={10} /> {lane.bytes || 0}</span>
        <span className="ml-auto" style={{ color: failed ? "#fb7185" : lane.exitCode === 0 ? "#86efac" : undefined }}>
          {lane.exitCode === null ? (lane.running ? "" : "no exit code") : `exit ${lane.exitCode}`}
        </span>
      </div>
    </div>
  );
}

function ConfirmModal({ names, onCancel, onGo }: { names: string[]; onCancel: () => void; onGo: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()} className="panel p-5 w-full max-w-md space-y-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <div className="text-[15px]">This spends real usage</div>
            <p className="text-[12px] text-[var(--fg-dim)] mt-1">
              Each lane is a real call on that profile&apos;s own account. Running {names.length} lanes bills
              {names.length > 1 ? " all of them" : " it"} at once.
            </p>
          </div>
        </div>
        <ul className="text-[12px] space-y-1">
          {names.map((n) => <li key={n} className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-[var(--fg-dimmer)]" />{n}</li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 h-9 rounded-lg text-[12px] text-[var(--fg-dim)] hover:text-[var(--fg)] transition">Cancel</button>
          <button onClick={onGo} className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] transition"
                  style={{ background: "rgba(251,146,60,0.16)", color: "#fb923c" }}>
            <Play size={13} /> Race them
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function HistoryDrawer({ runs, onClose }: { runs: ArenaRun[]; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-[var(--panel)] border-l border-[var(--panel-border)] overflow-auto">
        <div className="sticky top-0 bg-[var(--panel)] px-4 py-3 border-b border-[var(--panel-border)] flex items-center justify-between">
          <span className="text-[14px]">Past races</span>
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)] transition"><X size={15} /></button>
        </div>
        <div className="px-4 pt-3 text-[10.5px] text-[var(--fg-dimmer)]">
          Race results are <span className="text-amber-300">experimental evidence</span> — tagged for the allocator but never silently overriding production scores.
        </div>
        <div className="p-4 space-y-3">
          {runs.length === 0 && <div className="text-[12px] text-[var(--fg-dim)] text-center py-8">No races yet.</div>}
          {runs.map((r) => (
            <div key={r.runId} className="panel p-3">
              <div className="flex items-center gap-2 text-[11px] text-[var(--fg-dimmer)]">
                <span>{new Date(r.ts).toLocaleString()}</span>
                <span className="ml-auto px-1.5 py-px rounded-full border text-[9px] uppercase tracking-wider text-amber-300 border-amber-300/30"
                      title="Tagged experimental — allocator reads this as arena evidence, not production outcomes.">
                  experimental
                </span>
              </div>
              <div className="text-[12px] mt-1 line-clamp-2">{r.prompt}</div>
              <div className="mt-2 space-y-1">
                {r.lanes.map((l) => (
                  <div key={l.builderId} className="flex items-center gap-2 text-[11px]">
                    {r.winner === l.builderId && <Crown size={11} className="text-[#fbbf24] shrink-0" />}
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-[var(--fg-dimmer)]">{(l.durationMs / 1000).toFixed(1)}s</span>
                    <span style={{ color: l.error || l.exitCode !== 0 ? "#fb7185" : "#86efac" }}>
                      {l.error ? "failed" : l.timedOut ? "timed out" : `exit ${l.exitCode}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
