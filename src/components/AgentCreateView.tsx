"use client";

// Create an agent: pick a skin, pick what drives it, name it.
//
// The compatibility rules live in lib/skins.ts and are enforced again when the
// registry saves, so this view never has to guess. Incompatible profiles are
// shown greyed with the reason rather than hidden — "why can't I pick that?" is
// a worse question than a one-line answer.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ExternalLink, Plus, TriangleAlert } from "lucide-react";
import { allSkins, skinAcceptsCli, type Skin } from "@/lib/skins";

interface BuilderRow {
  id: string;
  cli: string;
  name: string;
  isDefault: boolean;
  model: string | null;
  auth: { kind: string };
  /** Set by the last passing health probe — the green tick in CLI Config. */
  verifiedAt?: string;
  verifiedDetail?: string;
}

interface RouterRow {
  id: string;
  kind: string;
  name: string;
  baseUrl: string;
  defaultModel: string | null;
  isDefault: boolean;
  hasKey: boolean;
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return (await r.json()) as Record<string, unknown>; }
  catch { return { error: `${r.status} ${r.statusText}` }; }
}

export default function AgentCreateView() {
  const router = useRouter();
  const skins = useMemo(() => allSkins(), []);
  const [builders, setBuilders] = useState<BuilderRow[]>([]);
  const [routers, setRouters] = useState<RouterRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [skinId, setSkinId] = useState<string | null>(null);
  const [builderId, setBuilderId] = useState<string | null>(null);
  const [routerId, setRouterId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/builders", { cache: "no-store" })
      .then(readJson)
      .then((j) => {
        if (j.error) { setLoadErr(String(j.error)); return; }
        // Only green-ticked (verifiedAt) profiles are offered: an agent bound to
        // an unproven profile fails later, at chat time, where the reason is
        // much harder to see than here.
        setBuilders(((j.builders as BuilderRow[]) ?? []).filter((b) => b.verifiedAt));
      })
      .catch((e) => setLoadErr(String(e)));
    // A missing Routers list is not an error worth blocking on: most skins never
    // offer one, and the ones that do fall back to their built-in engine.
    fetch("/api/routers", { cache: "no-store" })
      .then(readJson)
      .then((j) => { if (!j.error) setRouters((j.routers as RouterRow[]) ?? []); })
      .catch(() => { /* the built-in engine still works */ });
  }, []);

  const skin = skinId ? skins.find((s) => s.id === skinId) ?? null : null;
  const needsBuilder = Boolean(skin?.backendKinds.includes("builder"));
  const canRoute = Boolean(skin?.backendKinds.includes("router"));

  // Suggest a name once, then leave it alone — retyping over the user's own
  // wording every time they change a profile is infuriating.
  useEffect(() => {
    if (!skin || nameTouched) return;
    const backend = builders.find((x) => x.id === builderId) ?? routers.find((x) => x.id === routerId);
    setName(backend ? `${skin.label} – ${backend.name}` : skin.label);
  }, [skin, builderId, routerId, builders, routers, nameTouched]);

  const choices = useMemo(() => {
    if (!skin || !needsBuilder) return [];
    return builders.map((b) => ({ builder: b, compat: skinAcceptsCli(skin, b.cli) }));
  }, [skin, needsBuilder, builders]);

  const usable = choices.filter((c) => c.compat.ok);
  const ready = Boolean(skin && name.trim() && (!needsBuilder || builderId));

  function backendBody(): { kind: string; refId?: string } {
    if (needsBuilder) return { kind: "builder", refId: builderId ?? undefined };
    // A Router is opt-in even on the skins that accept one: picking none leaves
    // the skin on the engine it has always used.
    if (routerId) return { kind: "router", refId: routerId };
    return { kind: "builtin" };
  }

  async function create() {
    if (!skin || !ready) return;
    setSaving(true);
    setErr(null);
    const r = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        skinId: skin.id,
        backend: backendBody(),
      }),
    });
    const j = await readJson(r);
    setSaving(false);
    if (j.error) { setErr(String(j.error)); return; }
    const created = j.agent as { id: string };
    // Tell the sidebar a new agent exists so it appears without a reload.
    window.dispatchEvent(new CustomEvent("agentos:agents-changed"));
    router.push(`/agents/${created.id}`);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500 }}>
          New Agent
        </h1>
        <p className="text-[13px]" style={{ color: "var(--fg-dim)" }}>
          A skin is the interface. A Builder profile is the account that answers. Pick one of each.
        </p>
      </header>

      {loadErr && <Banner tone="bad">{loadErr}</Banner>}

      <Step n={1} title="Choose a skin" />
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
        {skins.map((s) => (
          <SkinCard
            key={s.id}
            skin={s}
            selected={skinId === s.id}
            profiles={builders.filter((b) => skinAcceptsCli(s, b.cli).ok).length}
            routers={routers.length}
            onPick={() => { setSkinId(s.id); setBuilderId(null); setRouterId(null); }}
          />
        ))}
      </div>

      {skin && (
        <>
          <Step n={2} title={needsBuilder ? "Choose the profile that answers" : "Choose what answers"} />
          {!needsBuilder ? (
            <div className="space-y-2.5">
              <button
                onClick={() => setRouterId(null)}
                data-backend="builtin"
                className="panel p-3.5 w-full text-left transition"
                style={{
                  borderColor: routerId === null ? skin.accent : "var(--panel-border)",
                  background: routerId === null ? `${skin.accent}14` : undefined,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px]" style={{ color: "var(--fg)" }}>Built-in engine</span>
                  {routerId === null && <Check size={14} style={{ color: skin.accent }} />}
                </div>
                <div className="text-[11.5px] mt-1" style={{ color: "var(--fg-dimmer)" }}>
                  Exactly what the {skin.label} tab does today, using the keys already in your environment.
                </div>
              </button>

              {canRoute && routers.map((r) => (
                <button
                  key={r.id}
                  data-router={r.id}
                  onClick={() => setRouterId(r.id)}
                  className="panel p-3.5 w-full text-left transition"
                  style={{
                    borderColor: routerId === r.id ? skin.accent : "var(--panel-border)",
                    background: routerId === r.id ? `${skin.accent}14` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] truncate" style={{ color: "var(--fg)" }}>{r.name}</span>
                    {routerId === r.id && <Check size={14} style={{ color: skin.accent }} />}
                  </div>
                  <div className="text-[11px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: "var(--fg-dimmer)" }}>
                    <span className="metric">{r.kind}</span>
                    <span>·</span>
                    <span className="metric truncate">{r.baseUrl}</span>
                    {r.defaultModel && <><span>·</span><span className="metric">{r.defaultModel}</span></>}
                    {!r.hasKey && <><span>·</span><span>no key</span></>}
                  </div>
                </button>
              ))}

              {canRoute && !routers.length && (
                <p className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>
                  {skin.label} can also answer through a named endpoint.{" "}
                  <Link href="/routers" className="underline">Add one in Router Config</Link> to bind this agent to a
                  specific key instead of the environment.
                </p>
              )}
              {!canRoute && (
                <p className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>
                  {skin.notes}
                </p>
              )}
            </div>
          ) : !usable.length ? (
            <Banner tone="warn">
              No <strong>verified</strong> Builder profile can drive the {skin.label} skin yet — it needs one for{" "}
              <span className="metric">{skin.accepts.join(" or ")}</span>, and only green-ticked profiles are
              offered here. Run a profile&#39;s health probe in{" "}
              <Link href="/builders" className="underline">CLI Config</Link> so it earns its tick, or create one.
            </Banner>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {choices.map(({ builder, compat }) => (
                <button
                  key={builder.id}
                  data-builder={builder.id}
                  disabled={!compat.ok}
                  onClick={() => setBuilderId(builder.id)}
                  title={compat.ok ? "" : compat.reason}
                  className="panel p-3 text-left transition"
                  style={{
                    opacity: compat.ok ? 1 : 0.42,
                    cursor: compat.ok ? "pointer" : "not-allowed",
                    borderColor: builderId === builder.id ? skin.accent : "var(--panel-border)",
                    background: builderId === builder.id ? `${skin.accent}14` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] truncate" style={{ color: "var(--fg)" }}>{builder.name}</span>
                    {builderId === builder.id && <Check size={14} style={{ color: skin.accent }} />}
                  </div>
                  <div className="text-[11px] mt-1 flex items-center gap-2" style={{ color: "var(--fg-dimmer)" }}>
                    <span className="metric">{builder.cli}</span>
                    <span>·</span>
                    <span>{builder.auth.kind === "oauth" ? "login" : builder.auth.kind === "api" ? "API key" : "no auth"}</span>
                    {builder.isDefault && <><span>·</span><span>default</span></>}
                  </div>
                  {!compat.ok && (
                    <div className="text-[11px] mt-1.5" style={{ color: "var(--fg-dimmer)" }}>{compat.reason}</div>
                  )}
                </button>
              ))}
            </div>
          )}

          <Step n={3} title="Name it" />
          <div className="panel p-4 space-y-3">
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
              placeholder="Claude – work"
              maxLength={60}
              className="w-full bg-transparent border rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--panel-border)", color: "var(--fg)" }}
            />
            {skin.extras.length > 0 && (
              <p className="text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>
                An agent is the chat, bound to one account. {skin.label}&apos;s{" "}
                {skin.extras.join(", ")} {skin.extras.length === 1 ? "stays" : "stay"} on the{" "}
                <Link href={skin.route} className="underline">classic tab</Link>.
              </p>
            )}
            {err && <Banner tone="bad">{err}</Banner>}
            <button
              onClick={create}
              disabled={!ready || saving}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border text-[13px] transition"
              style={{
                borderColor: ready ? skin.accent : "var(--panel-border)",
                background: ready ? `${skin.accent}1f` : "transparent",
                color: ready ? "var(--fg)" : "var(--fg-dimmer)",
                cursor: ready && !saving ? "pointer" : "not-allowed",
              }}
            >
              <Plus size={14} />
              {saving ? "Creating…" : "Create agent"}
              {ready && !saving && <ArrowRight size={14} />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SkinCard({ skin, selected, profiles, routers, onPick }: {
  skin: Skin; selected: boolean; profiles: number; routers: number; onPick: () => void;
}) {
  const builderBacked = skin.backendKinds.includes("builder");
  const routerBacked = skin.backendKinds.includes("router");
  return (
    <div
      className="panel p-3.5 transition"
      style={{
        borderColor: selected ? skin.accent : "var(--panel-border)",
        background: selected ? `${skin.accent}12` : undefined,
      }}
    >
      <button onClick={onPick} data-skin={skin.id} className="w-full text-left">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: skin.accent }} />
          <span className="text-[13.5px]" style={{ color: "var(--fg)" }}>{skin.label}</span>
          {selected && <Check size={13} className="ml-auto" style={{ color: skin.accent }} />}
        </div>
        <div className="text-[11px] mt-1.5" style={{ color: "var(--fg-dimmer)" }}>
          {builderBacked
            ? `${profiles} profile${profiles === 1 ? "" : "s"} available · ${skin.accepts.join(", ")}`
            : routerBacked
              ? `built-in engine · or ${routers} router${routers === 1 ? "" : "s"}`
              : "built-in engine · no profile needed"}
        </div>
      </button>
      <Link
        href={skin.route}
        className="inline-flex items-center gap-1 text-[11px] mt-2 hover:underline"
        style={{ color: "var(--fg-dimmer)" }}
      >
        <ExternalLink size={11} /> classic tab
      </Link>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span
        className="grid place-items-center w-5 h-5 rounded-full text-[10px] metric"
        style={{ background: "var(--panel-border)", color: "var(--fg-dim)" }}
      >
        {n}
      </span>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--fg-dimmer)" }}>{title}</span>
    </div>
  );
}

function Banner({ tone, children }: { tone: "bad" | "warn"; children: React.ReactNode }) {
  const color = tone === "bad" ? "#fb7185" : "#fbbf24";
  return (
    <div
      className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px]"
      style={{ borderColor: `${color}55`, background: `${color}12`, color: "var(--fg-dim)" }}
    >
      <TriangleAlert size={14} style={{ color, marginTop: 1, flexShrink: 0 }} />
      <div>{children}</div>
    </div>
  );
}
