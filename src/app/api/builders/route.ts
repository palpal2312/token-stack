import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { checkLocalRequest } from "@/lib/localOnly";
import { allClis, defaultBinFor } from "@/lib/builders/clis";
import { detectNativeProfiles } from "@/lib/builders/nativeProfiles";
import {
  listBuilders, createBuilder, publicBuilder, orphanedProfileDirs, RegistryCorrupt,
  type Builder,
} from "@/lib/builders/registry";
import { refreshStaleQuota, isQuotaRefreshing } from "@/lib/builders/quotaRefresh";
import { probeOmniRoute } from "@/lib/omniroute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failed(e: unknown) {
  // A corrupted registry is a user-fixable situation, not a server bug — say what
  // to fix rather than returning an unexplained 500.
  if (e instanceof RegistryCorrupt) return NextResponse.json({ error: e.message, corrupt: true }, { status: 409 });
  return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
}

// Guarded even for read: the list names every profile and its masked secrets —
// credential-adjacent, so a local process without the token gets nothing.

import { credentialIdentity, sameAccountSiblings } from "@/lib/builders/credentialIdentity";
import { modelsForBuilder } from "@/lib/sen-models";

function sharedAccountWith(b: Builder, all: Builder[]): string[] {
  return sameAccountSiblings(b, all).map((o) => o.id);
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const url = new URL(req.url);
    // Summary: enough to paint Active/Inactive shells (CLI cards + profile rows)
    // without models catalogs or native-profile disk scans. Full GET follows.
    const summary = url.searchParams.get("summary") === "1";
    const refreshQuota = url.searchParams.get("refreshQuota") === "1";

    const mark = (label: string, started: number) => {
      const ms = Date.now() - started;
      if (ms >= 50) console.info(`[api/builders] ${label} ${ms}ms`);
      return Date.now();
    };
    let t = Date.now();
    const builders = await listBuilders();
    t = mark("listBuilders", t);
    // Free Claude Code is a virtual CLI (claude binary + OmniRoute proxy). Having
    // Claude Code installed must not mark FCC as installed when the gateway is down.
    // Summary skips the probe so Active can paint without waiting on :20128.
    const omniReachable = summary ? false : await probeOmniRoute();
    if (!summary) t = mark("probeOmniRoute", t);
    const clis = allClis()
      .filter((c) => !c.id.startsWith("fixture"))
      .map((c) => {
        const bin = defaultBinFor(c);
        const hostBinOk = Boolean(bin && existsSync(bin));
        // Virtual CLIs reuse another binary; "installed" means the product path works.
        const installed = c.id === "fcc"
          ? hostBinOk && omniReachable
          : hostBinOk;
        return {
          id: c.id, label: c.label,
          installed,
          defaultBin: bin,
          authKinds: c.authKinds,
          apiKeyEnv: c.apiKeyEnv,
          multiProfile: c.multiProfile && installed,
          isolationEnv: c.isolationEnv,
          canLogin: Boolean(c.loginArgs),
          notes: c.notes,
          profileCount: builders.filter((b) => b.cli === c.id).length,
        };
      });
    t = mark("clis", t);

    // Native CLI profiles the dashboard has not imported yet. One is "imported"
    // when a Builder exists with the same cli and the same invoking args.
    // Deferred on summary — mainly useful when browsing Inactive / Add profile.
    let nativeProfiles: ReturnType<typeof detectNativeProfiles> = [];
    if (!summary) {
      const sameArgs = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
      nativeProfiles = detectNativeProfiles()
        .filter((p) => !builders.some((b) => b.cli === p.cli && sameArgs(b.args, p.args)));
      t = mark("nativeProfiles", t);
    }

    // Cache/config-only model lists — parallel, no CLI spawns / provider HTTP.
    // Skipped on summary so Active can paint before catalog reads finish.
    const modelsById = new Map<string, Awaited<ReturnType<typeof modelsForBuilder>>>();
    if (!summary) {
      await Promise.all(builders.map(async (b) => {
        try {
          modelsById.set(b.id, await modelsForBuilder(b, { live: false, signal: req.signal }));
        } catch {
          modelsById.set(b.id, { models: [], cliDefault: null, source: "unavailable" });
        }
      }));
      t = mark("modelsForBuilder×N", t);
    }

    // Quota probes must not start on every page load — they saturate the Node
    // event loop (provider HTTP / status spawns) and make soft-nav away from
    // /builders multi-seconds slower than other dashboard transitions. Opt in
    // via ?refreshQuota=1 (CLI Config Quota button / hourly schedule).
    if (refreshQuota) {
      void refreshStaleQuota(builders).catch(() => {});
    }

    const orphanedDirs = summary ? [] : await orphanedProfileDirs();
    if (!summary) t = mark("orphanedDirs", t);

    const payload = {
      summary: summary || undefined,
      builders: builders.map((b) => ({
        ...publicBuilder(b),
        modelsInfo: modelsById.get(b.id) ?? null,
        // Set when a background quota refresh for this profile is in flight —
        // its reading below is the stale one being replaced right now.
        // `refreshing` is the policy contract; keep `quotaRefreshing` as a
        // compatibility alias for existing dashboard/API consumers.
        ...(isQuotaRefreshing(b.id) ? { refreshing: true, quotaRefreshing: true } : {}),
        // Two profiles can bill the SAME account (kimi01 and kimi-default
        // here). The identity is the credential token's hash — no secrets
        // leave the process, only the grouping.
        ...(sharedAccountWith(b, builders).length
          ? { sharedAccountWith: sharedAccountWith(b, builders) }
          : {}),
        // Phase 11: whether any account identity resolved at all — the UI
        // shows "identity unknown" for unidentifiable profiles.
        identified: credentialIdentity(b) !== null,
      })),
      clis,
      nativeProfiles,
      orphanedDirs,
    };
    mark("publicBuilder map", t);
    return NextResponse.json(payload);
  } catch (e) { return failed(e); }
}

export async function POST(req: Request) {
  const guard = checkLocalRequest(req);
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  try {
    const builder = await createBuilder({
      cli: String(body.cli ?? ""),
      name: String(body.name ?? ""),
      authKind: body.authKind as "oauth" | "api" | "none" | undefined,
      secrets: (body.secrets ?? {}) as Record<string, string>,
      env: (body.env ?? {}) as Record<string, string>,
      bin: body.bin === undefined ? null : (body.bin as string | null),
      args: Array.isArray(body.args) ? (body.args as string[]).map(String) : [],
      model: body.model === undefined ? null : (body.model as string | null),
      effort: body.effort === undefined ? null : (body.effort as string | null),
      notes: String(body.notes ?? ""),
    });
    return NextResponse.json({ builder: publicBuilder(builder) }, { status: 201 });
  } catch (e) {
    if (e instanceof RegistryCorrupt) return failed(e);
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}
