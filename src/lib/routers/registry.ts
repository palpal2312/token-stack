// Router profiles, stored in ~/.agentic-os/routers.json.
//
// A Router is to an HTTP model endpoint what a Builder is to a CLI: one named
// configuration — a base URL, a key, an optional default model — that a skin can
// be pointed at. Two OpenRouter keys are two Routers, and an agent bound to one
// never quietly bills the other.
//
// Same three rules as the Builder registry, for the same reasons: writes are
// serialized and atomic, a corrupted file is reported rather than repaired, and
// keys leave here only through publicRouter().
//
// Deliberately never seeded. Every API-backed tab already works from environment
// variables, and inventing Router rows on first run would imply the dashboard had
// chosen an account for you. Routers are opt-in.

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { AGENTIC_HOME, RegistryCorrupt, slugify, maskSecret, isMasked } from "../builders/registry";

// Re-exported so the Router routes can catch it without also importing the
// Builder registry: it is one error class for one failure — a registry file that
// exists but cannot be read — and both files raise it.
export { RegistryCorrupt };

export const ROUTERS_FILE = path.join(AGENTIC_HOME, "routers.json");

export type RouterKind = "openrouter" | "omniroute" | "sub2api" | "custom-openai" | "anthropic";

export interface RouterKindSpec {
  id: RouterKind;
  label: string;
  /** Pre-filled base URL, or null when only the user knows where it lives. */
  defaultBaseUrl: string | null;
  /** Whether a request to this endpoint is rejected without a key. */
  keyRequired: boolean;
  /** What the key looks like and where it comes from. */
  keyHint: string;
  /** True when the endpoint is expected on this machine rather than the internet. */
  local: boolean;
  /**
   * Which chat adapter speaks for this kind — the wire format, not the brand.
   * A plain string rather than an import so this file stays free of the
   * adapter layer and the format on disk never names code.
   */
  adapter: string;
  notes: string;
}

// Four kinds speak the OpenAI wire format; what differs between them is where
// they live, who issues the key, and what it costs. Anything else
// OpenAI-compatible — Ollama, LM Studio, a company gateway — is covered by
// custom-openai for free. Anthropic is the odd one out on purpose: its native
// API differs enough (path, auth header, system param, stream events) that
// pretending it speaks OpenAI wire would cost more than the adapter it gets.
const KINDS: RouterKindSpec[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    keyRequired: true,
    keyHint: "An OpenRouter key (starts with sk-or-) from openrouter.ai/keys.",
    local: false,
    adapter: "openai-compatible",
    notes: "The aggregator the API-backed tabs already call. Add one Router per key to keep "
      + "work and personal spend apart, or to run a free-model key beside a paid one.",
  },
  {
    id: "omniroute",
    label: "OmniRoute",
    defaultBaseUrl: "http://localhost:20128/v1",
    keyRequired: false,
    keyHint: "Usually none — OmniRoute holds the upstream credentials itself.",
    local: true,
    adapter: "openai-compatible",
    notes: "Runs on your machine and fans out across 90+ providers with automatic fallback. "
      + "The OmniRoute tab talks to this same endpoint whether or not a Router exists.",
  },
  {
    id: "sub2api",
    label: "Sub2API",
    defaultBaseUrl: "http://localhost:5173/v1",
    keyRequired: true,
    keyHint: "A key the Sub2API admin dashboard issues to a user (starts with sk-).",
    local: true,
    adapter: "openai-compatible",
    notes: "A self-hosted gateway (github.com/Wei-Shaw/sub2api, LGPL-3.0) that turns AI "
      + "subscriptions into an OpenAI-compatible API. It is a full platform — Go binary plus "
      + "PostgreSQL 15+ and Redis 7+ — not a single process, and its own README warns that "
      + "using it may breach the upstream providers' terms. Agent OS only ever talks to the "
      + "endpoint you point it at; it never installs or runs it.",
  },
  {
    id: "custom-openai",
    label: "OpenAI-compatible",
    defaultBaseUrl: null,
    keyRequired: false,
    keyHint: "Whatever the endpoint expects, or blank if it takes anything.",
    local: false,
    adapter: "openai-compatible",
    notes: "Anything that speaks the OpenAI wire format: Ollama, LM Studio, vLLM, a company "
      + "gateway. Give it the base URL ending in /v1.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    keyRequired: true,
    keyHint: "An Anthropic key (starts with sk-ant-) from console.anthropic.com/settings/keys.",
    local: false,
    adapter: "anthropic",
    notes: "Claude's first-party API, spoken natively: requests go to /v1/messages with the key "
      + "in an x-api-key header, not /chat/completions with a Bearer token. One Router per key, "
      + "as ever — a work key and a personal key never bill each other.",
  },
];

export function allRouterKinds(): RouterKindSpec[] { return KINDS; }
export function routerKind(id: string): RouterKindSpec | null {
  return KINDS.find((k) => k.id === id) ?? null;
}

export interface Router {
  id: string;
  kind: RouterKind;
  name: string;
  baseUrl: string;
  /** Raw key. Never leaves this module except through a deliberate resolve call. */
  apiKey: string;
  defaultModel: string | null;
  isDefault: boolean;
  notes: string;
  createdAt: string;
  /** Whether this router has an active subscription plan. */
  plan?: boolean;
  /** Whether pay-as-you-go billing is activated. */
  payg?: boolean;
  /** URL to the provider's billing/usage dashboard. */
  dashboardUrl?: string | null;
  /** Free-form plan quota description, e.g. "1M tokens/mo" or "$50/mo". */
  planQuota?: string | null;
}

interface RegistryFile { version: 1; routers: Router[] }

// ---------------------------------------------------------------- persistence

let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

async function readFileRaw(): Promise<RegistryFile | null> {
  if (!existsSync(ROUTERS_FILE)) return null;
  let text: string;
  try { text = await readFile(ROUTERS_FILE, "utf8"); }
  catch (e) { throw new RegistryCorrupt(ROUTERS_FILE, e); }
  if (!text.trim()) return { version: 1, routers: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new RegistryCorrupt(ROUTERS_FILE, e); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as RegistryFile).routers)) {
    throw new RegistryCorrupt(ROUTERS_FILE, "no routers array");
  }
  return { version: 1, routers: (parsed as RegistryFile).routers.map(normalize) };
}

function normalize(r: Partial<Router>): Router {
  return {
    id: String(r.id ?? ""),
    kind: (r.kind ?? "custom-openai") as RouterKind,
    name: String(r.name ?? r.id ?? ""),
    baseUrl: String(r.baseUrl ?? ""),
    apiKey: String(r.apiKey ?? ""),
    defaultModel: r.defaultModel ?? null,
    isDefault: Boolean(r.isDefault),
    notes: String(r.notes ?? ""),
    createdAt: String(r.createdAt ?? new Date().toISOString()),
    plan: r.plan ?? undefined,
    payg: r.payg ?? undefined,
    dashboardUrl: r.dashboardUrl ?? null,
    planQuota: r.planQuota ?? null,
  };
}

async function writeAtomic(data: RegistryFile): Promise<void> {
  await mkdir(AGENTIC_HOME, { recursive: true });
  const tmp = `${ROUTERS_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  // 0600 because this file is nothing but API keys. Advisory on Windows,
  // load-bearing everywhere else, and free either way.
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmp, ROUTERS_FILE);
  } catch (e) {
    // A rename can fail — an indexer holding the target open, a cross-volume
    // AGENTIC_HOME. Left alone that abandons every key in a temp file nothing
    // ever reads again and nothing ever shows.
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- validation

/**
 * A base URL is fetched by the server, so it is checked here rather than trusted.
 * Only http(s) is allowed: a file: or data: URL would turn a text field into a
 * way to read this machine.
 *
 * The three rejections below are refusals, not silent repairs. Stripping a
 * `?api-key=` would leave a Router that cannot authenticate for a reason the UI
 * never stated, which is worse than saying no.
 */
export function normalizeBaseUrl(raw: string): string {
  const text = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!text) throw new Error("Give the Router a base URL.");
  let u: URL;
  try { u = new URL(text); }
  catch { throw new Error(`That is not a URL. It should look like https://openrouter.ai/api/v1.`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`A Router URL must be http or https, not ${u.protocol.replace(":", "")}.`);
  }
  // A credential in the URL is the one secret this module could not mask: the
  // base URL is stored as typed, rendered in full on the card, and repeated in
  // every error message.
  if (u.username || u.password) {
    throw new Error(
      "Take the sign-in out of the base URL. Put the key in the API key field, where it is masked and never sent to the browser.",
    );
  }
  // Requests are built as `${baseUrl}/chat/completions`. A query or fragment
  // swallows that path, so every call would quietly land on /v1 instead.
  if (u.search) {
    throw new Error(
      "Take the query string off the base URL — it would swallow the request path. Only the part ending in /v1 belongs here.",
    );
  }
  if (u.hash) throw new Error("Take the #fragment off the base URL. Only the part ending in /v1 belongs here.");
  return u.toString().replace(/\/+$/, "");
}

// ------------------------------------------------------------------ public API

export async function listRouters(): Promise<Router[]> {
  const f = await readFileRaw();
  return f?.routers ?? [];
}

export async function getRouter(id: string): Promise<Router | null> {
  return (await listRouters()).find((r) => r.id === id) ?? null;
}

export interface CreateInput {
  kind: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string | null;
  notes?: string;
}

export async function createRouter(input: CreateInput): Promise<Router> {
  const spec = routerKind(input.kind);
  if (!spec) throw new Error(`Unknown Router kind "${input.kind}".`);

  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Give the Router a name.");

  const baseUrl = normalizeBaseUrl(input.baseUrl?.trim() || spec.defaultBaseUrl || "");
  const apiKey = String(input.apiKey ?? "").trim();
  if (spec.keyRequired && !apiKey) {
    // Same reasoning as an empty API key on a Builder: a blank credential is worse
    // than none, because the endpoint answers 401 and the user reads it as their
    // account having failed.
    throw new Error(`${spec.label} rejects requests without a key. ${spec.keyHint}`);
  }

  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, routers: [] };
    const base = slugify(name) || spec.id;
    let id = base;
    for (let n = 2; f.routers.some((r) => r.id === id); n++) id = `${base}-${n}`;

    const router = normalize({
      id, kind: spec.id, name, baseUrl, apiKey,
      defaultModel: input.defaultModel?.trim() || null,
      isDefault: !f.routers.some((r) => r.kind === spec.id),
      notes: input.notes ?? "",
      createdAt: new Date().toISOString(),
    });
    f.routers.push(router);
    await writeAtomic(f);
    return router;
  });
}

export interface PatchInput {
  name?: string;
  baseUrl?: string;
  /** Absent leaves the key alone; a masked value is ignored; "" is rejected. */
  apiKey?: string;
  defaultModel?: string | null;
  isDefault?: boolean;
  notes?: string;
  plan?: boolean;
  payg?: boolean;
  dashboardUrl?: string | null;
  planQuota?: string | null;
}

export async function updateRouter(id: string, patch: PatchInput): Promise<Router> {
  return serialized(async () => {
    const f = await readFileRaw();
    const r = f?.routers.find((x) => x.id === id);
    if (!f || !r) throw new Error(`No Router "${id}".`);
    const spec = routerKind(r.kind);

    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (!n) throw new Error("The Router needs a name.");
      r.name = n;
    }
    if (patch.baseUrl !== undefined) r.baseUrl = normalizeBaseUrl(patch.baseUrl);
    if (patch.apiKey !== undefined) {
      // The UI only ever renders a masked key. If one comes back, the user did not
      // retype it — storing it would replace a working key with "sk-o…9f2c".
      if (!isMasked(patch.apiKey)) {
        const next = String(patch.apiKey).trim();
        if (!next && spec?.keyRequired) {
          throw new Error(`${spec.label} needs a key. Delete the Router instead of blanking it.`);
        }
        r.apiKey = next;
      }
    }
    if (patch.defaultModel !== undefined) r.defaultModel = patch.defaultModel?.trim() || null;
    if (patch.notes !== undefined) r.notes = String(patch.notes);
    if (patch.plan !== undefined) r.plan = patch.plan;
    if (patch.payg !== undefined) r.payg = patch.payg;
    if (patch.dashboardUrl !== undefined) r.dashboardUrl = patch.dashboardUrl?.trim() || null;
    if (patch.planQuota !== undefined) r.planQuota = patch.planQuota?.trim() || null;
    if (patch.isDefault) {
      for (const o of f.routers) if (o.kind === r.kind) o.isDefault = o.id === r.id;
    }
    await writeAtomic(f);
    return r;
  });
}

export async function deleteRouter(id: string): Promise<void> {
  return serialized(async () => {
    const f = await readFileRaw();
    const r = f?.routers.find((x) => x.id === id);
    if (!f || !r) throw new Error(`No Router "${id}".`);
    f.routers = f.routers.filter((x) => x.id !== id);
    if (r.isDefault) {
      const sibling = f.routers.find((x) => x.kind === r.kind);
      if (sibling) sibling.isDefault = true;
    }
    await writeAtomic(f);
  });
}

// -------------------------------------------------------------------- masking

export interface PublicRouter extends Omit<Router, "apiKey"> {
  hasKey: boolean;
  keyPreview: string;
}

/** The shape safe to send over HTTP. The raw key is never in it. */
export function publicRouter(r: Router): PublicRouter {
  const { apiKey, ...rest } = r;
  return { ...rest, hasKey: Boolean(apiKey), keyPreview: maskSecret(apiKey) };
}
