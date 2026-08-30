import { createHash } from "node:crypto";

import { redactEventPayload, type RedactionClass } from "./redaction";

/**
 * Append-only S10 evidence registry.  The store is deliberately injected so
 * a controller can choose a durable adapter without giving this module any
 * dispatch, network, worker, or release authority.
 */
export const S10_RECORD_KINDS = [
  "signal",
  "candidate",
  "evidence",
  "evaluation-run",
  "canary",
  "promotion",
  "rollback",
  "supersession",
  "approval",
] as const;

export type S10RecordKind = (typeof S10_RECORD_KINDS)[number];

export interface S10RegistryRecord {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly kind: S10RecordKind;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly redactionClass: RedactionClass;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadSha256: string;
  readonly previousRecordSha256: string | null;
  readonly recordSha256: string;
}

export interface S10RecordInput {
  recordId: string;
  kind: S10RecordKind;
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface S10RegistryPersistence {
  read(): readonly S10RegistryRecord[];
  append(record: S10RegistryRecord): void;
}

export class S10RegistryConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "S10RegistryConflict";
  }
}

/** A deterministic adapter useful for local controlled execution and tests. */
export class S10MemoryPersistence implements S10RegistryPersistence {
  private readonly records: S10RegistryRecord[] = [];

  read(): readonly S10RegistryRecord[] {
    return this.records.map(cloneRecord);
  }

  append(record: S10RegistryRecord): void {
    this.records.push(cloneRecord(record));
  }
}

export class S10Registry {
  private readonly persistence: S10RegistryPersistence;

  constructor(persistence: S10RegistryPersistence = new S10MemoryPersistence()) {
    this.persistence = persistence;
    verifyChain(persistence.read());
  }

  /**
   * Append one redacted record.  Retrying an identical idempotency key is a
   * stable read; reusing it with different bytes is rejected.
   */
  append(input: S10RecordInput): S10RegistryRecord {
    validateInput(input);
    const existing = this.findByIdempotencyKey(input.idempotencyKey);
    const redacted = redactEventPayload(input.payload);
    const payloadSha256 = sha256(canonical(redacted.payload));
    if (existing) {
      if (existing.kind !== input.kind || existing.payloadSha256 !== payloadSha256) {
        throw new S10RegistryConflict("idempotency key already identifies different S10 bytes.");
      }
      return cloneRecord(existing);
    }

    if (input.kind === "promotion") this.requireApprovedCandidate(input.payload);
    const records = this.persistence.read();
    const previousRecordSha256 = records.length ? records[records.length - 1].recordSha256 : null;
    const recordWithoutHash = {
      schemaVersion: 1 as const,
      recordId: input.recordId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
      redactionClass: redacted.redactionClass,
      payload: redacted.payload,
      payloadSha256,
      previousRecordSha256,
    };
    const record: S10RegistryRecord = {
      ...recordWithoutHash,
      recordSha256: sha256(canonical(recordWithoutHash)),
    };
    this.persistence.append(record);
    return cloneRecord(record);
  }

  list(): readonly S10RegistryRecord[] {
    const records = this.persistence.read();
    verifyChain(records);
    return records.map(cloneRecord);
  }

  findByIdempotencyKey(key: string): S10RegistryRecord | undefined {
    return this.persistence.read().find((record) => record.idempotencyKey === key);
  }

  /** Returns a hash-pinned, read-only view suitable for a receipt. */
  snapshot(): { records: readonly S10RegistryRecord[]; headSha256: string | null } {
    const records = this.list();
    return { records, headSha256: records.length ? records[records.length - 1].recordSha256 : null };
  }

  private requireApprovedCandidate(payload: Record<string, unknown>): void {
    const candidateId = payload.candidateId;
    if (typeof candidateId !== "string" || !candidateId) throw new S10RegistryConflict("promotion requires candidateId.");
    const approved = this.persistence.read().some((record) =>
      record.kind === "approval" && record.payload.candidateId === candidateId && record.payload.decision === "approve",
    );
    if (!approved) throw new S10RegistryConflict("promotion requires an independent explicit approval record.");
  }
}

function validateInput(input: S10RecordInput): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.recordId)) throw new Error("recordId must be a bounded lowercase identifier.");
  if (!/^[a-z0-9][a-z0-9:_-]{0,127}$/.test(input.idempotencyKey)) throw new Error("idempotencyKey must be a bounded identifier.");
  if (!S10_RECORD_KINDS.includes(input.kind)) throw new Error("unknown S10 record kind.");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.occurredAt)) throw new Error("occurredAt must be UTC RFC3339.");
}

function verifyChain(records: readonly S10RegistryRecord[]): void {
  let previous: string | null = null;
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.idempotencyKey)) throw new S10RegistryConflict("persistence contains duplicate idempotency keys.");
    keys.add(record.idempotencyKey);
    const { recordSha256: _recordSha256, ...unsigned } = record;
    if (record.previousRecordSha256 !== previous || record.recordSha256 !== sha256(canonical(unsigned))) {
      throw new S10RegistryConflict("persistence chain hash verification failed.");
    }
    previous = record.recordSha256;
  }
}

function cloneRecord(record: S10RegistryRecord): S10RegistryRecord {
  return JSON.parse(JSON.stringify(record)) as S10RegistryRecord;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
