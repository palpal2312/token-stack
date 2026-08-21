# Session 195 — Lane 124C C11 reliability evidence

Date: 2026-08-21  
Target: retry of fenced `task_661b9541931d`  
Evidence root: `C:\Users\ADMIN\Documents\Agent OS`  
Verdict: C11-EVIDENCE-VERIFIED

## Result

The exact 106A B3 gate is green:

| Gate | Command | Result |
|---|---|---|
| Go reliability | `go test -count=1 ./internal/gates/reliability/` | **PASS**, exit 0, `ok ... 0.771s` |
| Playwright reliability | `PW_REUSE_SERVER=1 npx playwright test tests/reliability-gates.spec.ts --reporter=line` | **PASS**, exit 0, `2 passed (4.7m)` |

Playwright completed at `2026-08-21T15:54:47.063Z`. Its QA web server was started and stopped by Playwright.

## Frozen inputs

All four inputs still match `session-195-lane-124c-prestage.md`:

| File | Bytes | SHA256 |
|---|---:|---|
| `go/internal/gates/reliability/audit.go` | 5398 | `c349a1ddb3fe1a79f1e6851b4d35edab040b3ed51ee547ad5e48a81d0af4011b` |
| `go/internal/gates/reliability/audit_test.go` | 4414 | `a4830a54e19b9e331aabf268f724aca8600b8ad4c0c8474bf16c6bddf86690d4` |
| `qa/tests/reliability-gates.spec.ts` | 795 | `9485dc6fb5734d9faba5b614e15d9ce5ed1fecb73e5171429081e661122b6328` |
| `qa/tests/go-contract.ts` | 973 | `08f9e52b5d557b9b085c1854d30871a53e45288ef7ad669d6072ac2e25b51540` |

## Unblock applied

The first Playwright attempt exposed a build blocker: `source/src/lib/agentRuntime/go-builder-exec-client.ts` imported `parseRuntimeSlots` and `OrcaRuntimeSlotsDTO` twice. The duplicate alias import was removed; no behavior changed. The exact C11 commands then passed.

Catalog suites outside B3 were not added. This evidence remains synthetic gate coverage, not a live `agentos_newsos_r1` fence sweep.
