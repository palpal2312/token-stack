"use client";

// One agent instance: the skin's chat, pinned to the account the user chose.
//
// Two agents wearing the same skin are two separate conversations against two
// separate profiles, which is the whole point — so the transcript is keyed by
// instance id on the server and nothing here ever falls back to a default
// profile. If the bound profile is gone, the page says so and offers a rebind
// rather than quietly answering from somebody else's account.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, ExternalLink, Link2, Loader2, Trash2, TriangleAlert, User } from "lucide-react";
import { skinById } from "@/lib/skins";
import SkinHost from "./SkinHost";

interface AgentRow {
  id: string;
  name: string;
  skinId: string;
  backend: { kind: string; refId?: string };
  createdAt: string;
}
interface Turn { role: "user" | "assistant"; text: string; ts: string }
interface BuilderRow { id: string; cli: string; name: string }
interface RouterRow { id: string; kind: string; name: string; defaultModel: string | null }

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return (await r.json()) as Record<string, unknown>; }
  catch { return { error: `${r.status} ${r.statusText}` }; }
}

export default function AgentInstanceView({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [builderId, setBuilderId] = useState<string | null>(null);
  const [routerId, setRouterId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const j = await readJson(await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { cache: "no-store" }));
    setLoading(false);
    if (j.error) { setLoadErr(String(j.error)); return; }
    setLoadErr(null);
    setAgent(j.agent as AgentRow);
    setBuilderId((j.builderId as string | null) ?? null);
    setRouterId((j.routerId as string | null) ?? null);
    setProblem((j.problem as string | null) ?? null);
    setTurns((j.history as Turn[]) ?? []);
  }, [agentId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, live]);

  const skin = agent ? skinById(agent.skinId) : null;
  const accent = skin?.accent ?? "#a855f7";

  // One of the two is set, never both — resolveAgent decides which, and a
  // dangling reference leaves both null so the composer stays disabled.
  const endpoint = builderId
    ? `/api/builders/${encodeURIComponent(builderId)}/chat`
    : routerId
      ? `/api/routers/${encodeURIComponent(routerId)}/chat`
      : null;

  async function send() {
    const prompt = draft.trim();
    if (!prompt || !endpoint || busy) return;
    setDraft("");
    setNotes([]);
    setBusy(true);
    setTurns((t) => [...t, { role: "user", text: prompt, ts: new Date().toISOString() }]);
    setLive("");

    let answer = "";
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, agentId }),
      });
      if (!r.ok || !r.body) {
        const j = await readJson(r);
        setNotes([String(j.error ?? `${r.status} ${r.statusText}`)]);
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            let e: Record<string, unknown>;
            try { e = JSON.parse(line); } catch { continue; }
            if (e.t === "d") { answer += String(e.c); setLive(answer); }
            else if (e.t === "note") setNotes((n) => [...n, String(e.c)]);
            else if (e.t === "error") setNotes((n) => [...n, String(e.m)]);
            else if (e.t === "final" && e.error) setNotes((n) => [...n, String(e.error)]);
          }
        }
      }
    } catch (e) {
      setNotes((n) => [...n, String((e as Error)?.message ?? e)]);
    }

    setLive(null);
    setBusy(false);
    if (answer.trim()) {
      setTurns((t) => [...t, { role: "assistant", text: answer, ts: new Date().toISOString() }]);
    }
  }

  async function remove() {
    if (!agent) return;
    if (!confirm(`Delete "${agent.name}"? Its transcript stays on disk.`)) return;
    const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
    const j = await readJson(r);
    if (j.error) { setLoadErr(String(j.error)); return; }
    window.dispatchEvent(new CustomEvent("agentos:agents-changed"));
    router.push("/agents/new");
  }

  if (loading) return <div className="text-[13px] p-4" style={{ color: "var(--fg-dimmer)" }}>Loading…</div>;
  if (loadErr) return <Banner>{loadErr}</Banner>;
  if (!agent) return <Banner>This agent no longer exists.</Banner>;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
            <h1 className="text-lg tracking-tight truncate"
                style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500 }}>
              {agent.name}
            </h1>
          </div>
          <div className="text-[11.5px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: "var(--fg-dimmer)" }}>
            <span>{skin?.label ?? agent.skinId} skin</span>
            <span>·</span>
            {agent.backend.kind === "builtin"
              ? <span>built-in engine</span>
              : (
                <span className="flex items-center gap-1">
                  <Link2 size={11} />
                  <span className="metric">{agent.backend.refId}</span>
                  <span>{agent.backend.kind === "router" ? "router" : "profile"}</span>
                </span>
              )}
            {skin && (
              <>
                <span>·</span>
                <Link href={skin.route} className="flex items-center gap-1 hover:underline">
                  <ExternalLink size={11} /> classic tab
                </Link>
              </>
            )}
          </div>
        </div>
        <button
          onClick={remove}
          title="Delete this agent"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] shrink-0"
          style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}
        >
          <Trash2 size={13} /> Delete
        </button>
      </header>

      {problem && (
        <Rebind
          agentId={agentId}
          skinId={agent.skinId}
          backendKind={agent.backend.kind}
          problem={problem}
          onFixed={load}
        />
      )}

      {agent.backend.kind === "builtin" ? (
        <SkinHost skinId={agent.skinId} />
      ) : (
        <>
          <div className="panel p-4 space-y-4 min-h-[280px] max-h-[58vh] overflow-y-auto">
            {!turns.length && live === null && (
              <p className="text-[13px]" style={{ color: "var(--fg-dimmer)" }}>
                Nothing said yet. This conversation belongs to {agent.name} alone.
              </p>
            )}
            {turns.map((t, i) => <Bubble key={i} turn={t} accent={accent} />)}
            {live !== null && (
              <Bubble turn={{ role: "assistant", text: live || "…", ts: "" }} accent={accent} />
            )}
            <div ref={bottom} />
          </div>

          {notes.map((n, i) => (
            <div key={i} className="text-[11.5px] rounded-lg border px-3 py-2"
                 style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>
              {n}
            </div>
          ))}

          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              rows={2}
              disabled={Boolean(problem) || !endpoint}
              placeholder={problem || !endpoint
                ? "Rebind this agent to a backend first."
                : "Ask something. Enter sends, Shift+Enter is a new line."}
              className="flex-1 bg-transparent border rounded-lg px-3 py-2.5 text-[13px] outline-none resize-none"
              style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
            />
            <button
              onClick={() => void send()}
              disabled={busy || !draft.trim() || Boolean(problem) || !endpoint}
              className="grid place-items-center w-10 h-10 rounded-lg border shrink-0"
              style={{
                borderColor: busy || !draft.trim() ? "var(--panel-border)" : accent,
                background: busy || !draft.trim() ? "transparent" : `${accent}1f`,
                color: "var(--fg)",
              }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Bubble({ turn, accent }: { turn: Turn; accent: string }) {
  const mine = turn.role === "user";
  return (
    <div className="flex gap-2.5">
      <div className="grid place-items-center w-6 h-6 rounded-full shrink-0 mt-0.5"
           style={{ background: mine ? "var(--panel-border)" : `${accent}26`, color: mine ? "var(--fg-dim)" : accent }}>
        {mine ? <User size={12} /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />}
      </div>
      <div className="text-[13px] whitespace-pre-wrap min-w-0 flex-1"
           style={{ color: mine ? "var(--fg-dim)" : "var(--fg)" }}>
        {turn.text}
      </div>
    </div>
  );
}

/**
 * A dangling backend is expected — profiles and Routers get deleted. This is the
 * fix, inline. It rebinds within the same backend kind: a Router-backed agent
 * gets Routers to choose from, not a CLI profile, because swapping the kind would
 * change what the transcript above was said by.
 */
function Rebind({ agentId, skinId, backendKind, problem, onFixed }: {
  agentId: string; skinId: string; backendKind: string; problem: string; onFixed: () => void;
}) {
  const isRouter = backendKind === "router";
  const [builders, setBuilders] = useState<BuilderRow[]>([]);
  const [routers, setRouters] = useState<RouterRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const skin = skinById(skinId);

  useEffect(() => {
    fetch(isRouter ? "/api/routers" : "/api/builders", { cache: "no-store" }).then(readJson).then((j) => {
      if (j.error) return;
      if (isRouter) setRouters((j.routers as RouterRow[]) ?? []);
      else setBuilders((j.builders as BuilderRow[]) ?? []);
    }).catch(() => { /* the banner already explains the main problem */ });
  }, [isRouter]);

  // Any Router can drive any router-capable skin: they all speak the same wire
  // format, so there is nothing finer to filter on.
  const usable: (BuilderRow | RouterRow)[] = isRouter
    ? routers
    : skin ? builders.filter((b) => skin.accepts.includes(b.cli)) : [];

  async function bind(refId: string) {
    const j = await readJson(await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: { kind: isRouter ? "router" : "builder", refId } }),
    }));
    if (j.error) { setErr(String(j.error)); return; }
    window.dispatchEvent(new CustomEvent("agentos:agents-changed"));
    onFixed();
  }

  return (
    <div className="rounded-lg border px-3.5 py-3 space-y-2.5"
         style={{ borderColor: "#fbbf2455", background: "#fbbf2412" }}>
      <div className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--fg-dim)" }}>
        <TriangleAlert size={14} style={{ color: "#fbbf24", marginTop: 1, flexShrink: 0 }} />
        <span>{problem}</span>
      </div>
      {usable.length ? (
        <div className="flex flex-wrap gap-1.5">
          {usable.map((b) => (
            <button key={b.id} onClick={() => void bind(b.id)}
                    className="px-2.5 py-1.5 rounded-lg border text-[12px]"
                    style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}>
              {b.name}{" "}
              <span className="metric" style={{ color: "var(--fg-dimmer)" }}>
                {"cli" in b ? b.cli : b.kind}
              </span>
            </button>
          ))}
        </div>
      ) : isRouter ? (
        <p className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>
          There are no Routers left.{" "}
          <Link href="/routers" className="underline">Add one in Router Config</Link>.
        </p>
      ) : (
        <p className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>
          No profile can drive this skin.{" "}
          <Link href="/builders" className="underline">Create one in CLI Config</Link>.
        </p>
      )}
      {err && <p className="text-[12px]" style={{ color: "#fb7185" }}>{err}</p>}
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px]"
         style={{ borderColor: "#fb718555", background: "#fb718512", color: "var(--fg-dim)" }}>
      <TriangleAlert size={14} style={{ color: "#fb7185", marginTop: 1, flexShrink: 0 }} />
      <div>{children}</div>
    </div>
  );
}
