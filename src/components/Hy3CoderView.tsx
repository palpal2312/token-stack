"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Check, Copy, ExternalLink, Zap, Boxes, Send, Loader2, Play, Download, Code2, Eye, Sparkles, Wand2, Save, FolderOpen, Plus, FileCode, MessageSquare, BadgeCheck } from "lucide-react";

const ACCENT = "#3b82f6";   // Hunyuan blue
const ACCENT2 = "#22d3ee";  // cyan
const HF = "https://huggingface.co/tencent";
const OR = "https://openrouter.ai/tencent/hy3";
const LS_MSGS = "hy3coder.msgs";
const LS_SID = "hy3coder.sid";

interface Status { running: boolean; model: string; label: string; provider: string }
interface Msg { role: "user" | "assistant"; content: string; model?: string }
interface SavedBuild { file: string; title: string; when: string }
interface SavedSession { id: string; title: string; count: number; when: string }

function extractCode(msgs: Msg[]): { lang: string; code: string } | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "assistant") continue;
    const blocks = [...msgs[i].content.matchAll(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g)];
    if (!blocks.length) {
      // Hy3 sometimes returns a bare document with no fences
      const m = msgs[i].content.match(/<!doctype html[\s\S]*<\/html>/i) || msgs[i].content.match(/<html[\s\S]*<\/html>/i);
      if (m) return { lang: "html", code: m[0].trim() };
      continue;
    }
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
          return <pre key={i} className="mono text-[11.5px] rounded-md p-2.5 my-1 overflow-x-auto" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid var(--panel-border)", color: "#bae6fd" }}>{code}</pre>;
        }
        return <span key={i} className="whitespace-pre-wrap">{p}</span>;
      })}
    </>
  );
}

export default function Hy3CoderView() {
  const [st, setSt] = useState<Status | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<{ builds: SavedBuild[]; sessions: SavedSession[] }>({ builds: [], sessions: [] });
  const [savedFlash, setSavedFlash] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidRef = useRef<string>("");

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
    fetch("/api/hy3coder/workspace", { cache: "no-store" }).then((r) => r.json()).then((j) => setSaved({ builds: j.builds || [], sessions: j.sessions || [] })).catch(() => {});
  }, []);

  useEffect(() => {
    const ping = () => fetch("/api/hy3coder/status", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => setSt(null));
    ping(); refreshSaved();
    const id = setInterval(ping, 8000);
    return () => clearInterval(id);
  }, [refreshSaved]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(LS_MSGS, JSON.stringify(msgs)); } catch { /* ignore */ }
    if (!msgs.length) return;
    const title = (msgs[0]?.content || "Session").slice(0, 60);
    const t = setTimeout(() => {
      fetch("/api/hy3coder/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveSession", id: sidRef.current, title, messages: msgs }) }).then(refreshSaved).catch(() => {});
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
    // add a live-updating assistant bubble we append streamed tokens into
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/hy3coder/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }) });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "", model: string | undefined, streamErr: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s) continue;
          try {
            const j = JSON.parse(s);
            if (j.error) { streamErr = j.error; continue; }
            if (j.delta) {
              acc += j.delta;
              setMsgs((m) => { const c = [...m]; if (c.length && c[c.length - 1].role === "assistant") c[c.length - 1] = { role: "assistant", content: acc, model }; return c; });
            }
            if (j.done) model = j.model;
          } catch { /* partial line */ }
        }
      }
      if (streamErr) { setErr(streamErr); setMsgs((m) => m.filter((x, i) => !(i === m.length - 1 && x.role === "assistant" && !x.content))); }
      else setMsgs((m) => { const c = [...m]; if (c.length && c[c.length - 1].role === "assistant") c[c.length - 1] = { role: "assistant", content: acc, model }; return c; });
    } catch (e) {
      setErr(String((e as Error).message || e));
      setMsgs((m) => m.filter((x, i) => !(i === m.length - 1 && x.role === "assistant" && !x.content)));
    } finally { setBusy(false); }
  }

  function download() {
    if (!code) return;
    const ext = htmlish ? "html" : (code.lang || "txt");
    const blob = new Blob([code.code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `hy3-build.${ext}`; a.click();
    URL.revokeObjectURL(a.href);
  }
  async function saveBuild() {
    if (!code) return;
    const title = (msgs.find((m) => m.role === "user")?.content || "build").slice(0, 48);
    await fetch("/api/hy3coder/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveBuild", code: htmlish ? toDoc(code.code) : code.code, title }) }).catch(() => {});
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400);
    refreshSaved();
  }
  function newSession() {
    setMsgs([]); setErr(null);
    sidRef.current = `s-${Date.now()}`;
    try { localStorage.setItem(LS_SID, sidRef.current); localStorage.removeItem(LS_MSGS); } catch { /* ignore */ }
  }
  async function loadSession(id: string) {
    const j = await fetch(`/api/hy3coder/workspace?session=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (j?.messages) { setMsgs(j.messages); sidRef.current = id; try { localStorage.setItem(LS_SID, id); } catch { /* ignore */ } }
  }

  const SUGGESTIONS = ["A neon snake game on a canvas", "A rotating 3D solar system with three.js", "A glowing pricing card with hover glow", "An animated starfield with parallax"];

  return (
    <div className="space-y-4 max-w-[1180px]">
      <style>{`
        @keyframes hyAurora{0%{transform:translate(-8%,-6%) scale(1)}50%{transform:translate(8%,6%) scale(1.15)}100%{transform:translate(-8%,-6%) scale(1)}}
        @keyframes hyPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes hyGlow{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,.0)}50%{box-shadow:0 0 22px 2px rgba(59,130,246,.35)}}
        .hy-chip:hover{border-color:${ACCENT}66;color:var(--cream);transform:translateY(-1px)}
        .hy-save:hover{border-color:${ACCENT}88}
      `}</style>

      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border p-5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="pointer-events-none absolute -inset-24 opacity-60" style={{ background: `radial-gradient(closest-side, ${ACCENT}22, transparent 70%)`, animation: "hyAurora 14s ease-in-out infinite" }} />
        <div className="pointer-events-none absolute -inset-24 opacity-50" style={{ background: `radial-gradient(closest-side, ${ACCENT2}22, transparent 70%)`, animation: "hyAurora 18s ease-in-out infinite reverse" }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-11 h-11 rounded-xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, color: "#04121f", boxShadow: `0 8px 26px ${ACCENT}44` }}><Cpu size={22} /></div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5" style={{ color: ACCENT }}><Sparkles size={11} /> Open-Weights Coder · Live</div>
              <div className="text-[19px] font-semibold text-[var(--cream)] leading-tight">Hy3 Coder</div>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-full" style={{ background: running ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.05)", color: running ? ACCENT : "var(--cream-mute)", border: `1px solid ${running ? ACCENT + "55" : "var(--line-soft)"}`, animation: running ? "hyGlow 3s ease-in-out infinite" : "none" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: running ? ACCENT : "#6b7280", animation: running ? "hyPulse 1.6s ease-in-out infinite" : "none" }} />
              {running ? "Hy3 live · via OpenRouter" : "No OpenRouter key — see below"}
            </div>
          </div>
          <p className="text-[13px] text-[var(--cream-soft)] mt-3 leading-relaxed max-w-[660px]">
            Tencent&apos;s <b className="text-[var(--cream)]">Hunyuan 3</b> (Apache-2.0, 262K context) — a cheap, strong open-weights coder. Type a prompt, watch it build <b className="text-[var(--cream)]">live on the right</b>. Builds and chat history both survive a refresh.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {[{ i: <BadgeCheck size={12} />, t: "Apache-2.0 open weights" }, { i: <Zap size={12} />, t: "$0.14 / $0.58 per 1M" }, { i: <Boxes size={12} />, t: "262K context" }, { i: <Cpu size={12} />, t: "beats GLM-5.1 on frontend" }].map((c, k) => (
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
            <button onClick={newSession} className="ml-auto flex items-center gap-1 text-[11px] px-2 py-1 rounded-md hy-save" style={{ border: "1px solid var(--line-soft)", color: "var(--cream-mute)" }} title="Start a fresh session"><Plus size={12} /> New</button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll p-4 space-y-3">
            {msgs.length === 0 && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <div className="grid place-items-center w-12 h-12 rounded-2xl mx-auto mb-3" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, color: "#04121f", animation: "hyGlow 3s ease-in-out infinite" }}><Sparkles size={22} /></div>
                  <div className="text-[14px] text-[var(--cream)] font-medium">Describe something. Hy3 builds it.</div>
                  <div className="text-[11px] text-[var(--cream-mute)] mt-1">It previews live on the right →</div>
                  <div className="flex flex-wrap gap-1.5 justify-center mt-4 max-w-[320px]">
                    {SUGGESTIONS.map((q) => (
                      <button key={q} onClick={() => send(q)} disabled={!running} className="hy-chip text-[11px] px-2.5 py-1.5 rounded-full transition" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--line-soft)", color: "var(--cream-mute)", opacity: running ? 1 : 0.5 }}>{q}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className="max-w-[88%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed" style={m.role === "user" ? { background: `${ACCENT}18`, border: `1px solid ${ACCENT}44`, color: "var(--cream)" } : { background: "rgba(0,0,0,0.28)", border: "1px solid var(--panel-border)", color: "var(--cream)" }}>
                  {m.role === "assistant" && m.model && <div className="text-[10px] mono mb-1 inline-flex items-center gap-1" style={{ color: ACCENT }}><Cpu size={10} /> {m.model}</div>}
                  <Rendered text={m.content} />
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: ACCENT }}>
                <span className="inline-flex items-center gap-1">{[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT, animation: `hyPulse 1s ease-in-out ${d * 0.2}s infinite` }} />)}</span>
                Hy3 is building… {elapsed}s{elapsed > 8 ? " · upstream is slow, hang tight (a full build can take 1–3 min)" : ""}
              </div>
            )}
            {err && <div className="text-[11.5px]" style={{ color: "var(--plum, #c4607e)" }} title={err}>{err}</div>}
          </div>
          <div className="p-3 border-t flex items-end gap-2" style={{ borderColor: "var(--line-soft)" }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={running ? "Ask Hy3 to build something…" : "Add an OpenRouter key to enable Hy3"} disabled={!running} className="flex-1 resize-none p-2.5 rounded-lg text-[13px]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--panel-border)", color: "var(--cream)", opacity: running ? 1 : 0.6 }} />
            <button onClick={() => send()} disabled={busy || !running || !input.trim()} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-semibold" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, color: "#04121f", opacity: busy || !running || !input.trim() ? 0.5 : 1 }}>
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
              {code && <button onClick={saveBuild} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium hy-save" style={{ border: `1px solid ${savedFlash ? ACCENT : "var(--line-soft)"}`, color: savedFlash ? ACCENT : "var(--cream)" }} title="Save this build to your workspace">{savedFlash ? <Check size={13} /> : <Save size={13} />}{savedFlash ? "Saved" : "Save build"}</button>}
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
            {code && tab === "code" && <pre className="mono text-[11.5px] p-4 w-full h-full overflow-auto" style={{ color: "#bae6fd" }}>{code.code}</pre>}
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
                <a key={b.file} href={`/api/hy3coder/workspace?open=${encodeURIComponent(b.file)}`} target="_blank" rel="noopener" className="flex items-center gap-2 px-3 py-2 rounded-lg hy-save" style={{ border: "1px solid var(--line-soft)", background: "rgba(255,255,255,0.02)" }}>
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
                <button key={s.id} onClick={() => loadSession(s.id)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hy-save text-left" style={{ border: `1px solid ${s.id === sidRef.current ? ACCENT + "55" : "var(--line-soft)"}`, background: "rgba(255,255,255,0.02)" }}>
                  <MessageSquare size={13} color={ACCENT2} className="shrink-0" />
                  <span className="text-[12px] text-[var(--cream)] truncate flex-1">{s.title}</span>
                  <span className="text-[10px] mono text-[var(--cream-mute)] shrink-0">{s.count} msg</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-[var(--cream-mute)] px-1 flex items-center gap-1.5"><Save size={11} /> Saved to <span className="mono">~/.agentic-os/hy3-coder-workspace/</span> — builds as HTML, chats as JSON + readable transcript.</div>

      {/* about */}
      <div className="rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <span className="text-[12px] text-[var(--cream-soft)]">Hy3 is <b className="text-[var(--cream)]">Tencent Hunyuan 3</b> — Apache-2.0 open weights, run here through your OpenRouter key. No local install.</span>
        <a href={OR} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: ACCENT }}><ExternalLink size={12} /> OpenRouter</a>
        <a href={HF} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: ACCENT }}><ExternalLink size={12} /> Hugging Face</a>
      </div>
    </div>
  );
}
