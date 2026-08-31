# S12 Phase 1 — Go-plane wiring receipt

## Status

**DONE.** One vertical path wired and proven end-to-end: the Next.js proxy
(`src/app/api/herdr/slots`) → `readRuntimeSlots()` →
`GET /api/v1/runtime/slots` served by the new Go daemon `cmd/sen-plane`
(commit `1aa6ce7`).

## What was built

`go/cmd/sen-plane`:
- `GET /api/v1/runtime/slots` returning the safe-field DTO consumed by
  `parseRuntimeSlots` (`dto_version`, `lab_enabled`, `slots[{slot_id, state,
  capacity, in_flight, builder_label, attempt_ref, last_observed_at, reason}]`).
- `GET /healthz`.
- Loopback-only bind (`SEN_PLANE_ADDR`, default `127.0.0.1:3979`), refused for
  non-loopback hosts.
- Slot source as a `SlotSource` seam with a memory seed slot.
  `ponytail:` memory source; the production projection from `internal/orca`
  dispatch + `internal/reconcile` slots arrives in a later phase.

## Evidence

| Check | Result |
|---|---|
| `go test ./cmd/sen-plane` | pass (DTO shape + safe-field leak scan + healthz) |
| `go build ./...` | pass |
| Loopback bind guard | enforced (localhost/127.0.0.1/::1 only) |
| End-to-end vertical path | `SEN_DAEMON_URL=http://127.0.0.1:3979` → `readRuntimeSlots()` → `slots:1 lab:true dto:1 slot0: sen-plane-1 free` |
| DTO safe-field contract | no secretish keys (token/secret/password/command/private) in slot payload |

## Phase 1b — full proxy surface (complete)

Added the remaining routes the TS clients call (commit `c5bb135`):
`GET /api/v1/runtime/attempts` (projection v1, empty attempts),
`GET /api/v1/codespace/summary` (projection v1, empty summaries),
`GET|PUT /api/v1/workspace/{id}/execution-preference` (default host preference;
PUT reflects with `resolution_reason: accepted-no-durable-store (phase-1b seed)`).

Live round-trip (4/4 clients, `SEN_DAEMON_URL=http://127.0.0.1:3979`):

| Client | Result |
|---|---|
| `readRuntimeSlots` | 1 slot |
| `readRuntimeProjection` | 0 attempts (valid empty) |
| `readCodeSpaceSummary` | 0 summaries (valid empty) |
| `readExecutionPreference('w1')` | `w1 host daemon-default-no-store (phase-1b seed)` |

Go tests: attempts/codespace/preference handlers parse-checked, safe-field scan
applies, `go build ./...` green.

## Next (S12 phase 2)

Replace the memory slot source with the real `internal/orca` / `internal/reconcile`
projection (needs the orca store + migrations), then close the coverage sweep.
S10/S11 chains and controls untouched.

JOB_DONE: S12 Phase 1 + 1b go-plane surface wired and proven end-to-end.