// Automatic quota refresh, driven by staleness instead of clicks.
//
// Quota readings used to update only when someone pressed probe. The rule now:
// a reading older than QUOTA_STALE_MS refreshes itself at the moments the data
// is about to be used — loading /builders (background kick, response annotates
// `refreshing: true`, plus the legacy `quotaRefreshing` alias) and list_workers
// (inline, before ranking).
//
// Two hard limits keep the automation honest:
//
//   * Cheap probes only. "Cheap" means the connection proof is an HTTP call or
//     a sub-2s status command (codex login status + the ChatGPT wham/usage
//     endpoint, API-key /models probes, native -p provider probes). Kimi's only
//     quota path is a PTY-driven TUI boot (~30s), so it is never automatic.
//   * Concurrency is capped (default 2) so a page load costs at most a couple
//     of provider calls per hour, never a spawn storm.
//
// The heavy-probe helper (kimi TUI boot) remains available only for explicit
// callers/tests: at most one in flight and once per profile per HEAVY_STALE_MS
// (24h). Automatic use points never call it, because a 30s PTY boot must not
// run from a page load or stall list_workers.
//
// Persistence is shared with the manual probe endpoint: persistProbeResult is
// the exact verdict/quota write the health route does, extracted so the
// automatic path updates the registry identically instead of re-implementing it.

import { cliSpec } from "./clis";
import { detectNativeProfiles } from "./nativeProfiles";
import { probeBuilder, type BuilderHealth } from "./health";
import { setBuilderQuota, setBuilderVerified, type Builder } from "./registry";
import { credentialIdentity, sameAccountSiblings } from "./credentialIdentity";

/** A quota reading older than this is refreshed at its next use point. */
export const QUOTA_STALE_MS = 60 * 60 * 1000;

/** Missing or unparseable counts as stale — never probed is the stalest there is. */
export function isStale(
  checkedAt: string | undefined | null,
  thresholdMs: number = QUOTA_STALE_MS,
  nowMs: number = Date.now(),
): boolean {
  if (!checkedAt) return true;
  const t = Date.parse(checkedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t > thresholdMs;
}

/**
 * True when this builder's connection/quota probe is HTTP-class or a fast
 * status command. An API-key profile is always cheap — probeBuilder tests the
 * key against the provider's HTTP endpoint regardless of CLI. False only
 * where the probe boots a TUI through a PTY (kimi subscription logins) — the
 * one probe expensive enough to need the heavy lane instead of the cheap one.
 */
export function isCheapProbe(builder: Builder): boolean {
  if (builder.auth.kind === "api") return true;
  const spec = cliSpec(builder.cli);
  return spec !== null && spec !== undefined && !spec.usageViaTui;
}

/**
 * True when a probe of this builder can actually produce a quota reading:
 * kimi's TUI panel, an OpenRouter key (its /key endpoint reports usage/limit),
 * or a codex subscription login (ChatGPT wham/usage). A codex `-p` profile
 * routed to a custom provider is proven against that provider's key, which
 * reports no quota — including it would re-probe forever without ever bumping
 * checkedAt.
 */
export function isQuotaCapable(builder: Builder): boolean {
  const spec = cliSpec(builder.cli);
  if (!spec) return false;
  if (builder.auth.kind === "api") {
    // Of the API-key probes only OpenRouter's /key endpoint reports usage/limit.
    return "OPENROUTER_API_KEY" in (builder.auth.env ?? {});
  }
  if (spec.usageViaTui) return true;
  // agy's quota comes from the antigravity-usage node script (Google Cloud
  // Code API) — a few seconds, cheap-lane eligible.
  if (builder.cli === "antigravity") return true;
  if (builder.cli === "codex") {
    const sameArgs = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    const native = detectNativeProfiles()
      .find((p) => p.cli === builder.cli && sameArgs(p.args, builder.args ?? []));
    return !native?.provider;
  }
  return false;
}

/**
 * The registry write half of the manual health probe (api/builders/[id]/health):
 * a clean pass marks verified, a hard failure clears it, an inconclusive probe
 * leaves the old verdict alone; quota is kept separately and never cleared.
 */
export async function persistProbeResult(id: string, health: BuilderHealth): Promise<void> {
  if (health.state === "ok" && health.connection === "connected") {
    const detail = [health.connectionDetail, health.quota].filter(Boolean).join(" · ");
    await setBuilderVerified(id, { at: new Date().toISOString(), detail: detail || "Health probe passed." });
  } else if (health.state === "fail" || health.connection === "not-connected") {
    await setBuilderVerified(id, null);
  }
  if (health.quota) await setBuilderQuota(id, health.quota);
}

// Probes currently running, per process. GET /api/builders reads this to
// annotate its response; the filter below reads it so a background kick and an
// inline list_workers refresh never probe the same profile twice.
const inFlight = new Set<string>();

export function isQuotaRefreshing(id: string): boolean {
  return inFlight.has(id);
}

export interface RefreshStaleQuotaOpts {
  thresholdMs?: number;
  concurrency?: number;
  nowMs?: number;
  /**
   * Injectable for tests — the real probeBuilder spawns CLIs and calls
   * providers, so specs pass a stub and assert on the registry writes.
   */
  probe?: (builder: Builder) => Promise<BuilderHealth>;
}

/**
 * Probe every quota-capable, cheap-to-probe builder whose reading is stale and
 * persist the result. Never throws: a failed auto-refresh keeps the old dated
 * reading, exactly like a failed manual probe. Returns the ids whose quota
 * reading was actually updated. Awaiting it (list_workers) blocks only on
 * HTTP-class probes; not awaiting it (GET /api/builders) makes it a background
 * kick — targets are marked in-flight synchronously, before the first await,
 * so the caller can annotate its response immediately.
 */
export async function refreshStaleQuota(
  builders: Builder[],
  opts: RefreshStaleQuotaOpts = {},
): Promise<string[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const thresholdMs = opts.thresholdMs ?? QUOTA_STALE_MS;
  const probe = opts.probe ?? probeBuilder;

  const targets = builders.filter((b) =>
    !inFlight.has(b.id)
    && isQuotaCapable(b)
    && isCheapProbe(b)
    && isStale(b.quota?.checkedAt, thresholdMs, nowMs));
  // One probe per ACCOUNT, not per profile: two builders billing one identity
  // would otherwise each pay a probe for identical numbers. The first profile
  // of an identity is probed; its reading fans out to the rest below.
  const seenIdentities = new Set<string>();
  const dedupedTargets = targets.filter((b) => {
    const id = credentialIdentity(b);
    if (!id) return true;
    if (seenIdentities.has(id)) return false;
    seenIdentities.add(id);
    return true;
  });
  for (const b of dedupedTargets) inFlight.add(b.id);

  const refreshed: string[] = [];
  let next = 0;
  const lanes = Math.max(1, Math.min(opts.concurrency ?? 2, dedupedTargets.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (next < dedupedTargets.length) {
      const b = dedupedTargets[next++];
      try {
        const health = await probe(b);
        await persistProbeResult(b.id, health);
        if (health.quota) {
          refreshed.push(b.id);
          // The account is the quota's owner — stamp every sibling profile of
          // the same identity with the same reading and the same timestamp.
          for (const s of sameAccountSiblings(b, builders)) {
            try { await setBuilderQuota(s.id, health.quota); refreshed.push(s.id); } catch { /* sibling write is best-effort */ }
          }
        }
      } catch {
        // Swallowed by design — the stale reading stays, dated, and the next
        // use point tries again after the threshold.
      } finally {
        inFlight.delete(b.id);
      }
    }
  }));
  return refreshed;
}

/** A heavy-probe (TUI boot) quota reading older than this gets the slow lane. */
export const HEAVY_STALE_MS = 24 * 60 * 60 * 1000;

// Per-profile floor for an explicit heavy-lane caller, per process. A TUI boot
// costs ~30s and a PTY; even a failed boot must not retry immediately, so the
// floor is stamped when the probe is kicked, not when it succeeds.
const lastHeavyRefreshAt = new Map<string, number>();

export interface RefreshHeavyStaleQuotaOpts {
  thresholdMs?: number;
  nowMs?: number;
  /** Injectable for tests — see RefreshStaleQuotaOpts.probe. */
  probe?: (builder: Builder) => Promise<BuilderHealth>;
}

/**
 * The heavy lane: probe quota-capable builders whose only probe is a TUI boot
 * (kimi subscription logins) and whose reading is older than HEAVY_STALE_MS.
 * One at a time, at most once per profile per threshold, sharing the inFlight
 * set with the cheap lane. This helper is explicit-only: automatic use points
 * must not call it because a 30s PTY boot must not run unattended or stall a
 * tool call. Never throws, same as refreshStaleQuota.
 */
export async function refreshHeavyStaleQuota(
  builders: Builder[],
  opts: RefreshHeavyStaleQuotaOpts = {},
): Promise<string[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const thresholdMs = opts.thresholdMs ?? HEAVY_STALE_MS;
  const probe = opts.probe ?? probeBuilder;

  const targets = builders.filter((b) => {
    if (inFlight.has(b.id)) return false;
    if (!isQuotaCapable(b) || isCheapProbe(b)) return false;
    if (!isStale(b.quota?.checkedAt, thresholdMs, nowMs)) return false;
    const last = lastHeavyRefreshAt.get(b.id);
    return last === undefined || nowMs - last > thresholdMs;
  });
  // Same account, one boot: identity-dedupe before probing, fan out after.
  const seenIdentities = new Set<string>();
  const dedupedTargets = targets.filter((b) => {
    const id = credentialIdentity(b);
    if (!id) return true;
    if (seenIdentities.has(id)) return false;
    seenIdentities.add(id);
    return true;
  });
  for (const b of dedupedTargets) {
    inFlight.add(b.id);
    lastHeavyRefreshAt.set(b.id, nowMs);
  }

  const refreshed: string[] = [];
  // Concurrency 1, always: one PTY boot at a time.
  for (const b of dedupedTargets) {
    try {
      const health = await probe(b);
      await persistProbeResult(b.id, health);
      if (health.quota) {
        refreshed.push(b.id);
        for (const s of sameAccountSiblings(b, builders)) {
          try { await setBuilderQuota(s.id, health.quota); refreshed.push(s.id); } catch { /* sibling write is best-effort */ }
        }
      }
    } catch {
      // Swallowed by design — same rule as the cheap lane, and the floor
      // above means the next retry is a day away, not the next page load.
    } finally {
      inFlight.delete(b.id);
    }
  }
  return refreshed;
}
