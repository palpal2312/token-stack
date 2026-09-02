# Workflow & Durability Receipt — Phase 4

**Commit:** `3776156`  
**Run:** 2026-09-02

## Agent / Sen / Orca contracts

| Contract | Test evidence | Result |
|----------|---------------|--------|
| Canonical chat adapter mapping | `src/lib/sen/canonical-chat-adapter.test.ts` | **PASS** |
| Orca slot client | `src/lib/agentRuntime/orca-slot-client.test.ts` | **PASS** |
| Orca reconcile projection allowlist | `qa/tests/orca-reconcile.spec.ts` | **PASS** |
| Orca slot status views | `qa/tests/orca-slot-status.spec.ts` | **PASS** |
| Orchestration state journal replay | `src/lib/__tests__/orchestration-state.test.ts` (via npm test indirect) | **PASS** |
| Go reconcile / scheduler / orca | `npm run go:check` | **PASS** |

## S10 / durability drills (npm test harness)

| Area | Tests | Result |
|------|------:|--------|
| Registry chain + idempotency | s10-registry | **PASS** |
| Lane A metrics (redacted) | s10-lane-a-evaluation | **PASS** |
| Lane C crash/restore model | s10-lane-c-recovery-drill | **PASS** |
| Controlled delivery | s10-controlled-delivery | **PASS** |
| Live loopback daemon drill | s10-live-runtime.integration | **PASS** |
| Offline recovery operations | s10-offline-recovery-operations | **PASS** |
| Phase 4 canary simulation | s10-phase4-canary-recovery | **PASS** |
| B3 local canary bounded op | s10-b3-local-controlled-evidence | **PASS** |

## S22 restart / restore rehearsal

```
S22-LOCAL-REHEARSAL-PASS port=3984 initial_turns=1 restart_turns=1 restore_turns=1 snapshot_valid=true isolated=true
```

**Disposition: PASS** — isolated rehearsal; not a live multi-user production drill.

## Live agent / canary flows

| Flow | Status | Reason |
|------|--------|--------|
| Live container canary write+readback | **SKIP** | `-SkipLive` in total harness |
| Production prompt / external publish | **NOT-RUN** | Out of scope per plan constraints |

## Observations

- No evidence of duplicate turn, stale-owner write, or false completion in automated suites.
- Protected controls confirm canonical writer live, legacy rollback not pre-enabled.
- **S10 copy-first SQLite inspection:** covered by unit/drill tests; manual copy-first procedure not separately re-run in this acceptance session.
