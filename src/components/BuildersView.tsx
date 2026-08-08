"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, Check, KeyRound, LogIn, Activity, Trash2, Star, Terminal,
  AlertTriangle, CircleDot, Copy, Settings2, ScanSearch, RefreshCw, SlidersHorizontal,
} from "lucide-react";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";

// A Builder is one runnable configuration of a CLI — binary + account + env.
// This page is where they are made. It never shows a secret and never performs
// a login: keys are pasted by the user and immediately masked, and OAuth happens
// in a real terminal the user drives themselves.

type AuthKind = "oauth" | "api" | "none";

interface Cli {
  id: string; label: string; installed: boolean; defaultBin: string | null;
  authKinds: AuthKind[]; apiKeyEnv: string | null; multiProfile: boolean;
  isolationEnv: string | null; canLogin: boolean; notes: string; profileCount: number;
}

interface Builder {
  id: string; cli: string; name: string;
  auth: { kind: AuthKind; configDir?: string; secretKeys: string[]; secretPreview: Record<string, string> };
  env: Record<string, string>;
  bin: string | null; binResolved: string | null; args: string[];
  model: string | null; isDefault: boolean; notes: string; createdAt: string;
  /** Reasoning effort override (codex uses it; others record it for reference). */
  effort?: string | null;
  /** Set by the health route when the last probe passed and connected. */
  verifiedAt?: string; verifiedDetail?: string;
  /** Last quota reading persisted by a probe; shown by default. */
  quota?: { text: string; checkedAt: string };
  /** Models this profile can run, from the CLI's own config/cache. */
  modelsInfo?: { models: { id: string; note?: string; effortLevels?: string[] }[]; cliDefault: string | null; source: string } | null;
  /** Other profiles that bill the same account (same credential token). */
  sharedAccountWith?: string[];
  /** Phase 11: whether any account identity resolved for this profile. */
  identified?: boolean;
  /** Shortest terminal command to launch this profile (resolved by backend). */
  launchCmd?: string;
}

interface Health {
  state: "ok" | "auth-unverified" | "fail";
  message: string; version: string | null; durationMs: number; warnings: string[];
  connection?: "connected" | "not-connected" | "unverified";
  connectionDetail?: string | null;
  quota?: string | null;
}

const CONN_COLOR: Record<string, string> = {
  connected: "#86efac",
  "not-connected": "#fb7185",
  unverified: "#fbbf24",
};

/**
 * Derive a human-readable tag from the builder's actual properties.
 *
 * ROUTER — traffic goes through a 3rd-party API provider (Fugu, Troll, etc.).
 *   Detected by: auth.kind=api, env containing BASE_URL keys, or notes
 *   mentioning "provider" / "routes to" / "trỏ về".
 *
 * OAUTH  — a separate CLI login identity (different account).
 *   Detected by: auth.kind=oauth (and not a Router), or a codex -p profile
 *   that shares the CLI's own login (notes contain "shares").
 *
 * DEFAULT — the CLI's built-in default login, no special routing.
 */
type BuilderTag = "Router" | "OAuth" | "Default";
/** Extract a 3rd-party provider name from builder notes or env, or null if none found. */
function extractRouterName(notes: string, env?: Record<string, string>): string | null {
  if (notes) {
    // "routes to the «name» provider" — but exclude "openai" (the default ChatGPT backend)
    const routesTo = notes.match(/routes?\s+to\s+(?:the\s+)?["""]?([^"""(]+?)["""]?\s+provider/i);
    if (routesTo) {
      const name = routesTo[1].trim();
      if (!/^openai$/i.test(name)) return name;
    }
    // "trỏ về «Name»" (Vietnamese: "points to")
    const VN_TRO_VE = "tr\u1ECF v\u1EC1";
    const lower = notes.toLowerCase();
    const idx = lower.indexOf(VN_TRO_VE.toLowerCase());
    if (idx >= 0) {
      const after = notes.slice(idx + VN_TRO_VE.length).trim();
      const m = after.match(/^([A-Za-z0-9_\-]+(?:\s*API)?)/);
      if (m) return m[1].trim();
    }
    // Known API gateway names in notes
    const known = notes.match(/\b(Sub2API|Sub2|Troll\s*API|Fugu|Sakana(?:\s*API)?)\b/i);
    if (known) return known[1];
  }
  if (env) {
    const url = Object.values(env).find((v) => typeof v === "string" && v.includes("http"));
    if (url?.includes("5173") || url?.includes("8080") || url?.includes("sub2api")) return "Sub2API";
    if (url?.includes("sakana")) return "Fugu";
    if (url?.includes("trollllm")) return "Troll API";
  }
  return null;
}
function isRouterBuilder(b: Builder): boolean {
  // 1. Explicit API key auth → always a Router
  if (b.auth.kind === "api") return true;
  // 2. Env vars pointing to a custom base URL → Router
  if (Object.keys(b.env ?? {}).some((k) => k.includes("BASE_URL"))) return true;
  // 3. Notes mention a non-default provider → Router
  if (extractRouterName(b.notes ?? "", b.env)) return true;
  return false;
}
interface DerivedTag { tag: BuilderTag; routerName: string | null }
function deriveTag(b: Builder): DerivedTag {
  if (isRouterBuilder(b)) {
    const routerName = extractRouterName(b.notes ?? "", b.env);
    return { tag: "Router", routerName };
  }
  // OAuth login → separate account
  if (b.auth.kind === "oauth") return { tag: "OAuth", routerName: null };
  // Has profile args (e.g. codex -p 01) but no provider routing → OAuth
  if (b.args.length > 0) return { tag: "OAuth", routerName: null };
  // Everything else is the CLI's default login
  return { tag: "Default", routerName: null };
}
const TAG_TONE: Record<BuilderTag, "info" | "good" | "off"> = { Router: "info", OAuth: "good", Default: "off" };
const TAG_TITLE: Record<BuilderTag, string> = {
  Router: "Routes through a 3rd-party API provider",
  OAuth: "Separate CLI login / account",
  Default: "The CLI's default login",
};

/** A profile the CLI itself owns (e.g. `codex -p fugu`), detected on disk. */
interface NativeProfile { cli: string; name: string; args: string[]; source: string }

const STATE_COLOR: Record<Health["state"], string> = {
  ok: "#86efac",
  "auth-unverified": "#fbbf24",
  fail: "#fb7185",
};

export default function BuildersView() {
  const [clis, setClis] = useState<Cli[]>([]);
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [nativeProfiles, setNativeProfiles] = useState<NativeProfile[]>([]);
  const [orphans, setOrphans] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, Health | "running">>({});
  const [addFor, setAddFor] = useState<Cli | null>(null);
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [loginInfo, setLoginInfo] = useState<{ builder: Builder; command: string; opened: boolean; note: string } | null>(null);
  const [modelInfos, setModelInfos] = useState<Record<string, Builder["modelsInfo"]>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // A route that dies mid-flight sends no body, and res.json() would throw where
  // nothing catches it — so every read goes through here.
  async function readJson(r: Response): Promise<Record<string, unknown>> {
    try { return await r.json(); }
    catch { return { error: `The server returned ${r.status} with no explanation.` }; }
  }

  async function load() {
    setRefreshing(true);
    try {
      const j = await readJson(await fetch("/api/builders", { cache: "no-store" }));
      setClis((j.clis as Cli[]) ?? []);
      setBuilders((j.builders as Builder[]) ?? []);
      setNativeProfiles((j.nativeProfiles as NativeProfile[]) ?? []);
      setOrphans((j.orphanedDirs as string[]) ?? []);
      setErr((j.error as string) ?? null);
      setLoaded(true);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Model lists can be slow (codex app-server, agy PTY, provider calls). Load
  // the page first, then hydrate model dropdowns in the background per profile.
  // We process them SEQUENTIALLY to avoid blasting the backend with 10+ PTY spawns
  // or heavy network calls all at once, which causes Node event loop freezes.
  const fetchingModels = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    let alive = true;

    async function hydrateSequentially() {
      // Find missing models. We filter against fetchingModels so we don't re-queue.
      const missing = builders.filter((b) => !b.modelsInfo && !(b.id in modelInfos) && !fetchingModels.has(b.id));
      if (!missing.length) return;

      for (const b of missing) {
        if (!alive) break;
        fetchingModels.add(b.id);

        try {
          const res = await fetch(`/api/builders/${encodeURIComponent(b.id)}/models`, { cache: "no-store" });
          const j = await res.json();
          if (!alive) break;
          setModelInfos((m) => ({ ...m, [b.id]: (j.modelsInfo ?? null) as Builder["modelsInfo"] }));
        } catch {
          if (!alive) break;
          setModelInfos((m) => ({ ...m, [b.id]: null }));
        }
      }
    }

    // Fire the async background queue
    void hydrateSequentially();

    return () => { alive = false; };
  }, [builders, modelInfos, fetchingModels]);

  async function importProfile(p: NativeProfile) {
    const j = await readJson(await fetch("/api/builders/import-native", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cli: p.cli, name: p.name }),
    }));
    if (j.error) setErr(String(j.error)); else { setErr(null); await load(); }
  }

  /** Re-run native-profile detection, then health-test every profile of one CLI. */
  async function scanCli(c: Cli) {
    if (scanFor) return;
    setScanFor(c.id);
    try {
      await load();                              // fresh detection first
      for (const b of (byCli[c.id] ?? [])) {     // then test each profile, one at a time
        await probe(b);
      }
    } finally { setScanFor(null); }
  }

  async function probe(b: Builder) {
    setHealth((h) => ({ ...h, [b.id]: "running" }));
    const j = await readJson(await fetch(`/api/builders/${b.id}/health`, { method: "POST" }));
    setHealth((h) => ({
      ...h,
      [b.id]: (j.health as Health) ?? { state: "fail", message: String(j.error ?? "Health check failed."), version: null, durationMs: 0, warnings: [] },
    }));
    // The probe writes its verdict onto the builder record (the green tick) —
    // reload so the tick appears without a manual refresh.
    await load();
  }

  async function remove(b: Builder) {
    const hasLogin = b.auth.kind === "oauth" && b.auth.configDir;
    const msg = hasLogin
      ? `Delete "${b.name}"?\n\nIts login stays on disk at\n${b.auth.configDir}\nso you can recreate the profile without signing in again.\n\nTick OK, then choose whether to erase that folder too.`
      : `Delete "${b.name}"?`;
    if (!confirm(msg)) return;
    const purge = hasLogin && confirm(`Also erase the saved login folder?\n\n${b.auth.configDir}\n\nOK = erase it (you will have to log in again).\nCancel = keep it.`);
    const j = await readJson(await fetch(`/api/builders/${b.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" }));
    if (j.error) setErr(j.error as string); else { setErr(null); await load(); }
  }

  async function makeDefault(b: Builder) {
    await fetch(`/api/builders/${b.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    await load();
  }

  async function setEffort(b: Builder, effort: string | null) {
    await fetch(`/api/builders/${b.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ effort }),
    });
    await load();
  }

  async function setModel(b: Builder, model: string | null) {
    if ((b.model ?? null) === model) return;
    await fetch(`/api/builders/${b.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    await load();
  }

  async function startLogin(b: Builder) {
    const j = await readJson(await fetch(`/api/builders/${b.id}/login`, { method: "POST" }));
    if (j.error) { setErr(j.error as string); return; }
    setErr(null);
    setLoginInfo({ builder: b, command: String(j.command ?? ""), opened: Boolean(j.opened), note: String(j.note ?? "") });
  }

  const hydratedBuilders = useMemo(() => builders.map((b) => ({
    ...b,
    modelsInfo: (b.id in modelInfos) ? modelInfos[b.id] : b.modelsInfo,
  })), [builders, modelInfos]);

  const byCli = useMemo(() => {
    const m: Record<string, Builder[]> = {};
    for (const b of hydratedBuilders) (m[b.cli] ??= []).push(b);
    return m;
  }, [hydratedBuilders]);

  const stats = useMemo(() => ({
    profiles: builders.length,
    installed: clis.filter((c) => c.installed).length,
    multi: clis.filter((c) => c.multiProfile && c.installed).length,
  }), [builders, clis]);

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
          <PageHeaderIcon gradient="linear-gradient(135deg,#22d3ee,#0891b2)">
          <SlidersHorizontal size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            CLI Config
            <HeaderStatPills
              stats={[
                { label: `${stats.profiles} profiles`, tone: stats.profiles ? "ok" : "neutral" },
                { label: `${stats.installed}/${clis.length} CLIs`, tone: stats.installed ? "accent" : "warn" },
                { label: `${stats.multi} multi-account`, tone: stats.multi ? "accent" : "neutral" },
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

      {orphans.length > 0 && (
        <div className="panel p-3 flex items-start gap-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="text-[12px] text-amber-200">
            {orphans.length} saved login folder{orphans.length > 1 ? "s" : ""} no longer belong to any profile. They were
            kept on purpose when the profile was deleted, so nothing was lost — erase them yourself if you are done with them:
            <div className="mono text-[11px] mt-1 opacity-80">{orphans.join("  ·  ")}</div>
          </div>
        </div>
      )}

      {!loaded && <div className="text-sm text-[var(--fg-dim)] py-8 text-center">Reading your CLI setup…</div>}

      <div className="space-y-3">
        {clis.map((c) => (
          <CliCard
            key={c.id}
            cli={c}
            builders={byCli[c.id] ?? []}
            nativeProfiles={nativeProfiles.filter((p) => p.cli === c.id)}
            health={health}
            onAdd={() => setAddFor(c)}
            onProbe={probe}
            onDelete={remove}
            onDefault={makeDefault}
            onLogin={startLogin}
            onEffort={setEffort}
            onModel={setModel}
            onImport={importProfile}
            onScan={() => scanCli(c)}
            scanning={scanFor === c.id}
          />
        ))}
      </div>

      <AnimatePresence>
        {addFor && (
          <AddBuilderModal
            cli={addFor}
            onClose={() => setAddFor(null)}
            onCreated={async () => { setAddFor(null); await load(); }}
            onError={setErr}
          />
        )}
        {loginInfo && <LoginModal info={loginInfo} onClose={() => { setLoginInfo(null); load(); }} />}
      </AnimatePresence>
      </div>
    </div>
  );
}

function CliCard({ cli, builders, nativeProfiles, health, onAdd, onProbe, onDelete, onDefault, onLogin, onEffort, onModel, onImport, onScan, scanning }: {
  cli: Cli; builders: Builder[]; nativeProfiles: NativeProfile[]; health: Record<string, Health | "running">;
  onAdd: () => void; onProbe: (b: Builder) => void; onDelete: (b: Builder) => void;
  onDefault: (b: Builder) => void; onLogin: (b: Builder) => void; onEffort: (b: Builder, effort: string | null) => void;
  onModel: (b: Builder, model: string | null) => void;
  onImport: (p: NativeProfile) => void;
  onScan: () => void; scanning: boolean;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const shim = cli.defaultBin && /\.(cmd|bat|ps1)$/i.test(cli.defaultBin);

  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 grid place-items-center w-9 h-9 rounded-lg"
              style={{ background: cli.installed ? "rgba(134,239,172,0.12)" : "rgba(255,255,255,0.04)" }}>
          <Terminal size={16} style={{ color: cli.installed ? "#86efac" : "var(--fg-dimmer)" }} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px]">{cli.label}</span>
            <Pill tone={cli.installed ? "good" : "off"}>{cli.installed ? "installed" : "not installed"}</Pill>
            {cli.multiProfile
              ? <Pill tone="info">several accounts</Pill>
              : <Pill tone="off" title="No isolation variable has been proven for this CLI, so every profile would share one login.">one account</Pill>}
            <span className="text-[11px] text-[var(--fg-dimmer)]">{builders.length} profile{builders.length === 1 ? "" : "s"}</span>
          </div>

          <div className="mono text-[11px] text-[var(--fg-dimmer)] mt-1 truncate" title={cli.defaultBin ?? ""}>
            {cli.defaultBin ?? "no binary found"}
          </div>

          {shim && (
            <div className="text-[11px] text-amber-300 mt-1.5">
              That path is a shim script, which Node cannot run on Windows. Give a profile the real <code>.exe</code> in
              its Binary field and it will work.
            </div>
          )}
          {!cli.installed && !shim && (
            <div className="text-[11px] text-[var(--fg-dimmer)] mt-1.5">
              Install it, or set an absolute path in a profile&apos;s Binary field.
            </div>
          )}
          {cli.isolationEnv && (
            <div className="text-[11px] text-[var(--fg-dimmer)] mt-1.5">
              Accounts are kept apart with <code className="mono">{cli.isolationEnv}</code>.
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setShowNotes((s) => !s)} title="What Agent OS knows about this CLI"
                  className="grid place-items-center w-8 h-8 rounded-lg text-[var(--fg-dim)] hover:text-[var(--fg)] transition">
            <Settings2 size={14} />
          </button>
          <button onClick={onScan} disabled={scanning}
                  title="Re-scan profiles the CLI owns itself, then health-test every profile of this CLI"
                  className="grid place-items-center w-8 h-8 rounded-lg text-[var(--fg-dim)] hover:text-[var(--fg)] disabled:opacity-40 transition">
            <ScanSearch size={14} className={scanning ? "animate-pulse" : ""} />
          </button>
          <button onClick={onAdd}
                  className="px-3 h-8 rounded-lg flex items-center gap-1.5 text-[12px] transition"
                  style={{ background: "rgba(34,211,238,0.16)", border: "1px solid rgba(34,211,238,0.45)", color: "#22d3ee" }}>
            <Plus size={13} /> Add profile
          </button>
        </div>
      </div>

      {showNotes && <div className="text-[11px] text-[var(--fg-dim)] mt-3 pt-3 border-t border-[var(--panel-border)] leading-relaxed">{cli.notes}</div>}

      {builders.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--panel-border)] space-y-2">
          {builders.map((b) => (
            <BuilderRow key={b.id} builder={b} cli={cli} health={health[b.id]}
                        onProbe={() => onProbe(b)} onDelete={() => onDelete(b)}
                        onDefault={() => onDefault(b)} onLogin={() => onLogin(b)}
                        onEffort={(e) => onEffort(b, e)} onModel={(m) => onModel(b, m)} />
          ))}
        </div>
      )}

      {nativeProfiles.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--panel-border)] space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
            Found in the CLI itself — not a Builder yet
          </div>
          {nativeProfiles.map((p) => (
            <div key={p.name} className="rounded-lg px-3 py-2.5 flex items-center gap-2.5" style={{ background: "rgba(0,0,0,0.18)" }}>
              <CircleDot size={12} className="text-[var(--fg-dimmer)] shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[13px]">{p.name}</span>
                <span className="mono text-[10px] text-[var(--fg-dimmer)] ml-2">{cli.id} {p.args.join(" ")}</span>
                <div className="mono text-[10px] text-[var(--fg-dimmer)] truncate mt-0.5" title={p.source}>{p.source}</div>
              </div>
              <button onClick={() => onImport(p)}
                      title="Make it a Builder. It shares the CLI's default login, because the native profile lives in the default home."
                      className="shrink-0 px-3 h-8 rounded-lg flex items-center gap-1.5 text-[12px] border border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] transition">
                <Plus size={13} /> Import
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BuilderRow({ builder: b, cli, health, onProbe, onDelete, onDefault, onLogin, onEffort, onModel }: {
  builder: Builder; cli: Cli; health: Health | "running" | undefined;
  onProbe: () => void; onDelete: () => void; onDefault: () => void; onLogin: () => void;
  onEffort: (effort: string | null) => void; onModel: (model: string | null) => void;
}) {
  const h = health === "running" ? null : health;
  const dot = h ? STATE_COLOR[h.state] : "var(--fg-dimmer)";

  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.18)" }}>
      <div className="flex items-center gap-2.5">
        <CircleDot size={12} style={{ color: dot }} className={health === "running" ? "animate-pulse" : ""} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px]">{b.name}</span>
            {b.verifiedAt && (
              <span
                title={`Verified ${new Date(b.verifiedAt).toLocaleString()} — last health probe passed and the account connected.\n${b.verifiedDetail ?? ""}`}
                className="grid place-items-center w-4 h-4 rounded-full"
                style={{ background: "rgba(134,239,172,0.18)", color: "#86efac" }}>
                <Check size={11} strokeWidth={3} />
              </span>
            )}
            {/* Phase 11: identity mode + freshness badges (facts only, never scores). */}
            {b.sharedAccountWith?.length ? (
              <Pill tone="info" title={`Bills the same account as: ${b.sharedAccountWith.join(", ")}`}>
                shared account
              </Pill>
            ) : b.identified ? (
              <Pill tone="good" title="A stable account identity resolved for this profile.">
                identified
              </Pill>
            ) : (
              <Pill tone="off" title="No stable account identifier — never treated as independent for auto-dispatch.">
                identity unknown
              </Pill>
            )}
            {b.quota?.checkedAt && (() => {
              // Presentation-only buckets, deliberately tighter than the
              // canonical refresh policy (quotaRefresh.ts QUOTA_STALE_MS) —
              // these badges never feed allocation.
              const ageMs = Date.now() - Date.parse(b.quota.checkedAt);
              const fresh = ageMs < 15 * 60_000;
              const stale = ageMs < 2 * 60 * 60_000;
              return (
                <Pill
                  tone={fresh ? "good" : stale ? "info" : "off"}
                  title={`Quota reading checked ${new Date(b.quota.checkedAt).toLocaleString()}`}
                >
                  {fresh ? "quota fresh" : stale ? "quota stale" : "quota expired"}
                </Pill>
              );
            })()}
            {(() => { const { tag, routerName } = deriveTag(b); return (
              <Pill tone={TAG_TONE[tag]} title={routerName ? `Routes through ${routerName}` : TAG_TITLE[tag]}>
                {tag === "Router" && routerName ? `ROUTER: ${routerName}` : tag.toUpperCase()}
              </Pill>
            ); })()}
            {(() => {
              // Only the efforts the CHOSEN model's catalog declares — codex's
              // models_cache.json and -p catalogs name them per model (fugu:
              // high/xhigh). No declared levels → generic list, flagged
              // unverified; never invent levels for a model.
              const ALL = ["low", "medium", "high", "xhigh", "max"];
              const info = b.modelsInfo;
              const selectedId = b.model ?? info?.cliDefault ?? null;
              const declared = (info?.models ?? []).find((m) => m.id === selectedId)?.effortLevels;
              const defaultDeclared = selectedId === null
                ? (info?.models ?? []).find((m) => m.id === info?.cliDefault)?.effortLevels
                : undefined;
              const opts = declared?.length ? declared : defaultDeclared?.length ? defaultDeclared : ALL;
              return (
                <select
                  data-effort-for={b.id}
                  value={b.effort ?? ""}
                  onChange={(e) => onEffort(e.target.value || null)}
                  title={declared?.length
                    ? `Reasoning effort — this model's catalog offers: ${opts.join(", ")}.`
                    : "Reasoning effort — generic list, unverified for this model; providers may reject values they do not offer."}
                  className="bg-transparent border border-[var(--panel-border)] rounded px-1 py-0.5 text-[10.5px] text-[var(--fg-dim)]"
                >
                  <option value="">effort: default</option>
                  {opts.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              );
            })()}
            {b.modelsInfo && b.modelsInfo.models.length > 0 ? (
              <select
                value={b.model ?? ""}
                onChange={(e) => onModel(e.target.value || null)}
                title={`Model for this profile (default: ${b.modelsInfo.cliDefault ?? "the CLI's own"}). List read from ${b.modelsInfo.source}.`}
                className="bg-transparent border border-[var(--panel-border)] rounded px-1 py-0.5 text-[10.5px] mono text-[var(--fg-dim)] max-w-44"
              >
                <option value="">model: default{b.modelsInfo.cliDefault ? ` (${b.modelsInfo.cliDefault})` : ""}</option>
                {b.modelsInfo.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}{m.note ? ` — ${m.note}` : ""}</option>
                ))}
                {b.model && !b.modelsInfo.models.some((m) => m.id === b.model) && (
                  <option value={b.model}>{b.model} — custom</option>
                )}
              </select>
            ) : (
              <input
                key={b.id + ":" + (b.model ?? "")}
                defaultValue={b.model ?? ""}
                placeholder="model: default"
                spellCheck={false}
                title="Model override for this profile (blank = the CLI's own default). Applies on blur or Enter."
                onBlur={(e) => onModel(e.target.value.trim() || null)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="bg-transparent border border-[var(--panel-border)] rounded px-1.5 py-0.5 text-[10.5px] mono text-[var(--fg-dim)] w-36 outline-none focus:border-[rgba(34,211,238,0.5)]"
              />
            )}
            {b.auth.secretKeys.map((k) => (
              <span key={k} className="mono text-[10px] text-[var(--fg-dimmer)]" title="Keys are stored locally and never shown in full.">
                {k}={b.auth.secretPreview[k]}
              </span>
            ))}
          </div>
          {h && <div className="text-[11px] mt-1" style={{ color: h.state === "fail" ? "#fb7185" : "var(--fg-dim)" }}>{h.message}</div>}
          {h?.connection && (
            <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="uppercase tracking-wider text-[10px]" style={{ color: CONN_COLOR[h.connection] }}>
                {h.connection === "connected" ? "connected" : h.connection === "not-connected" ? "not connected" : "unverified"}
              </span>
              {h.connectionDetail && <span className="text-[var(--fg-dim)]">{h.connectionDetail}</span>}
            </div>
          )}
          {(h?.quota ?? b.quota?.text) && (
            <div className="mono text-[10px] mt-0.5" style={{ color: "#22d3ee" }}
                 title={h?.quota ? "Fresh from the probe just run" : `Last reading, checked ${b.quota?.checkedAt ? new Date(b.quota.checkedAt).toLocaleString() : "earlier"}. Probe to refresh.`}>
              {h?.quota ?? b.quota?.text}
            </div>
          )}
          {h?.version && <div className="mono text-[10px] text-[var(--fg-dimmer)] mt-0.5">{h.version}</div>}
          {h?.warnings.map((w, i) => <div key={i} className="text-[11px] text-amber-300 mt-0.5">{w}</div>)}
          <div
            className="mono text-[10px] mt-1 px-2 py-1 rounded cursor-pointer inline-flex items-center gap-1.5 group"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            title="Click to copy"
            onClick={() => { navigator.clipboard.writeText(b.launchCmd ?? b.id).catch(() => {}); }}
          >
            <span className="shrink-0" style={{ color: "#22d3ee" }}>$</span>
            <span className="text-[var(--fg-dim)]">{b.launchCmd ?? b.id}</span>
            <Copy size={10} className="shrink-0 text-[var(--fg-dimmer)] opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {cli.canLogin && b.auth.kind === "oauth" && (
            <IconBtn title="Open a terminal to sign this profile in" onClick={onLogin}><LogIn size={13} /></IconBtn>
          )}
          <IconBtn title="Check that this profile runs" onClick={onProbe}><Activity size={13} /></IconBtn>
          {!b.isDefault && <IconBtn title="Make this the default for this CLI" onClick={onDefault}><Star size={13} /></IconBtn>}
          <IconBtn title="Delete this profile" onClick={onDelete} danger><Trash2 size={13} /></IconBtn>
        </div>
      </div>
    </div>
  );
}

function AddBuilderModal({ cli, onClose, onCreated, onError }: {
  cli: Cli; onClose: () => void; onCreated: () => void; onError: (e: string) => void;
}) {
  const kinds = cli.authKinds;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AuthKind>(kinds.includes("oauth") ? "oauth" : kinds[0] ?? "none");
  const [secret, setSecret] = useState("");
  const [bin, setBin] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  const oauthImpossible = kind === "oauth" && !cli.isolationEnv;

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        cli: cli.id, name: name.trim(), authKind: kind,
        bin: bin.trim() || null, model: model.trim() || null, effort: effort || null,
      };
      if (kind === "api" && cli.apiKeyEnv) body.secrets = { [cli.apiKeyEnv]: secret.trim() };
      const r = await fetch("/api/builders", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      let j: Record<string, unknown> = {};
      try { j = await r.json(); } catch {}
      if (!r.ok) { onError(String(j.error ?? `Could not create the profile (${r.status}).`)); return; }
      setSecret("");   // never leave a key sitting in component state
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 grid place-items-center p-4"
                style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
                  className="panel p-5 w-full max-w-[520px] space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px]">New {cli.label} profile</h3>
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={16} /></button>
        </div>

        <Field label="Name" hint="What you will recognise it by — “Work account”, “Personal”, “Billing key”.">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                 placeholder="Work account"
                 className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)]" />
        </Field>

        <Field label="How it signs in">
          <div className="flex gap-2 flex-wrap">
            {kinds.map((k) => (
              <button key={k} onClick={() => setKind(k)}
                      className="px-3 py-1.5 rounded-full text-[12px] border transition"
                      style={{
                        background: kind === k ? "rgba(168,85,247,0.16)" : "transparent",
                        borderColor: kind === k ? "#a855f7" : "var(--panel-border)",
                        color: kind === k ? "var(--fg)" : "var(--fg-dim)",
                      }}>
                {k === "oauth" ? "Its own login" : k === "api" ? "API key" : "Use the shared login"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--fg-dim)] mt-2">
            {kind === "oauth" && (cli.isolationEnv
              ? `A folder is created for this profile and ${cli.isolationEnv} points the CLI at it, so this account stays separate from your others. You sign in yourself in a terminal after creating it.`
              : `${cli.label} has no proven way to keep two logins apart on this machine, so this would quietly share the existing account.`)}
            {kind === "api" && `The key is stored in ~/.agentic-os/builders.json and passed only to this profile's own processes. It is never set globally — that would break ${cli.label}'s normal login.`}
            {kind === "none" && `Runs as whatever account ${cli.label} is already signed in as.`}
          </p>
        </Field>

        {kind === "api" && cli.apiKeyEnv && (
          <Field label={cli.apiKeyEnv} hint="Pasted by you, stored locally, and shown masked everywhere after this.">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-[var(--fg-dimmer)] shrink-0" />
              <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" spellCheck={false}
                     placeholder="paste your key"
                     className="flex-1 bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-sm outline-none focus:border-[var(--panel-border-hot)] mono" />
            </div>
          </Field>
        )}

        <button onClick={() => setAdvanced((a) => !a)} className="text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)]">
          {advanced ? "Hide" : "Show"} advanced
        </button>

        {advanced && (
          <div className="space-y-3">
            <Field label="Binary" hint={`Leave blank to use ${cli.defaultBin ?? "the detected path"}. On Windows this must be a real .exe.`}>
              <input value={bin} onChange={(e) => setBin(e.target.value)} spellCheck={false}
                     placeholder={cli.defaultBin ?? "C:\\path\\to\\cli.exe"}
                     className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)] mono" />
            </Field>
            <Field label="Model" hint="Optional — overrides the model this profile asks for.">
              <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false}
                     className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)] mono" />
            </Field>
            <Field label="Effort" hint="Optional — reasoning effort. Only CLIs with a verified flag use it (codex); others record it for reference.">
              <select value={effort} onChange={(e) => setEffort(e.target.value)}
                      className="w-full bg-[rgba(0,0,0,0.25)] border border-[var(--panel-border)] rounded-lg px-3 h-[38px] text-[12px] outline-none focus:border-[var(--panel-border-hot)]">
                <option value="">CLI default</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
                <option value="max">max</option>
              </select>
            </Field>
          </div>
        )}

        {oauthImpossible && (
          <div className="text-[11px] text-amber-300">
            This will be created, but it cannot have an account of its own until an isolation variable is confirmed for {cli.label}.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 h-[36px] rounded-lg text-[13px] text-[var(--fg-dim)]">Cancel</button>
          <button onClick={submit} disabled={!name.trim() || busy || (kind === "api" && !secret.trim())}
                  className="px-4 h-[36px] rounded-lg flex items-center gap-1.5 text-[13px] transition disabled:opacity-40"
                  style={{ background: "rgba(34,211,238,0.18)", border: "1px solid rgba(34,211,238,0.5)", color: "#22d3ee" }}>
            <Check size={14} /> Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function LoginModal({ info, onClose }: {
  info: { builder: Builder; command: string; opened: boolean; note: string }; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 grid place-items-center p-4"
                style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
                  className="panel p-5 w-full max-w-[620px] space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px]">Sign in to “{info.builder.name}”</h3>
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={16} /></button>
        </div>

        <p className="text-[12px] text-[var(--fg-dim)]">
          {info.opened
            ? "A terminal window has opened. Complete the sign-in there — Agent OS never handles your credentials."
            : "Run this in your own terminal to sign in. Agent OS never handles your credentials."}
        </p>
        <p className="text-[12px] text-[var(--fg-dim)]">{info.note}</p>

        <div className="rounded-lg p-3 mono text-[11px] whitespace-pre-wrap break-all"
             style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--panel-border)" }}>
          {info.command}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={() => { navigator.clipboard?.writeText(info.command); setCopied(true); }}
                  className="px-3 h-[34px] rounded-lg flex items-center gap-1.5 text-[12px] text-[var(--fg-dim)] border border-[var(--panel-border)]">
            <Copy size={13} /> {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={onClose}
                  className="px-4 h-[34px] rounded-lg text-[12px]"
                  style={{ background: "rgba(34,211,238,0.18)", border: "1px solid rgba(34,211,238,0.5)", color: "#22d3ee" }}>
            Done — recheck
          </button>
        </div>
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
