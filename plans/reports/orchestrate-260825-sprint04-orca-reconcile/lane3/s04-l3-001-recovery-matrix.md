# S04-L3-001 — Reconcile recovery / failure-injection matrix

Date: 2026-08-25. Lane: 3 (recovery evidence). Sprint: orchestrate-260825-sprint04-orca-reconcile.
Dispatch: task_83aebde0f562 / ctx_6a167ac701e6 (Kimi fallback — initial kimi-kimicode command invalid, produced no artifact; primary fenced, claude-kimicode fallback active as sole Lane 3 writer).

## Scope

Failure-injection matrix for ADP-05 Orca reconciliation + reattach recovery.
Subject under test: `go/internal/builderexec/reconciler.go` — the 4-way
lifecycle reconciler (attempt × pane × sandbox × process). Matrix definition:
`qa/fixtures/sprint04/recovery-matrix.json`. Runner:
`qa/fixtures/sprint04/reconcile-runner/` (Go module, imports the real
reconciler read-only via `replace agentic-os => ../../../../go`).

## Results: 11/11 runnable cells PASS

| Cell | Failure class | Evidence level | Status |
|---|---|---|---|
| RC-01 | orphan-pane-after-attempt-death | fixture | PASS |
| RC-02 | orphan-sandbox-after-attempt-death | fixture | PASS |
| RC-03 | orphan-process-after-attempt-death | fixture | PASS |
| RC-04 | false-orphan-guard | fixture | PASS |
| RC-05 | resource-probe-error-fail-safe | fixture | PASS |
| RC-06 | cleanup-failure-retained | fixture | PASS |
| RC-07 | reattach-idempotent-second-pass | fixture | PASS |
| RC-08 | orphan-attempt-self-clean | fixture | PASS |
| RC-09 | attempt-probe-error-skips-cleanup | fixture | PASS |
| RC-10 | untrack-exemption | fixture | PASS |
| RC-11 | concurrent-reconcile-snapshot | fixture (no `-race`, env-blocked) | PASS |
| RC-12 | canonical-slot-reconcile-runtime | pending-lane1 | PENDING |

Evidence: `s04-l3-001-reconcile-evidence.json` (this directory). Counter line:
`S04-RC: 11/11 PASS dup-cleanup=0`.

## Key findings

1. **Fail-safe on uncertainty holds.** A resource probe error marks the
   resource `unknown` and produces zero cleanup actions (RC-05); an attempt
   probe error skips the whole attempt group with zero orphans (RC-09). No
   destructive action is ever taken on an unprobeable resource.
2. **Retry semantics hold.** A failed destroy leaves the resource tracked and
   records `action.success=false` (RC-06); the next pass retries.
3. **Reattach recovery is idempotent.** A second reconcile pass after
   successful cleanup is a pure no-op: 0 checked, 0 orphans, 0 actions,
   0 errors (RC-07). This is the property reattach flows rely on.
4. **Orphan attempts self-clean** with `action=cleanup` and no external
   destroy/kill call (RC-08).
5. **F-01 (note, not a failure): concurrent passes are not single-flighted.**
   `Reconcile` locks the resource map but not the pass; two concurrent passes
   over the same tracker can in principle duplicate a cleanup call (destroy is
   assumed idempotent downstream). Two-goroutine fixture (100 orphan panes)
   observed `dup-cleanup=0` and drained tracking cleanly, but the invariant
   rests on `RunLoop` being the only driver. Recommend Lane 1 either documents
   "single driver only" on `Reconcile` or adds a pass-level mutex. No fix
   applied — outside Lane 3 ownership.
6. **Race detector unavailable (environment evidence).** `-race` requires
   cgo/gcc; no C compiler on this machine (bounded 60s preflight per
   coordinator instruction). RC-11 ran without the detector; race-freedom is
   asserted from code inspection (all shared state behind `r.mu` / probe-local
   mutexes), not from detector output.

## Environment evidence

- Initial Lane 3 dispatch used an invalid Kimi command; produced no artifact.
  This dispatch is the sole Lane 3 writer. No commits. Master is
  coordination-only; Phase 21 not started.
- Windows hook timeouts during scouting were recorded by the coordinator as
  environment evidence; work continued per checkpoint instruction.
- gopls flags the fixture module ("not included in workspace"); the Go
  toolchain builds and runs it correctly — IDE noise, not a build error.

## Remaining concerns

- RC-12 pending-lane1: `go/internal/orcaslots` (canonical daemon slot
  reconciler, mirrored by `orca-slot-client.ts`) is not landed. When it lands,
  add a runtime cell re-pointing at the daemon package; matrix is already
  parameterized.
- F-01 single-flight note above is the only open code observation.

JOB_DONE: S04-L3-001
