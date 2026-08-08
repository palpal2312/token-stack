"use client";

// A Router is one runnable configuration of an HTTP model endpoint — a base URL,
// a key, and a default model. It is to a gateway what a Builder is to a CLI, and
// this page is the same idea as CLI Config with processes swapped for requests.
//
// Same two promises as that page: a key is pasted by the user and never rendered
// in full afterwards, and nothing here signs anyone in. The one extra care is the
// health probe — it sends the key outbound, so it is a POST the user asks for,
// never something that fires on page load.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Plus, X, Check, KeyRound, Activity, Trash2, Star, Globe, HardDrive,
  AlertTriangle, CircleDot, Settings2, Pencil, SquareTerminal, ExternalLink,
  RefreshCw, Waypoints,
} from "lucide-react";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";

interface Kind {
  id: string; label: string; defaultBaseUrl: string | null; keyRequired: boolean;
  keyHint: string; local: boolean; notes: string; profileCount: number;
}

interface Router {
  id: string; kind: string; name: string; baseUrl: string;
  hasKey: boolean; keyPreview: string; defaultModel: string | null;
  isDefault: boolean; notes: string; createdAt: string;
  plan?: boolean; payg?: boolean; dashboardUrl?: string | null; planQuota?: string | null;
}

interface Quota {
  exhausted: boolean; resetsAt: number | null; resetsAtLabel: string | null;
  rateLimit: number | null; rateRemaining: number | null; rateUsed: number | null;
  weeklyLimit: string | null; weeklyRemaining: string | null; weeklyUsed: string | null;
  exhaustedMessage: string | null;
}

interface Health {
  state: "ok" | "reachable" | "unauthorized" | "unreachable";
  message: string; models: number | null; status: number | null;
  durationMs: number; warnings: string[];
  quota?: Quota | null;
}

const STATE_COLOR: Record<Health["state"], string> = {
  ok: "#86efac",
  reachable: "#fbbf24",
  unauthorized: "#fb7185",
  unreachable: "#fb7185",
};

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return await r.json(); }
  catch { return { error: `The server returned ${r.status} with no explanation.` }; }
}

export default function RoutersView() {
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [routers, setRouters] = useState<Router[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, Health | "running">>({});
  const [healthTime, setHealthTime] = useState<Record<string, number>>({});
  const [addFor, setAddFor] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<{ kind: Kind; router: Router } | null>(null);
  const [cliFor, setCliFor] = useState<Router | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const routersRef = useRef<Router[]>([]);

  async function load() {
    setRefreshing(true);
    try {
      const j = await readJson(await fetch("/api/routers", { cache: "no-store" }));
      setKinds((j.kinds as Kind[]) ?? []);
      const rs = (j.routers as Router[]) ?? [];
      setRouters(rs);
      routersRef.current = rs;
      setErr((j.error as string) ?? null);
    } catch (e) {
      setErr(`Could not reach the dashboard's own API: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }

  const probe = useCallback(async (r: Router) => {
    setHealth((h) => ({ ...h, [r.id]: "running" }));
    const fallback = (message: string): Health => ({
      state: "unreachable", message, models: null, status: null, durationMs: 0, warnings: [],
    });
    try {
      const j = await readJson(await fetch(`/api/routers/${r.id}/health`, { method: "POST" }));
      setHealth((h) => ({
        ...h,
        [r.id]: (j.health as Health) ?? fallback(String(j.error ?? "The check failed.")),
      }));
      setHealthTime((t) => ({ ...t, [r.id]: Date.now() }));
    } catch (e) {
      setHealth((h) => ({
        ...h,
        [r.id]: fallback(`The check could not be sent: ${String((e as Error)?.message ?? e)}`),
      }));
    }
  }, []);

  // Auto-probe routers with plan/payg on mount, then every 5 minutes
  const probeAllBilling = useCallback(async () => {
    const billing = routersRef.current.filter((r) => r.plan || r.payg);
    for (const r of billing) probe(r);
  }, [probe]);

  useEffect(() => {
    load().then(() => {
      // Initiate probes directly; probing triggers localized state updates without blocking the main render
      probeAllBilling();
    });
  }, [probeAllBilling]);

  useEffect(() => {
    const id = setInterval(probeAllBilling, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [probeAllBilling]);

  async function remove(r: Router) {
    if (!confirm(
      `Delete "${r.name}"?\n\nAgents bound to it will say so and offer another Router — `
      + `their conversations stay on disk.`,
    )) return;
    const j = await readJson(await fetch(`/api/routers/${r.id}`, { method: "DELETE" }));
    if (j.error) setErr(j.error as string); else { setErr(null); await load(); }
  }

  async function makeDefault(r: Router) {
    await fetch(`/api/routers/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    await load();
  }

  const byKind = useMemo(() => {
    const m: Record<string, Router[]> = {};
    for (const r of routers) (m[r.kind] ??= []).push(r);
    return m;
  }, [routers]);

  const stats = useMemo(() => ({
    routers: routers.length,
    kinds: new Set(routers.map((r) => r.kind)).size,
    withKey: routers.filter((r) => r.hasKey).length,
  }), [routers]);

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
          <PageHeaderIcon gradient="linear-gradient(135deg,#2dd4bf,#0d9488)">
          <Waypoints size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Router Config
            <HeaderStatPills
              stats={[
                { label: `${stats.routers} routers`, tone: stats.routers ? "ok" : "neutral" },
                { label: `${stats.kinds}/${kinds.length} kinds`, tone: stats.kinds ? "accent" : "neutral" },
                { label: `${stats.withKey} with key`, tone: stats.withKey ? "ok" : "warn" },
              ]}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="ml-auto shrink-0 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
      {err && (
        <div className="panel p-3 flex items-start gap-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
          <div className="text-[12px] text-rose-300">{err}</div>
        </div>
      )}

      {!loaded && <div className="text-sm text-[var(--fg-dim)] py-8 text-center">Reading your Routers…</div>}

      <div className="space-y-3">
        {kinds.map((k) => (
          <KindCard
            key={k.id}
            kind={k}
            routers={byKind[k.id] ?? []}
            health={health}
            healthTime={healthTime}
            onAdd={() => setAddFor(k)}
            onProbe={probe}
            onDelete={remove}
            onDefault={makeDefault}
            onEdit={(r) => setEditing({ kind: k, router: r })}
            onUseWithCli={(r) => setCliFor(r)}
          />
        ))}
      </div>

      <AnimatePresence>
        {addFor && (
          <RouterModal
            kind={addFor}
            onClose={() => setAddFor(null)}
            onSaved={async () => { setAddFor(null); await load(); }}
            onError={setErr}
          />
        )}
        {editing && (
          <RouterModal
            kind={editing.kind}
            existing={editing.router}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load(); }}
            onError={setErr}
          />
        )}
        {cliFor && (
          <UseWithCliModal router={cliFor} onClose={() => setCliFor(null)} />
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

function KindCard({ kind, routers, health, healthTime, onAdd, onProbe, onDelete, onDefault, onEdit, onUseWithCli }: {
  kind: Kind; routers: Router[]; health: Record<string, Health | "running">;
  healthTime: Record<string, number>;
  onAdd: () => void; onProbe: (r: Router) => void; onDelete: (r: Router) => void;
  onDefault: (r: Router) => void; onEdit: (r: Router) => void; onUseWithCli: (r: Router) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);

  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 grid place-items-center w-9 h-9 rounded-lg"
              style={{ background: routers.length ? "rgba(134,239,172,0.12)" : "rgba(255,255,255,0.04)" }}>
          {kind.local
            ? <HardDrive size={16} style={{ color: routers.length ? "#86efac" : "var(--fg-dimmer)" }} />
            : <Globe size={16} style={{ color: routers.length ? "#86efac" : "var(--fg-dimmer)" }} />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px]">{kind.label}</span>
            <Pill tone={kind.local ? "info" : "off"}>{kind.local ? "on this machine" : "over the internet"}</Pill>
            {kind.keyRequired
              ? <Pill tone="off">key required</Pill>
              : <Pill tone="off" title="The endpoint answers without an Authorization header.">no key needed</Pill>}
            <span className="text-[11px] text-[var(--fg-dimmer)]">
              {routers.length} router{routers.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mono text-[11px] text-[var(--fg-dimmer)] mt-1 truncate" title={kind.defaultBaseUrl ?? ""}>
            {kind.defaultBaseUrl ?? "you supply the base URL"}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setShowNotes((s) => !s)} title="What this kind is"
                  className="grid place-items-center w-8 h-8 rounded-lg text-[var(--fg-dim)] hover:text-[var(--fg)] transition">
            <Settings2 size={14} />
          </button>
          <button onClick={onAdd}
                  className="px-3 h-8 rounded-lg flex items-center gap-1.5 text-[12px] transition"
                  style={{ background: "rgba(34,211,238,0.16)", border: "1px solid rgba(34,211,238,0.45)", color: "#22d3ee" }}>
            <Plus size={13} /> Add router
          </button>
        </div>
      </div>

      {showNotes && (
        <div className="text-[11px] text-[var(--fg-dim)] mt-3 pt-3 border-t border-[var(--panel-border)] leading-relaxed">
          {kind.notes}
        </div>
      )}

      {routers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--panel-border)] space-y-2">
          {routers.map((r) => (
            <RouterRow key={r.id} router={r} health={health[r.id]} checkedAt={healthTime[r.id]}
                       onProbe={() => onProbe(r)} onDelete={() => onDelete(r)}
                       onDefault={() => onDefault(r)} onEdit={() => onEdit(r)}
                       onUseWithCli={() => onUseWithCli(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RouterRow({ router: r, health, checkedAt, onProbe, onDelete, onDefault, onEdit, onUseWithCli }: {
  router: Router; health: Health | "running" | undefined; checkedAt?: number;
  onProbe: () => void; onDelete: () => void; onDefault: () => void; onEdit: () => void;
  onUseWithCli: () => void;
}) {
  const h = health === "running" ? null : health;
  const dot = h ? STATE_COLOR[h.state] : "var(--fg-dimmer)";

  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.18)" }}>
      <div className="flex items-center gap-2.5">
        <CircleDot size={12} style={{ color: dot }} className={health === "running" ? "animate-pulse" : ""} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px]">{r.name}</span>
            {r.isDefault && <Pill tone="info">default</Pill>}
            {r.plan !== undefined && <Pill tone={r.plan ? "good" : "off"} title={r.plan ? `Subscription plan active${r.planQuota ? ` — ${r.planQuota}` : ""}` : "No subscription plan"}>{r.plan && r.planQuota ? `Plan · ${r.planQuota}` : "Plan"}</Pill>}
            {r.payg !== undefined && (
              r.dashboardUrl
                ? <a href={r.dashboardUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                    <Pill tone={r.payg ? "good" : "off"} title={r.payg ? "Pay-as-you-go activated — click for dashboard" : "PAYG not activated"}>PAYG <ExternalLink size={8} style={{ display: "inline", verticalAlign: "middle", marginLeft: 2 }} /></Pill>
                  </a>
                : <Pill tone={r.payg ? "good" : "off"} title={r.payg ? "Pay-as-you-go activated" : "PAYG not activated"}>PAYG</Pill>
            )}
            {r.hasKey
              ? <span className="mono text-[10px] text-[var(--fg-dimmer)]" title="Stored locally, never shown in full.">
                  key {r.keyPreview}
                </span>
              : <Pill tone="off">no key</Pill>}
            {r.defaultModel && <span className="mono text-[10px] text-[var(--fg-dimmer)]">{r.defaultModel}</span>}
          </div>
          <div className="mono text-[11px] text-[var(--fg-dimmer)] mt-1 truncate" title={r.baseUrl}>{r.baseUrl}</div>
          {h && (
            <div className="text-[11px] mt-1"
                 style={{ color: h.state === "ok" ? "var(--fg-dim)" : STATE_COLOR[h.state] }}>
              {h.message}
            </div>
          )}
          {h?.warnings.map((w, i) => <div key={i} className="text-[11px] text-amber-300 mt-0.5">{w}</div>)}
          {h?.quota && <QuotaDisplay quota={h.quota} checkedAt={checkedAt} dashboardUrl={r.dashboardUrl} />}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <IconBtn title="Use this Router as a CLI profile (codex -p …, claude, kimi)" onClick={onUseWithCli}><SquareTerminal size={13} /></IconBtn>
          <IconBtn title="Ask this endpoint whether it is there" onClick={onProbe}><Activity size={13} /></IconBtn>
          <IconBtn title="Edit this Router" onClick={onEdit}><Pencil size={13} /></IconBtn>
          {!r.isDefault && <IconBtn title="Make this the default for its kind" onClick={onDefault}><Star size={13} /></IconBtn>}
          <IconBtn title="Delete this Router" onClick={onDelete} danger><Trash2 size={13} /></IconBtn>
        </div>
      </div>
    </div>
  );
}

/**
 * One modal for both creating and editing.
 *
 * The key field starts blank when editing, never pre-filled with the mask: a
 * masked value posted back would replace a working key with "sk-o…9f2c", and the
 * registry refuses it for exactly that reason. Blank means "leave it alone".
 */
function RouterModal({ kind, existing, onClose, onSaved, onError }: {
  kind: Kind; existing?: Router; onClose: () => void; onSaved: () => void; onError: (e: string) => void;
}) {
  const editingExisting = Boolean(existing);
  const [name, setName] = useState(existing?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? kind.defaultBaseUrl ?? "");
  const [secret, setSecret] = useState("");
  const [model, setModel] = useState(existing?.defaultModel ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [plan, setPlan] = useState(existing?.plan ?? false);
  const [payg, setPayg] = useState(existing?.payg ?? false);
  const [dashboardUrl, setDashboardUrl] = useState(existing?.dashboardUrl ?? "");
  const [planQuota, setPlanQuota] = useState(existing?.planQuota ?? "");
  const [busy, setBusy] = useState(false);

  const needsKey = kind.keyRequired && !editingExisting;

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        kind: kind.id,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        defaultModel: model.trim() || null,
        notes: notes.trim(),
        plan,
        payg,
        dashboardUrl: dashboardUrl.trim() || null,
        planQuota: planQuota.trim() || null,
      };
      if (secret.trim()) body.apiKey = secret.trim();

      const r = await fetch(existing ? `/api/routers/${existing.id}` : "/api/routers", {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let j: Record<string, unknown> = {};
      try { j = await r.json(); } catch { /* the status is the message */ }
      if (!r.ok) { onError(String(j.error ?? `Could not save the Router (${r.status}).`)); return; }
      setSecret("");   // never leave a key sitting in component state
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 grid place-items-center p-4"
                style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
                  className="panel p-5 w-full max-w-[520px] space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px]">{existing ? `Edit “${existing.name}”` : `New ${kind.label} router`}</h3>
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={16} /></button>
        </div>

        <Field label="Name" hint="What you will recognise it by — “Work key”, “Free models”, “Laptop Ollama”.">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                 placeholder="Work key"
                 className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)]" />
        </Field>

        <Field label="Base URL" hint="Ends in /v1. Agent OS appends /chat/completions and /models itself.">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false}
                 placeholder={kind.defaultBaseUrl ?? "https://example.com/v1"}
                 className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)] mono" />
        </Field>

        <Field
          label="API key"
          hint={editingExisting
            ? "Leave blank to keep the key already stored. Type a new one to rotate it."
            : kind.keyHint}
        >
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-[var(--fg-dimmer)] shrink-0" />
            <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" spellCheck={false}
                   placeholder={editingExisting ? "unchanged" : kind.keyRequired ? "paste your key" : "optional"}
                   className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] mono" />
          </div>
        </Field>

        <Field label="Default model" hint="Sent with every turn unless the agent names its own. The endpoint will not guess one.">
          <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false}
                 placeholder="anthropic/claude-sonnet-4.5"
                 className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)] mono" />
        </Field>

        <Field label="Notes" hint="Optional — what this endpoint is for.">
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
                 className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)]" />
        </Field>

        <div className="border-t border-[var(--panel-border)] pt-3 mt-1">
          <div className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">Billing</div>
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none">
              <input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)}
                     className="accent-[#86efac]" />
              <span style={{ color: plan ? "#86efac" : "var(--fg-dim)" }}>Plan</span>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none">
              <input type="checkbox" checked={payg} onChange={(e) => setPayg(e.target.checked)}
                     className="accent-[#86efac]" />
              <span style={{ color: payg ? "#86efac" : "var(--fg-dim)" }}>PAYG</span>
            </label>
          </div>
          {plan && (
            <Field label="Plan Quota" hint='Describe the plan limit, e.g. "1M tokens/mo" or "$50/mo".'>
              <input value={planQuota} onChange={(e) => setPlanQuota(e.target.value)}
                     placeholder="e.g. 1M tokens/mo"
                     className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)] mono" />
            </Field>
          )}
          {payg && (
            <Field label="Dashboard URL" hint="Link to provider billing/usage dashboard.">
              <input value={dashboardUrl} onChange={(e) => setDashboardUrl(e.target.value)} spellCheck={false}
                     placeholder="https://console.example.com/billing"
                     className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)] mono" />
            </Field>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 h-[36px] rounded-lg text-[13px] text-[var(--fg-dim)]">Cancel</button>
          <button onClick={submit}
                  disabled={!name.trim() || !baseUrl.trim() || busy || (needsKey && !secret.trim())}
                  className="px-4 h-[36px] rounded-lg flex items-center gap-1.5 text-[13px] transition disabled:opacity-40"
                  style={{ background: "rgba(34,211,238,0.18)", border: "1px solid rgba(34,211,238,0.5)", color: "#22d3ee" }}>
            <Check size={14} /> {existing ? "Save" : "Create"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * "Use with CLI": turn this Router into a Builder profile of a coding CLI.
 * codex gets a native profile (`codex -p ao-<name>`) written into $CODEX_HOME;
 * claude gets an api-key Builder whose env points ANTHROPIC_BASE_URL at the
 * Router; kimi gets an isolated KIMI_CODE_HOME whose config.toml names the
 * Router as an OpenAI-compatible provider. The result panel repeats the
 * server's detail — file paths and env var names, never the key.
 */
function UseWithCliModal({ router, onClose }: { router: Router; onClose: () => void }) {
  const [cli, setCli] = useState<"codex" | "claude" | "kimi">("codex");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ builderName: string; created: boolean; detail: string[] } | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/routers/${router.id}/use-with-cli`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cli, name: name.trim() || undefined }),
      });
      const j = await readJson(r);
      if (!r.ok) { setError(String(j.error ?? `Could not create the profile (${r.status}).`)); return; }
      const b = j.builder as { name: string };
      setResult({ builderName: b.name, created: Boolean(j.created), detail: (j.detail as string[]) ?? [] });
    } finally { setBusy(false); }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 grid place-items-center p-4"
                style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
                  className="panel p-5 w-full max-w-[520px] space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px]">Use “{router.name}” with a CLI</h3>
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={16} /></button>
        </div>

        {result ? (
          <>
            <div className="text-[12px] text-[var(--fg-dim)]">
              {result.created ? "Builder profile created" : "Already set up"}: <span className="text-[var(--fg)]">{result.builderName}</span>
            </div>
            <ul className="space-y-1.5">
              {result.detail.map((d, i) => (
                <li key={i} className="text-[11px] text-[var(--fg-dim)] leading-relaxed break-all">{d}</li>
              ))}
            </ul>
            <div className="flex justify-between items-center pt-1">
              <Link href="/builders" className="text-[12px] text-[#22d3ee] underline">Open in CLI Config</Link>
              <button onClick={onClose} className="px-3 h-[36px] rounded-lg text-[13px] text-[var(--fg-dim)]">Done</button>
            </div>
          </>
        ) : (
          <>
            <Field label="CLI" hint="codex gets a native profile — codex -p ao-<name> — like one written by hand. claude gets an api-key Builder with ANTHROPIC_BASE_URL pointing at this Router. kimi gets its own KIMI_CODE_HOME with this Router as the provider.">
              <div className="flex gap-2">
                {(["codex", "claude", "kimi"] as const).map((c) => (
                  <button key={c} onClick={() => setCli(c)}
                          className="px-3 h-[38px] rounded-lg text-[13px] transition"
                          style={cli === c
                            ? { background: "rgba(34,211,238,0.16)", border: "1px solid rgba(34,211,238,0.45)", color: "#22d3ee" }
                            : { background: "rgba(255,255,255,0.04)", border: "1px solid var(--panel-border)", color: "var(--fg-dim)" }}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>

            {cli === "codex" && (
              <Field label="Profile name" hint={`Blank uses the Router name — the profile becomes ao-${router.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "router"}.`}>
                <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false}
                       placeholder={router.name}
                       className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)]" />
              </Field>
            )}

            {cli === "kimi" && (
              <Field label="Profile name" hint="Blank uses the Router name — it becomes the Builder's name.">
                <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false}
                       placeholder={router.name}
                       className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)]" />
              </Field>
            )}

            {error && <div className="text-[12px] text-rose-300">{error}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 h-[36px] rounded-lg text-[13px] text-[var(--fg-dim)]">Cancel</button>
              <button onClick={submit} disabled={busy}
                      className="px-4 h-[36px] rounded-lg flex items-center gap-1.5 text-[13px] transition disabled:opacity-40"
                      style={{ background: "rgba(34,211,238,0.18)", border: "1px solid rgba(34,211,238,0.5)", color: "#22d3ee" }}>
                <SquareTerminal size={14} /> {busy ? "Setting up…" : "Create profile"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">{label}</div>
      {children}
      {hint && <p className="text-[11px] text-[var(--fg-dim)] mt-1.5">{hint}</p>}
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: {
  title: string; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button title={title} onClick={onClick}
            className={`grid place-items-center w-7 h-7 rounded-md text-[var(--fg-dim)] transition hover:bg-[rgba(255,255,255,0.06)] ${danger ? "hover:text-rose-300" : "hover:text-[var(--fg)]"}`}>
      {children}
    </button>
  );
}

function QuotaDisplay({ quota: q, checkedAt, dashboardUrl }: { quota: Quota; checkedAt?: number; dashboardUrl?: string | null }) {
  // Format relative time for reset
  const resetLabel = q.resetsAt ? (() => {
    const diff = q.resetsAt! * 1000 - Date.now();
    if (diff <= 0) return "now";
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })() : null;

  // Weekly limit is meaningful only when it's a real number, not "unlimited"
  const hasWeeklyQuota = q.weeklyLimit && q.weeklyLimit !== "unlimited";
  const weeklyPct = hasWeeklyQuota && Number(q.weeklyLimit) > 0
    ? Math.round(((Number(q.weeklyRemaining) || 0) / Number(q.weeklyLimit)) * 100)
    : null;

  const timeLabel = checkedAt ? new Date(checkedAt).toLocaleTimeString() : null;

  // Nothing meaningful to show — no exhaustion, no weekly quota, no dashboard
  const isEmpty = !q.exhausted && !hasWeeklyQuota && !dashboardUrl;
  if (isEmpty && !timeLabel) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {q.exhausted && (
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#fb7185" }}>
          <AlertTriangle size={11} />
          <span>Plan quota exhausted{resetLabel ? ` — resets in ${resetLabel}` : ""}</span>
        </div>
      )}
      {hasWeeklyQuota && weeklyPct !== null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${weeklyPct}%`,
              background: weeklyPct > 50 ? "#86efac" : weeklyPct > 20 ? "#fbbf24" : "#fb7185",
            }} />
          </div>
          <span className="mono text-[10px] text-[var(--fg-dimmer)] shrink-0">
            {q.weeklyRemaining}/{q.weeklyLimit} weekly
          </span>
        </div>
      )}
      {!q.exhausted && !hasWeeklyQuota && dashboardUrl && (
        <div className="text-[11px]">
          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 hover:underline"
             style={{ color: "#22d3ee" }}>
            View credits on dashboard <ExternalLink size={9} />
          </a>
        </div>
      )}
      {timeLabel && (
        <div className="mono text-[9px] text-[var(--fg-dimmer)] opacity-60">
          Checked at {timeLabel}
        </div>
      )}
    </div>
  );
}

function Pill({ children, tone, title }: { children: React.ReactNode; tone: "good" | "info" | "off"; title?: string }) {
  const style = tone === "good"
    ? { background: "rgba(134,239,172,0.14)", color: "#86efac", borderColor: "rgba(134,239,172,0.35)" }
    : tone === "info"
    ? { background: "rgba(34,211,238,0.14)", color: "#22d3ee", borderColor: "rgba(34,211,238,0.35)" }
    : { background: "rgba(255,255,255,0.04)", color: "var(--fg-dimmer)", borderColor: "var(--panel-border)" };
  return (
    <span title={title} className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider border" style={style}>
      {children}
    </span>
  );
}
