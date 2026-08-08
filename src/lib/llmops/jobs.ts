import { IAppendOnlyRepository, JsonlStorageRepository, StorageError } from "./storage";

export type JobStatus = "queued" | "leased" | "running" | "blocked" | "retry-wait" | "succeeded" | "failed" | "cancelled" | "orphaned";

export interface JobState {
  jobId: string;
  runId: string;
  status: JobStatus;
  leaseOwner?: string;
  leaseExpiry?: number;
  attemptCount: number;
  nextEligibleTime?: number;
  idempotencyKey?: string;
  createdAt: number;
  updatedAt: number;
}

export type JobEvent = 
  | { type: "JOB_ENQUEUED"; jobId: string; runId: string; timestamp: number; idempotencyKey?: string }
  | { type: "JOB_LEASED"; jobId: string; leaseOwner: string; leaseExpiry: number; timestamp: number }
  | { type: "JOB_HEARTBEAT"; jobId: string; leaseExpiry: number; timestamp: number }
  | { type: "JOB_SUCCEEDED"; jobId: string; timestamp: number }
  | { type: "JOB_FAILED"; jobId: string; errorClass: string; errorMessage: string; nextEligibleTime?: number; timestamp: number }
  | { type: "JOB_CANCELLED"; jobId: string; timestamp: number }
  | { type: "JOB_ORPHANED"; jobId: string; timestamp: number };

export class JobQueue {
  private repo: IAppendOnlyRepository<JobEvent, JobState>;

  constructor(repo?: IAppendOnlyRepository<JobEvent, JobState>) {
    this.repo = repo ?? new JsonlStorageRepository<JobEvent, JobState>("jobs");
  }

  public enqueue(jobId: string, runId: string, idempotencyKey?: string): void {
    const existing = this.read(jobId);
    if (existing) {
      if (existing.snapshot.idempotencyKey === idempotencyKey) return; // Idempotent duplicate
      throw new Error("Job already exists with different idempotency key");
    }

    this.repo.append(jobId, {
      type: "JOB_ENQUEUED",
      jobId,
      runId,
      timestamp: Date.now(),
      idempotencyKey
    });
  }

  public claim(jobId: string, leaseOwner: string, leaseDurationMs: number): boolean {
    const existing = this.read(jobId);
    if (!existing) return false;
    
    const now = Date.now();
    const { snapshot, revision } = existing;

    if (snapshot.status !== "queued" && snapshot.status !== "retry-wait" && snapshot.status !== "orphaned") {
      // If leased, check expiry
      if (snapshot.status === "leased" || snapshot.status === "running") {
        if (!snapshot.leaseExpiry || snapshot.leaseExpiry > now) {
          return false; // Still actively leased
        }
      } else {
        return false; // Terminal state or blocked
      }
    }

    if (snapshot.nextEligibleTime && snapshot.nextEligibleTime > now) {
      return false; // Retry backoff
    }

    try {
      this.repo.append(jobId, {
        type: "JOB_LEASED",
        jobId,
        leaseOwner,
        leaseExpiry: now + leaseDurationMs,
        timestamp: now
      }, revision);
      return true;
    } catch (err) {
      if (err instanceof StorageError && err.code === "CONCURRENCY_CONFLICT") {
        return false; // Someone else claimed it
      }
      throw err;
    }
  }

  public heartbeat(jobId: string, leaseOwner: string, leaseDurationMs: number): void {
    const existing = this.read(jobId);
    if (!existing) return;
    const { snapshot, revision } = existing;

    if (snapshot.leaseOwner !== leaseOwner) throw new Error("Not the lease owner");
    if (snapshot.status !== "leased" && snapshot.status !== "running") return;

    try {
      this.repo.append(jobId, {
        type: "JOB_HEARTBEAT",
        jobId,
        leaseExpiry: Date.now() + leaseDurationMs,
        timestamp: Date.now()
      }, revision);
    } catch (err) {
      // A concurrent claim/markOrphaned won the race; the heartbeat loses
      // softly instead of throwing through the caller's tick loop.
      if (err instanceof StorageError && err.code === "CONCURRENCY_CONFLICT") return;
      throw err;
    }
  }

  public complete(jobId: string): void {
    const existing = this.read(jobId);
    if (!existing) return;
    if (existing.snapshot.status === "succeeded") return; // Idempotent

    this.repo.append(jobId, {
      type: "JOB_SUCCEEDED",
      jobId,
      timestamp: Date.now()
    }, existing.revision);
  }

  /**
   * Every job snapshot, for recovery scans. Returns null when the repository
   * cannot enumerate streams — callers must treat that as fail-closed rather
   * than "no jobs exist". Per-stream read failures (e.g. a corrupt job file)
   * are captured in `errors` so one bad stream degrades the scan instead of
   * aborting all recovery.
   */
  public listJobs(): { jobs: { snapshot: JobState; revision: number }[]; errors: string[] } | null {
    if (!this.repo.listStreams) return null;
    const jobs: { snapshot: JobState; revision: number }[] = [];
    const errors: string[] = [];
    for (const jobId of this.repo.listStreams()) {
      try {
        const record = this.read(jobId);
        if (record) jobs.push(record);
      } catch (err) {
        errors.push(`${jobId}: ${String(err instanceof Error ? err.message : err)}`);
      }
    }
    return { jobs, errors };
  }

  /**
   * Mark a leased/running job orphaned. Compare-and-swap on the read revision:
   * a concurrent heartbeat or claim wins and this job is not orphaned. True
   * only for the caller that actually appended JOB_ORPHANED.
   */
  public markOrphaned(jobId: string, timestamp = Date.now()): boolean {
    const existing = this.read(jobId);
    if (!existing) return false;
    const { snapshot, revision } = existing;
    if (snapshot.status !== "leased" && snapshot.status !== "running") return false;
    try {
      this.repo.append(jobId, { type: "JOB_ORPHANED", jobId, timestamp }, revision);
      return true;
    } catch (err) {
      if (err instanceof StorageError && err.code === "CONCURRENCY_CONFLICT") return false;
      throw err;
    }
  }

  public fail(jobId: string, errorClass: string, errorMessage: string, retryDelayMs?: number): void {
    const existing = this.read(jobId);
    if (!existing) return;
    
    const now = Date.now();
    this.repo.append(jobId, {
      type: "JOB_FAILED",
      jobId,
      errorClass,
      errorMessage,
      nextEligibleTime: retryDelayMs ? now + retryDelayMs : undefined,
      timestamp: now
    }, existing.revision);
  }

  public cancel(jobId: string): void {
    const existing = this.read(jobId);
    if (!existing) return;
    if (existing.snapshot.status === "cancelled") return;

    this.repo.append(jobId, {
      type: "JOB_CANCELLED",
      jobId,
      timestamp: Date.now()
    }, existing.revision);
  }

  public read(jobId: string): { snapshot: JobState; revision: number } | null {
    const events = this.repo.readEvents(jobId);
    if (events.length === 0) return null;

    let snapshot: JobState | null = null;
    let revision = 0;

    for (const event of events) {
      snapshot = this.reduce(snapshot, event);
      revision++;
    }

    return snapshot ? { snapshot, revision } : null;
  }

  private reduce(state: JobState | null, event: JobEvent): JobState {
    switch (event.type) {
      case "JOB_ENQUEUED":
        return {
          jobId: event.jobId,
          runId: event.runId,
          status: "queued",
          attemptCount: 0,
          idempotencyKey: event.idempotencyKey,
          createdAt: event.timestamp,
          updatedAt: event.timestamp
        };
      case "JOB_LEASED":
        if (!state) throw new Error("Invalid state");
        return {
          ...state,
          status: "leased",
          leaseOwner: event.leaseOwner,
          leaseExpiry: event.leaseExpiry,
          attemptCount: state.attemptCount + 1,
          updatedAt: event.timestamp
        };
      case "JOB_HEARTBEAT":
        if (!state) throw new Error("Invalid state");
        return {
          ...state,
          leaseExpiry: event.leaseExpiry,
          updatedAt: event.timestamp
        };
      case "JOB_SUCCEEDED":
        if (!state) throw new Error("Invalid state");
        return {
          ...state,
          status: "succeeded",
          updatedAt: event.timestamp
        };
      case "JOB_FAILED":
        if (!state) throw new Error("Invalid state");
        return {
          ...state,
          status: event.nextEligibleTime ? "retry-wait" : "failed",
          nextEligibleTime: event.nextEligibleTime,
          updatedAt: event.timestamp
        };
      case "JOB_CANCELLED":
        if (!state) throw new Error("Invalid state");
        return {
          ...state,
          status: "cancelled",
          updatedAt: event.timestamp
        };
      case "JOB_ORPHANED":
        if (!state) throw new Error("Invalid state");
        return {
          ...state,
          status: "orphaned",
          updatedAt: event.timestamp
        };
      default:
        return state!;
    }
  }
}
