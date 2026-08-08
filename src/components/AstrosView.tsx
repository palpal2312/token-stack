"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ArrowUpRight, Copy, Check, X, Star, MonitorPlay, Clapperboard, NotebookPen, Globe, Settings2, Plus, Trash2, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";

// the WebGL star map is client-only (uses window / three.js)
const AstrosSky = dynamic(() => import("./AstrosSky"), { ssr: false });

// HERMES ASTROS — a living deep-space observatory, NOT another HUD. A full-bleed
// three.js star map where every hot topic is a real clickable star in a
// constellation, with holographic "star dossier" cards below. Scans competitor
// channels + niche keywords on YouTube 24/7 and writes your titles.

interface AstroTopic {
  topic: string; why_hot: string; heat: number; category: string;
  competitor: { channel: string; video_title: string; url: string; views: string; age: string };
  titles: string[]; seo_keyword: string; angles: string[]; hook: string; format: string;
}
interface DayEntry { day: string; scannedAt: string | null; count: number; topics: AstroTopic[] }
interface WatchConfig { channels: { id: string; title: string }[]; keywords: string[]; engine: string }

const CAT_COLOR: Record<string, string> = {
  Models: "#4deeff", Agents: "#50f2a8", Tools: "#b18cff", SEO: "#c8f25a", Drama: "#ff6d8a", Money: "#ffd86b",
};
const catColor = (c: string) => CAT_COLOR[c] || "#b18cff";

const SWEEP_STATUS = [
  "OPENING THE DOME…", "READING COMPETITOR ORBITS…", "SWEEPING THE KEYWORD BELT…",
  "MEASURING VIEW VELOCITY…", "CHARTING NEW STARS…", "FORGING YOUR TITLES…",
];

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (isNaN(s)) return "—";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function dayLabel(d: string): string {
  const dt = new Date(d + "T12:00:00");
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function AstrosView() {
  const [live, setLive] = useState<AstroTopic[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>("");
  const [history, setHistory] = useState<DayEntry[]>([]);
  const [viewDay, setViewDay] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [watch, setWatch] = useState<WatchConfig | null>(null);
  const [showWatch, setShowWatch] = useState(false);
  const [kwInput, setKwInput] = useState("");
  const [nbState, setNbState] = useState<Record<string, { busy?: boolean; url?: string; error?: string }>>({});
  const [pubState, setPubState] = useState<Record<string, { busy?: boolean; phase?: string; results?: { site: string; url: string }[]; error?: string }>>({});
  const [openIdx, setOpenIdx] = useState<number | null>(null); // one dossier open at a time — keeps the deck calm
  const cardsRef = useRef<HTMLDivElement>(null);
  const scannedAtRef = useRef<string | null>(null);

  const topics = viewDay ? (history.find((h) => h.day === viewDay)?.topics || []) : live;

  const loadHistory = useCallback(() => {
    fetch("/api/astros/history").then((r) => r.json()).then((d) => setHistory(d.days || [])).catch(() => {});
  }, []);
  const loadWatch = useCallback(() => {
    fetch("/api/astros/config").then((r) => r.json()).then((d) => { if (d.ok) setWatch({ channels: d.channels || [], keywords: d.keywords || [], engine: d.engine || "" }); }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/astros/latest").then((r) => r.json())
      .then((d) => { if (!alive) return; setLive(d.topics || []); setScannedAt(d.scannedAt || null); setEngine(d.engine || ""); })
      .catch(() => {}).finally(() => { if (alive) setBooting(false); });
    loadHistory(); loadWatch();
    return () => { alive = false; };
  }, [loadHistory, loadWatch]);

  useEffect(() => {
    if (!sweeping) return;
    const i = setInterval(() => setStatusIdx((n) => (n + 1) % SWEEP_STATUS.length), 3600);
    return () => clearInterval(i);
  }, [sweeping]);

  useEffect(() => { scannedAtRef.current = scannedAt; }, [scannedAt]);

  const pollUntilDone = useCallback(() => {
    const deadline = Date.now() + 540_000;
    const poll = async () => {
      if (Date.now() > deadline) { setErr("Astros took too long — try again."); setSweeping(false); return; }
      try {
        const s = await (await fetch("/api/astros/scan", { cache: "no-store" })).json();
        if (s.running) { setTimeout(poll, 5000); return; }
        if (s.error) { setErr(s.error); setSweeping(false); return; }
        const lat = await (await fetch("/api/astros/latest", { cache: "no-store" })).json();
        if (lat.ok && lat.scannedAt && lat.scannedAt !== scannedAtRef.current) {
          setLive(lat.topics || []); setScannedAt(lat.scannedAt); setEngine(lat.engine || ""); setActive(null); setOpenIdx(null);
          loadHistory(); loadWatch(); setSweeping(false);
        } else { setTimeout(poll, 4000); }
      } catch { setTimeout(poll, 6000); }
    };
    setTimeout(poll, 2000);
  }, [loadHistory, loadWatch]);

  // resume a server-side sweep already in flight
  useEffect(() => {
    let alive = true;
    fetch("/api/astros/scan", { cache: "no-store" }).then((r) => r.json()).then((s) => {
      if (alive && s?.running) { setSweeping(true); setStatusIdx(0); pollUntilDone(); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [pollUntilDone]);

  const sweep = useCallback(async () => {
    if (sweeping) return;
    setSweeping(true); setErr(null); setStatusIdx(0); setViewDay(null);
    try {
      const r = await fetch("/api/astros/scan", { method: "POST" });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Couldn't start the scan."); setSweeping(false); return; }
      pollUntilDone();
    } catch (e) { setErr(String((e as Error)?.message || e)); setSweeping(false); }
  }, [sweeping, pollUntilDone]);

  // ---- handoffs ----
  const videoLink = (t: AstroTopic) => {
    const topic = `${t.titles[0] || t.topic} — ${t.angles[0] || t.why_hot}${t.hook ? ` Open with: "${t.hook}"` : ""}`;
    return `/video?topic=${encodeURIComponent(topic.slice(0, 1200))}`;
  };
  const toNotebook = useCallback(async (key: string, t: AstroTopic) => {
    if (nbState[key]?.busy) return;
    setNbState((m) => ({ ...m, [key]: { busy: true } }));
    try {
      const r = await fetch("/api/astros/notebook", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: t.topic, urls: [t.competitor.url].filter(Boolean) }) });
      const d = await r.json();
      setNbState((m) => ({ ...m, [key]: d.ok ? { url: d.url } : { error: d.error || "NotebookLM handoff failed." } }));
      if (d.ok && d.url) window.open(d.url, "_blank", "noopener");
    } catch (e) { setNbState((m) => ({ ...m, [key]: { error: String((e as Error)?.message || e) } })); }
  }, [nbState]);

  const toSeo = useCallback(async (key: string, t: AstroTopic) => {
    if (pubState[key]?.busy) return;
    setPubState((m) => ({ ...m, [key]: { busy: true, phase: "Starting…" } }));
    try {
      const r = await fetch("/api/radar/publish", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ headline: t.titles[0] || t.topic, why_now: t.why_hot, angle: `${t.angles[0] || ""} Target keyword: ${t.seo_keyword}`.trim(), hook: t.hook, url: t.competitor.url, sites: "all", status: "publish" }) });
      const d = await r.json();
      if (!d.ok) { setPubState((m) => ({ ...m, [key]: { error: d.error || "Couldn't start publishing." } })); return; }
      const deadline = Date.now() + 460_000;
      const poll = async () => {
        if (Date.now() > deadline) { setPubState((m) => ({ ...m, [key]: { error: "Took too long — check WordPress." } })); return; }
        try {
          const st = await (await fetch("/api/radar/publish", { cache: "no-store" })).json();
          if (st.running) { setPubState((m) => ({ ...m, [key]: { busy: true, phase: st.phase || "Writing…" } })); setTimeout(poll, 3500); return; }
          setPubState((m) => ({ ...m, [key]: { results: st.results || [], error: (!st.results || !st.results.length) ? (st.error || "Publishing failed.") : undefined } }));
        } catch { setTimeout(poll, 5000); }
      };
      setTimeout(poll, 4000);
    } catch (e) { setPubState((m) => ({ ...m, [key]: { error: String((e as Error)?.message || e) } })); }
  }, [pubState]);

  const copyText = (key: string, txt: string) => {
    navigator.clipboard?.writeText(txt).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  };
  const focusTopic = useCallback((i: number) => {
    setActive(i);
    setOpenIdx(i); // clicking a star opens its dossier
    setTimeout(() => cardsRef.current?.querySelector(`[data-top="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }, []);

  const saveWatch = useCallback(async (next: { channels?: { id: string; title: string }[]; keywords?: string[] }) => {
    try {
      const r = await fetch("/api/astros/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const d = await r.json();
      if (d.ok) setWatch({ channels: d.channels || [], keywords: d.keywords || [], engine: d.engine || "" });
    } catch { /* no-op */ }
  }, []);

  const kf = (i: number) => (viewDay || "live") + ":" + i;
  const engineLabel = engine === "google-oauth" ? "GOOGLE API · OAUTH" : engine === "api-key" ? "GOOGLE API · KEY" : engine ? "DEEP-FIELD SCAN · KEYLESS" : "";

  return (
    <div className="asx">
      <style>{`
        .asx{ --void:#050310; --panel:#0b0718; --panel2:#120c22; --cy:#4deeff; --mg:#ff4dd8; --gd:#ffd86b; --ink:#eef0ff; --dim:#8b86ad; --mute:#565073; }
        .asx{ color:var(--ink); font-family:'Manrope',system-ui,sans-serif; }

        /* ══ THE DOME — full-bleed living star map (nebula = CSS cover, NEVER black bars) ══ */
        .asx-dome{ position:relative; height:480px; border-radius:22px; overflow:hidden;
          background:url('/astros/nebula.png') center/cover no-repeat, var(--void);
          border:1px solid rgba(77,238,255,.16); box-shadow:0 30px 80px -30px rgba(77,238,255,.25), inset 0 0 120px rgba(5,3,16,.8); }
        .asx-dome::after{ content:""; position:absolute; inset:0; pointer-events:none; z-index:5; opacity:.5;
          background:repeating-linear-gradient(0deg, rgba(255,255,255,.022) 0 1px, transparent 1px 4px); }
        .asx-dome .vig{ position:absolute; inset:0; pointer-events:none; z-index:4;
          background:radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(5,3,16,.72) 100%); }
        .asx-brand{ position:absolute; top:22px; left:26px; z-index:8; pointer-events:none; }
        .asx-brand .k{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.42em; color:var(--cy); text-shadow:0 0 12px rgba(77,238,255,.8); }
        .asx-brand h2{ margin:4px 0 0; font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:2.5rem; line-height:1; letter-spacing:.01em;
          background:linear-gradient(92deg,#fff 10%, var(--cy) 45%, var(--mg) 75%, var(--gd) 100%);
          -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 0 22px rgba(77,238,255,.35)); }
        .asx-brand .sub{ margin-top:6px; font-family:'JetBrains Mono',monospace; font-size:.66rem; letter-spacing:.14em; color:var(--dim); }
        .asx-brand .sub b{ color:var(--gd); font-weight:600; }
        .asx-ctrl{ position:absolute; top:22px; right:24px; z-index:9; display:flex; gap:10px; align-items:center; }
        .asx-watchbtn{ display:inline-flex; align-items:center; gap:7px; font-family:'JetBrains Mono',monospace; font-size:.68rem; letter-spacing:.06em; color:#cfd4ff;
          background:rgba(11,7,24,.6); backdrop-filter:blur(8px); border:1px solid rgba(177,140,255,.35); border-radius:12px; padding:11px 16px; cursor:pointer; transition:border-color .15s, box-shadow .2s; }
        .asx-watchbtn:hover{ border-color:var(--mg); box-shadow:0 0 20px rgba(255,77,216,.25); }
        .asx-scan{ position:relative; display:inline-flex; align-items:center; gap:10px; font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:1rem; color:#02121a;
          background:linear-gradient(120deg,var(--cy),#9be8ff 55%,var(--cy)); background-size:200% 100%; border:0; border-radius:14px; padding:14px 26px; cursor:pointer;
          box-shadow:0 0 34px rgba(77,238,255,.55), inset 0 -2px 8px rgba(0,60,90,.35); transition:transform .15s; animation:asx-shimmer 3.2s linear infinite; }
        @keyframes asx-shimmer{ to{ background-position:-200% 0; } }
        .asx-scan:hover{ transform:translateY(-2px) scale(1.02); }
        .asx-scan:disabled{ opacity:.75; cursor:default; }
        .asx-ticker{ position:absolute; left:26px; bottom:56px; z-index:8; pointer-events:none; font-family:'JetBrains Mono',monospace; font-size:.78rem; letter-spacing:.2em; color:var(--cy); text-shadow:0 0 14px rgba(77,238,255,.7); min-height:18px; }
        .asx-ticker.idle{ color:var(--dim); text-shadow:none; letter-spacing:.14em; }
        .asx-meta{ position:absolute; left:26px; bottom:22px; z-index:8; display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
        .asx-chip{ font-family:'JetBrains Mono',monospace; font-size:.6rem; letter-spacing:.12em; color:var(--dim); background:rgba(11,7,24,.55); backdrop-filter:blur(6px);
          border:1px solid rgba(139,134,173,.25); border-radius:999px; padding:5px 12px; }
        .asx-chip.eng{ color:var(--gd); border-color:rgba(255,216,107,.4); }
        .asx-chip.live{ color:#50f2a8; border-color:rgba(80,242,168,.4); }
        .asx-chip.live i{ display:inline-block; width:7px; height:7px; border-radius:50%; background:#50f2a8; box-shadow:0 0 8px #50f2a8; margin-right:6px; animation:asx-bl 1.6s infinite; }
        @keyframes asx-bl{ 0%,100%{opacity:1} 50%{opacity:.3} }
        .asx-hist{ position:absolute; right:24px; bottom:22px; z-index:9; display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end; max-width:44%; }
        .asx-hchip{ font-family:'JetBrains Mono',monospace; font-size:.62rem; color:#cfd4ff; background:rgba(11,7,24,.6); backdrop-filter:blur(6px); border:1px solid rgba(77,238,255,.25); border-radius:999px; padding:5px 12px; cursor:pointer; transition:border-color .15s; }
        .asx-hchip:hover{ border-color:var(--cy); }
        .asx-hchip.on{ background:var(--cy); color:#02121a; border-color:var(--cy); font-weight:700; }
        .asx-empty{ position:absolute; inset:0; z-index:7; display:grid; place-items:center; pointer-events:none; text-align:center; }
        .asx-empty .in{ font-family:'JetBrains Mono',monospace; font-size:.8rem; letter-spacing:.18em; color:var(--dim); }
        .asx-empty .in b{ color:var(--cy); text-shadow:0 0 14px rgba(77,238,255,.7); }

        /* ══ WATCHLIST DRAWER ══ */
        .asx-watch{ margin-top:16px; border:1px solid rgba(177,140,255,.28); border-radius:18px; padding:20px 24px;
          background:linear-gradient(180deg, rgba(18,12,34,.9), rgba(11,7,24,.9)); position:relative; overflow:hidden; }
        .asx-watch::before{ content:""; position:absolute; inset:0; pointer-events:none; opacity:.35;
          background:radial-gradient(600px 200px at 10% 0%, rgba(177,140,255,.14), transparent 60%); }
        .asx-watch h4{ font-family:'JetBrains Mono',monospace; font-size:.62rem; letter-spacing:.22em; text-transform:uppercase; color:var(--dim); margin:0 0 10px; }
        .asx-wrow{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; position:relative; }
        .asx-wtag{ display:inline-flex; align-items:center; gap:7px; font-family:'JetBrains Mono',monospace; font-size:.7rem; color:var(--ink);
          background:rgba(77,238,255,.06); border:1px solid rgba(77,238,255,.28); border-radius:10px; padding:6px 12px; }
        .asx-wtag a{ color:inherit; text-decoration:none; }
        .asx-wtag button{ background:none; border:0; color:var(--mute); cursor:pointer; display:inline-flex; padding:0; }
        .asx-wtag button:hover{ color:var(--mg); }
        .asx-kwadd{ display:flex; gap:9px; position:relative; }
        .asx-kwadd input{ flex:1; background:rgba(5,3,16,.7); border:1px solid rgba(177,140,255,.3); border-radius:10px; color:var(--ink); font-size:.82rem; padding:9px 14px; outline:none; font-family:'JetBrains Mono',monospace; }
        .asx-kwadd input:focus{ border-color:var(--cy); box-shadow:0 0 16px rgba(77,238,255,.2); }
        .asx-kwadd button{ display:inline-flex; align-items:center; gap:6px; background:rgba(77,238,255,.12); color:var(--cy); border:1px solid rgba(77,238,255,.4); border-radius:10px; padding:9px 16px; font-size:.8rem; font-weight:700; cursor:pointer; }

        /* ══ THE DECK — holographic star dossiers ══ */
        .asx-deck{ display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:18px; margin-top:22px; align-items:start; }
        @media(max-width:980px){ .asx-deck{ grid-template-columns:1fr; } }
        .asx-card{ --acc:#b18cff; position:relative; border-radius:18px; padding:22px 24px 20px; isolation:isolate;
          background:linear-gradient(165deg, rgba(18,12,34,.96), rgba(7,4,18,.98));
          clip-path:polygon(0 0, calc(100% - 26px) 0, 100% 26px, 100% 100%, 26px 100%, 0 calc(100% - 26px));
          transition:transform .2s; }
        .asx-card::before{ content:""; position:absolute; inset:0; z-index:-2; border-radius:18px;
          clip-path:polygon(0 0, calc(100% - 26px) 0, 100% 26px, 100% 100%, 26px 100%, 0 calc(100% - 26px));
          background:conic-gradient(from var(--asxa,0deg), transparent 0 60deg, var(--acc) 90deg, transparent 130deg 240deg, rgba(77,238,255,.8) 275deg, transparent 320deg);
          animation:asx-spin 7s linear infinite; opacity:.75; }
        @property --asxa { syntax:'<angle>'; initial-value:0deg; inherits:false; }
        @keyframes asx-spin{ to{ --asxa:360deg; } }
        .asx-card::after{ content:""; position:absolute; inset:1.6px; z-index:-1; border-radius:16px;
          clip-path:polygon(0 0, calc(100% - 25px) 0, 100% 25px, 100% 100%, 25px 100%, 0 calc(100% - 25px));
          background:linear-gradient(165deg, #120c22, #070412); }
        .asx-card:hover{ transform:translateY(-3px); }
        .asx-card.on::before{ opacity:1; animation-duration:2.8s; }
        .asx-card.closed{ cursor:pointer; }
        .asx-card.closed:hover{ transform:translateY(-4px) scale(1.005); }
        .asx-sigmini{ display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin-top:10px; font-family:'JetBrains Mono',monospace; font-size:.66rem; color:#ff8fa3; }
        .asx-sigmini b{ color:#ffd3db; font-weight:800; }
        .asx-sigmini .vw{ color:var(--gd); }
        .asx-open{ display:inline-flex; align-items:center; gap:8px; margin-top:14px; width:100%; justify-content:center;
          font-family:'JetBrains Mono',monospace; font-size:.68rem; letter-spacing:.24em; color:var(--cy);
          background:linear-gradient(90deg, rgba(77,238,255,.06), rgba(77,238,255,.14), rgba(77,238,255,.06));
          border:1px solid rgba(77,238,255,.35); border-radius:10px; padding:10px 16px; cursor:pointer; transition:box-shadow .2s, border-color .15s; }
        .asx-open:hover{ border-color:var(--cy); box-shadow:0 0 18px rgba(77,238,255,.3); }
        .asx-body{ animation:asx-fade .35s ease; }
        @keyframes asx-fade{ from{ opacity:0; transform:translateY(6px); } to{ opacity:1; transform:none; } }
        .asx-close{ background:none; border:0; color:var(--mute); font-family:'JetBrains Mono',monospace; font-size:.62rem; letter-spacing:.18em; cursor:pointer; margin-left:auto; }
        .asx-close:hover{ color:var(--cy); }
        .asx-toprow{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
        .asx-idx{ font-family:'JetBrains Mono',monospace; font-size:.66rem; letter-spacing:.2em; color:var(--acc); text-shadow:0 0 10px var(--acc); }
        .asx-kw{ font-family:'JetBrains Mono',monospace; font-size:.62rem; letter-spacing:.04em; color:#c8f25a; background:rgba(200,242,90,.07); border:1px solid rgba(200,242,90,.3); border-radius:8px; padding:3px 10px; }
        .asx-cat{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:.56rem; letter-spacing:.16em; text-transform:uppercase; color:var(--acc); border:1px solid; border-radius:8px; padding:3px 10px; }
        .asx-card h3{ font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:1.3rem; color:#f6f4ff; margin:2px 0 0; line-height:1.18; }
        .asx-mag{ display:flex; align-items:center; gap:10px; margin:12px 0 6px; }
        .asx-mag .bar{ flex:1; height:8px; border-radius:999px; background:rgba(255,255,255,.05); overflow:hidden; position:relative; }
        .asx-mag .fill{ height:100%; border-radius:999px; background:linear-gradient(90deg, var(--acc), #fff); box-shadow:0 0 14px var(--acc); transition:width 1s cubic-bezier(.22,1,.36,1); }
        .asx-mag .n{ font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:1.15rem; color:var(--acc); text-shadow:0 0 12px var(--acc); min-width:40px; text-align:right; }
        .asx-mag .lbl{ font-family:'JetBrains Mono',monospace; font-size:.54rem; letter-spacing:.18em; color:var(--mute); }
        .asx-why{ font-size:.93rem; color:#c6c2df; margin:8px 0; }
        .asx-sig{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:12px 0; padding:10px 14px; border-radius:12px;
          background:rgba(255,45,85,.06); border:1px solid rgba(255,80,110,.28); }
        .asx-sig .tag{ font-family:'JetBrains Mono',monospace; font-size:.56rem; letter-spacing:.16em; color:#ff8fa3; }
        .asx-sig .ch{ font-weight:800; font-size:.85rem; color:#ffd3db; }
        .asx-sig .vt{ flex:1; min-width:150px; font-size:.8rem; color:#cbb8c6; font-style:italic; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .asx-sig .stat{ font-family:'JetBrains Mono',monospace; font-size:.62rem; color:#ff8fa3; white-space:nowrap; }
        .asx-sig a{ display:inline-flex; align-items:center; gap:5px; color:#fff; font-size:.72rem; font-weight:800; text-decoration:none; background:linear-gradient(120deg,#ff1e56,#c9184a); border-radius:8px; padding:5px 12px; white-space:nowrap; box-shadow:0 0 16px rgba(255,30,86,.4); }
        .asx-th{ font-family:'JetBrains Mono',monospace; font-size:.58rem; letter-spacing:.22em; text-transform:uppercase; color:var(--cy); margin:12px 0 6px; display:flex; align-items:center; gap:7px; }
        .asx-th::after{ content:""; flex:1; height:1px; background:linear-gradient(90deg, rgba(77,238,255,.4), transparent); }
        .asx-titles{ display:flex; flex-direction:column; gap:6px; }
        .asx-title{ display:flex; align-items:center; gap:10px; background:rgba(5,3,16,.65); border:1px solid rgba(77,238,255,.14); border-left:2px solid var(--cy); border-radius:9px; padding:8px 12px; transition:border-color .15s, background .15s; }
        .asx-title:hover{ border-color:rgba(77,238,255,.5); background:rgba(77,238,255,.05); }
        .asx-title .tx{ flex:1; font-size:.92rem; font-weight:700; color:#f2f6ff; }
        .asx-title button{ display:inline-flex; align-items:center; gap:4px; background:none; border:1px solid rgba(139,134,173,.3); color:var(--mute); border-radius:7px; padding:3px 9px; font-size:.62rem; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; transition:color .15s, border-color .15s; }
        .asx-title button:hover{ color:var(--cy); border-color:var(--cy); }
        .asx-angle{ font-size:.88rem; color:#d9d5ee; margin:6px 0; padding-left:12px; border-left:2px solid var(--gd); }
        .asx-hook{ font-style:italic; color:#9d97c2; font-size:.88rem; margin:8px 0; }
        .asx-actions{ display:flex; align-items:center; gap:9px; margin-top:14px; flex-wrap:wrap; }
        .asx-fmt{ font-family:'JetBrains Mono',monospace; font-size:.56rem; letter-spacing:.18em; text-transform:uppercase; color:var(--dim); border:1px dashed rgba(139,134,173,.4); border-radius:999px; padding:5px 12px; }
        .asx-act{ display:inline-flex; align-items:center; gap:7px; border-radius:11px; padding:9px 17px; font-weight:800; font-size:.84rem; cursor:pointer; transition:transform .15s, box-shadow .2s; text-decoration:none; border:1px solid; background:rgba(5,3,16,.5); }
        .asx-act:hover{ transform:translateY(-2px); }
        .asx-act:disabled{ opacity:.5; cursor:default; }
        .asx-act.video{ color:#7cc4ff; border-color:rgba(96,165,250,.5); } .asx-act.video:hover{ box-shadow:0 0 18px rgba(96,165,250,.35); }
        .asx-act.nb{ color:#50f2a8; border-color:rgba(80,242,168,.5); } .asx-act.nb:hover{ box-shadow:0 0 18px rgba(80,242,168,.3); }
        .asx-act.seo{ color:var(--gd); border-color:rgba(255,216,107,.5); } .asx-act.seo:hover{ box-shadow:0 0 18px rgba(255,216,107,.3); }
        .asx-sub{ margin-top:10px; border-top:1px dashed rgba(139,134,173,.25); padding-top:10px; font-family:'JetBrains Mono',monospace; font-size:.74rem; }
        .asx-sub .okx{ color:#50f2a8; } .asx-sub .errx{ color:#ff8fa3; }
        .asx-sub a{ color:var(--gd); text-decoration:none; border-bottom:1px solid rgba(255,216,107,.4); }
        .asx-err{ margin-top:16px; border:1px solid rgba(255,109,138,.5); background:rgba(255,109,138,.07); color:#ffd3db; border-radius:14px; padding:13px 17px; font-size:.9rem; display:flex; gap:10px; align-items:flex-start; }
        .asx-skel{ height:150px; border-radius:18px; background:linear-gradient(90deg, rgba(77,238,255,.03), rgba(177,140,255,.08), rgba(77,238,255,.03)); background-size:200% 100%; animation:asx-shm 1.4s infinite; border:1px solid rgba(77,238,255,.1); }
        @keyframes asx-shm{ to{ background-position:-200% 0; } }
        .asx-viewing{ display:flex; align-items:center; gap:10px; font-family:'JetBrains Mono',monospace; font-size:.72rem; letter-spacing:.1em; color:var(--gd); margin-top:16px; }
        .asx-viewing button{ background:none; border:1px solid rgba(77,238,255,.35); color:var(--cy); border-radius:999px; padding:4px 14px; font-size:.66rem; cursor:pointer; font-family:'JetBrains Mono',monospace; }
      `}</style>

      {/* ═══════════ THE DOME ═══════════ */}
      <div className="asx-dome">
        <AstrosSky
          topics={topics.map((t) => ({ topic: t.topic, heat: t.heat, category: t.category }))}
          sweeping={sweeping}
          activeIndex={active}
          onSelect={focusTopic}
        />
        <div className="vig" />
        <div className="asx-brand">
          <div className="k">⟡ THE STARCHART IS LIVE</div>
          <h2>HERMES ASTROS</h2>
          <div className="sub">24/7 YouTube watcher · every star is a topic — <b>click one</b> · last swept {ago(scannedAt)}</div>
        </div>
        <div className="asx-ctrl">
          <button className="asx-watchbtn" onClick={() => setShowWatch((v) => !v)}>
            <Settings2 size={13} /> WATCHLIST{watch ? ` · ${watch.channels.length}CH · ${watch.keywords.length}KW` : ""}
          </button>
          <button className="asx-scan" onClick={sweep} disabled={sweeping}>
            {sweeping ? <Loader2 size={17} className="animate-spin" /> : <Star size={17} />}
            {sweeping ? "SCANNING…" : "SCAN THE SKIES"}
          </button>
        </div>
        <div className={`asx-ticker ${sweeping ? "" : "idle"}`}>
          {sweeping ? `▮▮ ${SWEEP_STATUS[statusIdx]}` : topics.length ? "" : ""}
        </div>
        <div className="asx-meta">
          <span className="asx-chip live"><i />{sweeping ? "SWEEPING" : "WATCHING"}</span>
          {engineLabel && <span className="asx-chip eng">◈ {engineLabel}</span>}
          <span className="asx-chip">RE-SCANS EVERY 4H · LOGS TO OBSIDIAN</span>
        </div>
        {history.length > 0 && (
          <div className="asx-hist">
            <span className={`asx-hchip ${!viewDay ? "on" : ""}`} onClick={() => { setViewDay(null); setActive(null); setOpenIdx(null); }}>LIVE</span>
            {history.slice(0, 5).map((h) => (
              <span key={h.day} className={`asx-hchip ${viewDay === h.day ? "on" : ""}`} onClick={() => { setViewDay(h.day); setActive(null); setOpenIdx(null); }} title={`${h.count} topics`}>
                {dayLabel(h.day)}
              </span>
            ))}
          </div>
        )}
        {!topics.length && !booting && !sweeping && (
          <div className="asx-empty"><div className="in">THE SKY IS QUIET<br /><b>▸ SCAN THE SKIES ◂</b></div></div>
        )}
      </div>

      {/* ═══════════ WATCHLIST DRAWER ═══════════ */}
      {showWatch && watch && (
        <div className="asx-watch">
          <h4><MonitorPlay size={11} style={{ display: "inline", marginRight: 6 }} />Tracked competitor orbits — auto-discovered every sweep</h4>
          <div className="asx-wrow">
            {watch.channels.length === 0 && <span style={{ color: "var(--mute)", fontSize: ".8rem" }}>None yet — the first sweep discovers competitors automatically.</span>}
            {watch.channels.map((c) => (
              <span className="asx-wtag" key={c.id}>
                <a href={`https://www.youtube.com/channel/${c.id}`} target="_blank" rel="noopener noreferrer">{c.title}</a>
                <button title="Stop tracking" onClick={() => saveWatch({ channels: watch.channels.filter((x) => x.id !== c.id) })}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
          <h4>Keyword belt</h4>
          <div className="asx-wrow">
            {watch.keywords.map((k) => (
              <span className="asx-wtag" key={k}>{k}
                <button title="Remove" onClick={() => saveWatch({ keywords: watch.keywords.filter((x) => x !== k) })}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
          <div className="asx-kwadd">
            <input value={kwInput} onChange={(e) => setKwInput(e.target.value)} placeholder="add a keyword to watch — e.g. 'gemini agents'"
              onKeyDown={(e) => { if (e.key === "Enter" && kwInput.trim()) { saveWatch({ keywords: [...watch.keywords, kwInput.trim()] }); setKwInput(""); } }} />
            <button onClick={() => { if (kwInput.trim()) { saveWatch({ keywords: [...watch.keywords, kwInput.trim()] }); setKwInput(""); } }}><Plus size={13} /> ADD</button>
          </div>
        </div>
      )}

      {viewDay && (
        <div className="asx-viewing">VIEWING {dayLabel(viewDay).toUpperCase()} <button onClick={() => { setViewDay(null); setActive(null); setOpenIdx(null); }}>← BACK TO LIVE</button></div>
      )}
      {err && <div className="asx-err"><X size={16} style={{ marginTop: 2 }} /><div>{err}</div></div>}

      {/* ═══════════ THE DECK ═══════════ */}
      <div className="asx-deck" ref={cardsRef}>
        {booting && [0, 1, 2, 3].map((i) => <div key={i} className="asx-skel" />)}
        {!booting && !topics.length && !err && (
          <div className="asx-card" style={{ ["--acc" as string]: "#4deeff" }}>
            <h3>Astros hasn&apos;t mapped the sky yet.</h3>
            <p className="asx-why">Hit <b style={{ color: "var(--cy)" }}>SCAN THE SKIES</b> — Astros reads the freshest uploads from your competitors + keyword belt on YouTube, then hands you the topics breaking right now: 5 ready titles each, the SEO keyword, angles and a hook. It re-scans on its own every 4 hours, 24/7.</p>
          </div>
        )}
        {topics.map((t, i) => {
          const col = catColor(t.category); const key = kf(i);
          const nb = nbState[key]; const pub = pubState[key];
          const open = openIdx === i;
          return (
            <div key={key} data-top={i} className={`asx-card ${active === i ? "on" : ""} ${open ? "" : "closed"}`}
              style={{ ["--acc" as string]: col }} onMouseEnter={() => setActive(i)}
              onClick={open ? undefined : () => setOpenIdx(i)}>
              <div className="asx-toprow">
                <span className="asx-idx">✦ STAR {String(i + 1).padStart(2, "0")}</span>
                {t.seo_keyword && <span className="asx-kw">⌕ {t.seo_keyword}</span>}
                <span className="asx-cat" style={{ borderColor: `${col}66`, background: `${col}12` }}>{t.category}</span>
                {open && <button className="asx-close" onClick={(e) => { e.stopPropagation(); setOpenIdx(null); }}>✕ CLOSE</button>}
              </div>
              <h3>{t.topic}</h3>
              <div className="asx-mag">
                <span className="lbl">MAGNITUDE</span>
                <div className="bar"><div className="fill" style={{ width: `${t.heat}%` }} /></div>
                <div className="n">{t.heat}</div>
              </div>

              {!open && (
                <>
                  {t.competitor.channel && (
                    <div className="asx-sigmini">
                      <span>SIGNAL</span><b>▶ {t.competitor.channel}</b>
                      {t.competitor.views && <span className="vw">{t.competitor.views}</span>}
                      {t.competitor.age && <span>{t.competitor.age}</span>}
                    </div>
                  )}
                  <button className="asx-open">▸ OPEN DOSSIER — {t.titles.length} TITLES · {t.angles.length} ANGLES</button>
                </>
              )}

              {open && (
                <div className="asx-body">
                  <p className="asx-why">{t.why_hot}</p>
                  {t.competitor.channel && (
                    <div className="asx-sig">
                      <span className="tag">SIGNAL FROM</span>
                      <span className="ch">▶ {t.competitor.channel}</span>
                      <span className="vt">“{t.competitor.video_title}”</span>
                      {(t.competitor.views || t.competitor.age) && <span className="stat">{[t.competitor.views, t.competitor.age].filter(Boolean).join(" · ")}</span>}
                      {t.competitor.url && <a href={t.competitor.url} target="_blank" rel="noopener noreferrer">WATCH <ArrowUpRight size={11} /></a>}
                    </div>
                  )}
                  {t.titles.length > 0 && (
                    <>
                      <div className="asx-th"><Sparkles size={11} /> YOUR TITLES — READY TO FIRE</div>
                      <div className="asx-titles">
                        {t.titles.map((ti, k) => (
                          <div className="asx-title" key={k}>
                            <span className="tx">{ti}</span>
                            <button onClick={() => copyText(`${key}:t${k}`, ti)}>{copied === `${key}:t${k}` ? <Check size={11} /> : <Copy size={11} />}{copied === `${key}:t${k}` ? "COPIED" : "COPY"}</button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {t.angles.length > 0 && (
                    <>
                      <div className="asx-th">ANGLES</div>
                      {t.angles.map((a, k) => <p className="asx-angle" key={k}>{a}</p>)}
                    </>
                  )}
                  {t.hook && <p className="asx-hook">“{t.hook}”</p>}
                  <div className="asx-actions">
                    <span className="asx-fmt">{t.format}</span>
                    <a className="asx-act video" href={videoLink(t)} title="Open the Video agent with this topic + angle + hook prefilled">
                      <Clapperboard size={14} /> VIDEO AGENT <ArrowUpRight size={13} />
                    </a>
                    <button className="asx-act nb" onClick={() => toNotebook(key, t)} disabled={!!nb?.busy} title="Create a NotebookLM notebook for this topic with the competitor video loaded as a source">
                      {nb?.busy ? <Loader2 size={14} className="animate-spin" /> : <NotebookPen size={14} />}
                      {nb?.busy ? "CREATING…" : nb?.url ? "NOTEBOOK ✓" : "NOTEBOOKLM"}
                    </button>
                    <button className="asx-act seo" onClick={() => toSeo(key, t)} disabled={!!pub?.busy} title="Write a unique SEO article on this topic for each of your WordPress sites, publish + index them">
                      {pub?.busy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                      {pub?.busy ? "PUBLISHING…" : pub?.results?.length ? "PUBLISHED ✓" : "SEO CONTENT"}
                    </button>
                  </div>
                  {(nb?.url || nb?.error) && (
                    <div className="asx-sub">{nb.url ? <span className="okx">✓ NOTEBOOK READY — <a href={nb.url} target="_blank" rel="noopener noreferrer">open in NotebookLM ↗</a></span> : <span className="errx">⚠ {nb.error}</span>}</div>
                  )}
                  {pub && (pub.busy || pub.results || pub.error) && (
                    <div className="asx-sub">
                      {pub.busy ? <span><Loader2 size={12} className="animate-spin" style={{ display: "inline" }} /> {pub.phase || "Working…"}</span>
                        : pub.results?.length ? <span className="okx">✓ PUBLISHED TO {pub.results.length} SITE{pub.results.length > 1 ? "S" : ""} — {pub.results.map((r, k) => <span key={r.site}>{k > 0 ? " · " : ""}<a href={r.url} target="_blank" rel="noopener noreferrer">{r.site} ↗</a></span>)}</span>
                        : <span className="errx">⚠ {pub.error}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
