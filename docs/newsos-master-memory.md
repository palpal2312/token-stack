# NEWS OS Master Memory

This is the durable, evidence-backed memory for Lead Orchestrators. It stores reusable operating lessons, not transcripts, secrets, volatile terminal output or speculative rules.

## Current checkpoint

- Sprint 01: CLOSED — GO.
- Sprint 02: CLOSED — GO; canonical evidence is `plans/reports/orchestrate-260825-sprint02-close/final-arbiter-pi.md`.
- Sprint 03: CLOSED — GO; arbiter `plans/reports/orchestrate-260825-sprint03-chat/arbiter-go.md`.
- Sprint 04: CLOSED — GO; arbiter `plans/reports/orchestrate-260825-sprint04-orca-reconcile/arbiter-go.md`.
- Sprint 05–07 multi-sprint run: ACTIVE; Sprint 05 Wave A is running, while
  Sprint 06/07 remain gated by `S05-G1`. Current manifest:
  `plans/reports/orchestrate-260825-sprint05-07-multi-sprint/run-manifest.json`.
- Phase 20: open.
- Phase 21: CLOSED_GO (2026-09-02, owner GO; canonical writer live;
  `phase_21: closed_g0`, legacy rollback guard inert). Evidence
  `plans/reports/s22-phase21-closedgo-260902.md`; plan
  `plans/260902-1156-s22-phase21-cutover/`.

## Phase-21 close-gate lessons (2026-09-02)

- **Guard root bug found at the gate**: the pre-gate `check-protected-controls.ps1`
  resolved the repo root with a double `Split-Path` off `scripts/`, landing one
  level too high, so `src/` and `go/` never existed under that path and the scan
  was vacuous (always PASS). Fixed to a single `Split-Path`; the guard now
  genuinely scans and fails on a missing `phase_21: closed_g0` marker or a
  reappearing `blocked`/`disabled` token. Guards must prove they scan (a
  deliberately-broken case should fail), not just echo OK.
- **Post-gate marker pattern**: after an owner-gated release, the protected
  expectation flips from "forbidden token" to "required marker". The rule is
  still fail-closed, but the sign of the invariant inverts; both states must be
  enforced in code, not prose.
- Phase 21: blocked until the revised Phase 20 machine gate returns GO.
- Latest controller continuity config:
  `plans/reports/orchestrate-260825-sprint05-07-multi-sprint/controller-failover.json`.
- Current controller scope: the Sprint 05–07 run is active. Sprint 04 remains
  released and must not be revived.
- Latest retrospective: `plans/reports/retro-260825-sprint02.md`.

## Verified operating lessons

| ID | Lesson | Durable action | Evidence |
|---|---|---|---|
| OM-01 | An open terminal is not proof of productive work. | Observe exact handle, idle/busy state, output delta and receipt. | Sprint 01/02 idle incidents; orchestration runbook |
| OM-02 | Routine monitoring does not need model tokens. | Use local five-minute polling; invoke master only on state changes/anomalies. | Sprint 02 token counter and retrospective |
| OM-03 | The 15-minute check is too slow for short jobs. | Preload ACTIVE/NEXT/FALLBACK and let workers self-advance on `JOB_DONE`. | Repeated Lane 2 stops |
| OM-04 | Full-screen reads are expensive and often redundant. | Prefer terminal metadata and cursor deltas; use screen reads only for TUI/prompt ambiguity. | Sprint 02 monitoring history |
| OM-05 | Provider fallback and context replacement are different. | Preserve Task/worktree for provider fallback; fence old writer for context replacement. | Lane 1 quota and Lane 2 100% context incidents |
| OM-06 | A prompt timeout is ambiguous. | Inspect terminal screen and file activity before retry; never create two writers. | Lane 2/3 hook timeouts |
| OM-07 | Promotion and closure must be mechanical. | Freeze current-byte hashes only after writers settle, test the integrated state, then require an independent arbiter to re-execute the owned gates. | Sprint 02 final arbiter; Sprint 03/04 arbiter reports |
| OM-08 | A controller also needs a lease. | Token-free stale/idle detector, allowlisted successor, generation claim and redacted handoff. | Controller failover review/drill |
| OM-09 | Never send takeover before persisting authorization. | Save pending owner/generation first; a crash cannot create an invisible dispatch. | Failover review B3 |
| OM-10 | Evidence detail and evergreen rules belong in different places. | Reports retain incident detail; this memory/runbook retain only reusable verified rules. | Documentation policy |
| OM-11 | PowerShell may collapse a one-item result into a scalar, making `[0]` select its first character. | Array-wrap discovered path candidates before selecting the newest controller config, then verify released-state commands are read-only. | `newos-master-released-regression-controller.md` |
| OM-12 | Provider or command availability can fail before useful work starts even when the terminal is open. | Preflight provider/quota, configured command, workspace readiness and connection before dispatch; on failure, fence the dispatch and create exactly one same-ownership fallback. | Sprint 03/04 run manifests and dispatch records |
| OM-13 | A non-blocking Windows hook error can still prevent an agent from making progress. | Treat repeated hook errors as a worker-health event; inspect output/file activity, then switch to a verified fallback or record a hard blocker instead of counting the terminal as productive. | Sprint 03 Lane 2 live output |
| OM-14 | A worker can report `Ran` while a combined shell remains waiting for minutes. | Bound each check independently; interrupt the waiting shell, record timeout/non-run honestly, and continue from saved files through one final fallback. | Sprint 03 Lane 2 final receipt |
| OM-15 | Evidence reports can leak dispatch capabilities or self-match secret scanners. | Scrub bearer-like values before durable evidence; audit the final evidence tree and avoid literal secret-pattern examples in the audit report itself. | Sprint 03 Lane 3 14/14 boundary audit |
| OM-16 | A producer receipt is a claim, not a gate result. | Re-run acceptance checks against current bytes; if they contradict the receipt, preserve the failure, reopen a bounded correction and rerun the arbiter. | Sprint 04 invalid capability-hash fixture correction and arbiter |
| OM-17 | Missing tooling cannot be represented as PASS. | Record the exact unavailable check, prerequisite and follow-up owner; keep claims within the evidence actually executed. | Sprint 04 race-detector limitation |
| OM-18 | Orca task state, terminal appearance, file activity and receipts can diverge. | Reconcile all four before retry/fallback/close; settle stale task rows explicitly and never dispatch a duplicate writer from an ambiguous prompt result. | Sprint 03/04 completion and prompt-stall incidents |
| OM-19 | Controller continuity is run-scoped. | After arbiter GO, close the manifest, release the lease and disable the run-specific detector; never auto-revive a closed sprint. | Sprint 02 continuity tests; Sprint 04 release evidence |
| OM-20 | Optimal lane capacity is dynamic and machine-local. | Compute Global OLC, Effective Global OLC, Sprint OLC and allocations from host pressure, weighted active workloads, verified worker/quota/fallback capacity, dependencies, ownership and budget; downshift when effective capacity falls. | Explicit product decision; `docs/optimal-lane-count.md` |
| OM-21 | Provider profiles are not independent capacity when they share quota or lack fallback. | Count a slot only when its effective route is verified; exhausted primary plus verified fallback remains one slot, while no fallback means zero. | Explicit product decision; provider fallback incidents |
| OM-22 | A claimed controller lease and an Orca Run binding are separate state machines. | After takeover, first try `orca orchestration run-use --id <run_id> --json` from the active coordinator context; verify `run-current` immediately. `--takeover-legacy` from an ordinary PowerShell or shell pane returns `legacy_read_only`. If binding succeeds, re-check it atomically before dispatch; do not create a second run merely to hide a missing binding. | Sprint 05-07 controller recovery, generation 3; `run-use` + immediate `run-current` both returned `run_3f23cdda2361` |

## Controller takeover policy

1. Read this memory and `docs/orchestration-runbook.md`.
2. Locate the newest active `controller-failover.json` and its `ak:handoff` continuation contract.
3. Never steal a healthy lease. A claim is valid only for the currently dispatched allowlisted terminal and generation.
4. Claim before any orchestration action, then verify git state and reconcile all Orca terminals/receipts.
5. Act as coordinator only: no master coding, no silent product-decision changes, no commits of user-owned changes.
6. Refresh heartbeat after every meaningful state transition. Release when work closes or intentionally pauses.
7. Recalculate Effective Global OLC before new lane admission and on heavy-work,
   host-pressure, quota, fallback, dependency or ownership changes. Never infer
   capacity from open terminals.

## Memory update protocol

- Read existing entries before adding one; merge duplicates instead of appending variants.
- Add only a lesson supported by a report, test, gate, incident log or explicit user decision.
- If new evidence conflicts, preserve the user decision and current verified contract; mark the old lesson superseded with a reference rather than silently reversing it.
- Keep volatile handles, timestamps and per-run counters in run state/handoffs, not this file.
- Never record credentials, raw prompts, private project content, personal data or terminal transcripts.
- At sprint close, update `Current checkpoint`, link the new retrospective, and add only the few lessons that change future controller behavior.

## S11 checkpoint and lessons (2026-08-31)

Checkpoint: S10 CLOSED_GO (S10 chain, `legacy_writer: disabled`, `phase_21:
blocked`) then S11 CLOSED_GO on independent GO (`plans/reports/s11-CLOSED_GO-record.md`,
master `4876a49`). Rewrite-baseline (go control plane, desktop-shell v2 flag,
web refactor) merged to master after 17-topic split + phase-1 fixes + two-lens
pre-merge audit. Desktop shell v2 stays OFF by default; enablement is a separate
deploy gate.

Lessons that change future behavior:
- **Live smoke toolchain**: `npx next dev` panics in Turbopack here compiling
  CSS (worker exit 0xc0000142). Use `next build` (sandbox off) + `next start`
  for page smoke; verify flag branches via a discriminating page (`/settings`
  placeholder vs `Schema …` render).
- **Flag-gated surfaces**: keep default OFF; only env `…=1`/`true` flips; demo
  data must be gated behind `AGENTIC_OS_ALLOW_TEST_FIXTURE=1` + `NODE_ENV!==production`
  and a real empty read-path default instead of fabricated values.
- **Merge hygiene**: exclude `plans/reports/orchestrate-*/` runtime state
  (`jobs.yaml`, `state.json`, `controller-failover.json`, `orchestrate-history.jsonl`,
  `*prompt.txt`), `_tmp-*` and `*.before-recovery.bin` from product branches —
  transient + machine-local paths, never release content.
- **Close pattern**: CLOSED_GO record + independent fresh-session arbiter on
  committed bytes; Finalize stays gated by the controller-failover state
  machine (watchdog disabled; reinstall before any live run).

## S12 checkpoint and lessons (2026-08-31)

Checkpoint: S12 CLOSED_GO (wiring/test-sweep/planning scope, master `462fcd6`).
`cmd/sen-plane` daemon now serves the proxy surface (`/api/v1/runtime/slots`,
`runtime/attempts`, `codespace/summary`, `workspace/*/execution-preference`)
end-to-end from Node. Desktop shell v2 stays OFF; enablement is the 1809-gate
plan. Phase 12 (legacy cutover) has budget+inventory+drill done; waiting on the
owner's live host.

Lessons:
- **Daemon wiring pattern**: Go HTTP daemon binds loopback only; DTOs mirror the
  exact TS validators (`parseRuntimeSlots`, `isGoRuntimeAttempt`, etc.) — prove
  the round-trip by running the daemon and invoking the real TS clients with
  `SEN_DAEMON_URL`, not by unit tests alone. Empty lists are valid where the
  validator uses `.every()`.
- **Test-sweep**: fan out one agent per module writing minimal
  mutation-catching node:test suites (assert emit-on-mutate, storage round-trip,
  clamp/geometry). Write against real exports; run before merge.
- **Speculative API cut**: confirm zero non-test consumers with
  `git grep` filtered of `_test.go` before deleting; keep any symbol a package's
  own tests exercise. Cut landed −148/+1 with reconcile/allocator/orca green.
- **Per-sprint close**: independent fresh-session arbiter on committed bytes →
  CLOSED_GO record → journal lifecycle events; Finalize stays gated by the
  controller-failover state machine (disabled watchdog, reinstall on the live
  host before Phase 12).

## S16 checkpoint and lessons (2026-09-01)

Checkpoint: S16 CLOSED_GO (canonical-default rollout): legacy FirstMate JSONL
writer frozen (410 unless SEN_CHAT_LEGACY_WRITER=1); canonical chat reachable via
daemon, fail-closed offline (503/410, 0 silent legacy writes); backup cycle 2
9/9 hash-verified. S15 DTO alignment (`turn_id`/`chat_attempt_id` from product
receipt — never synthesize attempt ids) carries into S16.

Lessons:
- **Freeze-not-delete**: retire legacy writers by fail-closed refusal (410) gated
  behind an explicit env, keep the archive + backup drives — reversible, still
  "legacy disabled".
- **Fail-closed offline**: canonical default means every offline path must be a
  hard error (503/410), never a silent fallback write.
- **DTO from source of truth**: expose real PK ids from the durable receipt;
  adapter maps, never manufactures identity.
- **Backup cadence**: verify every cycle with `sha256sum -c` from the manifest's
  own root; keep cycles outside git.

Next known gap: one-command packaging (S17) then live SLO observability.

## S18 checkpoint and lessons (2026-09-01)
S18 CLOSED_GO: SLO probes (Availability/RPO/RTO per ops-prep 1d) as JSONL under
%LOCALAPPDATA%\NEWSOS\s12-metrics + /api/ops/metrics tail-N route + no-chart
dashboard + 30m scheduled-task safety detector + backup-cadence hash check.
Lessons: single watch-loop probe script > external agent per tick; v1 dashboard
last-state table (sparklines later, no chart lib); scheduled tasks are safety
detectors, not the normal loop. Next gap: none blocking — the roadmap (S10-S18 +
Phase 12) is closed; further work is optional.

## Roadmap closed checkpoint (2026-09-01)
S10..S19 + Phase 12 all CLOSED_GO (independent arbiters); evidence + journal
complete; legacy writer disabled + frozen, canonical Go store live, packaging +
observability in place. The local `NEWSOS-S17-SEN-PLANE` task owns the loopback
daemon and S18 currently observes `healthz: 200`; shell rollout remains
host-local, and CI container jobs still await a Docker runner. See
`plans/reports/retro-260901-s10-to-s19.md` for the full retrospective.
