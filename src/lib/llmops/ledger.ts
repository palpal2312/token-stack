import os from "node:os";
import path from "node:path";
import {
  RUN_ENVELOPE_SCHEMA_VERSION,
  type RedactionClass,
  type RunEnvelope,
  type RunEvent,
  type RunEventType,
  validateRunEnvelope,
  validateRunEvent,
} from "./contracts";
import {
  appendJsonLineDurable,
  readJsonIfPresent,
  recoverJsonLines,
  withSerializedWriter,
  writeJsonAtomic,
  type QuarantinedTail,
  type StorageFaults,
} from "./storage";
import { getTraceExporter } from "./exporters";
import type { Span } from "./tracing";
import { assertDifyEnabled } from "../dify/enablement";
import { readFile } from "node:fs/promises";
import { writeTextAtomic } from "./storage";

const LEDGER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2_000;

export interface RunLedgerSnapshot {
  version: 1;
  ledgerId: string;
  lastAppliedSeq: number;
  runs: Record<string, RunEnvelope>;
  eventIds: string[];
}

export interface AppendRunEventInput {
  id: string;
  type: RunEventType;
  run: RunEnvelope;
  at: string;
  redactionClass: RedactionClass;
  payload?: Record<string, unknown>;
  parentSpanId?: string;
  traceId?: string;
}

export interface AppendOptions {
  expectedSeq?: number;
}

export interface LedgerRecoveryReport {
  lastAppliedSeq: number;
  replayedEvents: number;
  quarantine?: QuarantinedTail;
}

export interface RunLedgerOptions {
  root?: string;
  ledgerId?: string;
  faults?: StorageFaults;
  /** Test hook: simulate backup media mutation after copy and before verify. */
  afterBackupWrite?(destinationRoot: string): void | Promise<void>;
}

type StoredRunProjection = Omit<RunEnvelope, "sourceRef"> & {
  originRef: RunEnvelope["sourceRef"];
};

export class LedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerConflictError";
  }
}

export class LedgerCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerCorruptError";
  }
}

function emptySnapshot(ledgerId: string): RunLedgerSnapshot {
  return { version: 1, ledgerId, lastAppliedSeq: 0, runs: {}, eventIds: [] };
}

function cloneSnapshot(snapshot: RunLedgerSnapshot): RunLedgerSnapshot {
  return structuredClone(snapshot);
}

function expectedStatus(type: RunEventType): RunEnvelope["status"] | null {
  switch (type) {
    case "run_queued": return "queued";
    case "run_started": return "running";
    case "run_blocked": return "blocked";
    case "run_succeeded": return "succeeded";
    case "run_failed": return "failed";
    case "run_cancelled": return "cancelled";
    case "run_orphaned": return "orphaned";
    default: return null;
  }
}

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<
  RunEnvelope["status"],
  ReadonlySet<RunEnvelope["status"]>
> = {
  queued: new Set(["running", "failed", "cancelled", "orphaned"]),
  running: new Set(["blocked", "succeeded", "failed", "cancelled", "orphaned"]),
  blocked: new Set(["running", "failed", "cancelled", "orphaned"]),
  orphaned: new Set(["running", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertStableIdentity(current: RunEnvelope, next: RunEnvelope, event: RunEvent): void {
  for (const field of [
    "runId",
    "threadId",
    "sourceRef",
    "producerRef",
    "executionAttemptId",
    "kanbanAttemptId",
    "parentRunId",
    "builderId",
    "assetVersion",
    "createdAt",
    "traceId",
  ] as const) {
    if (!sameValue(current[field], next[field])) {
      throw new LedgerConflictError(`event ${event.id} cannot change immutable run field ${field}`);
    }
  }
  if (current.builderSessionId !== undefined
    && current.builderSessionId !== next.builderSessionId) {
    throw new LedgerConflictError(`event ${event.id} cannot change builderSessionId once assigned`);
  }
}

function storeProjection(run: RunEnvelope): StoredRunProjection {
  const { sourceRef, ...rest } = structuredClone(run);
  return { ...rest, originRef: sourceRef };
}

function runFromEvent(event: RunEvent): RunEnvelope {
  const candidate = event.payload.projection;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new LedgerCorruptError(`event ${event.id} has no run projection`);
  }
  const { originRef, ...rest } = candidate as Partial<StoredRunProjection>;
  const runCandidate = { ...rest, sourceRef: originRef };
  const validation = validateRunEnvelope(runCandidate);
  if (!validation.ok) {
    throw new LedgerCorruptError(`event ${event.id} has invalid run projection: ${validation.errors.join("; ")}`);
  }
  const run = structuredClone(runCandidate as RunEnvelope);
  if (run.runId !== event.runId) {
    throw new LedgerCorruptError(`event ${event.id} run projection does not match runId`);
  }
  const status = expectedStatus(event.type);
  if (status && run.status !== status) {
    throw new LedgerCorruptError(`event ${event.id} requires run status ${status}`);
  }
  return run;
}

function applyEvent(snapshot: RunLedgerSnapshot, event: RunEvent): void {
  if (event.seq <= snapshot.lastAppliedSeq) return;
  if (event.seq !== snapshot.lastAppliedSeq + 1) {
    throw new LedgerCorruptError(
      `ledger sequence gap: expected ${snapshot.lastAppliedSeq + 1}, received ${event.seq}`,
    );
  }
  if (event.ledgerId !== snapshot.ledgerId) {
    throw new LedgerCorruptError(`event ${event.id} belongs to a different ledger`);
  }
  if (snapshot.eventIds.includes(event.id)) {
    throw new LedgerCorruptError(`duplicate event id ${event.id}`);
  }

  const next = runFromEvent(event);
  const current = snapshot.runs[event.runId];
  if (event.type === "run_queued") {
    if (current) throw new LedgerCorruptError(`run ${event.runId} is already registered`);
    snapshot.runs[event.runId] = next;
  } else {
    if (!current) throw new LedgerCorruptError(`run ${event.runId} has no queued event`);
    assertStableIdentity(current, next, event);
    const lifecycleStatus = expectedStatus(event.type);
    if (lifecycleStatus) {
      if (!ALLOWED_LIFECYCLE_TRANSITIONS[current.status].has(lifecycleStatus)) {
        throw new LedgerConflictError(
          `invalid run transition ${current.status} -> ${lifecycleStatus} for ${event.type}`,
        );
      }
    } else if (next.status !== current.status) {
      throw new LedgerConflictError(
        `event ${event.type} cannot change run status ${current.status} -> ${next.status}`,
      );
    }
    if (event.type === "artifact_recorded") {
      snapshot.runs[event.runId] = { ...current, artifacts: next.artifacts };
    } else if (event.type === "usage_recorded") {
      snapshot.runs[event.runId] = { ...current, usage: next.usage, quota: next.quota };
    } else if (event.type === "external_intent_recorded"
      || event.type === "external_intent_reconciled") {
      // Intent state is authoritative in the event payload. It must not replace
      // a possibly newer run projection when callers append without a CAS.
      snapshot.runs[event.runId] = current;
    } else {
      snapshot.runs[event.runId] = next;
    }
  }
  snapshot.lastAppliedSeq = event.seq;
  snapshot.eventIds = [...snapshot.eventIds, event.id].slice(-10_000);
}

function validateSnapshot(value: unknown, ledgerId: string): RunLedgerSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LedgerCorruptError("run ledger snapshot is corrupt or unsupported");
  }
  const candidate = value as Partial<RunLedgerSnapshot>;
  if (candidate.version !== 1
    || candidate.ledgerId !== ledgerId
    || !Number.isSafeInteger(candidate.lastAppliedSeq)
    || Number(candidate.lastAppliedSeq) < 0
    || !candidate.runs
    || typeof candidate.runs !== "object"
    || Array.isArray(candidate.runs)
    || !Array.isArray(candidate.eventIds)
    || candidate.eventIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new LedgerCorruptError("run ledger snapshot is corrupt or unsupported");
  }
  const runs = candidate.runs as Record<string, unknown>;
  for (const [runId, run] of Object.entries(runs)) {
    const result = validateRunEnvelope(run);
    if (!result.ok || (run as RunEnvelope).runId !== runId) {
      throw new LedgerCorruptError("run ledger snapshot is corrupt or unsupported");
    }
  }
  return structuredClone(candidate as RunLedgerSnapshot);
}

export class RunLedger {
  readonly root: string;
  readonly ledgerId: string;
  readonly paths: { events: string; snapshot: string };
  private readonly faults?: StorageFaults;
  private readonly afterBackupWrite?: RunLedgerOptions["afterBackupWrite"];

  constructor(options: RunLedgerOptions = {}) {
    this.root = path.resolve(options.root
      ?? path.join(process.env.AGENTIC_OS_HOME ?? path.join(os.homedir(), ".agentic-os"), "llmops"));
    this.ledgerId = options.ledgerId ?? "sen-local";
    if (!LEDGER_ID_RE.test(this.ledgerId)) throw new Error("ledgerId is invalid");
    this.paths = {
      events: path.join(this.root, "events.jsonl"),
      snapshot: path.join(this.root, "runs.json"),
    };
    this.faults = options.faults;
    this.afterBackupWrite = options.afterBackupWrite;
  }

  async append(
    input: AppendRunEventInput,
    options: AppendOptions = {},
  ): Promise<{ event: RunEvent; snapshot: RunLedgerSnapshot }> {
    return withSerializedWriter(this.paths.events, async () => {
      if (input.run.producerRef.kind === "dify") await assertDifyEnabled();
      const loaded = await this.load();
      const snapshot = loaded.snapshot;
      if (options.expectedSeq !== undefined && options.expectedSeq !== snapshot.lastAppliedSeq) {
        throw new LedgerConflictError(
          `run ledger revision changed: expected ${options.expectedSeq}, current ${snapshot.lastAppliedSeq}`,
        );
      }
      if (snapshot.eventIds.includes(input.id)
        || loaded.events.some((event) => event.id === input.id)) {
        throw new LedgerConflictError(`event id ${input.id} already exists`);
      }

      const event: RunEvent = {
        schemaVersion: RUN_ENVELOPE_SCHEMA_VERSION,
        ledgerId: this.ledgerId,
        seq: snapshot.lastAppliedSeq + 1,
        id: input.id,
        runId: input.run.runId,
        producerRef: input.run.producerRef,
        at: input.at,
        type: input.type,
        redactionClass: input.redactionClass,
        payload: {
          ...(structuredClone(input.payload ?? {})),
          projection: storeProjection(input.run),
        },
        ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
        ...(input.traceId ?? input.run.traceId
          ? { traceId: input.traceId ?? input.run.traceId }
          : {}),
      };
      if (event.redactionClass === "public") {
        throw new Error("run projection events must be at least local-sensitive");
      }
      const validation = validateRunEvent(event);
      if (!validation.ok) throw new Error(`invalid run event: ${validation.errors.join("; ")}`);
      runFromEvent(event);
      const nextSnapshot = cloneSnapshot(snapshot);
      applyEvent(nextSnapshot, event);

      // The journal is authoritative: flush it before changing/checkpointing
      // the read model. A failed snapshot is recovered by replay on restart.
      await appendJsonLineDurable(this.paths.events, event, this.faults);
      await writeJsonAtomic(this.paths.snapshot, nextSnapshot, this.faults);

      // Async fail-open telemetry export
      const span: Span = {
        context: {
          traceId: event.traceId ?? event.runId,
          spanId: event.id,
          parentSpanId: event.parentSpanId
        },
        name: event.type,
        startTime: event.at,
        endTime: new Date().toISOString(), // Instantaneous ledger event
        status: "ok",
        attributes: {
          runId: event.runId,
          producer: event.producerRef.id,
          seq: event.seq
        },
        events: []
      };
      // Fire and forget
      void getTraceExporter().exportSpans([span]);

      return { event: structuredClone(event), snapshot: cloneSnapshot(nextSnapshot) };
    });
  }

  /** Produces a replayable point-in-time copy while no append can interleave. */
  async createVerifiedBackup(destinationRoot: string): Promise<RunLedgerSnapshot> {
    return withSerializedWriter(this.paths.events, async () => {
      const loaded = await this.load();
      const events = await readFile(this.paths.events, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      const snapshot = cloneSnapshot(loaded.snapshot);
      await writeTextAtomic(path.join(destinationRoot, "events.jsonl"), events);
      await writeJsonAtomic(path.join(destinationRoot, "runs.json"), snapshot);
      // Test hook: simulate backup media tampering/bit-rot between the copy and
      // the verification replay, so the mismatch guard below is exercised.
      await this.afterBackupWrite?.(destinationRoot);
      const reopened = new RunLedger({ root: destinationRoot, ledgerId: this.ledgerId });
      const replayed = await reopened.snapshot();
      if (replayed.lastAppliedSeq !== snapshot.lastAppliedSeq) {
        throw new LedgerCorruptError("backup replay does not match the authoritative ledger revision");
      }
      return snapshot;
    });
  }

  async snapshot(): Promise<RunLedgerSnapshot> {
    return withSerializedWriter(this.paths.events, async () => cloneSnapshot((await this.load()).snapshot));
  }

  async getRun(runId: string): Promise<RunEnvelope | null> {
    const snapshot = await this.snapshot();
    return snapshot.runs[runId] ? structuredClone(snapshot.runs[runId]) : null;
  }

  async listRuns(): Promise<RunEnvelope[]> {
    const snapshot = await this.snapshot();
    return Object.values(snapshot.runs)
      .map((run) => structuredClone(run))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async readEvents(options: {
    afterSeq?: number;
    limit?: number;
    runId?: string;
  } = {}): Promise<RunEvent[]> {
    return withSerializedWriter(this.paths.events, async () => {
      const loaded = await this.load();
      const afterSeq = Math.max(0, Math.floor(options.afterSeq ?? 0));
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)));
      return loaded.events
        .filter((event) => event.seq > afterSeq && (!options.runId || event.runId === options.runId))
        .slice(0, limit)
        .map((event) => structuredClone(event));
    });
  }

  async recover(): Promise<LedgerRecoveryReport> {
    return withSerializedWriter(this.paths.events, async () => {
      const loaded = await this.load(true);
      if (loaded.replayedEvents > 0 || loaded.quarantine) {
        await writeJsonAtomic(this.paths.snapshot, loaded.snapshot, this.faults);
      }
      return {
        lastAppliedSeq: loaded.snapshot.lastAppliedSeq,
        replayedEvents: loaded.replayedEvents,
        ...(loaded.quarantine ? { quarantine: loaded.quarantine } : {}),
      };
    });
  }

  private async load(quarantineCorruptTail = false): Promise<{
    snapshot: RunLedgerSnapshot;
    events: RunEvent[];
    replayedEvents: number;
    quarantine?: QuarantinedTail;
  }> {
    let previousSeq = 0;
    const recovered = await recoverJsonLines<RunEvent>(this.paths.events, (value) => {
      const validation = validateRunEvent(value);
      if (!validation.ok) return validation.errors.join("; ");
      const event = value as RunEvent;
      if (event.ledgerId !== this.ledgerId) return "ledgerId does not match";
      if (event.seq !== previousSeq + 1) return `expected sequence ${previousSeq + 1}`;
      try {
        runFromEvent(event);
      } catch (error) {
        return String((error as Error)?.message ?? error);
      }
      previousSeq = event.seq;
      return null;
    }, { quarantine: quarantineCorruptTail });
    if (recovered.corruption) {
      throw new LedgerCorruptError(
        `run ledger journal is corrupt at line ${recovered.corruption.firstInvalidLine}: `
        + `${recovered.corruption.reason}. Run explicit recovery to quarantine the tail.`,
      );
    }

    const rawSnapshot = await readJsonIfPresent<unknown>(this.paths.snapshot);
    const snapshot = rawSnapshot === null
      ? emptySnapshot(this.ledgerId)
      : validateSnapshot(rawSnapshot, this.ledgerId);
    if (snapshot.lastAppliedSeq > recovered.records.length) {
      throw new LedgerCorruptError("run ledger snapshot is ahead of its authoritative journal");
    }

    let replayedEvents = 0;
    for (const event of recovered.records) {
      if (event.seq <= snapshot.lastAppliedSeq) continue;
      applyEvent(snapshot, event);
      replayedEvents += 1;
    }
    return {
      snapshot,
      events: recovered.records,
      replayedEvents,
      ...(recovered.quarantine ? { quarantine: recovered.quarantine } : {}),
    };
  }
}
