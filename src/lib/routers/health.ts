// Does this Router answer, and would a request on it work?
//
// Every kind speaks the OpenAI wire format, so one probe covers all of them:
// GET <baseUrl>/models with the key attached. What differs is how to read the
// result, and that is where most of the value is — the four outcomes below have
// four different fixes, and collapsing them into "red" sends the user to
// reinstall software that was working.
//
//   unreachable  — nothing is listening. Start it, or fix the URL.
//   unauthorized — it answered, and rejected the key. Fix the key.
//   reachable    — it answered, but this endpoint does not list models. Fine.
//   ok           — it answered and listed models.
//
// Nothing here proves a request will succeed: a key can be valid and out of
// credit. The messages say so rather than implying a green dot means "will work".

import { getRouter, routerKind, type Router } from "./registry";

export type RouterState = "ok" | "reachable" | "unauthorized" | "unreachable";

export interface RouterHealth {
  state: RouterState;
  message: string;
  /** How many models the endpoint listed, when it listed any. */
  models: number | null;
  /** HTTP status of the probe, or null when nothing answered. */
  status: number | null;
  durationMs: number;
  warnings: string[];
  /** Quota/rate-limit info from a lightweight chat probe, when available. */
  quota?: RouterQuota | null;
}

export interface RouterQuota {
  /** Whether the plan quota is exhausted (429 with usage_limit_reached). */
  exhausted: boolean;
  /** Unix timestamp when quota resets, from the provider. */
  resetsAt: number | null;
  /** Human-readable reset time. */
  resetsAtLabel: string | null;
  /** Per-window request rate limit (Troll: x-ratelimit-limit). */
  rateLimit: number | null;
  /** Remaining requests in this window (Troll: x-ratelimit-remaining). */
  rateRemaining: number | null;
  /** Requests used in this window. */
  rateUsed: number | null;
  /** Weekly request limit ("unlimited" or a number). */
  weeklyLimit: string | null;
  /** Weekly remaining. */
  weeklyRemaining: string | null;
  /** Weekly used. */
  weeklyUsed: string | null;
  /** Error message from the provider when exhausted. */
  exhaustedMessage: string | null;
}

const TIMEOUT_MS = 8_000;

/** A model list is small. Something far larger is not one, and buffering it
 *  would make the probe the problem rather than the endpoint. */
const MAX_BODY_BYTES = 2_000_000;

function modelsUrl(baseUrl: string): string {
  // baseUrl already ends in /v1 for every kind; /models hangs off it.
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

class BodyTooLarge extends Error {}

/**
 * Read the body with a ceiling.
 *
 * `res.json()` would buffer whatever arrives, and this URL is whatever the user
 * typed — a probe should not be able to exhaust the dashboard's memory because
 * someone pointed a Router at a file server.
 */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

export async function probeRouter(router: Router): Promise<RouterHealth> {
  const spec = routerKind(router.kind);
  const started = Date.now();
  const warnings: string[] = [];

  if (spec?.keyRequired && !router.apiKey) {
    warnings.push(`${spec.label} normally rejects requests without a key.`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  // The whole probe lives inside the timer, body included. `fetch` resolves as
  // soon as the headers land, so a timer cleared at that point leaves the body
  // read unguarded — and an endpoint that sends headers and then stalls would
  // pin this request forever.
  try {
    const res = await fetch(modelsUrl(router.baseUrl), {
      signal: ctrl.signal,
      cache: "no-store",
      headers: router.apiKey ? { Authorization: `Bearer ${router.apiKey}` } : {},
    });

    const durationMs = Date.now() - started;

    if (res.status === 401 || res.status === 403) {
      return {
        state: "unauthorized",
        message: router.apiKey
          ? `${router.baseUrl} answered, and refused this key (HTTP ${res.status}). The endpoint is fine; the key is not.`
          : `${router.baseUrl} answered, and wants a key (HTTP ${res.status}). ${spec?.keyHint ?? ""}`.trim(),
        models: null, status: res.status, durationMs, warnings,
      };
    }

    if (!res.ok) {
      // It answered, so something is listening — that is worth saying, because the
      // fix is completely different from "nothing is there".
      return {
        state: "reachable",
        message: `${router.baseUrl} is up but returned HTTP ${res.status} for /models. `
          + "Some gateways do not implement that route; a real request may still work.",
        models: null, status: res.status, durationMs, warnings,
      };
    }

    let count: number | null = null;
    let stalled = false;
    let oversized = false;
    try {
      const body = JSON.parse(await readCapped(res)) as { data?: unknown[]; models?: unknown[] };
      const arr = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
      if (arr) count = arr.length;
    } catch (e) {
      // "Sent headers then went quiet" and "answered with something that is not a
      // model list" are different problems, so they do not collapse into one.
      if (e instanceof BodyTooLarge) oversized = true;
      else if ((e as Error)?.name === "AbortError") stalled = true;
      /* anything else: a 200 that is not JSON still proves something answered */
    }

    if (stalled) {
      return {
        state: "unreachable",
        message: `${router.baseUrl} sent a reply header and then stopped: no body within ${TIMEOUT_MS / 1000}s.`,
        models: null, status: res.status, durationMs: Date.now() - started, warnings,
      };
    }

    if (count === null) {
      return {
        state: "reachable",
        message: oversized
          ? `${router.baseUrl} answered with more than ${MAX_BODY_BYTES / 1_000_000}MB, which is not a model list. `
            + "Check the URL points at an API and not at a file."
          : `${router.baseUrl} answered, but not with a model list. A real request may still work.`,
        models: null, status: res.status, durationMs: Date.now() - started, warnings,
      };
    }

    return {
      state: "ok",
      message: `Answering with ${count} model${count === 1 ? "" : "s"}. `
        + "Whether the key still has credit is only proven by a real request.",
      models: count, status: res.status, durationMs: Date.now() - started, warnings,
    };
  } catch (e) {
    const durationMs = Date.now() - started;
    const aborted = (e as Error)?.name === "AbortError";
    return {
      state: "unreachable",
      message: aborted
        ? `Nothing answered at ${router.baseUrl} within ${TIMEOUT_MS / 1000}s.`
        + (spec?.local ? " Is it running on this machine?" : "")
        : `Could not reach ${router.baseUrl}: ${String((e as Error)?.message ?? e)}.`
        + (spec?.local ? " Start it, or correct the URL." : ""),
      models: null, status: null, durationMs, warnings,
    };
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

export async function probeRouterById(id: string): Promise<RouterHealth | null> {
  const r = await getRouter(id);
  return r ? probeRouter(r) : null;
}

/**
 * Probe the router's quota by making a minimal chat completion request.
 * This sends a single "hi" message with max_tokens=1 to avoid wasting quota,
 * and reads rate-limit headers and 429 error bodies to determine quota status.
 */
export async function probeRouterQuota(router: Router): Promise<RouterQuota> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const model = router.defaultModel || "gpt-4o";
    const res = await fetch(`${router.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        ...(router.apiKey ? { Authorization: `Bearer ${router.apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });

    // Parse rate-limit headers (Troll-style)
    const rl = (h: string) => {
      const v = res.headers.get(h);
      return v != null ? v : null;
    };
    const rlNum = (h: string) => {
      const v = res.headers.get(h);
      return v != null && v !== "unlimited" ? Number(v) : null;
    };

    const quota: RouterQuota = {
      exhausted: false,
      resetsAt: null,
      resetsAtLabel: null,
      rateLimit: rlNum("x-ratelimit-limit"),
      rateRemaining: rlNum("x-ratelimit-remaining"),
      rateUsed: rlNum("x-ratelimit-used"),
      weeklyLimit: rl("x-ratelimit-weekly-limit"),
      weeklyRemaining: rl("x-ratelimit-weekly-remaining"),
      weeklyUsed: rl("x-ratelimit-weekly-used"),
      exhaustedMessage: null,
    };

    // Check for reset-at header (Sakana-style)
    const resetHeader = res.headers.get("x-codex-primary-reset-at");
    if (resetHeader) {
      const ts = Number(resetHeader);
      if (!isNaN(ts) && ts > 0) {
        quota.resetsAt = ts;
        quota.resetsAtLabel = new Date(ts * 1000).toISOString();
      }
    }

    // 429 = quota exhausted
    if (res.status === 429) {
      quota.exhausted = true;
      try {
        const body = JSON.parse(await readCapped(res)) as {
          error?: { message?: string; resets_at?: number };
        };
        if (body.error?.message) quota.exhaustedMessage = body.error.message;
        if (body.error?.resets_at) {
          quota.resetsAt = body.error.resets_at;
          quota.resetsAtLabel = new Date(body.error.resets_at * 1000).toISOString();
        }
      } catch { /* body parse failed, that's fine */ }
    }

    return quota;
  } catch {
    return {
      exhausted: false, resetsAt: null, resetsAtLabel: null,
      rateLimit: null, rateRemaining: null, rateUsed: null,
      weeklyLimit: null, weeklyRemaining: null, weeklyUsed: null,
      exhaustedMessage: null,
    };
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

export interface RouterModelList {
  /** The model ids the endpoint listed, in the endpoint's own order. */
  models: string[];
  /** Null when a list came back; otherwise why it did not. */
  error: string | null;
}

/**
 * The ids behind probeRouter's count: same URL, same key, same timeout, but
 * the names survive. A picker is only as honest as this list — an endpoint
 * that does not implement /models yields an empty list with the reason, and
 * the UI falls back to "router default" rather than inventing entries.
 */
export async function listRouterModels(router: Router): Promise<RouterModelList> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(modelsUrl(router.baseUrl), {
      signal: ctrl.signal,
      cache: "no-store",
      headers: router.apiKey ? { Authorization: `Bearer ${router.apiKey}` } : {},
    });
    if (!res.ok) {
      return { models: [], error: `${router.baseUrl} answered HTTP ${res.status} for /models.` };
    }
    try {
      const body = JSON.parse(await readCapped(res)) as {
        data?: { id?: unknown; slug?: unknown }[];
        models?: ({ id?: unknown; slug?: unknown } | string)[];
      };
      const arr = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
      if (!arr) return { models: [], error: `${router.baseUrl} answered, but not with a model list.` };
      const models = arr
        .map((m) => typeof m === "string" ? m : String(m?.id ?? m?.slug ?? ""))
        .filter(Boolean);
      return { models, error: models.length ? null : "The endpoint listed no models." };
    } catch {
      return { models: [], error: `${router.baseUrl} sent a reply that was not a readable model list.` };
    }
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return {
      models: [],
      error: aborted
        ? `Nothing answered at ${router.baseUrl} within ${TIMEOUT_MS / 1000}s.`
        : `Could not reach ${router.baseUrl}: ${String((e as Error)?.message ?? e)}.`,
    };
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}
