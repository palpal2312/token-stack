# Optimal Lane Count

Optimal Lane Count (`OLC`) is NEWS OS's advisory capacity contract for useful
parallel work. It is not a scheduler and grants no execution authority. SEN
proposes capacity and allocation; the user approves the Sprint envelope; Orca
owns Run, Task, Dispatch, worker, worktree and terminal execution.

## Capacity hierarchy

- `Global OLC baseline`: conservative concurrency supported by the installed
  machine, declared workers and approved budget before current load is applied.
- `Effective Global OLC`: capacity available now after resource pressure,
  running workload, provider health, quota and fallback coverage are applied.
- `Sprint OLC`: safe useful parallelism inside one Sprint, bounded by its
  independent ready work, dependencies and ownership isolation.
- `Sprint lane allocation`: the share of Effective Global OLC currently
  assigned to each active Sprint. Allocations must sum to no more than the
  effective global value and may not exceed each Sprint OLC.

OLC counts useful physical worker slots, not logical backlog lanes or open
terminal tabs. An open, idle, quota-blocked or non-writable terminal contributes
zero capacity.

## Capacity model

At time `t`, SEN evaluates:

```text
EffectiveGlobalOLC(t) = floor(min(
  HostCapacity(t),
  EffectiveWorkerCapacity(t),
  ApprovedBudgetCapacity(t),
  SafeRunnableCapacity(t)
))
```

The minimum is deliberate. Spare CPU cannot compensate for unavailable
workers; extra providers cannot compensate for unsafe file overlap; a large
backlog cannot compensate for exhausted quota.

Each active lane has a workload weight. Lightweight planning or review may use
less than one capacity unit; a build, browser suite, local model, database
migration or large test run may consume multiple units. Admission is allowed
only when the sum of active weights plus the candidate weight fits the current
effective capacity and configured headroom.

## Required inputs

### Local host capacity and pressure

Capture bounded samples, not raw process arguments or file content:

- logical CPU count and recent CPU utilization/queue pressure;
- total and available memory, committed memory and swap/page pressure;
- disk free space, throughput, latency and queue pressure;
- optional GPU/accelerator memory and utilization when a local workload uses it;
- network availability/latency for remote providers;
- thermal throttling, power/battery policy and operating-system process limits;
- resource envelope of active work: build, test, browser, database, local model,
  indexing, review or lightweight coordination.

Keep safety headroom for the desktop, SQLite writer, Orca and SEN. A default
headroom policy is conservative until machine-specific evidence exists.

### Effective worker capacity

A worker counts only when its current route is usable and its ownership can be
isolated. Record:

- agent, harness, model and role identifiers;
- terminal readiness and current context-risk state;
- authentication/capability health without persisting credential material;
- quota/subscription window state and observed rate-limit/reset class;
- active work and maximum approved WIP;
- verified fallback order and fallback readiness;
- recent failure, retry, timeout and completion rates.

An exhausted primary with a live verified fallback keeps one effective slot.
An exhausted primary with no verified fallback contributes zero. Multiple
profiles sharing one provider/quota pool must not be counted as independent
capacity.

### Sprint and work-graph capacity

- independent ready Runs/Tasks and critical-path depth;
- dependency fan-in/fan-out and expected unblock time;
- exclusive file, schema, migration and integration ownership;
- estimated effort and workload weight;
- acceptance/review capacity and independent arbiter availability;
- Sprint timebox, priority, token/agent-time budget and user-approved maximum;
- historical throughput, rework and conflict rates for similar work.

## Session telemetry contract

Workers report structured events at start, meaningful checkpoint, blocker,
review-ready and completion. The controller combines self-reports with Orca
state, bounded terminal deltas, current-byte hashes and test evidence. A
self-reported percentage alone is never authoritative.

Minimum privacy-safe fields:

```text
session/run/sprint/lane/task identifiers
agent/harness/model/role and workload class
state and checkpoint reason
active/idle/blocked duration
resource-weight estimate and bounded host samples
token/agent-time usage bucket and quota-health class
fallback availability and fallback activation reason
dependency/ownership/conflict counts
test/review/rework outcome
dispatch-to-receipt wall time and final verdict
```

Do not collect project content, prompts, source text, raw terminal transcripts,
credentials, capability values, private environment variables or personal data.
Local SQLite stores per-installation event evidence and personal aggregates;
only allowlisted anonymous aggregates may enter community comparison.

## Derived indicators

SEN derives at least:

- lane utilization, idle ratio and blocked ratio;
- weighted active load and remaining capacity;
- worker/provider availability and fallback coverage;
- throughput and wall-clock contribution by workload class;
- token/agent-time cost per accepted Run;
- ownership-conflict, retry, failure and rework rates;
- quality/review pass rate and critical-path duration;
- marginal benefit of the last added lane.

The training label is the lowest wall-clock result that remained within the
approved budget, resource envelope and quality gates. Fast but failed, heavily
reworked or conflict-heavy runs are not positive OLC examples.

## Control loop

1. Before Sprint approval, compute baseline and Sprint OLC ranges with reasons.
2. After approval, allocate physical lanes across Sprints without exceeding the
   approved global maximum or any Sprint OLC.
3. Before every admission, recalculate effective capacity from current host
   pressure, active workload and worker/fallback health.
4. During execution, automatically downshift when pressure, quota loss,
   fallback loss, dependency or conflict risk reduces capacity. Preserve the
   Run and worktree; drain or reassign safely through Orca.
5. Increase concurrency only inside the user-approved maximum and budget, with
   a ready independent task and verified worker route.
6. After the Sprint, compare proposed versus actual capacity, record outcomes
   and update machine-local estimates. Community aggregates inform priors but
   never override current local safety evidence.

## Recalculation triggers

Recalculate immediately when a heavy job starts or ends; CPU, memory, disk,
thermal or battery pressure crosses policy; a provider loses quota/auth; a
fallback becomes unavailable; context replacement is required; dependency or
ownership state changes; a lane becomes idle with backlog; or a gate changes
the ready-work graph. Routine sampling remains token-free.

## Cold-start and failure policy

With insufficient history, use conservative host headroom, verified workers
only and dependency-safe parallelism. Missing metrics reduce confidence and may
lower the recommendation; they never justify invented capacity. If effective
capacity falls below active weighted load, stop new admissions, finish or drain
the safest bounded work first, preserve receipts and reallocate only after the
new state is stable.
