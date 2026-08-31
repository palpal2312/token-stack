# Continuous Orchestration Runbook

This document defines the operating contract for the NEWS OS Lead Orchestrator. It is consumed by the controller and lane agents. Product execution remains owned by Orca; the controller coordinates Orca terminals, Runs, evidence, and handoffs.

## Operating contract

The objective is useful continuous throughput, not artificial activity. A lane may remain idle only when its approved backlog is exhausted or a hard external blocker prevents safe work.

The controller must preserve three layers for every lane:

- `ACTIVE`: the current bounded Run/job.
- `NEXT`: the next approved job with complete context and acceptance criteria.
- `FALLBACK`: an independent, useful job for a soft or cross-agent blocker.

The controller is not a coding worker. It reviews evidence, updates the queue, handles blockers, and delegates execution to Orca.

The Master lane is accountable for throughput across every other lane. Its job is to keep useful work flowing, detect false-idle states, prepare the next assignment before completion, and move spare lanes into review/support work when their own queue is exhausted. A terminal being open is not evidence that a lane is productive.

## Lane model

Use these logical lanes when building a sprint queue:

- **Critical Path**: work that determines the sprint outcome.
- **Parallel Production**: independent implementation, research, data, or documentation work.
- **Verification**: review, tests, audits, integration checks, and regression detection.
- **Future Preparation**: acceptance criteria, decomposition, migration planning, and dependency discovery.
- **Fallback Queue**: bounded work with independent value, such as tests, observability, security edge cases, documentation, benchmarks, or handoff preparation.

The physical lane count is the number of approved Orca workers running in parallel. Logical work lanes may be mapped onto those physical lanes by the controller.

### OLC capacity and allocation

Use [`docs/optimal-lane-count.md`](./optimal-lane-count.md) as the canonical
capacity contract. The Master computes a Global OLC baseline, recalculates an
Effective Global OLC from current machine pressure and effective worker/fallback
capacity, then allocates that pool across Sprints without exceeding any Sprint
OLC. An active heavy build/test/local-model lane consumes more weighted capacity
than lightweight review work; terminal count alone is never capacity evidence.

Before admitting another worker, sample current CPU, memory, disk and relevant
accelerator/network pressure, include the workload weights of active lanes, and
reserve host headroom for SEN, Orca, SQLite and the desktop. A provider route
counts only when auth/quota/capability and a writable worker are currently
verified. If its primary is exhausted and no verified fallback remains, remove
that slot from Effective Global OLC and downshift or reallocate safely.

The Master may reduce concurrency automatically when safety or effective
capacity falls. It may increase only inside the user-approved lane and budget
ceiling, with independent ready work, disjoint ownership and a verified worker.
All execution changes still go through Orca.

## Queue requirements

Every queue item must have an ID, goal, assigned worker, priority, logical lane, dependencies, input context, expected output, acceptance criteria, effort estimate, startability, and fallback suitability. Keep at least one prepared next item and one fallback item per active worker whenever the sprint backlog permits it.

Do not place an item in `NEXT` until its context, ownership, acceptance criteria, and test/evidence plan are complete. When the ready queue drops below lane capacity plus fallback coverage, prepare more work before the next polling cycle.

Tasks that can finish in only a few seconds are a scheduling smell when the lane still owns a meaningful objective. Prefer a bounded chain of related work with reviewable outputs, and prefetch the next task before dispatching the current one. If a short task is genuinely complete, immediately dispatch its prepared successor or re-plan a useful support/verification task; do not leave the lane at a prompt while valuable work remains.

## Assignment contract

Every assignment must state:

1. the exact goal and scope;
2. why it is prioritized;
3. allowed files or modules;
4. required inputs and dependencies;
5. deliverables and acceptance criteria;
6. evidence or tests to produce;
7. reporting points at start, 50%, 80%, blocker, review-ready, and completion;
8. the `NEXT` item;
9. the `FALLBACK` item and its activation condition.

Jobs should end with a machine-detectable completion receipt:

```text
JOB_DONE: <task-id>
```

The receipt is evidence that the controller may clear `ACTIVE`; it is not a substitute for the required report and acceptance checks.

## Rolling planning rules

- At 50%: validate direction, dependency health, and blocker status.
- At 70–80%: prepare and attach `NEXT` without interrupting `ACTIVE`.
- At 80–90%: start verification and prepare the handoff.
- At 100%: record evidence, clear `ACTIVE`, and let the worker start `NEXT` immediately.

Planning is event-driven. Every status update must trigger a scan of all lanes, not just the reporting lane. Do not wait for a phase or milestone to finish before preparing the next useful work.

## Status protocol

Agents report using:

```text
STATUS UPDATE
Agent:
Task ID:
State: RUNNING | AT_RISK | BLOCKED | READY_FOR_REVIEW | COMPLETED
Progress: ...%
Completed:
Currently doing:
Remaining:
Files/outputs changed:
Tests/checks:
Blockers:
Decisions needed:
Estimated remaining effort:
NEXT readiness: READY | NEEDS_CONTEXT | BLOCKED
Suggested follow-up work:
```

For OLC learning, append privacy-safe session metrics: workload class/weight,
active-idle-blocked durations, bounded resource samples, quota-health class,
fallback readiness, conflicts/retries/rework, token or agent-time bucket and
final review outcome. The controller corroborates these fields against Orca,
hashes and tests; it never treats self-reported progress as authoritative.

The controller must respond with a decision, queue update, blocker action, or next assignment. “Continue” without an operational action is not a sufficient orchestration response.

## Blocker handling

Classify blockers as `HARD`, `SOFT`, `LOCAL`, or `CROSS_AGENT`.

- Keep a hard-blocked item in `BLOCKED`; do not mark it failed or complete.
- Assign an owner and a concrete recheck trigger for the blocker.
- Move the affected worker to `FALLBACK` when independent work exists.
- Split blocked and unblocked portions whenever possible.
- Never let a provider/authentication failure cause an unbounded restart loop. Record the incident, use the configured fallback worker where approved, or stop that lane with an explicit reason.

### Provider fallback

Provider fallback is part of the lane state machine, not a comment in the backlog. When the active provider reports an expired credential, authentication failure, quota exhaustion, subscription-window exhaustion, or an equivalent non-task error:

For the Sprint 05-07 run, the Claude route is `claude-kimicode`; `claude-fugu`
is retired and must not be selected. The fallback order is revalidated by the
live worker preflight before dispatch.

1. preserve the current Task ID and worktree;
2. record the provider error and stop retrying that provider;
3. select the run-specific configured fallback in policy order; never reuse an
   older Sprint's route map without current preflight;
4. create or reattach the fallback terminal in the same Orca worktree;
5. wait for workspace trust/readiness before sending the preserved task;
6. send the task once with the same acceptance criteria and completion receipt;
7. record the fallback provider and continue monitoring it.

Fallback must not silently change task scope, ownership, branch, or evidence location. If no fallback is configured or the fallback also fails, classify the lane as `PROVIDER_BLOCKED` and assign independent work only when it is safe. The Lane 1 quota incident demonstrated that a fixed primary terminal alone is insufficient.

## Orca and terminal safety

Orca is the execution authority. The controller must reconcile and reattach Orca Runs rather than inventing a second worker/process lifecycle.

For the local watchdog:

- bind each physical lane to its verified Orca terminal handle;
- never select an arbitrary “last” terminal when multiple terminals share a worktree;
- exclude stale/orphaned terminals and terminals showing authentication errors;
- use a mutex so overlapping 15-minute checks cannot dispatch twice;
- use an absolute Orca executable path for Scheduled Task execution;
- dispatch only when the lane has no active job and the selected terminal is writable/idle;
- clear the active job only after its completion receipt and evidence are visible;
- preserve the job in state when probing fails; do not advance the queue;
- do not spend an LLM call for routine polling.

### Terminal replacement and context saturation

- Treat context usage at or above 90% as `AT_RISK`. Prepare a continuation terminal and compact handoff before the worker reaches 100%.
- At 100% context, interrupt or fence the old worker before starting a replacement writer. Preserve its uncommitted files, Task ID, acceptance criteria, and evidence path.
- Wait for the replacement terminal to reach its real ready state, including any workspace-trust prompt, before dispatching. Sending during startup can truncate the beginning of a task.
- A `UserPromptSubmit hook timed out` or `agent_prompt_stalled` result is ambiguous. Read the terminal screen and file activity before retrying; the agent may already be executing the prompt.
- Never let two terminals edit the same worktree because a prompt outcome was ambiguous. If a replacement was started prematurely, fence one writer immediately and retain the terminal with the most advanced coherent work.
- Text visible after an idle prompt marker is not proof that a task was submitted. Clear stale pending text before dispatching the next approved task.
- Provider fallback and context replacement are different events: provider fallback changes the configured worker only after a provider error, while context replacement keeps the same provider when possible.

The executable watchdog owner is [`scripts/sprint-01-watchdog.ps1`](../scripts/sprint-01-watchdog.ps1). Changes to its dispatch state machine must preserve the invariants above.

## Fifteen-minute safety check

The 15-minute cron is a detector, not the decision-maker. On every check, if any lane is idle, waiting, disconnected, authentication-failed, probe-failed, or has a stale `ACTIVE` state while useful backlog remains, the Master controller must immediately inspect the Orca terminal and evidence, classify the cause, and take one bounded action:

- continue the current Run when it is still active;
- clear a completed Run after verifying its receipt/report;
- dispatch the prepared `NEXT` item once;
- move the lane to `FALLBACK`;
- repair the watchdog state or terminal binding; or
- record a hard blocker and stop retrying.

After resolving an incident, update this runbook when the incident exposes a reusable rule or missing safeguard. Keep detailed timestamps and terminal output in the sprint report, not in this evergreen document. The Master must never silently accept an idle lane while suitable backlog remains.

## Token-efficient continuous supervision

Continuous observation has two layers. The local observer runs every five minutes and consumes no model tokens; the fifteen-minute cycle is a broader safety checkpoint. Neither should invoke a controller merely to repeat an unchanged status.

The local observer reads only exact terminal handles, connection/writable state, `tui-idle`, `lastOutputAt`, bounded output cursors, active Task IDs and completion receipts. It writes one compact line:

```text
Lane 1: <done>/<total> | Lane 2: <done>/<total> | Lane 3: <done>/<total> || Total: <done>/<total>
```

Invoke the Lead Orchestrator only for an event that needs judgment or dispatch:

- `JOB_DONE` or a gate verdict changed;
- an idle lane still has prepared backlog;
- provider/auth/quota failure requires fallback;
- context is approaching replacement threshold;
- a blocker, dependency or ownership conflict appeared;
- the ready queue is exhausted and useful work must be planned;
- promotion/integration or independent review is ready.

Pass the controller a delta packet, not a transcript: previous/current state, exact terminal, receipt marker, changed hashes, blocker/rule code and queue head. Prefer `terminal read --cursor` for new output; use `--screen` only when rendered TUI state or an ambiguous prompt submission matters. Load full reports only at an evidence or promotion gate.

Agents should self-advance from `ACTIVE` to a fully prepared `NEXT` after writing the receipt and report. The cron is a recovery detector, not the normal scheduler. Prepare a fresh context around 80–90% rather than waiting for 100%.

## Exhausted-lane rule

When a lane reaches `SPRINT_EXHAUSTED`, it must not remain idle while the sprint, phase, or approved product objective still has useful work. The Master must immediately:

1. Run `$ak:plan` against current evidence, remaining goals, blockers, and cross-lane dependencies to create additional bounded work for that lane.
2. If planning needs another lane's output, assign this lane verification, review, testing, documentation, benchmarking, integration, or blocker-removal work from another queue.
3. Provide `ACTIVE`, `NEXT`, and `FALLBACK` with context and acceptance criteria before dispatching.
4. Update the sprint backlog and state ledger so the new work is auditable.

The only valid terminal state is `EXHAUSTED_CLOSED`, reached when no valuable work remains across the approved sprint/phase, or when a hard blocker prevents safe work and has an owner plus recheck trigger. Do not create artificial busywork solely to keep a process alive.

Before declaring `EXHAUSTED_CLOSED`, an exhausted lane must run a self-verification pass over its completed outputs when no new task is available. The pass should test or audit the relevant artifacts, re-check acceptance criteria and evidence links, detect regressions or stale assumptions, and produce a verification report. Only after that pass finds no valuable unresolved verification work may the lane close; otherwise the findings become the next `ACTIVE`/`NEXT` queue items.

## Observation-window rule

Do not declare a lane stable, continuously productive, or fixed after a single probe or two rapid task transitions. For a continuity claim, the Master must observe the lane for at least 15–20 minutes, or through the next scheduled watchdog cycle plus one follow-up check, and record terminal state, completion receipts, dispatch actions, and progress-log entries. Until that window is complete, report the result as `MONITORING`, not `RESOLVED`.

## Evidence and handoff

Each completed job must leave reviewable output in the assigned worktree, normally a focused code/doc change plus a report under the sprint plan’s `reports/` directory. The report must identify scope, changed artifacts, checks performed, remaining concerns, and whether the result is ready for review.

The controller owns cross-lane integration and user approval. Agents must not modify the master worktree or shared plan/HANDOFF unless that ownership is explicitly assigned.

## Proven sprint-close loop

Sprints 02–04 established one repeatable close sequence. The controller must
use the sequence as a state machine, not as a narrative checklist:

1. Freeze disjoint ownership, acceptance criteria, evidence paths and the
   fallback order before dispatch.
2. Start an independent verification lane while producers are still working;
   findings become bounded producer follow-ups, not post-sprint debt by default.
3. Settle every producer through a receipt, machine-readable result and exact
   `JOB_DONE` marker. A terminal becoming idle or returning to PowerShell is not
   completion evidence.
4. Stop writer churn, then compute the promotion/freeze manifest from current
   bytes. Superseded receipts remain historical and must not be selected merely
   because they are older or more complete-looking.
5. Run an independent arbiter against the promoted/current bytes. The arbiter
   must re-execute the owned mechanical gates; it must not convert producer
   claims into PASS by inspection alone.
6. If the arbiter finds a defect, reopen a narrowly owned correction job,
   preserve the failing evidence, rerun the affected gate and then rerun the
   close gate. Sprint 04's invalid capability-hash fixtures are the canonical
   example: the receipt claimed green, the independent run failed, production
   validation stayed strict, and only the fixtures were corrected.
7. Record unavailable checks as unavailable, with the missing prerequisite and
   follow-up owner. Environment-blocked evidence is never a synthetic PASS.
8. Only after arbiter `GO`: close the run manifest, update plan/HANDOFF, release
   the controller lease and disable the run-specific failover detector. A
   sprint `GO` never opens a separately blocked phase.

The executable evidence owners are the sprint gate/fixture runners and arbiter
artifacts under `plans/reports/`; this section owns only the operating order and
the rejection rules.

### Runtime-state reconciliation

Orca task status, terminal UI, file activity and durable receipts can briefly
disagree. Before retry, fallback, promotion or close, reconcile all four:

- identify the current Task and Dispatch from the run ledger;
- inspect the exact terminal rather than an arbitrary pane;
- check bounded output/file deltas for useful work;
- accept completion only after receipt plus independent acceptance checks.

An ambiguous dispatch response such as `agent_prompt_stalled` may still have
delivered the task. Inspect first. A completed receipt with a stale Orca task
must be settled explicitly; a green task row with failing current-byte tests
must be reopened. Durable evidence outranks terminal appearance.

## Durable-chat recovery and evidence hygiene (Sprint 03)

Verified by Lane 3 Sprint 03 evidence (`plans/reports/orchestrate-260825-sprint03-chat/lane3/`); runners live in `qa/fixtures/sprint03/`.

- **Copy-first SQLite inspection is mandatory.** Never open a live or promoted SQLite store for read-only inspection — copy `db`+`wal`+`shm` to a temp location and open the copy read-only. Direct read-only opens create WAL/SHM sidecars beside checkpointed DBs (Sprint 02 debt, closed by FI-07: zero source-byte change, zero new sidecars on both promoted DBs). Use `qa/fixtures/sprint03/sqlite-inspect.py`.
- **Durable chat has four recovery invariants** that verification must check before promotion: persist-before-ack with command-id replay (a retried command replays the original receipt, exactly one turn row), stream-event dedupe by `(attempt, seq)` with gap-detect-then-refetch, attempt lease fencing by monotonically increasing generation (stale-owner writes affect zero rows), and single-writer enforcement (a second writer surfaces `SQLITE_BUSY`, never silent interleave). Fixture matrix: `qa/fixtures/sprint03/recovery-matrix.json`.
- **Credential material never crosses into evidence.** Reports, receipts and fixtures reference `msg_*`/`task_*`/`ctx_*`/`term_*` identifiers only — never `dcap_*` dispatch capabilities, token values, or `sen.env` contents (BA-01 incident: a Lane 2 report persisted a capability and had to be scrubbed). Scan with `qa/fixtures/sprint03/boundary-audit.py` before sprint close.
- **Verification runners are token-free and self-checking.** Each Lane 3 runner exits non-zero on any failed cell and prints one compact counter line, so the local observer can consume it without a model call.

## Orca reconcile recovery and slot wire hygiene (Sprint 04)

Verified by Lane 3 Sprint 04 evidence (`plans/reports/orchestrate-260825-sprint04-orca-reconcile/lane3/`); runners live in `qa/fixtures/sprint04/`.

- **Reconcile never destroys on uncertainty.** The 4-way lifecycle reconciler (`go/internal/builderexec/reconciler.go`) must keep these invariants: cleanup touches orphans only; a resource probe error marks the resource `unknown` with zero cleanup actions; an attempt probe error skips that attempt group entirely; a failed cleanup keeps the resource tracked for the next pass; orphan attempts self-clean with no external destroy/kill. Fixture matrix: `qa/fixtures/sprint04/recovery-matrix.json` (RC-01..RC-11).
- **Reattach recovery is idempotent.** A second reconcile pass after successful cleanup must be a pure no-op (0 checked, 0 orphans, 0 actions, 0 errors — RC-07). Any reattach flow that re-runs reconciliation relies on this property; regression here is a sprint gate.
- **Reconcile passes are not single-flighted.** `Reconcile` locks the resource map but not the pass; concurrent invocations can duplicate cleanup calls (F-01). `RunLoop` is the only supported driver until a pass-level lock lands. Where a race claim matters, preflight `-race` first: it needs cgo and a C compiler, and when neither exists record the check as environment-blocked — never claim detector-verified race-freedom without the detector.
- **Slot wire data is fail-closed at the parse boundary.** Runtime-slot payloads parse through `parseRuntimeSlots` (`src/lib/agentRuntime/orca-slot-client.ts`): unknown extra fields are ignored, any violation returns null, strings are length-capped and control-char stripped. Anything the wire carries beyond the safe-field contract (secrets, raw commands, tokens, auth/config paths) is dropped at the boundary, never forwarded to a view.
- **An invalid worker command is a dispatch failure, not a retry loop.** When a dispatched provider command is invalid and produces no artifact, fence the primary, dispatch the configured fallback exactly once with unchanged ownership and acceptance criteria, and record the incident as environment evidence. One writer per lane survives provider failure.

## Controller succession

The controller itself is leased. A local checker may detect controller loss without spending an LLM call, but it must never infer authority from silence alone.

- Keep a machine-readable lease with `owner`, Orca terminal handle, heartbeat, status, and monotonically increasing `generation`.
- Refresh the heartbeat from explicit controller checkpoints or observed output from the bound Orca terminal. Routine checks consume no model tokens.
- Treat the owner as eligible for failover only after the configured stale interval and only when its exact terminal is idle, disconnected, or unavailable. A stale but busy terminal is `AT_RISK`, not abandoned.
- Dispatch one pre-registered standby in policy order. Do not select an arbitrary terminal from the worktree.
- The standby must read the redacted continuation contract, verify live state, and atomically claim the next lease generation before issuing any lane command.
- While a takeover is pending, enforce a cooldown and never dispatch another successor for the same generation.
- A successor inherits coordination scope only. It does not gain permission to code in master, change product decisions, commit user files, weaken gates, or start blocked phases.
- Refresh terminal bindings whenever Orca replaces a terminal or the machine restarts. Runtime handles are not durable identities.
- Release the lease when the sprint is closed or intentionally paused so an idle completed controller does not trigger a false takeover.

The executable owner is [`scripts/controller-failover.ps1`](../scripts/controller-failover.ps1). Each active orchestration run supplies a config and an `ak:handoff`-compatible continuation contract. The recommended detector cadence is five minutes with a fifteen-minute stale threshold.

Install or refresh the detector with [`scripts/install-controller-failover-task.ps1`](../scripts/install-controller-failover-task.ps1). The task deliberately uses the logged-on interactive user because Orca terminals are desktop resources; it survives provider/context exhaustion and remains enabled on battery, but it cannot take over after Windows logout or when Orca itself is closed. In those cases the durable lease and handoff preserve resumability for the next login rather than pretending a live standby exists.

Reusable controller lessons and the current checkpoint live in [`docs/newsos-master-memory.md`](./newsos-master-memory.md). Update that memory only from verified evidence; keep per-run detail in retrospectives and orchestration reports.

## Incident learning

Operational failures are recorded as durable guidance when they reveal a missing invariant. The Lane 2 incident established two such invariants: terminal selection must be explicit per lane, and queue advancement requires a completion receipt. Keep incident evidence in the sprint report; keep only the reusable rule here.

Sprint 03 adds two provider-health rules: provider quota/connection readiness is
part of dispatch preflight, and repeated Windows hook failures are a worker
health event even when the terminal remains `running`. Fence the failed
dispatch, preserve its evidence, and create one same-ownership fallback task;
never count an open but tool-blocked terminal as progress.
# MemoraX Code memory boundary

The installed MemoraX Code adapters provide advisory memory to the Master and
Claude workers. They do not replace Orca execution state, SQLite state,
receipts, manifests, or handoffs. Follow the complete boundary and recovery
rules in [memorax-code-memory-policy.md](memorax-code-memory-policy.md).

For a new or repaired client, verify `memorax-code status` before dispatch.
Use `$memorax-code` in Codex or `/memorax-code` in Claude Code only to retrieve
or record a sanitized lesson. A missing backend or adapter is a recoverable
integration issue; continue the run using the normal low-token watchdog and
Master failover protocol.
