# S04-L3-003 — Reconcile measurements

Date: 2026-08-25. Lane: 3. Sprint: orchestrate-260825-sprint04-orca-reconcile.
All numbers token-free reproducible; commands at bottom.

## Reconcile pass latency (fixture runner, scripted probes, all-alive)

| Resources tracked | Passes | Total | ns/pass | ns/resource/pass |
|---:|---:|---:|---:|---:|
| 1,000 | 50 | 39.46 ms | 789,222 (≈0.79 ms) | 789 |
| 10,000 | 10 | 102.95 ms | 10,294,680 (≈10.29 ms) | 1,029 |

Per-pass cost grows ~linearly with tracked resources (per-resource cost
789→1,029 ns, mild map/alloc pressure at 10k). A 10k-resource pass at ≈10 ms
is three orders of magnitude under the 5-minute observer / 15-minute watchdog
cadence — reconciliation latency is not a scheduling constraint at any
plausible fleet size. Attempt-probe caching (`deadAttempts` map) keeps the
dominant external call count at O(distinct attempts), not O(resources).

## Verification runtimes (wall clock, this machine)

| Check | Result | Wall time |
|---|---|---:|
| `go test ./internal/builderexec/ -count=1` (7 Lane 1 unit tests) | ok | 2.27–2.56 s (package time); 30.95 s wall incl. toolchain |
| `reconcile-runner` 11 cells + bench | 11/11 PASS | ~1 s (compiled run) |
| `boundary-audit.py` (171 files, 16 checks) | 16/16 PASS | 1.48 s |

## Environment limits (recorded, bounded per coordinator instruction)

- `-race` unavailable: no C compiler (gcc/clang/mingw absent; cgo disabled).
  Race preflight bounded to 60s; RC-11 ran without the detector. Do not claim
  detector-verified race-freedom from this machine.
- First runner invocation cold-measured 10.4 ms/pass at 1k (compile-cache
  warmup); steady-state numbers above are from the warm rerun.

## Reproduce

```bash
cd qa/fixtures/sprint04/reconcile-runner
go run . --bench --json <evidence.json>
python qa/fixtures/sprint04/boundary-audit.py
cd go && go test ./internal/builderexec/ -count=1
```

JOB_DONE: S04-L3-003
