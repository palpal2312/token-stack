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

function sharedAccountWith(b: Builder, all: Builder[]): string[] {
  return sameAccountSiblings(b, all).map((o) => o.id);
}

export async function GET(req: Request) {
  const guard = checkLocalRequest(req, { requireJson: false });
  if (guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const builders = await listBuilders();
    // Stale quota readings refresh themselves: kick a background pass over the
    // cheap-to-probe profiles (concurrency-capped, never a TUI boot) and mark
    // the in-flight ones below. Not awaited — the response must not block on
    // provider calls. refreshStaleQuota never rejects; the catch is belt and
    // braces for a fire-and-forget promise.
    void refreshStaleQuota(builders).catch(() => {});
    const clis = allClis()
      .filter((c) => !c.id.startsWith("fixture"))
      .map((c) => {
        const bin = defaultBinFor(c);
        return {
          id: c.id, label: c.label,
          installed: Boolean(bin && existsSync(bin)),
          defaultBin: bin,
          authKinds: c.authKinds,
          apiKeyEnv: c.apiKeyEnv,
          multiProfile: c.multiProfile,
          isolationEnv: c.isolationEnv,
          canLogin: Boolean(c.loginArgs),
          notes: c.notes,
          profileCount: builders.filter((b) => b.cli === c.id).length,
        };
      });
    // Native CLI profiles the dashboard has not imported yet. One is "imported"
    // when a Builder exists with the same cli and the same invoking args.
    const sameArgs = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    const nativeProfiles = detectNativeProfiles()
      .filter((p) => !builders.some((b) => b.cli === p.cli && sameArgs(b.args, p.args)));

    return NextResponse.json({
      builders: builders.map((b) => ({
        ...publicBuilder(b),
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
      orphanedDirs: await orphanedProfileDirs(),
    });
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
