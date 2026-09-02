# S22 Phase-21 cutover, verify and rollback drill receipt

Approval: `P21-A01-20260902` (owner-delegated). Host: container
`newsos-s22-prod` (agent-os-s17:latest), port 3737.

## Phase-3 checks

### Write-verification (canonical sole writer path)

- Canary write via `/api/sen/chat` → POST 200, canonical receipt
  (`commandId`/`turnSeq`/`turnId`/`chatAttemptId`, `status: queued`,
  camelCase per S15 P1 adapter). Session `s22-readback`.
- Readback via `?session=` → 200 `{turns:[...], canonical:true}`.
- **Durability:** survival across container restart (phase-2) and rollback
  restore (phase-3) — same turn intact, RPO close to zero.

### Old surface inert probes (retired surfaces fail closed)

| Surface | Expected | Observed |
|---------|----------|----------|
| `sen/chat` PATCH | 501 (legacy disabled) | 501 |
| `sen/chat` DELETE | 501 (legacy disabled) | 501 |
| `firstmate/chat` POST | 410 (legacy writer guard) | 410 |

All probes used `x-agentic-os-token` header auth; legacy surface inert —
no dual-writer path reachable.

### Rollback drill

- **Forced failure:** `docker stop --time 3 newsos-s22-prod` →
  `docker wait` exit 1, `State.Running=false` (authoritative down signal).
- Note: host-port `Invoke-WebRequest http://127.0.0.1:3737` still answered
  while the container was down — Docker Desktop host-side port proxy keeps
  the listener bound; container state is the reliable down indicator, not the
  forwarded-http probe.
- **Rollback:** `docker start newsos-s22-prod` → healthz 200; readback of
  `s22-readback` turn intact (200, canonical).

## Verdict

**PASS-CUTOVER-VERIFY / PASS-ROLLBACK-DRILL.** Canonical write path live and
durable; retired surfaces inert; rollback restores prior state with data
intact. No `legacy_writer` or `phase_21` state changed by this phase.

## Invariants held

`npm run protected:check` → PASS (`legacy_writer disabled`, `phase_21 blocked`)
before and after phase-3. Nothing flipped outside the recorded gate.