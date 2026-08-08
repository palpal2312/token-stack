"use client";

// Video Editor — upload a video, tell the agent what you want, get edit/final.mp4.
// Backed by the browser-use/video-use skill running inside Claude Code
// (spawned per job dir by /api/videouse/run).

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2, Play, RefreshCw, Scissors, Upload } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

const ACCENT = "#f59e0b";

interface Job { name: string; mtime: number; sources: string[]; hasFinal: boolean; running: boolean; }
interface Output { rel: string; bytes: number; mtime: number; }

const PRESETS: Array<{ label: string; text: string }> = [
  { label: "Tighten + captions", text: "Remove dead air, long pauses, umms and false starts. Burn bold 2-word captions. Keep everything else untouched." },
  { label: "Rough cut → polished", text: "Cut filler and retakes, keep the best take of each line, light auto colour grade, burn captions, normalise loudness for social." },
  { label: "60s highlight", text: "Cut this down to the strongest ~60 seconds that still tells one clear story. Burn captions. Punchy pacing." },
  { label: "Captions only", text: "Don't cut anything — just burn clean bold captions over the whole video." },
];

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function VideoUseView() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [instruction, setInstruction] = useState(PRESETS[0].text);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [summary, setSummary] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const loadJobs = useCallback(async () => {
    try {
      const j = await (await fetch("/api/videouse/jobs", { cache: "no-store" })).json();
      setJobs(j.jobs ?? []);
    } catch { /* ignore */ }
  }, []);
  usePollWhileVisible(loadJobs, 8000);

  const loadStatus = useCallback(async () => {
    if (!active) return;
    try {
      const j = await (await fetch(`/api/videouse/status?job=${encodeURIComponent(active)}`, { cache: "no-store" })).json();
      setRunning(!!j.running);
      setLog(j.log ?? []);
      setOutputs(j.outputs ?? []);
      setSummary(j.summary ?? "");
    } catch { /* ignore */ }
  }, [active]);
  usePollWhileVisible(loadStatus, 3000);
  useEffect(() => { loadStatus(); }, [active, loadStatus]);
  useEffect(() => { logRef.current?.scrollTo({ top: 999999 }); }, [log]);

  async function upload(f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("video", f);
      const j = await (await fetch("/api/videouse/jobs", { method: "POST", body: fd })).json();
      if (j.job) { await loadJobs(); setActive(j.job); }
    } finally { setUploading(false); }
  }

  async function run() {
    if (!active || !instruction.trim()) return;
    setStarting(true);
    try {
      await fetch("/api/videouse/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: active, instruction }),
      });
      setRunning(true);
      await loadStatus();
    } finally { setStarting(false); }
  }

  const fileUrl = (rel: string) => active ? `/api/videouse/file?job=${encodeURIComponent(active)}&path=${encodeURIComponent(rel)}` : "#";
  const activeJob = jobs.find((j) => j.name === active);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr_1fr] gap-3" style={{ height: "min(76vh, 860px)" }}>
      {/* Jobs */}
      <div className="panel p-2 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5">
            <Clapperboard size={12} /> Edit jobs
          </div>
          <button onClick={loadJobs} title="Refresh" className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
        </div>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="mx-2 mb-2 flex items-center justify-center gap-2 rounded-md border py-2 text-[12px] font-semibold transition"
          style={{ borderColor: `${ACCENT}66`, color: ACCENT, background: `${ACCENT}0d` }}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {uploading ? "Uploading…" : "Upload video"}
        </button>
        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
          {jobs.length === 0 && <div className="px-2 py-3 text-[11px] text-[var(--cream-mute)]">No jobs yet — upload a video to start.</div>}
          {jobs.map((j) => (
            <button key={j.name} onClick={() => setActive(j.name)}
              className="block w-full text-left px-2.5 py-2 rounded-md border transition"
              style={{ borderColor: active === j.name ? `${ACCENT}66` : "var(--line-soft)", background: active === j.name ? `${ACCENT}12` : "transparent" }}>
              <div className="text-[12px] text-[var(--cream)] truncate font-medium">{j.name}</div>
              <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">
                {j.running ? "● editing…" : j.hasFinal ? "✓ final ready" : `${j.sources.length} source${j.sources.length === 1 ? "" : "s"}`}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Brief + log */}
      <div className="panel p-3 flex flex-col min-h-0">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-2 flex items-center gap-1.5">
          <Scissors size={12} /> Edit brief {activeJob && <span className="normal-case tracking-normal">· {activeJob.sources[0] ?? ""}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => setInstruction(p.text)}
              className="text-[10.5px] px-2 py-1 rounded-full border transition"
              style={{ borderColor: instruction === p.text ? ACCENT : "var(--line-soft)", color: instruction === p.text ? ACCENT : "var(--cream-dim)" }}>
              {p.label}
            </button>
          ))}
        </div>
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4}
          placeholder="Tell the editor what you want…"
          className="w-full rounded-md border bg-transparent p-2 text-[12.5px] text-[var(--cream)] resize-none"
          style={{ borderColor: "var(--line-soft)" }} />
        <button onClick={run} disabled={!active || running || starting || !instruction.trim()}
          className="mt-2 flex items-center justify-center gap-2 rounded-md py-2 text-[13px] font-bold transition disabled:opacity-40"
          style={{ background: ACCENT, color: "#1a1206" }}>
          {running || starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? "Editing… (safe to leave this page)" : starting ? "Starting…" : "Edit this video"}
        </button>
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mt-3 mb-1">Agent log</div>
        <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto scroll rounded-md border p-2 space-y-1.5" style={{ borderColor: "var(--line-soft)", background: "#0a070d" }}>
          {log.length === 0 && <div className="text-[11px] text-[var(--cream-mute)]">The editor narrates its work here once you hit run.</div>}
          {log.map((l, i) => (
            <div key={i} className="text-[11px] leading-relaxed" style={{ color: l.startsWith("⚙") ? "var(--cream-mute)" : l.startsWith("✓") ? "#34d399" : l.startsWith("✕") ? "#f87171" : "var(--cream)" }}>{l}</div>
          ))}
        </div>
      </div>

      {/* Outputs */}
      <div className="panel p-3 flex flex-col min-h-0">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-2">Output</div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-3">
          {outputs.length === 0 && (
            <div className="text-[11.5px] text-[var(--cream-mute)] p-3">
              Finished videos land here as <span className="mono">edit/final.mp4</span> — playable inline, with a download link.
            </div>
          )}
          {outputs.sort((a, b) => b.mtime - a.mtime).map((o) => (
            <div key={o.rel} className="rounded-md border overflow-hidden" style={{ borderColor: o.rel.endsWith("final.mp4") ? `${ACCENT}66` : "var(--line-soft)" }}>
              <video src={fileUrl(o.rel)} controls preload="metadata" className="w-full bg-black" style={{ maxHeight: 260 }} />
              <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px]">
                <span className="mono text-[var(--cream)]">{o.rel} · {fmtBytes(o.bytes)}</span>
                <a href={fileUrl(o.rel)} download className="font-semibold" style={{ color: ACCENT }}>download</a>
              </div>
            </div>
          ))}
          {summary && (
            <div className="rounded-md border p-2.5" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)] font-semibold mb-1">What the editor did</div>
              <pre className="text-[10.5px] text-[var(--cream-dim)] whitespace-pre-wrap leading-relaxed">{summary}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
