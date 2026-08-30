// Shadow-mode proxy harness for the SEN control-plane migration (phase 05
// step 3). While the Go control plane is being built out, a Next.js sen route
// stays authoritative and the Go equivalent is queried in shadow: payloads
// are compared and divergences logged, so parity is measured before any
// authority flip. Shadow mode never changes the response, never throws, and
// only runs when explicitly enabled (SEN_GO_SHADOW=1) with the Go listener
// configured.

import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { AGENTIC_HOME } from "./builders/registry";
import { goApiAvailable, goApiFetch } from "./goApiProxy";

export function shadowEnabled(): boolean {
  return process.env.SEN_GO_SHADOW === "1";
}

function logFile(): string {
  return path.join(process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME, "logs", "sen-shadow.jsonl");
}

async function appendEntry(entry: Record<string, unknown>): Promise<void> {
  const file = logFile();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`);
}

/**
 * Per-route comparison options. Shadow parity is per-route field comparison,
 * NOT deep equality: these options decide which fields participate and how
 * many object levels deep the presence + type check recurses. Values are
 * never compared.
 */
export interface ShadowCompareOptions {
  /**
   * Restrict comparison to these top-level fields (both directions); every
   * other key is ignored. Without this, all top-level keys on both sides
   * participate (envelope-level).
   */
  fields?: string[];
  /**
   * How many object levels deep presence + type checks recurse (default 1 =
   * envelope-level). Arrays stay leaf-typed ("array") — element alignment is
   * out of scope for shape parity.
   */
  depth?: number;
  /**
   * "compare" (default): fetch the Go counterpart and diff payload shapes.
   * "observation-only": NEVER call the Go listener — the counterpart is a
   * mutating canonical command, and replaying it in shadow mode would create
   * divergent canonical state (see shadowObserve). Only the legacy response
   * is observed and logged, marked comparison=observation-only.
   */
  mode?: "compare" | "observation-only";
}

/**
 * Per-route comparison config, keyed by the routeName passed to
 * shadowCompare. Routes absent here compare at envelope level (top-level key
 * presence + type, both directions). The `parity` flag in the shadow log
 * always means "no mismatches under this route's configured comparison" —
 * nothing stronger.
 */
export const SHADOW_ROUTE_COMPARISON: Record<string, ShadowCompareOptions> = {
  // Firstmate file-based overview vs the canonical domain projection. Only
  // the domain payload fields participate: the legacy side intentionally
  // carries extra UI fields (home, fleet, plans, …) the projection does not,
  // and the projection carries metadata (projectionVersion, updatedAt,
  // source) the legacy side never will — those permanent divergences must
  // not drown out the parity signal for the fields the cutover depends on.
  "sen": { fields: ["goals", "tasks", "blockers", "nextDecisions"] },
  // "sen/metrics" stays envelope-level on purpose: the two sides are
  // intentionally different payloads (llmops run metrics vs canonical domain
  // counts), so the envelope diff itself is the measurement.
  //
  // Threads read path. Legacy lists runtime-run threads from the file state
  // store; the Go read model lists chat sessions from sen_session_turns.
  // Both sides now emit compatibility aliases (threads↔sessions,
  // messages↔turns) so field-level presence+type can pass. Values and
  // sources still differ; legacy-UI-only (agentName) and canonical-metadata
  // (projectionVersion/updatedAt/source) stay ignored both directions.
  "sen/threads": { fields: ["threads", "sessions"] },
  "sen/threads/{id}": { fields: ["threadId", "messages", "turns"] },
  // Chat is a command surface: its Go counterpart POST /v1/sen/chat/turns is a
  // live MUTATING canonical command. Shadow mode must never replay mutations
  // into Go (one authority for side effects), so chat is observation-only —
  // the legacy response shape is logged and Go is never called. See
  // shadowObserveResponse.
  "sen/chat": { mode: "observation-only" },
};

function sha256Bytes(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function typeOf(value: unknown): string {
  return Array.isArray(value) ? "array" : typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compareObjects(
  legacyObj: Record<string, unknown>,
  canonicalObj: Record<string, unknown>,
  prefix: string,
  depth: number,
  onlyFields: string[] | undefined,
  mismatches: string[],
): void {
  // Legacy keys first (missing-in-canonical / type mismatches), then
  // canonical-only keys — both directions, stable message order.
  const keys = onlyFields ?? [...new Set([...Object.keys(legacyObj), ...Object.keys(canonicalObj)])];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const inLegacy = key in legacyObj;
    const inCanonical = key in canonicalObj;
    if (inLegacy && !inCanonical) {
      mismatches.push(`missing in canonical: ${path}`);
      continue;
    }
    if (!inLegacy && inCanonical) {
      mismatches.push(`missing in legacy: ${path}`);
      continue;
    }
    if (!inLegacy && !inCanonical) continue; // a configured field absent on both sides agrees
    const legacyType = typeOf(legacyObj[key]);
    const canonicalType = typeOf(canonicalObj[key]);
    if (legacyType !== canonicalType) {
      mismatches.push(`type mismatch at ${path}: legacy ${legacyType} vs canonical ${canonicalType}`);
      continue;
    }
    if (depth > 1 && isPlainObject(legacyObj[key]) && isPlainObject(canonicalObj[key])) {
      compareObjects(
        legacyObj[key] as Record<string, unknown>,
        canonicalObj[key] as Record<string, unknown>,
        path, depth - 1, undefined, mismatches,
      );
    }
  }
}

/**
 * Structural comparison of two JSON payloads: key presence and value types,
 * both directions, values never compared. Default (no options) is
 * envelope-level — top-level keys only. Per-route options (see
 * SHADOW_ROUTE_COMPARISON) graduate a route to field-level comparison.
 * Deep value parity remains a later migration step.
 */
export function comparePayloads(legacy: unknown, canonical: unknown, options?: ShadowCompareOptions): string[] {
  const mismatches: string[] = [];
  const legacyObj = isPlainObject(legacy) ? legacy : null;
  const canonicalObj = isPlainObject(canonical) ? canonical : null;
  if (!legacyObj || !canonicalObj) {
    if (legacyObj !== canonicalObj) mismatches.push("payload kinds differ (object vs non-object)");
    return mismatches;
  }
  compareObjects(legacyObj, canonicalObj, "", Math.max(1, options?.depth ?? 1), options?.fields, mismatches);
  return mismatches;
}

/**
 * Shadow-compare the authoritative legacy payload against the Go route.
 * Always resolves, never throws; mismatches append to the JSONL log.
 *
 * The comparison mode comes from SHADOW_ROUTE_COMPARISON and is recorded in
 * the entry (`comparison`, plus `fields` for field-level routes) so a parity
 * pass is never read as more than it is: parity means "no mismatches under
 * this route's configured field comparison", not deep equality.
 */
export async function shadowCompare(
  routeName: string,
  goPath: string,
  legacyPayload: unknown,
  extras?: { legacyBytesSha256?: string },
): Promise<void> {
  try {
    if (!shadowEnabled()) return;
    if (!(await goApiAvailable())) return;
    const routeOptions = SHADOW_ROUTE_COMPARISON[routeName];
    // Defense in depth: an observation-only route's Go counterpart is a
    // mutating canonical command. Shadow mode must never call it, even if a
    // caller reaches for shadowCompare by mistake — route such calls through
    // shadowObserveResponse instead.
    if (routeOptions?.mode === "observation-only") return;
    const result = await goApiFetch(goPath);
    const entry: Record<string, unknown> = {
      at: new Date().toISOString(),
      route: routeName,
      goStatus: result.status,
      unreachable: result.unreachable === true,
      comparison: routeOptions ? "field-level" : "envelope",
      ...(routeOptions?.fields ? { fields: routeOptions.fields } : {}),
      legacyPayloadSha256: sha256Bytes(JSON.stringify(legacyPayload ?? null)),
      ...(extras?.legacyBytesSha256 ? { legacyBytesSha256: extras.legacyBytesSha256 } : {}),
    };
    if (result.unreachable) {
      entry.parity = null;
      entry.availability = "unavailable";
      entry.mismatches = [];
    } else if (result.ok) {
      const mismatches = comparePayloads(legacyPayload, result.body, routeOptions);
      entry.mismatches = mismatches;
      entry.parity = mismatches.length === 0;
      entry.availability = "ok";
    } else {
      entry.parity = false;
      entry.availability = "error";
      entry.mismatches = [`go side returned ${result.status}`];
    }
    await appendEntry(entry);
  } catch { /* shadow mode is observability only — never break the route */ }
}

/**
 * Shadow-compare a route handler's Response against the Go route without
 * touching the response the caller returns: the body is cloned for
 * observation (synchronously, before the framework can start consuming the
 * original), so the legacy response stays byte-identical. Non-ok legacy
 * responses are skipped — an erroring legacy side has no payload to compare
 * (same contract as routes that only shadow their success payload).
 */
export async function shadowCompareResponse(routeName: string, goPath: string, response: Response): Promise<void> {
  try {
    if (!shadowEnabled()) return;
    if (!response.ok) return;
    const raw = await response.clone().text();
    const payload = (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    })();
    await shadowCompare(routeName, goPath, payload, { legacyBytesSha256: sha256Bytes(raw) });
  } catch { /* shadow mode is observability only — never break the route */ }
}

/**
 * Shadow-observe a route handler's Response WITHOUT calling the Go control
 * plane — the shadow contract for routes whose Go counterpart is a MUTATING
 * canonical command (POST /v1/sen/chat/turns). There is deliberately no live
 * replay here: shadow mode must never re-issue a mutation into Go, because
 * that would create divergent canonical state (turns + command receipts
 * written to sen_session_turns that the legacy path knows nothing about).
 * Exactly one authority owns side effects (red-team contract), and
 * ROLLBACK.md §4 likewise keeps chat turns with "no Next.js caller yet" —
 * the Next.js side does not POST the canonical command while in shadow.
 *
 * Observation records only the legacy response's envelope/shape: the status
 * and, for JSON bodies, top-level key presence + types (values never
 * compared). Entries carry comparison="observation-only" and replayed=false
 * so a log line can never be read as a parity measurement. Non-JSON bodies
 * (the NDJSON chat stream) are never read — draining a clone of the whole
 * turn stream would buy no parity signal.
 *
 * Gated like every shadow path (SEN_GO_SHADOW=1 + configured sen.env), never
 * throws, and the body is read from a clone so the legacy response stays
 * byte-identical.
 */
export async function shadowObserveResponse(routeName: string, response: Response): Promise<void> {
  try {
    if (!shadowEnabled()) return;
    if (!(await goApiAvailable())) return;
    const contentType = response.headers.get("content-type") ?? "";
    const entry: Record<string, unknown> = {
      at: new Date().toISOString(),
      route: routeName,
      comparison: "observation-only",
      replayed: false,
      legacyStatus: response.status,
      goStatus: null,
      contentType,
    };
    if (contentType.includes("application/json")) {
      const payload = await response.clone().json().catch(() => null);
      entry.legacyShape = isPlainObject(payload)
        ? Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeOf(value)]))
        : null;
    }
    await appendEntry(entry);
  } catch { /* shadow mode is observability only — never break the route */ }
}
