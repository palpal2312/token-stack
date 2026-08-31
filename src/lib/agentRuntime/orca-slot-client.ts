// Read-only Orca slot status client (PD lane, SO0F).
//
// Types and fixture factory for the J0F `/api/v1/runtime/slots` read DTO,
// developed against fixtures only — the daemon route is Agent 1's serialized
// join and does not exist yet. This module is deliberately fetch-free: J1 will
// plug `parseRuntimeSlots` into the existing Code Space query round-trip (one
// cache/listener owner, no separate polling loop).
//
// Safe-field contract: capacity/WIP, Builder display label, Attempt
// reference, last-observed time, and a safe status/reason string. Anything
// else the wire carries (secrets, raw commands, tokens, auth/config paths) is
// dropped at the parse boundary, never forwarded to the view.

export const ORCA_SLOT_DTO_VERSION = 1;

/** Daemon-side slot states (mirrors go/internal/orcaslots). */
export type OrcaSlotState =
  | "free"
  | "reserved"
  | "launching"
  | "running"
  | "reconciling"
  | "draining";

/** Strict wire shape for one slot as produced by J0F. */
export interface OrcaSlotDTO {
  slot_id: string;
  state: OrcaSlotState;
  /** 1 while WIP=1 policy holds. */
  capacity: number;
  in_flight: number;
  builder_label: string | null;
  attempt_ref: string | null;
  last_observed_at: string;
  /** Safe, already-redacted reason text from the daemon. */
  reason: string | null;
}

export interface OrcaRuntimeSlotsDTO {
  dto_version: number;
  /** False when the orca-lab selector is off — the UI shows "disabled". */
  lab_enabled: boolean;
  slots: OrcaSlotDTO[];
}

const SLOT_STATES = new Set<OrcaSlotState>([
  "free", "reserved", "launching", "running", "reconciling", "draining",
]);

const MAX_REASON_LEN = 200;
const MAX_LABEL_LEN = 200;

function isSafeText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
}

function isSlotDTO(v: unknown): v is OrcaSlotDTO {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<OrcaSlotDTO>;
  return isSafeText(s.slot_id, 128)
    && typeof s.state === "string" && SLOT_STATES.has(s.state as OrcaSlotState)
    && typeof s.capacity === "number" && Number.isSafeInteger(s.capacity) && s.capacity >= 0
    && typeof s.in_flight === "number" && Number.isSafeInteger(s.in_flight) && s.in_flight >= 0
    && (s.builder_label === null || isSafeText(s.builder_label, MAX_LABEL_LEN))
    && (s.attempt_ref === null || isSafeText(s.attempt_ref, 128))
    && typeof s.last_observed_at === "string" && !Number.isNaN(Date.parse(s.last_observed_at))
    && (s.reason === null || isSafeText(s.reason, MAX_REASON_LEN));
}

/**
 * Fail-closed parse of the runtime-slots payload. Unknown extra wire fields
 * are ignored (forward-compatible reads); required fields must be present and
 * safe. Returns null on any violation — the view maps that to "error".
 */
export function parseRuntimeSlots(payload: unknown): OrcaRuntimeSlotsDTO | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<OrcaRuntimeSlotsDTO>;
  if (p.dto_version !== ORCA_SLOT_DTO_VERSION) return null;
  if (typeof p.lab_enabled !== "boolean") return null;
  if (!Array.isArray(p.slots)) return null;
  const slots: OrcaSlotDTO[] = [];
  for (const raw of p.slots) {
    if (!isSlotDTO(raw)) return null;
    // Rebuild from allowlisted fields only — never forward the raw object.
    slots.push({
      slot_id: raw.slot_id,
      state: raw.state,
      capacity: raw.capacity,
      in_flight: raw.in_flight,
      builder_label: raw.builder_label ?? null,
      attempt_ref: raw.attempt_ref ?? null,
      last_observed_at: raw.last_observed_at,
      reason: raw.reason ?? null,
    });
  }
  return { dto_version: ORCA_SLOT_DTO_VERSION, lab_enabled: p.lab_enabled, slots };
}

/** UI-facing status vocabulary. */
export type SlotViewStatus = "disabled" | "loading" | "available" | "drifted" | "error";

/**
 * Reconcile/reattach projection phase (Sprint 04 ADP-05 UI). Safe, typed
 * surface over daemon observe fields — never carries secrets or commands.
 */
export type ReconcileViewPhase =
  | "steady"
  | "reconnecting"
  | "reattaching"
  | "quarantined"
  | "observe_only";

/** Strict wire shape for an observe-only reconcile projection (optional on slots). */
export interface OrcaReconcileProjectionDTO {
  phase: ReconcileViewPhase;
  last_seq: number | null;
  last_reconcile_at: string | null;
  reattach_count: number;
  observe_only: boolean;
  /** Safe, already-redacted diagnostic text from the daemon/UI layer. */
  diagnostic: string | null;
}

export interface SlotView {
  status: SlotViewStatus;
  capacity: number | null;
  inFlight: number | null;
  builderLabel: string | null;
  attemptRef: string | null;
  lastObservedAt: string | null;
  statusText: string;
  reason: string | null;
  /** Typed reconnect/reattach projection; null when the wire omitted it. */
  reconcile: OrcaReconcileProjectionDTO | null;
  /** Short restart/reconnect hint for the status shell (never a control). */
  reconnectHint: string | null;
  /** Durable terminal/dispatch output cursor; null when omitted. */
  cursor: OrcaCursorProjectionDTO | null;
  /** Typed capability negotiation/revoke/duplicate error; null when healthy. */
  capabilityError: OrcaCapabilityErrorDTO | null;
}

export const LOADING_VIEW: SlotView = {
  status: "loading", capacity: null, inFlight: null, builderLabel: null,
  attemptRef: null, lastObservedAt: null, statusText: "Loading…", reason: null,
  reconcile: null, reconnectHint: null, cursor: null, capabilityError: null,
};

const RECONCILE_PHASES = new Set<ReconcileViewPhase>([
  "steady", "reconnecting", "reattaching", "quarantined", "observe_only",
]);

function isReconcileProjection(v: unknown): v is OrcaReconcileProjectionDTO {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<OrcaReconcileProjectionDTO>;
  return typeof r.phase === "string" && RECONCILE_PHASES.has(r.phase as ReconcileViewPhase)
    && (r.last_seq === null || (typeof r.last_seq === "number" && Number.isSafeInteger(r.last_seq) && r.last_seq >= 0))
    && (r.last_reconcile_at === null || (typeof r.last_reconcile_at === "string" && !Number.isNaN(Date.parse(r.last_reconcile_at))))
    && typeof r.reattach_count === "number" && Number.isSafeInteger(r.reattach_count) && r.reattach_count >= 0
    && typeof r.observe_only === "boolean"
    && (r.diagnostic === null || isSafeText(r.diagnostic, MAX_REASON_LEN));
}

/**
 * Fail-closed parse of an optional reconcile projection. Unknown extra fields
 * are dropped; malformed projections return null (slot still usable).
 */
export function parseReconcileProjection(payload: unknown): OrcaReconcileProjectionDTO | null {
  if (!isReconcileProjection(payload)) return null;
  return {
    phase: payload.phase,
    last_seq: payload.last_seq ?? null,
    last_reconcile_at: payload.last_reconcile_at ?? null,
    reattach_count: payload.reattach_count,
    observe_only: payload.observe_only,
    diagnostic: payload.diagnostic ?? null,
  };
}

/** Human-readable restart/reconnect hint derived from reconcile phase + slot state. */
export function reconnectHintFor(
  phase: ReconcileViewPhase | null,
  slotState: OrcaSlotState | null,
): string | null {
  if (phase === "reconnecting") return "Transport reconnect — awaiting canonical slot replace.";
  if (phase === "reattaching") return "Reattaching Run to the observed slot.";
  if (phase === "quarantined") return "Slot quarantined after stale/mismatch; observe only.";
  if (phase === "observe_only") return "Observe-only diagnostics; no slot mutation from this shell.";
  if (slotState === "reconciling") return "Daemon reconciling — UI shows drifted until steady.";
  return null;
}

/**
 * Map one parsed slot to the view model. Slot absent + lab off = disabled;
 * reconciling = drifted; anything else canonical = available.
 * Optional cursor / capabilityError projections layer observe-only diagnostics.
 */
export function toSlotView(
  dto: OrcaRuntimeSlotsDTO | null,
  slotId: string,
  reconcile: OrcaReconcileProjectionDTO | null = null,
  extras: {
    cursor?: OrcaCursorProjectionDTO | null;
    capabilityError?: OrcaCapabilityErrorDTO | null;
  } = {},
): SlotView {
  const cursor = extras.cursor ?? null;
  const capabilityError = extras.capabilityError ?? null;
  if (!dto) {
    return {
      ...LOADING_VIEW,
      status: "error",
      statusText: "Slot status unavailable",
      reason: "Unreadable runtime payload.",
      reconcile,
      reconnectHint: reconnectHintFor(reconcile?.phase ?? null, null),
      cursor,
      capabilityError,
    };
  }
  if (!dto.lab_enabled) {
    return {
      ...LOADING_VIEW,
      status: "disabled",
      statusText: "Orca Lab disabled",
      reason: null,
      reconcile,
      reconnectHint: reconnectHintFor(reconcile?.phase ?? null, null),
      cursor,
      capabilityError,
    };
  }
  const slot = dto.slots.find((s) => s.slot_id === slotId);
  if (!slot) {
    return {
      ...LOADING_VIEW,
      status: "error",
      statusText: "Slot not reported",
      reason: `No slot named ${slotId}.`,
      reconcile,
      reconnectHint: reconnectHintFor(reconcile?.phase ?? null, null),
      cursor,
      capabilityError,
    };
  }
  const base: SlotView = {
    status: "available",
    capacity: slot.capacity,
    inFlight: slot.in_flight,
    builderLabel: slot.builder_label,
    attemptRef: slot.attempt_ref,
    lastObservedAt: slot.last_observed_at,
    statusText: slot.state,
    reason: slot.reason,
    reconcile,
    reconnectHint: reconnectHintFor(reconcile?.phase ?? null, slot.state),
    cursor,
    capabilityError,
  };
  if (capabilityError) {
    return {
      ...base,
      status: "error",
      statusText: capabilityError.code === "duplicate_dispatch" ? "Duplicate dispatch" : "Capability error",
      reason: capabilityError.message,
      reconnectHint: capabilityError.code === "capability_revoked"
        ? "Capability revoked — observe only; no slot mutation."
        : base.reconnectHint,
    };
  }
  if (slot.state === "reconciling" || reconcile?.phase === "reconnecting" || reconcile?.phase === "reattaching") {
    const text = reconcile?.phase === "reattaching"
      ? "Reattaching"
      : reconcile?.phase === "reconnecting"
        ? "Reconnecting"
        : "Reconciling";
    return {
      ...base,
      status: "drifted",
      statusText: text,
      reason: reconcile?.diagnostic
        ?? slot.reason
        ?? "Observed state disagrees with canonical records.",
    };
  }
  if (reconcile?.phase === "quarantined") {
    return {
      ...base,
      status: "error",
      statusText: "Quarantined",
      reason: reconcile.diagnostic ?? slot.reason ?? "Stale/mismatch quarantine.",
    };
  }
  return base;
}

/** Deterministic fixtures for component/spec development before J0F lands. */
export function fixtureRuntimeSlots(overrides: Partial<OrcaSlotDTO> = {}, labEnabled = true): OrcaRuntimeSlotsDTO {
  const slot: OrcaSlotDTO = {
    slot_id: "orca-lab-0",
    state: "free",
    capacity: 1,
    in_flight: 0,
    builder_label: null,
    attempt_ref: null,
    last_observed_at: "2026-08-18T00:00:00.000Z",
    reason: null,
    ...overrides,
  };
  return { dto_version: ORCA_SLOT_DTO_VERSION, lab_enabled: labEnabled, slots: [slot] };
}

/** Deterministic observe-only reconcile projection fixture. */
export function fixtureReconcileProjection(
  overrides: Partial<OrcaReconcileProjectionDTO> = {},
): OrcaReconcileProjectionDTO {
  return {
    phase: "steady",
    last_seq: 0,
    last_reconcile_at: "2026-08-25T00:00:00.000Z",
    reattach_count: 0,
    observe_only: true,
    diagnostic: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cursor + capability-error projections (mirror go/internal/orca + adapter)
// ---------------------------------------------------------------------------

/**
 * Safe capability-error codes for UI. Never carries raw dcap bearers or
 * capability hashes — only classified failure kinds + dispatch IDs.
 */
export type OrcaCapabilityErrorCode =
  | "contract_version_mismatch"
  | "missing_required_features"
  | "capability_revoked"
  | "duplicate_dispatch"
  | "cursor_regression"
  | "negotiation_rejected"
  | "unknown";

/** Observe-only capability error DTO (fail-closed parse). */
export interface OrcaCapabilityErrorDTO {
  code: OrcaCapabilityErrorCode;
  /** Safe, already-redacted reason text. */
  message: string;
  active_dispatch_id: string | null;
  attempt_dispatch_id: string | null;
}

/**
 * Terminal/dispatch output cursor projection. Aligns with
 * `orca.Store` output_cursor persistence (monotonic, regression refused).
 */
export interface OrcaCursorProjectionDTO {
  terminal_handle: string;
  dispatch_id: string;
  output_cursor: number;
  updated_at: string | null;
}

const CAPABILITY_ERROR_CODES = new Set<OrcaCapabilityErrorCode>([
  "contract_version_mismatch",
  "missing_required_features",
  "capability_revoked",
  "duplicate_dispatch",
  "cursor_regression",
  "negotiation_rejected",
  "unknown",
]);

/**
 * Classify a safe negotiation/reconcile reason string into a typed error code.
 * Matches go/internal/adapter + reconcile diagnostic phrasing without importing Go.
 */
export function classifyCapabilityReason(reason: string): OrcaCapabilityErrorCode {
  const r = reason.toLowerCase();
  if (r.includes("contract version")) return "contract_version_mismatch";
  if (r.includes("missing required features")) return "missing_required_features";
  if (r.includes("capability revoked") || r.includes("revoked")) return "capability_revoked";
  if (r.includes("duplicate")) return "duplicate_dispatch";
  if (r.includes("cursor regression")) return "cursor_regression";
  if (r.includes("negotiation")) return "negotiation_rejected";
  return "unknown";
}

function isDispatchId(v: unknown): v is string {
  return isSafeText(v, 128) && /^(ctx_|task_|term_|run_|pin_)/.test(v);
}

function isCapabilityErrorDTO(v: unknown): v is OrcaCapabilityErrorDTO {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<OrcaCapabilityErrorDTO>;
  return typeof e.code === "string" && CAPABILITY_ERROR_CODES.has(e.code as OrcaCapabilityErrorCode)
    && isSafeText(e.message, MAX_REASON_LEN)
    && (e.active_dispatch_id === null || isDispatchId(e.active_dispatch_id))
    && (e.attempt_dispatch_id === null || isDispatchId(e.attempt_dispatch_id));
}

/** Fail-closed parse of a capability error. Drops hash/token-shaped extras. */
export function parseCapabilityError(payload: unknown): OrcaCapabilityErrorDTO | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  // Accept either explicit code or classify from a safe reason/message field.
  let code: OrcaCapabilityErrorCode = "unknown";
  if (typeof raw.code === "string" && CAPABILITY_ERROR_CODES.has(raw.code as OrcaCapabilityErrorCode)) {
    code = raw.code as OrcaCapabilityErrorCode;
  } else if (typeof raw.reason === "string" && isSafeText(raw.reason, MAX_REASON_LEN)) {
    code = classifyCapabilityReason(raw.reason);
  } else if (typeof raw.message === "string" && isSafeText(raw.message, MAX_REASON_LEN)) {
    code = classifyCapabilityReason(raw.message);
  } else {
    return null;
  }
  const message = typeof raw.message === "string" && isSafeText(raw.message, MAX_REASON_LEN)
    ? raw.message
    : typeof raw.reason === "string" && isSafeText(raw.reason, MAX_REASON_LEN)
      ? raw.reason
      : null;
  if (!message) return null;
  const candidate: OrcaCapabilityErrorDTO = {
    code,
    message,
    active_dispatch_id: raw.active_dispatch_id === null || isDispatchId(raw.active_dispatch_id)
      ? (raw.active_dispatch_id as string | null) ?? null
      : null,
    attempt_dispatch_id: raw.attempt_dispatch_id === null || isDispatchId(raw.attempt_dispatch_id)
      ? (raw.attempt_dispatch_id as string | null) ?? null
      : null,
  };
  if (!isCapabilityErrorDTO(candidate)) return null;
  // Rebuild allowlisted fields only — never forward capability_hash / token.
  return {
    code: candidate.code,
    message: candidate.message,
    active_dispatch_id: candidate.active_dispatch_id,
    attempt_dispatch_id: candidate.attempt_dispatch_id,
  };
}

function isCursorProjection(v: unknown): v is OrcaCursorProjectionDTO {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<OrcaCursorProjectionDTO>;
  return isDispatchId(c.terminal_handle)
    && isDispatchId(c.dispatch_id)
    && typeof c.output_cursor === "number"
    && Number.isSafeInteger(c.output_cursor)
    && c.output_cursor >= 0
    && (c.updated_at === null
      || (typeof c.updated_at === "string" && !Number.isNaN(Date.parse(c.updated_at))));
}

/** Fail-closed parse of a terminal/dispatch cursor projection. */
export function parseCursorProjection(payload: unknown): OrcaCursorProjectionDTO | null {
  if (!isCursorProjection(payload)) return null;
  return {
    terminal_handle: payload.terminal_handle,
    dispatch_id: payload.dispatch_id,
    output_cursor: payload.output_cursor,
    updated_at: payload.updated_at ?? null,
  };
}

/**
 * Monotonic cursor advance predicate (mirrors Store.AdvanceCursor regression
 * refusal). Returns the next cursor when legal; null when regression/invalid.
 */
export function advanceCursor(current: number, next: number): number | null {
  if (!Number.isSafeInteger(current) || current < 0) return null;
  if (!Number.isSafeInteger(next) || next < 0) return null;
  if (next < current) return null;
  return next;
}

/** Deterministic cursor fixture. */
export function fixtureCursorProjection(
  overrides: Partial<OrcaCursorProjectionDTO> = {},
): OrcaCursorProjectionDTO {
  return {
    terminal_handle: "term_orca_lab_0",
    dispatch_id: "ctx_fixture_0001",
    output_cursor: 0,
    updated_at: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

/** Deterministic capability-error fixture. */
export function fixtureCapabilityError(
  overrides: Partial<OrcaCapabilityErrorDTO> = {},
): OrcaCapabilityErrorDTO {
  return {
    code: "capability_revoked",
    message: "capability revoked",
    active_dispatch_id: null,
    attempt_dispatch_id: "ctx_fixture_0001",
    ...overrides,
  };
}
