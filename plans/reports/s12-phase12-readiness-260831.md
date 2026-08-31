# Phase 12 readiness record (2026-08-31)

## Owner decision: budget approved

On 2026-08-31 the owner approved the Phase 12 cutover budget scaffold from
`plans/260831-0206-s12-phase12-cutover-pack/ops-prep.md` (§2, ~USD 13 for a
7-day window, contingency included). This satisfies the Phase 12 gate
contract entry condition "New plan + budget approved by the owner".

Still REQUIRED from the owner before execution: the live environment
(staging host distinct from any controlled checkout), the local `%LOCALAPPDATA%\NEWSOS` probe, and the watchdog install (`scripts/install-controller-failover-task.ps1`). Pre-cutover arbiter READY comes after provisioning.

## Legacy canonical-write surface inventory (current-byte pins)

`legacy_writer` is an invariant string/assertions (no runtime toggle): display
in the orchestration dashboard and fail-closed assertions in the live-runtime
drill. The canonical-write surface to be switched/retired at cutover is the SEN
chat write path and the localdb store layer:

| Path | SHA-256 (prefix) |
|---|---|
| `src/app/api/sen/chat/route.ts` | `d9fee7f296cb631f` |
| `src/app/orchestration/page.tsx` | `461b27b7dca7d670` |
| `scripts/s10-live-runtime-drill.ts` | `6ef0fdd0dd3d5293` |
| `go/internal/localdb/community/sqlite_store.go` | `8a9e276337e18fe7` |
| `go/internal/localdb/product/database.go` | `126c61c737e9329b` |
| `go/internal/localdb/product/chat.go` | `fcf9e5141854f68f` |

## Local preflight evidence (this checkout, master)

- `go build ./...` + `go vet ./...`: pass.
- `git status --porcelain`: empty (clean tree).
- `scripts/controller-failover.ps1` + `install-controller-failover-task.ps1`: present.
- S10/S11 chain receipts: unaffected (no chain paths touched).

JOB_DONE: Phase 12 readiness advanced — budget approved, legacy-surface
inventory pinned, local preflight green; live environment provisioning is the
remaining owner gate before the cutover runbook executes.