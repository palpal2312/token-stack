// The approval inbox: consequential tool calls park here until a human decides.
//
// A run that hits a gated tool stops at "blocked" (see agentRuntime/runner.ts);
// this store is what it parks *into*, so the ask survives a dashboard restart
// and can be answered from the /automations Inbox instead of being lost with
// the process.
//
// Three rules, same shape as the registries and for the same reasons:
//
//   1. Resolve-once. Two decides racing the same item cannot both win — every
//      decide is a serialized read-modify-write, and only the caller that
//      flipped "pending" gets `won: true`. Idempotent by design: re-deciding
//      an already-decided item returns the item as it stands, not an error.
//   2. Decide-before-execute is atomic. The status flips to approved/rejected
//      in the same write that wins the race, BEFORE any tool runs — a crash
//      between decide and execute leaves a decided item and a still-blocked
//      run, never a tool that ran off an unrecorded yes.
//   3. Asks expire. 48h (a conscious deviation from openworker, whose items
//      never expire — our inbox is dashboard-only, so a forgotten ask should
//      not hold a run hostage forever). Expiry is swept lazily on read:
//      there is no background reaper to also fail.
//
// Writes are tmp-file-plus-rename atomic; a corrupted file is reported and
// left untouched, never repaired — a hand-edit typo must not silently drop a
// pending "may I delete this?".

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { AGENTIC_HOME, RegistryCorrupt } from "./builders/registry";
import { REDACTED_LOCAL_VALUE, redactEventPayload, type RedactionResult } from "./llmops/redaction";

export const APPROVAL_TTL_MS = 48 * 60 * 60 * 1000;

export type ApprovalSource = "automation" | "firstmate";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalDecision = "approve" | "reject";

export interface ApprovalItem {
  id: string;
  /** The runtime run that parked this call — how approve finds what to resume. */
  runId: string;
  source: ApprovalSource;
  toolCallId: string;
  tool: string;
  args: unknown;
  /** One human sentence: who wants to run what, and with which arguments. */
  summary: string;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
}

export interface ApprovalInboxRow {
  id: string;
  runId: string;
  source: ApprovalSource;
  toolCallId: string;
  tool: string;
  /** Safe for list views: never copied from the stored raw-argument summary. */
  summary: string;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
  actionHash: string;
  evidenceHash: string;
  redactionClass: RedactionResult["redactionClass"];
  redactedPaths: string[];
  truncated: boolean;
}

export interface ApprovalInboxDetail extends ApprovalInboxRow {
  redactedArgs: Record<string, unknown>;
}

interface ApprovalsFile { version: 1; approvals: ApprovalItem[] }

// The home is resolved per call, not cached at import: the QA suite points
// AGENTIC_OS_HOME at a temp dir after this module (and the registry whose
// constant it mirrors) has already been imported by an earlier spec.
function home(): string { return process.env.AGENTIC_OS_HOME ?? AGENTIC_HOME; }
function file(): string { return path.join(home(), "approvals.json"); }

// ---------------------------------------------------------------- persistence

let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

function normalize(a: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: String(a.id ?? ""),
    runId: String(a.runId ?? ""),
    source: (a.source === "firstmate" ? "firstmate" : "automation") as ApprovalSource,
    toolCallId: String(a.toolCallId ?? ""),
    tool: String(a.tool ?? ""),
    args: a.args ?? null,
    summary: String(a.summary ?? ""),
    createdAt: String(a.createdAt ?? new Date().toISOString()),
    expiresAt: String(a.expiresAt ?? ""),
    status: (a.status ?? "pending") as ApprovalStatus,
    decidedAt: a.decidedAt ? String(a.decidedAt) : undefined,
  };
}

async function readFileRaw(): Promise<ApprovalsFile | null> {
  const f = file();
  if (!existsSync(f)) return null;
  let text: string;
  try { text = await readFile(f, "utf8"); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!text.trim()) return { version: 1, approvals: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new RegistryCorrupt(f, e); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as ApprovalsFile).approvals)) {
    throw new RegistryCorrupt(f, "no approvals array");
  }
  return { version: 1, approvals: (parsed as ApprovalsFile).approvals.map(normalize) };
}

async function writeAtomic(data: ApprovalsFile): Promise<void> {
  const f = file();
  await mkdir(home(), { recursive: true });
  const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  try {
    await rename(tmp, f);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/** Lazily expire: pending items past their deadline become "expired" now. */
function sweep(f: ApprovalsFile, now: Date): boolean {
  let changed = false;
  for (const a of f.approvals) {
    if (a.status === "pending" && a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) {
      a.status = "expired";
      a.decidedAt = now.toISOString();
      changed = true;
    }
  }
  return changed;
}

// ------------------------------------------------------------------ public API

export interface ParkInput {
  runId: string;
  source: ApprovalSource;
  toolCallId: string;
  tool: string;
  args: unknown;
  summary: string;
}

/** Record a parked call. Returns the item as stored. */
export async function parkApproval(input: ParkInput, opts: { ttlMs?: number } = {}): Promise<ApprovalItem> {
  const now = new Date();
  const item = normalize({
    ...input,
    id: randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (opts.ttlMs ?? APPROVAL_TTL_MS)).toISOString(),
    status: "pending",
  });
  return serialized(async () => {
    const f = (await readFileRaw()) ?? { version: 1 as const, approvals: [] };
    f.approvals.push(item);
    await writeAtomic(f);
    return item;
  });
}

/** All items, pending first, with the 48h sweep applied (and persisted) on the way. */
export async function listApprovals(): Promise<ApprovalItem[]> {
  return serialized(async () => {
    const f = await readFileRaw();
    if (!f) return [];
    if (sweep(f, new Date())) await writeAtomic(f);
    const rank = (s: ApprovalStatus) => (s === "pending" ? 0 : 1);
    return [...f.approvals].sort((a, b) =>
      rank(a.status) - rank(b.status) || b.createdAt.localeCompare(a.createdAt));
  });
}

export async function getApproval(id: string): Promise<ApprovalItem | null> {
  return (await listApprovals()).find((a) => a.id === id) ?? null;
}

export async function listRedactedApprovals(): Promise<ApprovalInboxRow[]> {
  return (await listApprovals()).map(redactedApprovalRow);
}

export async function getRedactedApprovalDetail(id: string): Promise<ApprovalInboxDetail | null> {
  const item = await getApproval(id);
  return item ? redactedApprovalDetail(item) : null;
}

/** Redact a single item for any exposed surface (decision responses, streams). */
export function toApprovalInboxRow(item: ApprovalItem): ApprovalInboxRow {
  return redactedApprovalRow(item);
}

/** A safe, hash-bound summary for exposed surfaces that only need one line. */
export function redactedApprovalSummary(item: ApprovalItem): string {
  return redactedSummary(item);
}

export async function pendingCount(): Promise<number> {
  return (await listApprovals()).filter((a) => a.status === "pending").length;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(String(value));
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
}

function hashApprovalPart(kind: "action" | "evidence", value: unknown): string {
  return createHash("sha256").update(`${kind}:`).update(stableJson(value)).digest("hex");
}

function redactArgs(args: unknown): RedactionResult {
  // A plain object is classified key-by-key. Anything else (a bare string,
  // array, number) is wrapped under a local-sensitive key so its raw content is
  // never emitted — a bare argument blob is opaque and could hold a path,
  // transcript, or secret we cannot key-classify.
  const payload = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : { content: args };
  return redactEventPayload(payload, { maxStringLength: 512, maxEntries: 32, maxTotalEntries: 96, maxDepth: 4 });
}

function redactedSummary(item: ApprovalItem): string {
  return `Approval requested for ${item.tool}; action ${hashApprovalPart("action", { tool: item.tool, args: item.args }).slice(0, 12)}; evidence ${hashApprovalPart("evidence", item).slice(0, 12)}.`;
}

function redactedApprovalRow(item: ApprovalItem): ApprovalInboxRow {
  const redaction = redactArgs(item.args);
  return {
    id: item.id,
    runId: item.runId,
    source: item.source,
    toolCallId: item.toolCallId,
    tool: item.tool,
    summary: redactedSummary(item),
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    status: item.status,
    decidedAt: item.decidedAt,
    actionHash: hashApprovalPart("action", { tool: item.tool, args: item.args }),
    evidenceHash: hashApprovalPart("evidence", item),
    redactionClass: redaction.redactionClass,
    redactedPaths: redaction.redactedPaths,
    truncated: redaction.truncated,
  };
}

function redactedApprovalDetail(item: ApprovalItem): ApprovalInboxDetail {
  const row = redactedApprovalRow(item);
  const redaction = redactArgs(item.args);
  return {
    ...row,
    redactedArgs: Object.keys(redaction.payload).length > 0 ? redaction.payload : { value: REDACTED_LOCAL_VALUE },
  };
}

export interface DecideResult {
  item: ApprovalItem;
  /** True only for the caller that flipped "pending" — the one allowed to execute. */
  won: boolean;
}

/**
 * Resolve an ask exactly once. The first decide to land wins; every later one
 * — including a race that arrived while the winner was still writing, and a
 * decide against an item the sweep just expired — gets the item as it stands
 * with `won: false`, so a second executor can never fire.
 */
export async function decideApproval(id: string, decision: ApprovalDecision): Promise<DecideResult> {
  return serialized(async () => {
    const f = await readFileRaw();
    const item = f?.approvals.find((a) => a.id === id);
    if (!f || !item) throw new Error(`No approval "${id}".`);
    const now = new Date();
    if (item.status === "pending" && new Date(item.expiresAt).getTime() <= now.getTime()) {
      item.status = "expired";
      item.decidedAt = now.toISOString();
      await writeAtomic(f);
      return { item, won: false };
    }
    if (item.status !== "pending") return { item, won: false };
    item.status = decision === "approve" ? "approved" : "rejected";
    item.decidedAt = now.toISOString();
    await writeAtomic(f);
    return { item, won: true };
  });
}

/** One sentence for the inbox row: which run wants which tool with what args. */
export function summarizeCall(agentName: string, tool: string, args: unknown): string {
  let preview: string;
  try { preview = JSON.stringify(args ?? {}); }
  catch { preview = "(unprintable arguments)"; }
  if (preview.length > 160) preview = `${preview.slice(0, 157)}…`;
  return `"${agentName}" wants to run ${tool} with ${preview}`;
}
