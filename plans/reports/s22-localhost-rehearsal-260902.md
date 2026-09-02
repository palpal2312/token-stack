# S22 localhost isolated rehearsal receipt (2026-09-02)

## Verdict

**PASS-REHEARSAL / NO-GO-PRODUCTION.** This receipt proves only a localhost
rehearsal. It neither authorizes nor performs a production release, cutover,
writer flip, or Phase 21 transition.

## Boundaries

- Daemon bound to loopback only: `127.0.0.1:3982`.
- Store, snapshot, restore target, and binaries were created under one
  uniquely named temporary directory and removed in the script's `finally`
  block.
- No production endpoint, external service, credential, or persistent user
  data was used.
- This rehearsal does not change `legacy_writer` or `phase_21`.

## Executed drill

`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-s22-local-rehearsal.ps1 -Port 3982`

Result:

```text
S22-LOCAL-REHEARSAL-PASS port=3982 initial_turns=1 restart_turns=1 restore_turns=1 snapshot_valid=true isolated=true
```

The drill wrote a redacted canary, verified its durable read-back, stopped the
daemon it started, restarted against the same isolated store, verified the
turn again, created a snapshot, restored that snapshot into a separate
isolated store, and verified the restored turn. Before every request it checks
that the listener belongs to its own daemon PID; it waits for each owned PID to
exit and verifies no listener remains before deleting its temporary resources.

## Focused verification

- `go test ./cmd/sen-plane ./cmd/newsos-backup` — PASS.
- `go vet ./cmd/sen-plane ./cmd/newsos-backup` — PASS.
- Post-run check — no listener on port 3982 and no rehearsal temporary
  directory remained.

## Remaining production gates

Production-host authorization, monitored production SLO evidence, independent
arbiter review, and an owner-recorded release gate remain required. This
rehearsal must not be interpreted as satisfying them.
