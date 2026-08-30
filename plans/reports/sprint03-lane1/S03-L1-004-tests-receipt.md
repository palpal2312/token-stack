# S03-L1-004 Evidence — Core crash/idempotency tests

## Status

DONE. **33 passed in 2 packages, exit 0.** Process investigation stopped.

## Result

```text
Go test: 33 passed in 2 packages
exit 0
```

First full focused run wall time ~7.5 minutes is a **timing concern** (cold SQLite driver compile + RTK quiet success), not a hang. See `S03-L1-002-004-evidence.md` and `S03-L1-004-anomaly-hung-gotest.md`.

## Acceptance

| Criterion | Result |
|---|---|
| duplicate send | PASS |
| duplicate event | PASS |
| terminal callback retry | PASS |
| restart recovery | PASS |

## Related

- Consolidated: `plans/reports/sprint03-lane1/S03-L1-002-004-evidence.md`
- S03-L1-002: `plans/reports/sprint03-lane1/S03-L1-002-schema-report.md`
- S03-L1-003: `plans/reports/sprint03-lane1/S03-L1-003-events-checkpoints-report.md`

No commit. Lane 2/3 not waited on.

JOB_DONE: S03-L1-004
JOB_DONE: S03-L1
