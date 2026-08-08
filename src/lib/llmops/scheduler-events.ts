// Phase 10-11 scheduler & allocator decision events.
//
// These types extend the domain event spine with the two new event kinds
// emitted by the Go CommittingDispatcher and LiveScoringAllocator. The
// TypeScript side consumes them through the existing RunEvent pipeline (the
// Go control plane emits them into the shared event journal or posts them
// via the proxy).
//
// Each event carries a machine-readable reason code so dashboards, activity
// feeds, and audit logs can display actionable information about *why* a
// dispatch or allocation was accepted or rejected.

import type { RunEventType } from "./contracts";

// ---------------------------------------------------------------------------
// Scheduler dispatch decision events (Phase 10)
// ---------------------------------------------------------------------------

export type SchedulerReasonCode =
  | "wip_ok"
  | "already_dispatched"
  | "wip_global_exceeded"
  | "wip_per_goal_exceeded"
  | "wip_per_account_exceeded";

export interface SchedulerDispatchDecidedPayload {
  attemptId: string;
  goalId: string;
  accountId: string;
  dryRun: boolean;
  accepted: boolean;
  reason: SchedulerReasonCode;
  fencingToken?: string;
}

// ---------------------------------------------------------------------------
// Allocator decision events (Phase 11)
// ---------------------------------------------------------------------------

export type AllocatorReasonCode =
  | "assigned"
  | "no_capacity"
  | "no_match"
  | "score_too_low"
  | "already_assigned"
  | "advisory_only";

export interface AllocatorDecisionMadePayload {
  attemptId: string;
  goalId: string;
  accountId: string;
  builderId?: string;
  live: boolean;
  assigned: boolean;
  score: number;
  reason: AllocatorReasonCode;
}

// ---------------------------------------------------------------------------
// Type guard helpers — used by event consumers to narrow payload shapes.
// ---------------------------------------------------------------------------

export function isSchedulerDispatchEvent(type: RunEventType): boolean {
  return type === "scheduler_dispatch_decided";
}

export function isAllocatorDecisionEvent(type: RunEventType): boolean {
  return type === "allocator_decision_made";
}

export function isSchedulerOrAllocatorEvent(type: RunEventType): boolean {
  return isSchedulerDispatchEvent(type) || isAllocatorDecisionEvent(type);
}

// ---------------------------------------------------------------------------
// Event envelope helpers — build a well-formed payload for RunLedger.append
// ---------------------------------------------------------------------------

export function schedulerDispatchPayload(
  data: SchedulerDispatchDecidedPayload,
): Record<string, unknown> {
  return { ...data };
}

export function allocatorDecisionPayload(
  data: AllocatorDecisionMadePayload,
): Record<string, unknown> {
  return { ...data };
}
