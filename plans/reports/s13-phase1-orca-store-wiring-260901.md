# S13 Phase 1 — orca-store projection receipt

## Status
**DONE** (master). `cmd/sen-plane` now projects `/api/v1/runtime/slots` and
`/api/v1/runtime/attempts` live from the durable orca store; DTOs reused from
`internal/orca` (no duplication). Codespace summary stays valid-empty and
execution-preference reflect-only (documented ponytail deferrals).

## Evidence
- Store root: `SEN_PLANE_STORE_DIR` → `AGENTIC_OS_HOME/sen-plane/store` →
  `%LOCALAPPDATA%\NEWSOS\sen-plane\store` → home fallback. Fail-closed at
  startup on open/migrate error (exit 2, no memory fallback).
- Fresh store boot probe: `/healthz → {"status":"ok"}`,
  `/api/v1/runtime/slots → {"dto_version":1,"lab_enabled":true,"slots":[]}`;
  migrations created `orca-runtime.db`.
- `go build ./...`, `go vet ./...`, `go test ./cmd/sen-plane ./internal/orca`:
  green. Tests cover empty-fresh DTOs (non-nil `[]`), live dispatch→slot
  (`launching`, attempt_ref), attempts projection incl. terminal statuses.
- Projection errors → HTTP 503 (fail closed, never partial success).

## ponytail notes
- `orca_dispatches` has no builder_id; terminal handle stands in for
  builder_id/pane_id until a column lands.
- lease_generation = reattach+1 (always ≥1 per the TS validator).
