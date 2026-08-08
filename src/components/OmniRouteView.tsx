"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Check, Copy, ExternalLink, Zap, Shield, Infinity as InfinityIcon, Boxes, Send, Loader2, ChevronDown, ChevronRight, Play, Download, Code2, Eye, Sparkles, Wand2, Save, FolderOpen, Plus, FileCode, MessageSquare } from "lucide-react";

const ACCENT = "#2dd4bf";
const ACCENT2 = "#a78bfa";
const GH = "https://github.com/diegosouzapw/OmniRoute";
const LS_MSGS = "omniroute.msgs";
const LS_SID = "omniroute.sid";

interface Status { running: boolean; base: string; api: string; dashboard: string; models: number | null }
interface Msg { role: "user" | "assistant"; content: string; model?: string }
interface SavedBuild { file: string; title: string; when: string }
interface SavedSession { id: string; title: string; count: number; when: string }

function extractCode(msgs: Msg[]): { lang: string; code: string } | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "assistant") continue;
    const blocks = [...msgs[i].content.matchAll(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g)];
    if (!blocks.length) continue;
    const htmlish = blocks.find((b) => /html|xml|svg/i.test(b[1]) || /<html|<!doctype|<body|<div|<svg|<canvas|<button|<style/i.test(b[2]));
    const pick = htmlish || blocks.slice().sort((a, b) => b[2].length - a[2].length)[0];
    return { lang: (pick[1] || "").toLowerCase(), code: pick[2].trim() };
  }
  return null;
}
function isHtmlish(c: { lang: string; code: string } | null) {
  if (!c) return false;
  return /html|xml|svg/.test(c.lang) || /<html|<!doctype|<body|<div|<svg|<canvas|<button|<style|<h1|<p>/i.test(c.code);
}
function toDoc(code: string) {
  if (/<!doctype|<html/i.test(code)) return code;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:18px;font-family:system-ui,sans-serif;background:#0b0b12;color:#eee}</style></head><body>${code}</body></html>`;
}

function Rendered({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("```")) {
          const code = p.replace(/^```[a-zA-Z0-9+#-]*\n?/, "").replace(/```$/, "");
          return <pre key={i} className="mono text-[11.5px] rounded-md p-2.5 my-1 overflow-x-auto" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid var(--panel-border)", color: "#a7f3d0" }}>{code}</pre>;
        }
        return <span key={i} className="whitespace-pre-wrap">{p}</span>;
      })}
    </>
  );
}

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-2 mono text-[12px]" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
      <span className="flex-1 overflow-x-auto whitespace-nowrap">{children}</span>
      <button onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="shrink-0 opacity-70 hover:opacity-100" title="Copy">
        {copied ? <Check size={13} color={ACCENT} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export default function OmniRouteView() {
  const [st, setSt] = useState<Status | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<{ builds: SavedBuild[]; sessions: SavedSession[] }>({ builds: [], sessions: [] });
  const [savedFlash, setSavedFlash] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidRef = useRef<string>("");

  // hydrate conversation from localStorage (survives refresh)
  useEffect(() => {
    try {
      sidRef.current = localStorage.getItem(LS_SID) || `s-${Date.now()}`;
      localStorage.setItem(LS_SID, sidRef.current);
      const raw = localStorage.getItem(LS_MSGS);
      if (raw) setMsgs(JSON.parse(raw));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  const refreshSaved = useCallback(() => {
    fetch("/api/omniroute/workspace", { cache: "no-store" }).then((r) => r.json()).then((j) => setSaved({ builds: j.builds || [], sessions: j.sessions || [] })).catch(() => {});
  }, []);

  useEffect(() => {
    const ping = () => fetch("/api/omniroute/status", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => setSt(null));
    ping(); refreshSaved();
    const id = setInterval(ping, 6000);
    return () => clearInterval(id);
  }, [refreshSaved]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);

  // persist conversation to localStorage + disk whenever it changes
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(LS_MSGS, JSON.stringify(msgs)); } catch { /* ignore */ }
    if (!msgs.length) return;
    const title = (msgs[0]?.content || "Session").slice(0, 60);
    const t = setTimeout(() => {
      fetch("/api/omniroute/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveSession", id: sidRef.current, title, messages: msgs }) }).then(refreshSaved).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [msgs, hydrated, refreshSaved]);

  const running = !!st?.running;
  const code = useMemo(() => extractCode(msgs), [msgs]);
  const htmlish = isHtmlish(code);
  useEffect(() => { if (code) setTab(isHtmlish(code) ? "preview" : "code"); }, [code]);

  async function send(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setErr(null);
    const next = [...msgs, { role: "user" as const, content: t }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/omniroute/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }) });
      const j = await r.json();
      if (j.error) setErr(j.error);
      else setMsgs((m) => [...m, { role: "assistant", content: j.content, model: j.model }]);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  function download() {
    if (!code) return;
    const ext = htmlish ? "html" : (code.lang || "txt");
    const blob = new Blob([code.code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `omniroute-build.${ext}`; a.click();
    URL.revokeObjectURL(a.href);
  }
  async function saveBuild() {
    if (!code) return;
    const title = (msgs.find((m) => m.role === "user")?.content || "build").slice(0, 48);
    await fetch("/api/omniroute/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveBuild", code: htmlish ? toDoc(code.code) : code.code, title }) }).catch(() => {});
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400);
    refreshSaved();
  }
  function newSession() {
    setMsgs([]); setErr(null);
    sidRef.current = `s-${Date.now()}`;
    try { localStorage.setItem(LS_SID, sidRef.current); localStorage.removeItem(LS_MSGS); } catch { /* ignore */ }
  }
  async function loadSession(id: string) {
    const j = await fetch(`/api/omniroute/workspace?session=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (j?.messages) { setMsgs(j.messages); sidRef.current = id; try { localStorage.setItem(LS_SID, id); } catch { /* ignore */ } }
  }

  const SUGGESTIONS = ["Build a glowing neon button in HTML", "An animated starfield on a canvas", "A pricing card with a hover glow", "A bouncing DVD-logo screensaver"];

  return (
    <div className="space-y-4 max-w-[1180px]">
      <style>{`
        @keyframes orAurora{0%{transform:translate(-8%,-6%) scale(1)}50%{transform:translate(8%,6%) scale(1.15)}100%{transform:translate(-8%,-6%) scale(1)}}
        @keyframes orPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes orGlow{0%,100%{box-shadow:0 0 0 0 rgba(45,212,191,.0)}50%{box-shadow:0 0 22px 2px rgba(45,212,191,.35)}}
        .or-chip:hover{border-color:${ACCENT}66;color:var(--cream);transform:translateY(-1px)}
        .or-save:hover{border-color:${ACCENT}88}
      `}</style>

      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border p-5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="pointer-events-none absolute -inset-24 opacity-60" style={{ background: `radial-gradient(closest-side, ${ACCENT}22, transparent 70%)`, animation: "orAurora 14s ease-in-out infinite" }} />
        <div className="pointer-events-none absolute -inset-24 opacity-50" style={{ background: `radial-gradient(closest-side, ${ACCENT2}22, transparent 70%)`, animation: "orAurora 18s ease-in-out infinite reverse" }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-11 h-11 rounded-xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, color: "#0a1a17", boxShadow: `0 8px 26px ${ACCENT}44` }}><Route size={22} /></div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5" style={{ color: ACCENT }}><Sparkles size={11} /> Free Coder · Live Gateway</div>
              <div className="text-[19px] font-semibold text-[var(--cream)] leading-tight">OmniRoute</div>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-full" style={{ background: running ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.05)", color: running ? ACCENT : "var(--cream-mute)", border: `1px solid ${running ? ACCENT + "55" : "var(--line-soft)"}`, animation: running ? "orGlow 3s ease-in-out infinite" : "none" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: running ? ACCENT : "#6b7280", animation: running ? "orPulse 1.6s ease-in-out infinite" : "none" }} />
              {running ? `Gateway live${st?.models != null ? ` · ${st.models} models` : ""}` : "Gateway offline — see setup"}
            </div>
          </div>
          <p className="text-[13px] text-[var(--cream-soft)] mt-3 leading-relaxed max-w-[640px]">
            Type a prompt. Watch it build — <b className="text-[var(--cream)]">live, on the right, for free</b>. Everything is saved to your workspace — builds and chat history both survive a refresh.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {[{ i: <InfinityIcon size={12} />, t: "90+ free providers" }, { i: <Zap size={12} />, t: "15–95% token savings" }, { i: <Boxes size={12} />, t: "auto-fallback" }, { i: <Shield size={12} />, t: "local & private" }].map((c, k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line-soft)", color: "var(--cream-mute)" }}>{c.i}{c.t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* WORKSPACE */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.15fr)" }}>
        {/* LEFT: chat */}
        <div className="rounded-2xl border flex flex-col overflow-hidden" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)", height: "540px" }}>
          <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
            <Wand2 size={13} color={ACCENT} />
            <span className="text-[11px] uppercase tracking-widest text-[var(--cream-mute)]">Prompt</span>
            <button onClick={newSession} className="ml-auto flex items-center gap-1 text-[11px] px-2 py-1 rounded-md or-save" style={{ border: "1px solid var(--line-soft)", color: "var(--cream-mute)" }} title="Start a fresh session"><Plus size={12} /> New</button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll p-4 space-y-3">
            {msgs.length === 0 && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <div className="grid place-items-center w-12 h-12 rounded-2xl mx-auto mb-3" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, color: "#0a1a17", animation: "orGlow 3s ease-in-out infinite" }}><Sparkles size={22} /></div>
                  <div className="text-[14px] text-[var(--cream)] font-medium">Describe something. Build it free.</div>
                  <div className="text-[11px] text-[var(--cream-mute)] mt-1">It previews live on the right →</div>
                  <div className="flex flex-wrap gap-1.5 justify-center mt-4 max-w-[300px]">
                    {SUGGESTIONS.map((q) => (
                      <button key={q} onClick={() => send(q)} disabled={!running} className="or-chip text-[11px] px-2.5 py-1.5 rounded-full transition" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line-soft)", color: "var(--cream-mute)", opacity: running ? 1 : 0.5 }}>{q}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className="max-w-[88%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed" style={m.role === "user" ? { background: `${ACCENT}18`, border: `1px solid ${ACCENT}44`, color: "var(--cream)" } : { background: "rgba(0,0,0,0.28)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
                  {m.role === "assistant" && m.model && <div className="text-[10px] mono mb-1 inline-flex items-center gap-1" style={{ color: ACCENT }}><Zap size={10} /> via {m.model} · free</div>}
                  <Rendered text={m.content} />
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: ACCENT }}>
                <span className="inline-flex items-center gap-1">{[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT, animation: `orPulse 1s ease-in-out ${d * 0.2}s infinite` }} />)}</span>
                routing through free providers…
              </div>
            )}
            {err && <div className="text-[11.5px]" style={{ color: "var(--plum, #c4607e)" }} title={err}>{err}</div>}
          </div>
          <div className="p-3 border-t flex items-end gap-2" style={{ borderColor: "var(--line-soft)" }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={running ? "Ask OmniRoute to build something…" : "Start OmniRoute first (setup below)"} disabled={!running} className="flex-1 resize-none p-2.5 rounded-lg text-[13px]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)", opacity: running ? 1 : 0.6 }} />
            <button onClick={() => send()} disabled={busy || !running || !input.trim()} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-semibold" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, color: "#0a1a17", opacity: busy || !running || !input.trim() ? 0.5 : 1 }}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Build
            </button>
          </div>
        </div>

        {/* RIGHT: live workspace */}
        <div className="rounded-2xl border flex flex-col overflow-hidden" style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.22)", height: "540px" }}>
          <div className="px-3 py-2 border-b flex items-center gap-1.5" style={{ borderColor: "var(--line-soft)" }}>
            <button onClick={() => setTab("preview")} disabled={!htmlish} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium transition" style={{ background: tab === "preview" ? `${ACCENT}1f` : "transparent", color: tab === "preview" ? ACCENT : "var(--cream-mute)", opacity: htmlish ? 1 : 0.4 }}><Eye size={13} /> Preview</button>
            <button onClick={() => setTab("code")} disabled={!code} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-medium transition" style={{ background: tab === "code" ? `${ACCENT}1f` : "transparent", color: tab === "code" ? ACCENT : "var(--cream-mute)", opacity: code ? 1 : 0.4 }}><Code2 size={13} /> Code</button>
            <span className="ml-auto flex items-center gap-1">
              {code && <button onClick={saveBuild} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium or-save" style={{ border: `1px solid ${savedFlash ? ACCENT : "var(--line-soft)"}`, color: savedFlash ? ACCENT : "var(--cream)" }} title="Save this build to your workspace">{savedFlash ? <Check size={13} /> : <Save size={13} />}{savedFlash ? "Saved" : "Save build"}</button>}
              {code && <button onClick={() => { navigator.clipboard.writeText(code.code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="p-1.5 rounded-md opacity-70 hover:opacity-100" title="Copy code">{copied ? <Check size={14} color={ACCENT} /> : <Copy size={14} color="var(--cream-mute)" />}</button>}
              {code && <button onClick={download} className="p-1.5 rounded-md opacity-70 hover:opacity-100" title="Download"><Download size={14} color="var(--cream-mute)" /></button>}
            </span>
          </div>
          <div className="flex-1 min-h-0 relative">
            {!code && (
              <div className="h-full grid place-items-center text-center px-6">
                <div>
                  <Play size={26} color="var(--cream-mute)" className="mx-auto mb-2 opacity-50" />
                  <div className="text-[12.5px] text-[var(--cream-mute)]">Your build appears here — live.</div>
                  <div className="text-[11px] text-[var(--cream-mute)] mt-1 opacity-70">Ask for something visual and it renders instantly. Hit Save build to keep it.</div>
                </div>
              </div>
            )}
            {code && tab === "preview" && htmlish && <iframe title="preview" className="w-full h-full" style={{ background: "#0b0b12", border: 0 }} sandbox="allow-scripts allow-same-origin" srcDoc={toDoc(code.code)} />}
            {code && tab === "code" && <pre className="mono text-[11.5px] p-4 w-full h-full overflow-auto" style={{ color: "#a7f3d0" }}>{code.code}</pre>}
          </div>
        </div>
      </div>

      {/* SAVED WORKSPACE */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center gap-2 mb-3"><FolderOpen size={14} color={ACCENT} /><span className="text-[12.5px] font-medium text-[var(--cream)]">Saved builds</span><span className="text-[11px] text-[var(--cream-mute)]">{saved.builds.length}</span></div>
          {saved.builds.length === 0 ? <div className="text-[11.5px] text-[var(--cream-mute)]">Nothing saved yet — build something and hit <b className="text-[var(--cream)]">Save build</b>.</div> : (
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto scroll">
              {saved.builds.map((b) => (
                <a key={b.file} href={`/api/omniroute/workspace?open=${encodeURIComponent(b.file)}`} target="_blank" rel="noopener" className="flex items-center gap-2 px-3 py-2 rounded-lg or-save" style={{ border: "1px solid var(--line-soft)", background: "rgba(255,255,255,0.02)" }}>
                  <FileCode size={13} color={ACCENT} className="shrink-0" />
                  <span className="text-[12px] text-[var(--cream)] truncate flex-1">{b.title || b.file}</span>
                  <span className="text-[10px] mono text-[var(--cream-mute)] shrink-0">{new Date(b.when).toLocaleDateString()}</span>
                  <ExternalLink size={11} color="var(--cream-mute)" className="shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center gap-2 mb-3"><MessageSquare size={14} color={ACCENT2} /><span className="text-[12.5px] font-medium text-[var(--cream)]">Conversation history</span><span className="text-[11px] text-[var(--cream-mute)]">{saved.sessions.length}</span></div>
          {saved.sessions.length === 0 ? <div className="text-[11.5px] text-[var(--cream-mute)]">Your chats auto-save here — they survive a refresh and live in your workspace folder.</div> : (
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto scroll">
              {saved.sessions.map((s) => (
                <button key={s.id} onClick={() => loadSession(s.id)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg or-save text-left" style={{ border: `1px solid ${s.id === sidRef.current ? ACCENT + "55" : "var(--line-soft)"}`, background: "rgba(255,255,255,0.02)" }}>
                  <MessageSquare size={13} color={ACCENT2} className="shrink-0" />
                  <span className="text-[12px] text-[var(--cream)] truncate flex-1">{s.title}</span>
                  <span className="text-[10px] mono text-[var(--cream-mute)] shrink-0">{s.count} msg</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-[var(--cream-mute)] px-1 flex items-center gap-1.5"><Save size={11} /> Saved to <span className="mono">~/.agentic-os/omniroute-workspace/</span> — builds as HTML, chats as JSON + readable transcript.</div>

      {/* setup */}
      <div className="rounded-2xl border" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <button onClick={() => setSetupOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
          {setupOpen ? <ChevronDown size={15} color="var(--cream-mute)" /> : <ChevronRight size={15} color="var(--cream-mute)" />}
          <span className="text-[12.5px] text-[var(--cream)] font-medium">Setup &amp; connect your own IDE (Claude Code, Cursor, Cline)</span>
          {running && st?.dashboard && <a href={st.dashboard} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: ACCENT }}>Open dashboard <ExternalLink size={11} /></a>}
        </button>
        {setupOpen && (
          <div className="px-4 pb-4 space-y-3">
            <div className="space-y-1"><div className="text-[12px] text-[var(--cream)] font-medium">1 · Install &amp; start</div><Cmd>npm install -g omniroute &amp;&amp; omniroute</Cmd></div>
            <div className="space-y-1"><div className="text-[12px] text-[var(--cream)] font-medium">2 · Point Claude Code at it</div><Cmd>export ANTHROPIC_BASE_URL=http://localhost:20128/v1</Cmd></div>
            <div className="space-y-1"><div className="text-[12px] text-[var(--cream)] font-medium">3 · Or any OpenAI tool (Cursor/Cline/Copilot)</div>
              <div className="text-[11px] text-[var(--cream-mute)]">Base URL <span className="mono">http://localhost:20128/v1</span> · model <span className="mono">auto</span> · key from the dashboard. Verify: <span className="mono">curl localhost:20128/v1/models</span></div></div>
            <a href={GH} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: ACCENT }}><ExternalLink size={12} /> OmniRoute on GitHub — open-source, MCP server (95 tools)</a>
          </div>
        )}
      </div>
    </div>
  );
}
