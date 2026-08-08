"use client";

// Sen Agent — the runtime coworker's own surface.
//
// One screen, four parts:
//   Sessions  — every thread in the runs store, listed; reopening one loads
//               its transcript, and the next message continues that thread.
//   Chat      — a prompt runs the Sen preset (deliverable-first agent)
//               through /api/sen/agent; the NDJSON stream becomes text
//               bubbles and a one-line-per-tool live trace.
//   Artifacts — files the run's makers wrote, linked to open.
//   MCP       — the connector registry: add / test / enable / remove servers.
//               Every added server is code this machine will run, and the
//               section says so in plain words (the Sub2API warning precedent).
//
// A gated tool call parks the run and the ask lands in the /automations Inbox;
// the blocked banner links there, and "Resume" continues the run once the ask
// is answered.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot, Cpu, FileText, Inbox, Loader2, MessagesSquare, Play, Plus, Send, TriangleAlert,
} from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { AUKER_CAPABILITIES, AUKER_NAME } from "@/lib/agentRuntime/presets/sen-meta";
import McpServersPanel from "./McpServersPanel";

// --------------------------------------------------------------------- types

interface TraceLine {
  kind: "user" | "text" | "tool" | "note";
  text: string;
  error?: boolean;
}
interface Artifact { path: string; kind: string; runId: string }
interface Blocked { runId: string; approvalId: string; tool: string; summary: string }
interface ThreadSummary {
  threadId: string; agentName: string; firstUserText: string; updatedAt: string; runCount: number;
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return await r.json(); }
  catch { return { error: `The server returned ${r.status} with no explanation.` }; }
}

/** One readable line for a tool call — the trace is a story, not a JSON dump. */
function humanize(name: string, args: unknown, preview: string, error?: string): string {
  const a = (args ?? {}) as Record<string, unknown>;
  if (error) return `${name} — refused/failed: ${error}`;
  if (name.startsWith("make_")) return `${name} — wrote ${String(preview ? JSON.parse(preview)?.path ?? "a file" : "a file")}`;
  if (name === "files_read" || name === "files_write" || name === "files_edit") return `${name} — ${String(a.path ?? "")}`;
  if (name === "files_list") return `${name} — ${String(a.path ?? ".")}`;
  if (name === "shell_run") return `shell_run — ${String(a.command ?? "")} ${Array.isArray(a.args) ? (a.args as string[]).join(" ") : ""}`.trim();
  if (name.startsWith("git_")) return name;
  return `${name} — ${preview || "ok"}`;
}

// ---------------------------------------------------------------------- view

export default function SenAgentView({ embedded = false }: { embedded?: boolean }) {
  const [lines, setLines] = useState<TraceLine[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [prompt, setPrompt] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Brain pickers: "" means "not asked" — the run then behaves exactly as
  // before the pickers existed (router default model, endpoint default effort).
  const [routerInfo, setRouterInfo] = useState<{ id: string; name: string } | null>(null);
  const [modelChoices, setModelChoices] = useState<string[] | null>(null);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [modelSel, setModelSel] = useState("");
  const [effortSel, setEffortSel] = useState("");
  const [sessions, setSessions] = useState<ThreadSummary[]>([]);
  const traceEnd = useRef<HTMLDivElement>(null);

  // The sessions list rides the same poll pattern as the MCP section: fresh
  // while the tab is visible, silent when it is not. A run finishing also
  // triggers a reload (see consume), so a brand-new thread shows up at once.
  const loadSessions = useCallback(async () => {
    const j = await readJson(await fetch("/api/sen/threads", { cache: "no-store" }));
    setSessions((j.threads as ThreadSummary[]) ?? []);
  }, []);
  usePollWhileVisible(loadSessions, 10000);

  /** Reopen a conversation: its transcript replaces the trace, and the next send continues the thread. */
  async function openSession(id: string) {
    if (busy) return;
    setErr(null); setBlocked(null); setArtifacts([]);
    const j = await readJson(await fetch(`/api/sen/threads/${encodeURIComponent(id)}`, { cache: "no-store" }));
    if (j.error) { setErr(String(j.error)); return; }
    setThreadId(id);
    const msgs = (j.messages as { role: string; content: string; toolCalls?: { name: string }[] }[]) ?? [];
    const restored: TraceLine[] = [];
    for (const m of msgs) {
      if (m.role === "user") restored.push({ kind: "user", text: m.content });
      else if (m.role === "assistant") {
        if (m.content) restored.push({ kind: "text", text: m.content });
        for (const c of m.toolCalls ?? []) restored.push({ kind: "tool", text: c.name });
      }
      // Tool-result messages are raw JSON for the brain, not reading material.
    }
    setLines(restored);
  }

  function newSession() {
    if (busy) return;
    setThreadId(null); setLines([]); setArtifacts([]); setBlocked(null); setErr(null);
  }

  async function openArtifact(artifact: Artifact) {
    // A raw <a href> cannot attach the dashboard token. Open the tab during
    // the click gesture, then use the authenticated fetch wrapper installed by
    // layout.tsx. Never navigate the top-level tab to the Blob URL: Blob URLs
    // inherit their creator's origin, so active HTML could otherwise read the
    // dashboard token and call privileged local APIs. A sandboxed iframe
    // without allow-same-origin gives the artifact an opaque origin.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setErr("The browser blocked the artifact tab. Allow pop-ups for this local dashboard and try again.");
      return;
    }
    tab.opener = null;
    setErr(null);
    try {
      const url = `/api/sen/agent?run=${encodeURIComponent(artifact.runId)}&path=${encodeURIComponent(artifact.path)}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const detail = await readJson(response);
        throw new Error(String(detail.error ?? `Artifact request failed (${response.status}).`));
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const doc = tab.document;
      doc.title = artifact.path;
      doc.documentElement.style.cssText = "width:100%;height:100%;margin:0;background:#111;";
      doc.body.style.cssText = "width:100%;height:100%;margin:0;overflow:hidden;";
      const frame = doc.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:white;";
      frame.src = objectUrl;
      doc.body.replaceChildren(frame);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      tab.close();
      setErr(String(error instanceof Error ? error.message : error));
    }
  }

  // The models the run's Router actually lists — fetched once on mount from
  // the same /models the health probe talks to. No list, no invented options:
  // the dropdown just offers "router default" and says why.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const list = await readJson(await fetch("/api/routers", { cache: "no-store" }));
      const routers = (list.routers as { id: string; name: string; isDefault: boolean }[]) ?? [];
      const active = routers.find((r) => r.isDefault) ?? routers[0];
      if (!active || dead) return;
      setRouterInfo({ id: active.id, name: active.name });
      const j = await readJson(await fetch(`/api/routers/${encodeURIComponent(active.id)}/models`, { method: "POST" }));
      if (dead) return;
      const models = (j.models as string[]) ?? [];
      setModelChoices(models);
      if (j.error) setModelsNote(String(j.error));
    })().catch(() => { if (!dead) setModelsNote("The Router's model list could not be read."); });
    return () => { dead = true; };
  }, []);

  useEffect(() => { traceEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [lines, blocked]);

  /** Consume one NDJSON stream from the agent route, mutating the trace as events land. */
  async function consume(res: Response, runIdRef: { current: string | null }) {
    const reader = res.body?.getReader();
    if (!reader) { setErr("The dashboard answered with no stream."); return; }
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const rows = buf.split("\n");
      buf = rows.pop() ?? "";
      for (const row of rows) {
        if (!row.trim()) continue;
        let e: Record<string, unknown>;
        try { e = JSON.parse(row); } catch { continue; }
        if (e.t === "run") runIdRef.current = String(e.id);
        else if (e.t === "note") setLines((l) => [...l, { kind: "note", text: String(e.c) }]);
        else if (e.t === "text") setLines((l) => [...l, { kind: "text", text: String(e.c) }]);
        else if (e.t === "tool") {
          setLines((l) => [...l, {
            kind: "tool",
            text: humanize(String(e.name), e.args, String(e.preview ?? ""), e.error ? String(e.error) : undefined),
            error: Boolean(e.error),
          }]);
        } else if (e.t === "approval-parked") {
          setBlocked({
            runId: runIdRef.current ?? "",
            approvalId: String(e.approvalId), tool: String(e.tool), summary: String(e.summary),
          });
        } else if (e.t === "artifacts") {
          const runId = runIdRef.current ?? "";
          setArtifacts((prev) => [
            ...prev,
            ...((e.items as { path: string; kind: string }[]) ?? []).map((a) => ({ ...a, runId })),
          ]);
        } else if (e.t === "finish") {
          if (e.threadId) setThreadId(String(e.threadId));
          if (e.status !== "done" && e.status !== "blocked") {
            setLines((l) => [...l, { kind: "note", text: `Run ended ${String(e.status)}: ${String(e.text ?? "")}` }]);
          }
          void loadSessions();
        }
      }
    }
  }

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null); setBlocked(null);
    setLines((l) => [...l, { kind: "user", text }]);
    setPrompt("");
    const runIdRef = { current: null as string | null };
    try {
      const res = await fetch("/api/sen/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          threadId: threadId ?? undefined,
          model: modelSel || undefined,
          effort: effortSel || undefined,
        }),
      });
      if (!res.ok && !res.headers.get("content-type")?.includes("ndjson")) {
        const j = await readJson(res);
        setErr(String(j.error ?? `The dashboard answered ${res.status}.`));
      } else {
        await consume(res, runIdRef);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function resumeBlocked() {
    if (!blocked || busy) return;
    setBusy(true); setErr(null);
    const runIdRef = { current: blocked.runId };
    setBlocked(null);
    setLines((l) => [...l, { kind: "note", text: "Resuming the parked run…" }]);
    try {
      const res = await fetch("/api/sen/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume: runIdRef.current }),
      });
      if (!res.ok) {
        const j = await readJson(res);
        setErr(String(j.error ?? `The dashboard answered ${res.status}.`));
      } else {
        await consume(res, runIdRef);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {embedded && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot size={15} style={{ color: "#7dd3fc" }} />
            <span className="text-[14px] font-medium" style={{ color: "var(--cream)" }}>{AUKER_NAME}</span>
            <span className="text-[11px]" style={{ color: "var(--cream-mute)" }}>deliverable-first agent</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AUKER_CAPABILITIES.map((cap) => (
              <span
                key={cap.id}
                title={cap.detail}
                className="rounded-md border px-2 py-0.5 text-[10px]"
                style={{ borderColor: "var(--line-soft)", color: "var(--cream-dim)" }}
              >
                {cap.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Embedded inside SenView's Agent tab, the shared tab bar is the
          only header — this block would read as a second one. */}
      {!embedded && (
      <div>
        <h1 className="text-2xl tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500 }}>
          Sen Agent
        </h1>
        <p className="mt-1 text-[12.5px] text-[var(--cream-mute)] max-w-2xl">
          The central NEWS OS orchestrator: ask for something tangible and it lands as a file in the run&apos;s
          artifacts, with the trace below showing every tool it touched. Writes outside the run folder and
          external calls park in the{" "}
          <Link href="/automations" className="underline" style={{ color: "var(--gold)" }}>Automations Inbox</Link>{" "}
          for a human yes first.
        </p>
      </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[15rem_1fr_340px]">
        {/* ---------------------------------------------------------- sessions */}
        <section className="panel p-3 flex flex-col gap-2 max-h-[38rem]">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[12px] font-medium tracking-wide uppercase" style={{ color: "var(--fg-dim)" }}>
              <MessagesSquare size={13} /> Sessions
            </h2>
            <button onClick={newSession} disabled={busy}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition hover:brightness-110 disabled:opacity-50"
                    style={{ background: "rgba(125,211,252,0.14)", color: "#7dd3fc" }}>
              <Plus size={11} /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {sessions.length === 0 && (
              <div className="text-[11.5px] text-[var(--cream-mute)]">No past sessions yet — a conversation lands here after its first run.</div>
            )}
            {sessions.map((s) => (
              <button key={s.threadId} onClick={() => void openSession(s.threadId)} disabled={busy}
                      className="w-full text-left rounded-lg border p-2 transition hover:brightness-125 disabled:opacity-50"
                      style={{
                        borderColor: s.threadId === threadId ? "var(--gold)" : "var(--line-soft)",
                        background: s.threadId === threadId ? "rgba(212,165,116,0.08)" : "transparent",
                      }}>
                <div className="text-[12px] truncate" style={{ color: "var(--cream)" }}>
                  {s.firstUserText || "(no prompt)"}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--cream-mute)]">
                  {s.runCount} run{s.runCount === 1 ? "" : "s"} · {new Date(s.updatedAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------ chat */}
        <section className={`panel aura-border p-4 flex flex-col min-h-[28rem] ${busy ? "aura-border--live" : ""}`}>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[34rem]">
            {lines.length === 0 && (
              <div className="text-[12px] text-[var(--cream-mute)] py-10 text-center">
                Try “a one-page weekly summary as a web page” — the answer arrives as a file.
              </div>
            )}
            {lines.map((l, i) => (
              <div key={i} className={
                l.kind === "user"
                  ? "ml-auto max-w-[85%] rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap"
                  : l.kind === "tool"
                    ? "text-[11px] mono"
                    : l.kind === "note"
                      ? "text-[11px] italic"
                      : "mr-auto max-w-[90%] text-[13px] whitespace-pre-wrap"
              }
                style={
                  l.kind === "user"
                    ? { background: "rgba(125,211,252,0.14)", color: "var(--cream)" }
                    : l.kind === "tool"
                      ? { color: l.error ? "#fb7185" : "var(--cream-mute)" }
                      : l.kind === "note"
                        ? { color: "var(--cream-mute)" }
                        : { color: "var(--cream)" }
                }>
                {l.kind === "tool" && <span className="opacity-60">⚙ </span>}
                {l.text}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--gold)" }}>
                <Loader2 size={12} className="animate-spin" /> Sen is working…
              </div>
            )}
            <div ref={traceEnd} />
          </div>

          {blocked && (
            <div className="mt-3 rounded-lg border p-3 space-y-2"
                 style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.08)" }}>
              <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "#fbbf24" }}>
                <TriangleAlert size={14} />
                <span className="font-medium">Parked for approval</span>
              </div>
              <div className="text-[11.5px] text-[var(--cream-dim)]">{blocked.summary}</div>
              <div className="flex items-center gap-3 text-[11.5px]">
                <Link href="/automations" className="flex items-center gap-1 underline" style={{ color: "var(--gold)" }}>
                  <Inbox size={12} /> Answer it in the Inbox
                </Link>
                <button onClick={resumeBlocked}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md transition hover:brightness-110"
                        style={{ background: "rgba(251,191,36,0.18)", color: "#fbbf24" }}>
                  <Play size={11} /> Resume after answering
                </button>
              </div>
            </div>
          )}

          {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}

          {/* Brain pickers — what the next run asks its Router for. Both
              default to "not asked", which is exactly the old behavior. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--cream-mute)]">
            <span className="flex items-center gap-1">
              <Cpu size={12} />
              {routerInfo ? routerInfo.name : "router"}
            </span>
            <select
              value={modelSel}
              onChange={(e) => setModelSel(e.target.value)}
              title={modelsNote ?? (modelChoices?.length ? "Models this Router's endpoint lists" : "Reading the Router's model list…")}
              className="bg-transparent border border-[var(--line-soft)] rounded-md px-2 py-1 text-[11px] outline-none focus:border-[var(--gold)] max-w-[16rem] truncate"
            >
              <option value="">router default</option>
              {(modelChoices ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              value={effortSel}
              onChange={(e) => setEffortSel(e.target.value)}
              title="Reasoning effort, sent as reasoning_effort — an endpoint that does not support it ignores it"
              className="bg-transparent border border-[var(--line-soft)] rounded-md px-2 py-1 text-[11px] outline-none focus:border-[var(--gold)]"
            >
              <option value="">effort: default</option>
              <option value="low">effort: low</option>
              <option value="medium">effort: medium</option>
              <option value="high">effort: high</option>
              <option value="xhigh">effort: xhigh</option>
            </select>
            {modelsNote && <span className="opacity-70" title={modelsNote}>model list unread — default only</span>}
          </div>

          <div className="mt-3 flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              rows={2}
              placeholder="Ask for a deliverable…"
              className="flex-1 bg-transparent border border-[var(--line-soft)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[var(--gold)] resize-none"
            />
            <button onClick={send} disabled={busy || !prompt.trim()}
                    className="self-end flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-lg transition hover:brightness-110 disabled:opacity-50"
                    style={{ background: "rgba(125,211,252,0.18)", color: "#7dd3fc" }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
            </button>
          </div>
        </section>

        {/* ------------------------------------------------- artifacts + MCP */}
        <div className="space-y-5">
          <section className="panel p-4 space-y-2">
            <h2 className="flex items-center gap-2 text-[12px] font-medium tracking-wide uppercase" style={{ color: "var(--fg-dim)" }}>
              <FileText size={13} /> Artifacts
            </h2>
            {artifacts.length === 0 && (
              <div className="text-[11.5px] text-[var(--cream-mute)]">Files a run makes land here, linked.</div>
            )}
            {artifacts.map((a, i) => (
              <button key={`${a.runId}-${a.path}-${i}`}
                 type="button"
                 onClick={() => void openArtifact(a)}
                 className="block w-full text-left text-[12px] mono truncate transition hover:brightness-125"
                 style={{ color: "var(--gold)" }}>
                {a.path} <span className="opacity-60">({a.kind})</span>
              </button>
            ))}
          </section>

          <McpServersPanel />
        </div>
      </div>
    </div>
  );
}
