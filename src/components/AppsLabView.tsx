"use client";

// App Lab — browse + run apps from awesome-llm-apps, all on free cloud
// models (no local models). Card grid → run → live iframe preview.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FlaskConical, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

const ACCENT = "#a3e635";

interface LabApp {
  slug: string; title: string; desc: string; dir: string; file: string;
  port: number; model: string; adapted: boolean; running: boolean;
}

export default function AppsLabView() {
  const [apps, setApps] = useState<LabApp[]>([]);
  const [keyPresent, setKeyPresent] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch("/api/appslab/catalog", { cache: "no-store" })).json();
      setApps(j.apps ?? []);
      setKeyPresent(!!j.keyPresent);
    } catch { /* ignore */ }
  }, []);
  usePollWhileVisible(load, 8000);
  useEffect(() => { load(); }, [load]);

  async function run(slug: string) {
    setBusy(slug);
    try {
      await fetch("/api/appslab/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      await load();
      setActive(slug);
      setFrameKey((k) => k + 1);
    } finally { setBusy(null); }
  }
  async function stop(slug: string) {
    setBusy(slug);
    try {
      await fetch("/api/appslab/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      await load();
      if (active === slug) setActive(null);
    } finally { setBusy(null); }
  }

  const activeApp = apps.find((a) => a.slug === active);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-3" style={{ height: "min(76vh, 860px)" }}>
      {/* Catalog */}
      <div className="panel p-2 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5">
            <FlaskConical size={12} /> App Lab · awesome-llm-apps
          </div>
          <button onClick={load} title="Refresh" className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
        </div>
        {!keyPresent && (
          <div className="mx-2 mb-2 rounded-md border px-2.5 py-2 text-[11px]" style={{ borderColor: "#f8717166", color: "#f87171" }}>
            OPENROUTER_API_KEY not found — apps will show a key error when run.
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-2 px-1">
          {apps.map((a) => (
            <div key={a.slug} className="rounded-lg border p-2.5 transition"
              style={{ borderColor: active === a.slug ? `${ACCENT}66` : "var(--line-soft)", background: active === a.slug ? `${ACCENT}0d` : "transparent" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12.5px] font-semibold text-[var(--cream)]">{a.title}</div>
                <span className="text-[9px] mono px-1.5 py-0.5 rounded-full border"
                  style={{ borderColor: a.running ? `${ACCENT}88` : "var(--line-soft)", color: a.running ? ACCENT : "var(--cream-mute)" }}>
                  {a.running ? "● running" : "stopped"}
                </span>
              </div>
              <div className="text-[10.5px] text-[var(--cream-dim)] mt-1 leading-relaxed">{a.desc}</div>
              <div className="text-[9px] mono text-[var(--cream-mute)] mt-1.5 truncate" title={a.model}>⚡ {a.model} · $0</div>
              <div className="flex items-center gap-1.5 mt-2">
                {!a.running ? (
                  <button onClick={() => run(a.slug)} disabled={busy === a.slug}
                    className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1 rounded-md"
                    style={{ background: ACCENT, color: "#141a06" }}>
                    {busy === a.slug ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run
                  </button>
                ) : (
                  <>
                    <button onClick={() => { setActive(a.slug); setFrameKey((k) => k + 1); }}
                      className="text-[10.5px] font-semibold px-2.5 py-1 rounded-md border" style={{ borderColor: `${ACCENT}66`, color: ACCENT }}>
                      Preview
                    </button>
                    <a href={`http://localhost:${a.port}`} target="_blank" rel="noopener noreferrer"
                      className="text-[10.5px] px-2 py-1 rounded-md border flex items-center gap-1" style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}>
                      <ExternalLink size={10} /> tab
                    </a>
                    <button onClick={() => stop(a.slug)} disabled={busy === a.slug}
                      className="text-[10.5px] px-2 py-1 rounded-md border flex items-center gap-1" style={{ borderColor: "var(--line-soft)", color: "var(--cream-mute)" }}>
                      {busy === a.slug ? <Loader2 size={11} className="animate-spin" /> : <Square size={10} />} Stop
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          <div className="px-2 py-2 text-[10px] text-[var(--cream-mute)] leading-relaxed">
            100+ more apps in the repo (~/Developer/awesome-llm-apps) — ask Claude to adapt any of them to free cloud models and add them here.
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="panel p-0 flex flex-col min-h-0 overflow-hidden">
        {!activeApp?.running ? (
          <div className="flex-1 grid place-items-center text-center p-6">
            <div>
              <FlaskConical size={22} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-60" />
              <div className="text-[12.5px] text-[var(--cream)] mb-1">Run an app, then preview it here</div>
              <div className="text-[11px] text-[var(--cream-mute)]">Every app runs on OpenRouter free models — $0 per use, no local models</div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[12px] text-[var(--cream)] mono">{activeApp.title} · :{activeApp.port}</div>
              <a href={`http://localhost:${activeApp.port}`} target="_blank" rel="noopener noreferrer"
                className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={13} /></a>
            </div>
            <iframe key={frameKey} src={`http://localhost:${activeApp.port}/?embed=true`}
              className="flex-1 w-full border-0 bg-white" title={activeApp.title} />
          </>
        )}
      </div>
    </div>
  );
}
