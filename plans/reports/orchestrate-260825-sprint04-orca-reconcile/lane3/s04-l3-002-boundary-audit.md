# S04-L3-002 — Privacy + reconcile boundary audit

Date: 2026-08-25. Lane: 3. Runner: `qa/fixtures/sprint04/boundary-audit.py`
(exit 0 = no open finding). Evidence: `s04-l3-002-boundary-audit-evidence.json`.

## Result: 16/16 PASS (171 files scanned)

Counter line: `S04-BA: 16/16 PASS scanned=171`. Audit wall time 1.48s —
token-free, observer-consumable.

### Boundary posture verified (PASS)

| Check | Evidence |
|---|---|
| Reconciler cleanup phase touches orphans only (`if res.State != ResourceOrphan { continue }`) | `reconciler.go` phase 2 |
| Probe error → `ResourceUnknown`, never orphan — no destructive action on uncertainty | `reconciler.go` phase 1 |
| Failed cleanup keeps resource tracked for retry (`if action.Success { delete(...) }`) | `reconciler.go` phase 2 |
| Orphan attempts self-clean, no external destroy/kill | `reconciler.go` `// Attempts self-clean` |
| Runtime-slots wire data fail-closed at parse boundary; unsafe fields dropped, violations → null | `orca-slot-client.ts` `parseRuntimeSlots` |
| Slot strings length-capped, control-char stripped, state enum restricted | `orca-slot-client.ts` `isSafeText`/`SLOT_STATES` |
| Shell-spawning herdr terminal route origin-guarded (`checkLocalRequest`) and loopback-bound | `herdr/terminal/route.ts` |
| Go listener host restricted to loopback; non-loopback disables proxy | `goApiProxy.ts` host allowlist |
| Proxy fails closed when token missing; never unauthenticated | `goApiProxy.ts` `if (!token) return null` |
| No `SEN_API_TOKEN` assignments, bearer tokens, `dcap_*` capabilities, agentic-token headers, AWS-style keys, or private keys in 171 scanned evidence files (plans/, qa/, docs/) | secret scan |
| No `sen.env` inside the repo tree | filesystem scan |

### Findings

- None open. No scrub actions were required this sprint — the BA-01 lesson
  from Sprint 03 (never persist `dcap_*` in reports) held: all Sprint 04
  evidence references `msg_*`/`task_*`/`ctx_*`/`term_*` identifiers only.

## Scope limits

- Static checks read Lane 1/Lane 2 sources read-only; no fixes applied outside ownership.
- Secret scan covers plans/, qa/, docs/ (evidence trees), not product source or `~/.agentic-os` (privacy boundary respected — no credential files opened).
- `go/internal/orcaslots` is not landed, so the daemon-side slot wire shape is verified only at the client parse boundary (same pending-lane1 item as RC-12).

## Unresolved questions

- None open.

JOB_DONE: S04-L3-002
