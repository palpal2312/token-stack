"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Plus, Trash2, ChevronLeft, ChevronRight, History, GripVertical, Flame, Pencil, Copy } from "lucide-react";

type Status = "todo" | "doing" | "done";
interface Todo { id: string; text: string; done: boolean; ts: number; status?: Status; kind?: "task" | "heading"; indent?: number; }
const isTask = (t: Todo) => t.kind !== "heading";

const STATUS_STYLE: Record<Status, { label: string; color: string; bg: string; border: string }> = {
  todo:  { label: "to do", color: "var(--cream-mute)", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.14)" },
  doing: { label: "doing", color: "#e6c69a", bg: "rgba(212,165,116,0.14)", border: "rgba(212,165,116,0.4)" },
  done:  { label: "done",  color: "var(--emerald, #5ab896)", bg: "rgba(90,184,150,0.14)", border: "rgba(90,184,150,0.4)" },
};
const NEXT_STATUS: Record<Status, Status> = { todo: "doing", doing: "done", done: "todo" };
interface Day { date: string; total: number; done: number; }
interface Particle { id: number; x: number; y: number; dx: number; dy: number; color: string; }

const GOLD = "var(--gold, #d4a574)";
const COLORS = ["#d4a574", "#5ab896", "#2dd4bf", "#a78bfa", "#e6c69a", "#c4607e"];

// Render inline markdown: **bold**, __bold__, _italic_, *italic*, `code`.
function renderMd(s: string, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|_(.+?)_|\*(.+?)\*/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const bold = m[1] ?? m[2], code = m[3], ital = m[4] ?? m[5];
    if (bold != null) out.push(<strong key={`${base}-${k}`}>{bold}</strong>);
    else if (code != null) out.push(<code key={`${base}-${k}`} className="px-1 rounded" style={{ background: "rgba(255,255,255,0.08)", fontSize: "0.9em" }}>{code}</code>);
    else out.push(<em key={`${base}-${k}`}>{ital}</em>);
    k++; last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// Task text: full clickable URLs + inline markdown (bold/italic/code).
function TaskText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) {
          return (
            <a key={i} href={p} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
              className="text-[13px] font-medium underline decoration-dotted underline-offset-2 break-all"
              style={{ color: "var(--teal, #2dd4bf)", wordBreak: "break-all" }}>
              {p} ↗
            </a>
          );
        }
        return <span key={i}>{renderMd(p, `md${i}`)}</span>;
      })}
    </>
  );
}

// Tiny WebAudio pop — no assets. One blip on tick, rising arpeggio on all-done.
function pop(allDone = false) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = allDone ? [523, 659, 784, 1047] : [660];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = f; o.type = "sine";
      const t = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* audio blocked — fine */ }
}

export default function TodoPanel() {
  const [date, setDate] = useState<string>("");
  const [todayStr, setTodayStr] = useState<string>("");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [text, setText] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dragArmed, setDragArmed] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const pid = useRef(0);

  async function refresh(d?: string) {
    const r = await fetch(`/api/todos${d ? `?date=${d}` : ""}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!r) return;
    setDate(r.date); setTodayStr(r.today); setTodos(r.todos); setDays(r.days);
  }
  useEffect(() => { refresh(); }, []);

  const isToday = date === todayStr;
  const tasks = todos.filter(isTask);
  const doneCount = tasks.filter((t) => t.done).length;
  const allDone = tasks.length > 0 && doneCount === tasks.length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  // Streak — consecutive fully-cleared days ending today or yesterday.
  const dayMap = new Map(days.map((d) => [d.date, d]));
  let streak = 0;
  {
    const d = new Date();
    const key = () => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const t = dayMap.get(key());
    if (!(t && t.total > 0 && t.done === t.total)) d.setDate(d.getDate() - 1); // today not cleared yet — start from yesterday
    for (;;) {
      const e = dayMap.get(key());
      if (e && e.total > 0 && e.done === e.total) { streak++; d.setDate(d.getDate() - 1); } else break;
    }
  }

  function burst(e: React.MouseEvent, big = false) {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const n = big ? 26 : 12;
    const fresh: Particle[] = Array.from({ length: n }, () => {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (big ? 90 : 55);
      return { id: pid.current++, x, y, dx: Math.cos(a) * v, dy: Math.sin(a) * v - 30, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    });
    setParticles((p) => [...p, ...fresh]);
    setTimeout(() => setParticles((p) => p.filter((q) => !fresh.includes(q))), 800);
  }

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, date }) }).then((r) => r.json()).catch(() => null);
    if (r?.todos) setTodos(r.todos);
    fetch("/api/todos", { cache: "no-store" }).then((r) => r.json()).then((j) => setDays(j.days)).catch(() => {});
    return r;
  }
  function celebrate(e: React.MouseEvent) {
    const t = todos.filter(isTask);
    const willAllDone = t.filter((x) => x.done).length + 1 === t.length;
    burst(e, willAllDone);
    pop(willAllDone);
  }
  async function toggle(t: Todo, e: React.MouseEvent) {
    if (!t.done) celebrate(e);
    post({ action: "toggle", id: t.id });
  }
  function cycleStatus(t: Todo, e: React.MouseEvent) {
    const next = NEXT_STATUS[(t.status ?? (t.done ? "done" : "todo")) as Status];
    if (next === "done") celebrate(e);
    post({ action: "status", id: t.id, status: next });
  }
  function startEdit(t: Todo) { setEditingId(t.id); setEditText(t.text); }
  function saveEdit() {
    const t = editText.trim();
    if (editingId && t) post({ action: "edit", id: editingId, text: t });
    setEditingId(null);
  }
  function add() {
    const t = text.trim();
    if (!t) return;
    setText("");
    post({ action: "add", text: t }).then((r) => {
      const last = r?.todos?.[r.todos.length - 1];
      if (last) { setJustAdded(last.id); setTimeout(() => setJustAdded(null), 600); }
    });
    inputRef.current?.focus();
  }

  function dragEnter(i: number) {
    const from = dragIdx.current;
    if (from === null || from === i) return;
    setTodos((t) => { const next = [...t]; const [m] = next.splice(from, 1); next.splice(i, 0, m); return next; });
    dragIdx.current = i;
  }
  function dragEnd() {
    if (dragIdx.current === null) return;
    dragIdx.current = null;
    setTodos((t) => { post({ action: "reorder", ids: t.map((x) => x.id) }); return t; });
  }

  return (
    <div ref={panelRef} className="surface-card p-5 relative overflow-hidden">
      <style>{`
        @keyframes tdPop{0%{transform:scale(.6)}55%{transform:scale(1.25)}100%{transform:scale(1)}}
        @keyframes tdIn{0%{opacity:0;transform:translateY(-6px) scale(.98)}100%{opacity:1;transform:none}}
        @keyframes tdParticle{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.4)}}
        @keyframes tdShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes tdGlow{0%,100%{box-shadow:0 0 0 0 rgba(90,184,150,0)}50%{box-shadow:0 0 26px 2px rgba(90,184,150,.35)}}
      `}</style>

      {/* confetti layer */}
      <div className="pointer-events-none absolute inset-0 z-30">
        {particles.map((p) => (
          <span key={p.id} className="absolute w-[7px] h-[7px] rounded-sm"
            style={{ left: p.x, top: p.y, background: p.color, ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px`, animation: "tdParticle .75s cubic-bezier(.2,.7,.3,1) forwards" }} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="text-[15px] font-medium text-[var(--cream)]">{isToday ? "To-do list" : date}</div>
        {streak > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(201,124,94,0.16)", color: "var(--rust, #c97c5e)", border: "1px solid rgba(201,124,94,0.35)" }}
            title="consecutive fully-cleared days">
            <Flame size={11} /> {streak} day{streak > 1 ? "s" : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!isToday && (
            <button onClick={() => { setHistOpen(false); refresh(); }}
              className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-[rgba(255,255,255,0.04)]"
              style={{ borderColor: "var(--line-soft)", color: GOLD }}>
              <ChevronLeft size={12} /> back to today
            </button>
          )}
          <button onClick={() => setHistOpen((o) => !o)}
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-[rgba(255,255,255,0.04)]"
            style={{ borderColor: histOpen ? GOLD : "var(--line-soft)", color: histOpen ? GOLD : "var(--cream-mute)" }}>
            <History size={12} /> History
          </button>
        </div>
      </div>

      {/* progress bar */}
      {todos.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] mono tracking-widest uppercase font-semibold" style={{ color: allDone ? "var(--emerald)" : "var(--cream-dim, #a59783)" }}>
              {allDone ? "day crushed ✓" : `${doneCount}/${tasks.length} done`}
            </span>
            <span className="text-[12px] mono font-semibold" style={{ color: allDone ? "var(--emerald)" : "var(--cream-dim, #a59783)" }}>{pct}%</span>
          </div>
          <div className="h-[7px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: allDone
                  ? "linear-gradient(90deg,#5ab896,#2dd4bf,#5ab896)"
                  : "linear-gradient(90deg,#d4a574,#e6c69a,#5ab896)",
                backgroundSize: "200% 100%",
                animation: allDone ? "tdShimmer 2.2s linear infinite, tdGlow 2.2s ease-in-out infinite" : "none",
              }} />
          </div>
        </div>
      )}

      {histOpen && (
        <div className="absolute right-4 top-14 z-40 w-[270px] max-h-[280px] overflow-y-auto scroll rounded-xl border shadow-2xl"
          style={{ background: "var(--bg-elev, #2e2436)", borderColor: "var(--line-soft)" }}>
          {days.length === 0 && <div className="px-3 py-3 text-[11.5px] text-[var(--cream-mute)]">No days yet.</div>}
          {days.map((d) => (
            <button key={d.date} onClick={() => { setHistOpen(false); refresh(d.date); }}
              className="w-full text-left px-3 py-2 border-b hover:bg-[rgba(255,255,255,0.04)] flex items-center gap-2"
              style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <span className="flex-1 text-[12px] text-[var(--cream)]">{d.date === todayStr ? `${d.date} · today` : d.date}</span>
              {d.total > 0 && d.done === d.total
                ? <span className="text-[10.5px]" style={{ color: "var(--emerald)" }}>✓ crushed</span>
                : <span className="text-[10.5px] mono text-[var(--cream-mute)]">{d.done}/{d.total}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {todos.length === 0 && (
          <div className="text-[13.5px] text-[var(--cream-mute)] py-2">
            {isToday ? "Nothing yet — add the first thing to knock out today." : "Nothing was on the list this day."}
          </div>
        )}
        {todos.map((t, i) => {
          const heading = !isTask(t);
          const indent = Math.min(3, t.indent ?? 0);
          return (
          <div key={t.id} draggable={dragArmed === t.id}
            onDragStart={(e) => { dragIdx.current = i; e.dataTransfer.effectAllowed = "move"; }}
            onDragEnter={() => dragEnter(i)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => { setDragArmed(null); dragEnd(); }}
            className={`group flex items-center gap-3 rounded-xl transition-colors ${heading ? "px-3 pt-4 pb-1" : "px-3 py-2.5 border hover:border-[rgba(212,165,116,0.35)]"}`}
            style={{
              marginLeft: indent * 26,
              ...(heading ? {} : {
                background: t.done ? "rgba(90,184,150,0.05)" : "rgba(255,255,255,0.03)",
                borderColor: t.done ? "rgba(90,184,150,0.2)" : "rgba(255,255,255,0.07)",
              }),
              ...(justAdded === t.id ? { animation: "tdIn .45s cubic-bezier(.2,.7,.3,1)" } : {}),
            }}>
            {/* drag ONLY from the grip — leaves the text freely selectable */}
            <span className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-50 shrink-0 -ml-1"
              title="drag to reorder"
              onMouseDown={() => setDragArmed(t.id)}
              onMouseUp={() => setDragArmed(null)}>
              <GripVertical size={14} color="var(--cream-mute)" />
            </span>
            {!heading && indent > 0 && <span className="shrink-0 text-[var(--cream-mute)] -mx-1">•</span>}
            {!heading && (
              <button onClick={(e) => toggle(t, e)}
                className="w-[23px] h-[23px] rounded-lg border-2 grid place-items-center shrink-0 transition-all hover:scale-110"
                style={{ borderColor: t.done ? "var(--emerald)" : "rgba(243,235,218,0.35)", background: t.done ? "rgba(90,184,150,0.22)" : "transparent" }}
                aria-label={t.done ? "mark not done" : "mark done"}>
                {t.done && <span style={{ animation: "tdPop .3s cubic-bezier(.2,.7,.3,1)" }}><Check size={15} color="var(--emerald)" strokeWidth={3} /></span>}
              </button>
            )}
            {editingId === t.id ? (
              <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditingId(null);
                  if (e.key === "Tab") { e.preventDefault(); post({ action: "indent", id: t.id, delta: e.shiftKey ? -1 : 1 }); }
                  // Cmd/Ctrl + B / I / E → wrap the selection in markdown (bold / italic / code)
                  if ((e.metaKey || e.ctrlKey) && ["b", "i", "e"].includes(e.key.toLowerCase())) {
                    e.preventDefault();
                    const el = e.currentTarget;
                    const s = el.selectionStart ?? 0, en = el.selectionEnd ?? 0;
                    const mark = e.key.toLowerCase() === "b" ? "**" : e.key.toLowerCase() === "e" ? "`" : "_";
                    const v = editText;
                    setEditText(v.slice(0, s) + mark + v.slice(s, en) + mark + v.slice(en));
                    requestAnimationFrame(() => { try { el.selectionStart = s + mark.length; el.selectionEnd = en + mark.length; } catch {} });
                  }
                }}
                onBlur={saveEdit}
                className="flex-1 bg-transparent text-[15px] font-medium px-2 py-0.5 rounded-md border outline-none"
                style={{ borderColor: "var(--gold, #d4a574)", color: "var(--cream)" }} />
            ) : heading ? (
              <span className="flex-1 leading-snug cursor-text select-text font-semibold"
                onDoubleClick={() => startEdit(t)} title="double-click to rename"
                style={{ fontFamily: "'Bricolage Grotesque', var(--font-sans, sans-serif)", fontSize: 18, color: "var(--gold-soft, #e6c69a)", letterSpacing: "0.01em", userSelect: "text", WebkitUserSelect: "text" }}>
                <TaskText text={t.text} />
              </span>
            ) : (
              <span className="flex-1 text-[15px] font-medium leading-relaxed transition-all duration-300 cursor-text select-text"
                onDoubleClick={() => startEdit(t)} title="double-click to rename"
                style={{ color: t.done ? "var(--cream-mute)" : "var(--cream)", textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.6 : 1, letterSpacing: "0.01em", userSelect: "text", WebkitUserSelect: "text" }}>
                <TaskText text={t.text} />
              </span>
            )}
            {/* indent / outdent on hover */}
            {!heading && (
              <span className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0 inline-flex gap-0.5">
                <button onClick={() => post({ action: "indent", id: t.id, delta: -1 })} disabled={indent === 0} title="outdent (⇧Tab in edit)"
                  className="hover:!opacity-100 px-0.5 disabled:opacity-30"><ChevronLeft size={13} color="var(--cream-mute)" /></button>
                <button onClick={() => post({ action: "indent", id: t.id, delta: 1 })} disabled={indent === 3} title="make sub-bullet (Tab in edit)"
                  className="hover:!opacity-100 px-0.5 disabled:opacity-30"><ChevronRight size={13} color="var(--cream-mute)" /></button>
              </span>
            )}
            <button onClick={() => { navigator.clipboard.writeText(t.text); setCopiedId(t.id); setTimeout(() => setCopiedId(null), 1200); }}
              className={`${copiedId === t.id ? "opacity-100" : "opacity-0"} group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0`}
              aria-label="copy text" title="copy text">
              {copiedId === t.id ? <Check size={13} color="var(--emerald)" /> : <Copy size={13} color="var(--cream-mute)" />}
            </button>
            {!heading && (() => { const s = STATUS_STYLE[(t.status ?? (t.done ? "done" : "todo")) as Status]; return (
              <button onClick={(e) => cycleStatus(t, e)} title="click to cycle: to do → doing → done"
                className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-transform hover:scale-105"
                style={{ color: s.color, background: s.bg, borderColor: s.border }}>
                {s.label}
              </button>
            ); })()}
            <button onClick={() => startEdit(t)}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-[11px]" aria-label="edit" title="edit">
              <Pencil size={13} color="var(--cream-mute)" />
            </button>
            <button onClick={() => post({ action: "delete", id: t.id })}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" aria-label="delete">
              <Trash2 size={14} color="var(--cream-mute)" />
            </button>
          </div>
        ); })}
      </div>

      {allDone && (
        <div className="mt-3 rounded-lg px-3 py-2 text-center text-[12.5px] font-medium"
          style={{ background: "linear-gradient(90deg,rgba(90,184,150,.12),rgba(45,212,191,.12))", border: "1px solid rgba(90,184,150,.35)", color: "var(--emerald)", animation: "tdIn .45s ease" }}>
          🏆 Day crushed — every task done{streak > 1 ? ` · ${streak}-day streak` : ""}. Go touch grass.
        </div>
      )}

      <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--line-soft)" }}>
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={isToday ? "Add a task… start with # for a heading (Enter)" : `Add to ${date}… (Enter)`}
          className="flex-1 bg-transparent text-[14.5px] px-3 py-2 rounded-lg border outline-none focus:border-[var(--gold)] transition-colors"
          style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }} />
        <button onClick={add} disabled={!text.trim()}
          className="flex items-center gap-1 text-[12px] font-medium px-3 py-1.5 rounded-md transition-transform hover:scale-105"
          style={{ background: `linear-gradient(135deg, #d4a574, #e6c69a)`, color: "#2a1c12", opacity: text.trim() ? 1 : 0.5 }}>
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}
