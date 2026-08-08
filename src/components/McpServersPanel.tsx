"use client";

import { useCallback, useState } from "react";
import { Loader2, Plug, Trash2, TriangleAlert } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface McpServer {
  id: string; name: string; transport: "stdio" | "http";
  command?: string; args?: string[]; url?: string;
  allowedTools?: string[]; usePrefix: boolean; enabled: boolean;
  env?: Record<string, string>; headers?: Record<string, string>;
  notes: string; createdAt: string;
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return await r.json(); }
  catch { return { error: `The server returned ${r.status} with no explanation.` }; }
}

export default function McpServersPanel({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const j = await readJson(await fetch("/api/mcp-servers", { cache: "no-store" }));
    setServers((j.servers as McpServer[]) ?? []);
    if (j.error) setErr(String(j.error));
  }, []);
  usePollWhileVisible(load, 8000);

  async function test(id: string) {
    setTestOut((t) => ({ ...t, [id]: "…" }));
    const j = await readJson(await fetch(`/api/mcp-servers/${id}/test`, { method: "POST" }));
    setTestOut((t) => ({
      ...t,
      [id]: j.ok ? `${j.toolCount} tools: ${(j.tools as string[]).join(", ") || "—"}` : String(j.error),
    }));
  }

  async function toggle(s: McpServer) {
    await fetch(`/api/mcp-servers/${s.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await load();
  }

  async function remove(s: McpServer) {
    if (!confirm(`Remove "${s.name}"? Agents lose its tools immediately.`)) return;
    const j = await readJson(await fetch(`/api/mcp-servers/${s.id}`, { method: "DELETE" }));
    if (j.error) setErr(String(j.error)); else { setErr(null); await load(); }
  }

  const wrap = compact
    ? `panel p-3 flex flex-col gap-2 min-h-0 ${className}`
    : `panel p-4 space-y-3 ${className}`;

  return (
    <section className={wrap}>
      <div className="flex items-center justify-between shrink-0">
        <h2 className="flex items-center gap-2 text-[12px] font-medium tracking-wide uppercase" style={{ color: "var(--fg-dim)" }}>
          <Plug size={13} /> MCP servers
        </h2>
        <button onClick={() => setShowForm((v) => !v)}
                className="text-[11px] px-2 py-1 rounded-md transition hover:brightness-110"
                style={{ background: "rgba(125,211,252,0.14)", color: "#7dd3fc" }}>
          {showForm ? "Close" : "+ Add"}
        </button>
      </div>

      <div className={`space-y-2 min-h-0 ${compact ? "flex-1 overflow-y-auto sidebar-scroll" : ""}`}>
        <div className="flex items-start gap-2 text-[11px] leading-snug rounded-md p-2"
             style={{ background: "rgba(251,113,133,0.08)", color: "#fda4af" }}>
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            An MCP server is code this machine runs or an endpoint it calls with the credentials you store here.
            Add only servers you trust — Agent OS connects to what you configure; it never installs one itself.
          </span>
        </div>

        {err && <div className="text-[11.5px] text-rose-300">{err}</div>}

        {showForm && <McpForm onDone={() => { setShowForm(false); void load(); }} />}

        {servers.length === 0 && !showForm && (
          <div className="text-[11.5px] text-[var(--cream-mute)]">No connectors yet — Sen runs fine without any.</div>
        )}

        {servers.map((s) => (
          <div key={s.id} className="rounded-lg border border-[var(--line-soft)] p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-medium">
                {s.name}
                <span className="ml-2 text-[10px] mono text-[var(--cream-mute)]">
                  {s.transport === "stdio" ? s.command : s.url}
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => test(s.id)} title="Connect and list tools"
                        className="text-[10.5px] px-2 py-0.5 rounded-md transition hover:brightness-110"
                        style={{ background: "rgba(45,212,191,0.14)", color: "#2dd4bf" }}>Test</button>
                <button onClick={() => toggle(s)}
                        className="text-[10.5px] px-2 py-0.5 rounded-md transition hover:brightness-110"
                        style={{ background: s.enabled ? "rgba(134,239,172,0.12)" : "rgba(255,255,255,0.06)",
                                 color: s.enabled ? "#86efac" : "var(--cream-mute)" }}>
                  {s.enabled ? "on" : "off"}
                </button>
                <button onClick={() => remove(s)} className="text-[var(--cream-mute)] hover:text-rose-300 transition">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {s.allowedTools?.length ? (
              <div className="text-[10.5px] text-[var(--cream-mute)]">only: {s.allowedTools.join(", ")}</div>
            ) : null}
            {testOut[s.id] && <div className="text-[10.5px] mono text-[var(--cream-dim)] break-all">{testOut[s.id]}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function McpForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [allowed, setAllowed] = useState("");
  const [envText, setEnvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function parseKv(text: string): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) throw new Error(`"${t}" is not KEY=value.`);
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return Object.keys(out).length ? out : undefined;
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const payload: Record<string, unknown> = {
        name, transport,
        allowedTools: allowed.trim() ? allowed.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      };
      if (transport === "stdio") {
        payload.command = command;
        payload.args = argsText.trim() ? argsText.split(/\s+/) : undefined;
        payload.env = parseKv(envText);
      } else {
        payload.url = url;
        payload.headers = parseKv(envText);
      }
      const j = await readJson(await fetch("/api/mcp-servers", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      }));
      if (j.error) { setErr(String(j.error)); return; }
      onDone();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full bg-transparent border border-[var(--line-soft)] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--gold)]";
  const label = "block text-[10.5px] uppercase tracking-wider text-[var(--cream-mute)] mb-0.5";

  return (
    <div className="rounded-lg border border-[var(--line-soft)] p-3 space-y-2.5">
      <div>
        <span className={label}>Name (becomes the tool prefix)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-tools" className={input} />
      </div>
      <div>
        <span className={label}>Transport</span>
        <select value={transport} onChange={(e) => setTransport(e.target.value as "stdio" | "http")} className={input}>
          <option value="stdio">stdio — spawn a local command</option>
          <option value="http">http — streamable HTTP / SSE endpoint</option>
        </select>
      </div>
      {transport === "stdio" ? (
        <>
          <div>
            <span className={label}>Command (already on this machine — nothing gets installed)</span>
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className={input} />
          </div>
          <div>
            <span className={label}>Args (space-separated)</span>
            <input value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="-y @some/mcp-server" className={input} />
          </div>
        </>
      ) : (
        <div>
          <span className={label}>Endpoint URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3737/mcp" className={input} />
        </div>
      )}
      <div>
        <span className={label}>{transport === "stdio" ? "Env (KEY=value per line, stored masked)" : "Headers (KEY=value per line, stored masked)"}</span>
        <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={2}
                  placeholder={transport === "http" ? "Authorization=Bearer …" : "API_KEY=…"} className={`${input} resize-y`} />
      </div>
      <div>
        <span className={label}>Allowed tools (comma-separated, blank = all)</span>
        <input value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder="search, fetch" className={input} />
      </div>
      {err && <div className="text-[11.5px] text-rose-300">{err}</div>}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving || !name.trim()}
                className="flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded-lg transition hover:brightness-110 disabled:opacity-50"
                style={{ background: "rgba(212,165,116,0.2)", color: "var(--gold)" }}>
          {saving && <Loader2 size={11} className="animate-spin" />} Add server
        </button>
      </div>
    </div>
  );
}
