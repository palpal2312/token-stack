"use client";

// The open-source tools Agent OS builds on, and whether they are actually here.
//
// Every install command is copy-only. Agent OS never runs one: these are other
// people's programs, one of them explicitly beta, and installing software
// behind someone's back is not a convenience.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Boxes, Check, Copy, ExternalLink, RefreshCw, Stethoscope, TriangleAlert,
} from "lucide-react";
import HeaderStatPills from "./HeaderStatPills";
import PageHeaderIcon from "./PageHeaderIcon";
import {
  CachePresets,
  ClientCacheKeys,
  cachedFetchJson,
  invalidateCache,
  readCache,
  setCache,
} from "@/lib/client-data-cache";

interface Row {
  id: string; name: string; repo: string; license: string; category: string;
  pinnedVersion: string | null;
  installed: boolean;
  probable: boolean;
  path: string | null;
  version: string | null;
  detail: string | null;
  hasHealth: boolean;
  installHint: { command: string; url: string };
  usedBy: string[];
  notes: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  terminal: "Terminal",
  "cli-agent": "CLI agents",
  mcp: "MCP servers",
  runtime: "Runtimes",
  gateway: "Gateways",
};

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return (await r.json()) as Record<string, unknown>; }
  catch { return { error: `${r.status} ${r.statusText}` }; }
}

export default function IntegrationsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh = false) => {
    const url = `/api/integrations${fresh ? "?fresh=1" : ""}`;
    const key = fresh ? `GET ${url}` : ClientCacheKeys.integrations;
    const policy = CachePresets.static;

    if (!fresh) {
      const hit = readCache<Record<string, unknown>>(key, policy);
      if (hit?.usable) {
        if (hit.data.error) setErr(String(hit.data.error));
        else {
          setErr(null);
          setRows((hit.data.integrations as Row[]) ?? []);
        }
        if (hit.fresh) return;
      }
    } else {
      invalidateCache(ClientCacheKeys.integrations);
      invalidateCache(key);
    }

    if (fresh) setRefreshing(true);
    const { data: j } = await cachedFetchJson(
      key,
      async () => readJson(await fetch(url, { cache: "no-store" })),
      { ...policy, force: true },
    );
    setRefreshing(false);
    if (j.error) { setErr(String(j.error)); return; }
    setErr(null);
    setRows((j.integrations as Row[]) ?? []);
    if (fresh) {
      // Keep the warm default key in sync after an explicit re-probe.
      setCache(ClientCacheKeys.integrations, j);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const categories = rows
    ? [...new Set(rows.map((r) => r.category))]
    : [];

  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      installed: list.filter((r) => r.installed).length,
      categories: categories.length,
    };
  }, [rows, categories.length]);

  const body = (
    <>
      {err && (
        <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px]"
             style={{ borderColor: "#fb718555", background: "#fb718512", color: "var(--fg-dim)" }}>
          <TriangleAlert size={14} style={{ color: "#fb7185", marginTop: 1, flexShrink: 0 }} />
          <div>{err}</div>
        </div>
      )}

      {!rows && !err && <p className="text-[13px]" style={{ color: "var(--fg-dimmer)" }}>Checking…</p>}

      {categories.map((cat) => (
        <section key={cat} className="space-y-2">
          <h2 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>
            {CATEGORY_LABEL[cat] ?? cat}
          </h2>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: embedded ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {rows!.filter((r) => r.category === cat).map((r) => <Card key={r.id} row={r} />)}
          </div>
        </section>
      ))}

      {rows && (
        <p className="text-[11.5px] pt-2" style={{ color: "var(--fg-dimmer)" }}>
          Adding another tool? The recipe is in{" "}
          <span className="metric">docs/opensource-integration-recipe.md</span>.
        </p>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px]" style={{ color: "var(--fg-dim)" }}>
            Tools on this machine — install commands are copied, never run for you.
          </p>
          <button
            onClick={() => void load(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] shrink-0"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Re-check
          </button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col h-full px-4 md:px-6 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 mb-3">
          <PageHeaderIcon gradient="linear-gradient(135deg,#94a3b8,#64748b)">
          <Boxes size={18} />
        </PageHeaderIcon>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--cream)]">
            Integrations
            <HeaderStatPills
              stats={[
                { label: `${stats.installed}/${stats.total} installed`, tone: stats.installed ? "ok" : "warn" },
                { label: `${stats.categories} groups`, tone: "accent" },
              ]}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="ml-auto shrink-0 inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-mid)] px-3 text-[12px] font-medium text-[var(--cream-mute)] transition hover:text-[var(--cream)]"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-5">
        {body}
      </div>
    </div>
  );
}

function Card({ row }: { row: Row }) {
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Three states, not two. Amber is "something is answering and it may be this",
  // which is all a port probe can honestly report.
  const color = row.probable ? "#fbbf24" : row.installed ? "#86efac" : "#fb7185";
  // Someone looking at an unidentified endpoint may still need to install the
  // real thing, so the command stays on screen until the tool is actually found.
  const showInstall = !row.installed || row.probable;

  async function copy() {
    try {
      await navigator.clipboard.writeText(row.installHint.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* the command is on screen either way */ }
  }

  async function check() {
    setChecking(true);
    const j = await readJson(await fetch(`/api/integrations/${row.id}/health`, { cache: "no-store" }));
    setChecking(false);
    setHealth(j.error && j.ok === undefined
      ? { ok: false, detail: String(j.error) }
      : { ok: Boolean(j.ok), detail: String(j.detail ?? "") });
  }

  return (
    <div className="panel p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[14px]" style={{ color: "var(--fg)" }}>{row.name}</span>
          </div>
          <div className="text-[11px] mt-1" style={{ color: "var(--fg-dimmer)" }}>
            {row.probable
              ? `maybe here · ${row.version ?? "something answered"}`
              : row.installed ? (row.version ? `found · ${row.version}` : "found") : "not found"}
            {row.pinnedVersion && <> · tested against <span className="metric">{row.pinnedVersion}</span></>}
            {" · "}{row.license}
          </div>
        </div>
        <a href={row.repo} target="_blank" rel="noreferrer"
           className="shrink-0 grid place-items-center w-7 h-7 rounded-md" style={{ color: "var(--fg-dimmer)" }}
           title={row.repo}>
          <ExternalLink size={14} />
        </a>
      </div>

      <p className="text-[12px]" style={{ color: "var(--fg-dim)" }}>{row.notes}</p>

      {row.installed && row.path && (
        <div className="text-[11px] metric truncate" style={{ color: "var(--fg-dimmer)" }} title={row.path}>
          {row.path}
        </div>
      )}
      {/* Shown whether or not the tool was found: a detection that succeeded with
          a caveat — "something is answering, but we cannot tell what" — has to be
          able to say so, or "found" reads as more certain than it is. */}
      {row.detail && <p className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>{row.detail}</p>}

      {showInstall && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <code className="flex-1 text-[11.5px] metric rounded-md border px-2 py-1.5 truncate"
                  style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
                  title={row.installHint.command}>
              {row.installHint.command}
            </code>
            <button onClick={copy} title="Copy — you run it yourself"
                    className="grid place-items-center w-7 h-7 rounded-md border shrink-0"
                    style={{ borderColor: "var(--panel-border)", color: copied ? "#86efac" : "var(--fg-dimmer)" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <a href={row.installHint.url} target="_blank" rel="noreferrer"
             className="text-[11px] hover:underline" style={{ color: "var(--fg-dimmer)" }}>
            install docs
          </a>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {row.hasHealth && (
          <button onClick={check} disabled={checking}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11.5px]"
                  style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
            <Stethoscope size={12} /> {checking ? "Checking…" : "Health"}
          </button>
        )}
        {row.usedBy.map((href) => (
          <Link key={href} href={href}
                className="flex items-center gap-1 px-2 py-1 rounded-md border text-[11.5px]"
                style={{ borderColor: "var(--panel-border)", color: "var(--fg-dimmer)" }}>
            <Boxes size={12} /> {href}
          </Link>
        ))}
      </div>

      {health && (
        <div className="text-[11.5px] rounded-md border px-2.5 py-2"
             style={{
               borderColor: health.ok ? "#86efac55" : "#fbbf2455",
               background: health.ok ? "#86efac10" : "#fbbf2410",
               color: "var(--fg-dim)",
             }}>
          {health.detail}
        </div>
      )}
    </div>
  );
}
