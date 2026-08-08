// Run state: everything needed to resume a run, kept as plain JSON so a run
// survives a restart and can be inspected with any editor.
//
// Two stores, one interface. Memory for QA and for callers who do not care
// past the process; File at ~/.agentic-os/runtime/runs/<id>.json with the
// same two rules as the registries — writes are tmp-file-plus-rename atomic,
// and a file that cannot be read is reported, never repaired.
//
// Concurrency is optimistic, keyed on `revision`: the runner bumps it before
// every save, and a store refuses a save whose revision is not exactly one
// past what it holds. Two runners resuming the same blocked run cannot both
// win — the loser's StateConflictError is the notification, which is exactly
// what a single-writer-per-run design wants.
//
// `messages` is in the state even though the original sketch listed only
// steps: resume() has to continue the conversation, and rebuilding the wire
// history from the step trace would be a second source of truth that could
// disagree with the first.

import { readFile, writeFile, rename, mkdir, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChatMessage } from "../routers/adapters/base";
import type { BrainToolCall } from "./brain";
import { RunLedger } from "../llmops/ledger";
import { JsonlStorageRepository } from "../llmops/storage";
import { runDir, defaultRunsDir } from "../run-storage";

export type RunStatus = "running" | "done" | "blocked" | "max-turns" | "failed";

export interface PendingApproval {
  toolCallId: string;
  tool: string;
  args: unknown;
}

/**
 * One trace entry. Flat with optional fields rather than a discriminated
 * union because the state file round-trips through JSON and stays greppable.
 */
export interface RunStep {
  kind: "input" | "brain" | "tool" | "finish";
  at: string;
  /** Which model round-trip produced this step. */
  turn?: number;
  /** input: the user's text. brain: what the model said. finish: the run's final text. */
  text?: string;
  /** brain: the calls the model asked for. */
  toolCalls?: BrainToolCall[];
  /** tool: which call this result answers. */
  toolCallId?: string;
  /** tool: the tool's name; finish: the terminal status. */
  name?: string;
  /** tool: the arguments it ran with. */
  args?: unknown;
  /** tool: what it returned (already JSON-safe). */
  result?: unknown;
  /** tool: a thrown error or policy refusal, delivered as the tool result. */
  error?: string;
  /** tool: the policy decision that shaped this step ("allow" | "deny"). */
  decision?: string;
}

/** The Router or Builder brain a run started with, so a resume can rebuild it. */
export interface BrainPick {
  kind?: "router" | "builder" | "brain";
  routerId?: string;
  builderId?: string;
  builderSessionId?: string;
  sessionUnavailableReason?: string;
  capability?: any;
  model?: string;
  effort?: string;
}

/** One deliverable a run produced, registered when a producing tool returns it. */
export interface RunArtifact {
  /** Relative to the run directory, so a moved run folder stays valid. */
  path: string;
  /** Which maker wrote it ("document" | "spreadsheet" | "webpage"). */
  kind: string;
  createdAt: string;
}

export interface RunState {
  id: string;
  threadId: string;
  agentName: string;
  status: RunStatus;
  steps: RunStep[];
  /** Files the run produced. The UI links here, so it lives on the state, not in a step. */
  artifacts: RunArtifact[];
  /** The conversation so far, in chat wire shape — resume() continues from this. */
  messages: ChatMessage[];
  pendingApproval?: PendingApproval;
  /**
   * The brain pick this run started with, recorded so a resume can rebuild
   * the same brain — the user's model/effort choice survives the approval
   * boundary. Absent on runs from before this field; those require the caller
   * to explicitly provide a routerId or builderId when resuming.
   */
  brain?: BrainPick;
  createdAt: string;
  updatedAt: string;
  /** Counts saves. First save is 1; every later save must be exactly one more. */
  revision: number;
}

/**
 * One conversation in the runs store, for a sessions list. Derived from the
 * state files themselves — the store gains no new schema and stays
 * single-writer; listing is a read-side rollup.
 */
export interface ThreadSummary {
  threadId: string;
  /** From the thread's newest run. */
  agentName: string;
  /** First user message of the thread's earliest run, cut to 80 — the list's label. */
  firstUserText: string;
  /** The newest save across the thread's runs. */
  updatedAt: string;
  runCount: number;
}

export class StateConflictError extends Error {
  constructor(id: string, expected: number, found: number) {
    super(
      `Run "${id}" moved on without this writer (state is at revision ${found}, this save expected ${expected}). `
      + `Reload the run before resuming it — two writers cannot continue the same run.`,
    );
    this.name = "StateConflictError";
  }
}

export interface StateStore {
  save(state: RunState): Promise<void>;
  load(runId: string): Promise<RunState | null>;
  /**
   * Directory for a run's side files (transcript.md, artifacts/). Optional:
   * memory-backed stores have no disk, and the runner simply skips the
   * transcript and refuses deliverables there.
   */
  runDir?(runId: string): string;
}

/** Reject ids that would escape the runs directory or collide with path syntax. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function checkRevision(existing: RunState | null, state: RunState): void {
  const found = existing?.revision ?? 0;
  if (state.revision !== found + 1) throw new StateConflictError(state.id, found + 1, found);
}

export class MemoryStateStore implements StateStore {
  private runs = new Map<string, RunState>();

  async save(state: RunState): Promise<void> {
    checkRevision(this.runs.get(state.id) ?? null, state);
    // Snapshots in, snapshots out — handing back the live object would let a
    // caller mutate history the store believes it still owns.
    this.runs.set(state.id, structuredClone(state));
  }

  async load(runId: string): Promise<RunState | null> {
    const s = this.runs.get(runId);
    return s ? structuredClone(s) : null;
  }
}

export class LedgerStateStore implements StateStore {
  private ledger: RunLedger;
  private fileStore: FileStateStore;

  constructor(dir?: string) {
    this.ledger = new RunLedger();
    this.fileStore = new FileStateStore(dir);
  }

  runDir(runId: string): string {
    return this.fileStore.runDir(runId);
  }

  async save(state: RunState): Promise<void> {
    const existing = await this.load(state.id);
    checkRevision(existing, state);
    
    // Project to the legacy file store
    await this.fileStore.save(state);
    
    // Note: The authoritative write should happen via the ledger append
    // This is a minimal bridge implementation for Phase 3 projection
    await this.ledger.append({
      id: `state-${state.id}-${state.revision}`,
      type: "run_queued",
      run: {
        schemaVersion: 1,
        runId: state.id,
        sourceRef: { kind: "agent", id: state.threadId },
        producerRef: { kind: "sen", id: state.agentName },
        status: state.status === "running" ? "running" : 
                state.status === "failed" ? "failed" :
                state.status === "blocked" ? "blocked" :
                "succeeded",
        createdAt: state.createdAt,
        traceId: state.id,
        lastState: state
      } as any,
      at: new Date().toISOString(),
      redactionClass: "local-sensitive"
    }, { expectedSeq: existing ? undefined : 0 }).catch(e => {
      // Ignore conflict for the bridge for now
      if (e.name !== "LedgerConflictError") throw e;
    });
  }

  async load(runId: string): Promise<RunState | null> {
    return this.fileStore.load(runId);
  }
}

export class FileStateStore implements StateStore {
  constructor(public readonly dir: string = defaultRunsDir) {}

  private fileFor(runId: string): string {
    if (!RUN_ID.test(runId)) {
      throw new Error(`"${runId}" is not a run id. Run ids are letters, digits, dashes and underscores.`);
    }
    return path.join(this.dir, `${runId}.json`);
  }

  /**
   * Side files live in a folder named after the run, next to its state file.
   * The state file itself keeps its Phase-4 flat location so existing runs
   * stay resumable; only new surfaces (transcript, artifacts) use the folder.
   */
  runDir(runId: string): string {
    return runDir(this.dir, runId);
  }

  async save(state: RunState): Promise<void> {
    checkRevision(await this.load(state.id), state);
    await mkdir(this.dir, { recursive: true });
    const file = this.fileFor(state.id);
    // A unique temp name, then rename — the pattern the registries use, for
    // the same reason: a crash mid-write must leave either the old state or
    // the new one, never half of one.
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
    try {
      await rename(tmp, file);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }

  async load(runId: string): Promise<RunState | null> {
    const file = this.fileFor(runId);
    if (!existsSync(file)) return null;
    let text: string;
    try { text = await readFile(file, "utf8"); }
    catch (e) { throw corrupt(file, e); }
    let state: RunState;
    try { state = JSON.parse(text) as RunState; }
    catch (e) { throw corrupt(file, e); }
    // State files from before the artifact registry have no such field;
    // default it rather than reject a run that is otherwise perfectly valid.
    state.artifacts ??= [];
    return state;
  }

  /**
   * Every state file in the directory, best-effort. A file that will not
   * read is skipped here rather than reported: load() is the boundary that
   * refuses a corrupt run, and a listing must still answer when one file in
   * the folder is not a readable run (a leftover .tmp, a foreign JSON).
   */
  private async allStates(): Promise<RunState[]> {
    let names: string[];
    try { names = await readdir(this.dir); }
    catch { return []; }
    const states: RunState[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (!RUN_ID.test(id)) continue;
      try {
        const s = await this.load(id);
        if (s?.threadId) states.push(s);
      } catch { /* not a readable run state — not a listing's problem */ }
    }
    return states;
  }

  /** Every thread in the store, newest activity first. */
  async listThreads(): Promise<ThreadSummary[]> {
    const byThread = new Map<string, RunState[]>();
    for (const s of await this.allStates()) {
      const list = byThread.get(s.threadId) ?? [];
      list.push(s);
      byThread.set(s.threadId, list);
    }
    const threads: ThreadSummary[] = [];
    for (const [threadId, runs] of byThread) {
      runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const firstUser = runs[0].messages.find((m) => m.role === "user")?.content ?? "";
      threads.push({
        threadId,
        agentName: runs[runs.length - 1].agentName,
        firstUserText: firstUser.length > 80 ? `${firstUser.slice(0, 79)}…` : firstUser,
        updatedAt: runs.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), ""),
        runCount: runs.length,
      });
    }
    threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return threads;
  }

  /**
   * The newest run of a thread — the transcript a session view shows, and
   * the state a continuation seeds its messages from.
   */
  async latestInThread(threadId: string): Promise<RunState | null> {
    let latest: RunState | null = null;
    for (const s of await this.allStates()) {
      if (s.threadId !== threadId) continue;
      if (!latest || s.updatedAt > latest.updatedAt) latest = s;
    }
    return latest;
  }
}

function corrupt(file: string, cause: unknown): Error {
  return new Error(
    `${file} could not be read as a run state (${String(cause)}). It has been left untouched — `
    + `fix or move the file; Agent OS will not overwrite a trace it cannot understand.`,
  );
}
