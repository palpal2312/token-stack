export type ExecutionOwnerKind = "run" | "builder" | "automation" | "delegation" | "kanban" | "chat" | "process";

export interface ExecutionOwnerOptions {
  id?: string;
  name: string;
  kind: ExecutionOwnerKind | (string & {});
  runId: string;
  parent?: ExecutionOwnerHandle | string | null;
  processRef?: string;
  abortController?: AbortController;
  shutdown?: (reason: string) => void | Promise<void>;
  reconcile?: (persistedActiveRunIds: ReadonlySet<string>) => void | Promise<void>;
  replace?: boolean;
}

export interface ExecutionOwnerSnapshot {
  id: string;
  name: string;
  kind: string;
  runId: string;
  parentId: string | null;
  processRef?: string;
  childIds: string[];
  aborted: boolean;
}

export interface ExecutionOwnerHandle {
  readonly id: string;
  readonly runId: string;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  release(): boolean;
  cancel(reason?: string): boolean;
  snapshot(): ExecutionOwnerSnapshot | null;
}

export interface ExecutionHookError {
  ownerId: string;
  hook: "shutdown" | "reconcile";
  error: string;
}

export interface ExecutionShutdownReport {
  reason: string;
  ownerIds: string[];
  aborted: number;
  drained: number;
  hookErrors: ExecutionHookError[];
}

export interface ExecutionReconcileReport {
  persistedActiveRunIds: string[];
  liveRunIds: string[];
  orphanedPersistedRunIds: string[];
  cancelledOwnerIds: string[];
  hookErrors: ExecutionHookError[];
}

type OwnerRecord = ExecutionOwnerOptions & {
  id: string;
  parentId: string | null;
  abortController: AbortController;
  sequence: number;
};

type LegacyRecord = { abortController: AbortController; processRef: string; ownerId: string };

const PROCESS_HOOK_GUARD = Symbol.for("agentic-os.execution-manager.process-hooks");

type HookedProcess = NodeJS.Process & { [PROCESS_HOOK_GUARD]?: true };

export class ExecutionManager {
  private static liveExecutions = new Map<string, LegacyRecord>();
  private static liveClaims = new Map<string, LegacyRecord>();
  private static owners = new Map<string, OwnerRecord>();
  private static sequence = 0;

  public static register(runId: string, processRef: string): AbortController {
    const current = this.liveExecutions.get(runId);
    if (current) this.cancelOwner(current.ownerId, "Replaced by new execution");
    const handle = this.createOwner({
      id: `legacy:execution:${runId}`,
      name: processRef,
      kind: "process",
      runId,
      processRef,
      replace: true,
    });
    this.liveExecutions.set(runId, { abortController: handle.controller, processRef, ownerId: handle.id });
    return handle.controller;
  }

  /** Claim whole-run ownership without replacing an existing claimant. */
  public static claim(runId: string, processRef: string): AbortController | null {
    if (this.liveClaims.has(runId)) return null;
    const handle = this.createOwner({
      id: `legacy:claim:${runId}`,
      name: processRef,
      kind: "run",
      runId,
      processRef,
    });
    this.liveClaims.set(runId, { abortController: handle.controller, processRef, ownerId: handle.id });
    return handle.controller;
  }

  public static unregister(runId: string, owner?: AbortController): void {
    const current = this.liveExecutions.get(runId);
    if (!current || (owner && current.abortController !== owner)) return;
    this.liveExecutions.delete(runId);
    this.releaseOwner(current.ownerId, current.abortController);
  }

  public static releaseClaim(runId: string, owner?: AbortController): void {
    const current = this.liveClaims.get(runId);
    if (!current || (owner && current.abortController !== owner)) return;
    this.liveClaims.delete(runId);
    this.releaseOwner(current.ownerId, current.abortController);
  }

  public static createOwner(options: ExecutionOwnerOptions): ExecutionOwnerHandle {
    if (!options.runId.trim()) throw new Error("Execution owner runId is required.");
    const parentId = typeof options.parent === "string" ? options.parent : options.parent?.id ?? null;
    const parent = parentId ? this.owners.get(parentId) : undefined;
    if (parentId && !parent) throw new Error(`Execution owner parent "${parentId}" is not live.`);
    if (parent && parent.runId !== options.runId) {
      throw new Error(`Execution owner runId "${options.runId}" does not match parent runId "${parent.runId}".`);
    }
    const id = options.id?.trim() || `owner:${++this.sequence}`;
    const current = this.owners.get(id);
    if (current && !options.replace) throw new Error(`Execution owner "${id}" is already live.`);
    if (current) this.cancelOwner(id, "Replaced by new owner");

    const record: OwnerRecord = {
      ...options,
      id,
      parentId,
      abortController: options.abortController ?? new AbortController(),
      sequence: ++this.sequence,
    };
    this.owners.set(id, record);
    return this.handleFor(record);
  }

  public static child(parent: ExecutionOwnerHandle, options: Omit<ExecutionOwnerOptions, "parent" | "runId"> & { runId?: string }): ExecutionOwnerHandle {
    return this.createOwner({ ...options, parent, runId: options.runId ?? parent.runId });
  }

  public static releaseOwner(ownerOrId: ExecutionOwnerHandle | string, controller?: AbortController): boolean {
    const id = typeof ownerOrId === "string" ? ownerOrId : ownerOrId.id;
    const record = this.owners.get(id);
    if (!record) return false;
    const expected = controller ?? (typeof ownerOrId === "string" ? undefined : ownerOrId.controller);
    if (expected && record.abortController !== expected) return false;
    for (const child of this.childrenOf(id)) this.releaseOwner(child.id, child.abortController);
    this.owners.delete(id);
    this.removeLegacyReference(id, record.abortController);
    return true;
  }

  public static cancelOwner(ownerOrId: ExecutionOwnerHandle | string, reason = "Cancelled via ExecutionManager"): boolean {
    const id = typeof ownerOrId === "string" ? ownerOrId : ownerOrId.id;
    const root = this.owners.get(id);
    if (!root) return false;
    const records = this.subtree(root).reverse();
    for (const record of records) {
      if (!record.abortController.signal.aborted) record.abortController.abort(reason);
      this.owners.delete(record.id);
      this.removeLegacyReference(record.id, record.abortController);
    }
    return true;
  }

  public static cancelRun(runId: string, reason = "Cancelled via ExecutionManager"): boolean {
    const roots = this.sortedOwners().filter((owner) => owner.runId === runId && (!owner.parentId || this.owners.get(owner.parentId)?.runId !== runId));
    if (!roots.length) return false;
    for (const root of roots) this.cancelOwner(root.id, reason);
    return true;
  }

  public static abort(runId: string, reason?: string): boolean {
    return this.cancelRun(runId, reason);
  }

  public static snapshot(): ExecutionOwnerSnapshot[] {
    return this.sortedOwners().map((owner) => this.snapshotOf(owner));
  }

  public static getLiveRunIds(): string[] {
    return [...new Set(this.sortedOwners().map((owner) => owner.runId))].sort();
  }

  public static async shutdownAll(reason = "System shutdown"): Promise<ExecutionShutdownReport> {
    const records = this.sortedOwners();
    const hookErrors: ExecutionHookError[] = [];
    for (const owner of [...records].reverse()) {
      if (!owner.abortController.signal.aborted) owner.abortController.abort(reason);
    }
    for (const owner of [...records].reverse()) {
      if (!owner.shutdown) continue;
      try { await owner.shutdown(reason); }
      catch (error) { hookErrors.push({ ownerId: owner.id, hook: "shutdown", error: this.errorMessage(error) }); }
    }
    const report: ExecutionShutdownReport = {
      reason,
      ownerIds: records.map((owner) => owner.id),
      aborted: records.length,
      drained: records.length,
      hookErrors,
    };
    this.clear();
    return report;
  }

  public static async reconcile(persistedActiveRunIds: Iterable<string>): Promise<ExecutionReconcileReport> {
    const persisted = [...new Set(persistedActiveRunIds)].sort();
    const persistedSet = new Set(persisted);
    const before = this.getLiveRunIds();
    const hookErrors: ExecutionHookError[] = [];
    const cancelledOwnerIds: string[] = [];
    for (const owner of this.sortedOwners()) {
      if (owner.reconcile) {
        try { await owner.reconcile(persistedSet); }
        catch (error) { hookErrors.push({ ownerId: owner.id, hook: "reconcile", error: this.errorMessage(error) }); }
      }
    }
    for (const runId of before.filter((id) => !persistedSet.has(id))) {
      const ids = this.sortedOwners().filter((owner) => owner.runId === runId).map((owner) => owner.id);
      if (this.cancelRun(runId, "Reconciled: run is no longer persisted active")) cancelledOwnerIds.push(...ids);
    }
    return {
      persistedActiveRunIds: persisted,
      liveRunIds: this.getLiveRunIds(),
      orphanedPersistedRunIds: persisted.filter((id) => !before.includes(id)),
      cancelledOwnerIds: [...new Set(cancelledOwnerIds)].sort(),
      hookErrors,
    };
  }

  public static installProcessShutdownHooks(target: NodeJS.Process = process): boolean {
    const guarded = target as HookedProcess;
    if (guarded[PROCESS_HOOK_GUARD]) return false;
    guarded[PROCESS_HOOK_GUARD] = true;
    const shutdown = (signal: NodeJS.Signals) => { void this.shutdownAll(`Process ${signal}`); };
    target.once("SIGINT", shutdown);
    target.once("SIGTERM", shutdown);
    return true;
  }

  public static resetForTests(): void {
    this.clear();
    this.sequence = 0;
  }

  private static handleFor(record: OwnerRecord): ExecutionOwnerHandle {
    const controller = record.abortController;
    return {
      id: record.id,
      runId: record.runId,
      controller,
      signal: controller.signal,
      release: () => this.releaseOwner(record.id, controller),
      cancel: (reason) => this.cancelOwner(record.id, reason),
      snapshot: () => {
        const current = this.owners.get(record.id);
        return current?.abortController === controller ? this.snapshotOf(current) : null;
      },
    };
  }

  private static snapshotOf(owner: OwnerRecord): ExecutionOwnerSnapshot {
    return {
      id: owner.id,
      name: owner.name,
      kind: owner.kind,
      runId: owner.runId,
      parentId: owner.parentId,
      ...(owner.processRef ? { processRef: owner.processRef } : {}),
      childIds: this.childrenOf(owner.id).map((child) => child.id),
      aborted: owner.abortController.signal.aborted,
    };
  }

  private static sortedOwners(): OwnerRecord[] {
    return [...this.owners.values()].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  }

  private static childrenOf(parentId: string): OwnerRecord[] {
    return this.sortedOwners().filter((owner) => owner.parentId === parentId);
  }

  private static subtree(root: OwnerRecord): OwnerRecord[] {
    return [root, ...this.childrenOf(root.id).flatMap((child) => this.subtree(child))];
  }

  private static removeLegacyReference(ownerId: string, controller: AbortController): void {
    for (const [runId, record] of this.liveExecutions) {
      if (record.ownerId === ownerId && record.abortController === controller) this.liveExecutions.delete(runId);
    }
    for (const [runId, record] of this.liveClaims) {
      if (record.ownerId === ownerId && record.abortController === controller) this.liveClaims.delete(runId);
    }
  }

  private static clear(): void {
    this.owners.clear();
    this.liveExecutions.clear();
    this.liveClaims.clear();
  }

  private static errorMessage(error: unknown): string {
    return String(error instanceof Error ? error.message : error);
  }
}

if (typeof process !== "undefined" && typeof process.once === "function") {
  ExecutionManager.installProcessShutdownHooks();
}
