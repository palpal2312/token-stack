# S10 Lane C offline recovery runbook

## Authority boundary

This runbook is a portable, redacted decision aid for offline evidence only.
It must not start or restart daemons, restore a database, write an outbox,
claim or renew a lease, call a backend, alter snapshots, enable the legacy
writer, promote a candidate, release/cut over, or change Phase 21.

Every result is either a hash-pinned local replay instruction, `NOT_MEASURABLE`,
or fail-closed. A live incident needs a separately approved operational
runbook and controller authority.

## Preconditions

- Record the redacted frozen-input SHA-256 and its provenance.
- Confirm the intended operation is local inspection only.
- Preserve `legacy_writer: disabled` and `phase_21: blocked`.
- Do not replace a missing hash, invalid snapshot, or unavailable dependency
  with nearby data.

## Bounded drill matrix

| Condition | Offline decision | Publication | Live claim intentionally excluded |
|---|---|---|---|
| Daemon crash | Recompute only from the pinned frozen input. | Replay-only descriptor; no writer. | Process restart/recovery. |
| Restore request | Recompute derived evidence from the same pinned input. | Replay-only descriptor; no restore. | Database or object restore. |
| Duplicate outbox | Suppress the duplicate publication key. | None. | Queue/outbox mutation. |
| Stale lease | Fail closed; require fresh independent lease evidence. | None. | Lease takeover/renewal. |
| Backend unavailable | `NOT_MEASURABLE`; retain incident metadata only. | None. | Retry, fallback, or network call. |
| Invalid snapshot | Fail closed; quarantine the claim. | None. | Snapshot repair/restore. |

## Verification

```powershell
npx --no-install tsx --test qa/tests/s10-lane-c-recovery-drill.test.ts
Get-FileHash -Algorithm SHA256 src/lib/llmops/s10-lane-c-recovery-drill.ts
Get-FileHash -Algorithm SHA256 qa/tests/s10-lane-c-recovery-drill.test.ts
```

The test checks classification for all six conditions and rejects command,
network, and write APIs in the isolated model. It does not measure daemon,
backend, restore, queue, or lease behavior.
