# S13 Close Gate — Independent Arbiter Verdict

## Authority and decision

Independent arbiter for the S13 close gate (orca projection / desktop-shell
preview / debt scope), reviewing committed evidence at master `d3eb963`
(`fix(web): parser suite valid payload gains reason: null`), working tree clean
(0 modified). Not the packet author; read-only scrutineer.

**Decision: GO** for S13 close, per the decision rule: focused suites pass,
go plane green, `tsc` zero, S10/S12 chains intact, and all protected controls
hold — each verified independently below against current bytes at HEAD.

**Scope of this GO:** closes the S13 projection/preview/debt scope only —
(1) `cmd/sen-plane` serving `slots`/`attempts` live from the durable
`internal/orca` store (memory seed gone), (2) desktop-shell preview exercised
on a staging (loopback) seat via env flip, (3) the recorded debt pass. This GO
does **NOT** authorize release, cutover, legacy-writer enablement, Phase 21, or
the production desktop-shell flip — those remain owner-approved gates (Phase 12
cutover untouched).

## Checks actually run (with outcomes)

| # | Check | Outcome |
|---|-------|---------|
| 1 | Evidence read: `plans/260831-2154-s13-orca-projection-and-preview/plan.md`, `plans/reports/s13-phase1-orca-store-wiring-260901.md`, `s13-phase2-preview-enable-260901.md`, `s13-phase3-debt-260901.md` | Receipts DONE/JOB_DONE; phase 1 store projection live (fail-closed 503), phase 2 preview on dev host only with "Production flip NOT performed", phase 3 tsc baseline 0 (was 9) |
| 2 | `npx --no-install tsx --test` shell suite (7 files: view-session-store, intent-prefetch, desktop-shell-flag, panel-layout-store, panel-resize-controller, sen-surface-store, desktop-module-registry) | **pass 20 / fail 0** (expected 20) |
| 3 | `npx --no-install tsx --test src/lib/agentRuntime/orca-slot-client.test.ts` | **pass 3 / fail 0** (expected 3) |
| 4 | `npx --no-install tsx --test qa/tests/s10-*.test.ts` | **pass 33 / fail 0** (expected 33) |
| 5 | `cd go && go build ./...` | **BUILD_OK** (exit 0) |
| 6 | `cd go && go vet ./...` | **VET_OK** (exit 0) |
| 7 | `cd go && go test ./internal/... ./cmd/sen-plane` | **all ok** — 14 internal packages + `cmd/sen-plane` green (adapter, admission, allocator, builderexec, localdb/{community,core,handoff,product}, memory, orca, reconcile, runlearning, sandbox, scheduler, cmd/sen-plane) |
| 8 | `npx --no-install tsc --noEmit -p tsconfig.json` | **0 errors** (exit 0) |
| 9 | `newos-receipt-verify.ps1` on `plans/reports/sprint10/s10-phase5-closeout-receipt.md` | **PASS** (1 JOB_DONE marker, 8/8 SHA-256 hashes match) |
| 10 | `newos-receipt-verify.ps1` on `plans/reports/sprint10/s10-phase5-current-byte-close-packet.md` | **PASS** (1 JOB_DONE marker, 25/25 SHA-256 hashes match) |
| 11 | S12 close chain intact | **INTACT** — `plans/reports/s12-go-independent-arbiter-verdict.md` present, DECISION: GO; `plans/reports/s12-CLOSED_GO-record.md` present |
| 12 | Controls grep `legacy_writer: enabled` / `phase_21: enabled` in `src/` and `go/` | **0 hits** both keys, both trees (broader `'enabled'` scan also 0 hits) |
| 13 | `desktop_shell_v2` default OFF | **CONFIRMED** — `src/shell/desktop-shell-flag.ts` returns false when env unset; env-only (`DESKTOP_SHELL_V2`), request-time read; no query/view path |
| 14 | Production preview flip | **NOT performed** — phase 2 receipt states it explicitly; repo default stays OFF |

## Current-byte pins (sha256sum at HEAD d3eb963)

```
532bb7673ed3ea28fb515ca73c9b7dee7cda154d03a58264e999a09136cfc5ea  plans/260831-2154-s13-orca-projection-and-preview/plan.md
ea472d9c69e216b4bd6aff78cf373d839fe09a1df5a9bfcf822b8ce242c8c809  plans/reports/s13-phase1-orca-store-wiring-260901.md
8a17fb8e609247ac359b08b7f976e44300d3546d90f4788ab93a92d3ad22c299  plans/reports/s13-phase2-preview-enable-260901.md
95aef37285c457638ed35a1a22f8ec6f45fcae60b1f076f4180d6e473a909b3f  plans/reports/s13-phase3-debt-260901.md
881d1a9200935bc1232c88a2908044c8fae189cfc2a6f1a1783424df2e8894c8  plans/reports/s12-go-independent-arbiter-verdict.md
54e03ffa51b001c7ac50edd5fb0cb61eaaeccd17e4fc7d6a067c762b6e8e5c72  plans/reports/s12-CLOSED_GO-record.md
b3beb0dc084b5c58bea0c0d91060d1ad03425b04fd1391ac88c0e9a39e37acec  src/shell/desktop-shell-flag.ts
3078e1883e877436fda1a7afb06ceb7945cbb664335ec97df62b1cd0a283a865  go/cmd/sen-plane/main.go
```

S10 chain byte-pins reverified via receipt-verify (not restated here); closeout
receipt pins close-packet `72d07cd3…` and the packet pins its 25 artifacts, all
matching at HEAD.

## Protected controls

- `legacy_writer: disabled` — 0 `legacy_writer: enabled` hits in `src/`/`go/`.
- `phase_21: blocked` — 0 `phase_21: enabled` hits in `src/`/`go/`.
- Phase 12 cutover / retirement / release / production desktop-shell flip — out
  of scope, untouched; this GO authorizes none of them.
- Memory seed gone: 0 `memorySlotSource` hits in `go/`; `cmd/sen-plane/main.go`
  opens `orca.Store` via `SEN_PLANE_STORE_DIR` (fail-closed on open/migrate).

## Observations (non-blocking)

- Phase 2 receipt exercises the preview on the dev host (loopback seat); SLO
  probe window is documented as the staging-host step (ops-prep 1d), not yet
  exercised in S13. Noted; does not fail the decision rule and does not widen
  the GO scope.
- `sen-plane` dev-loop spawn wiring recorded as follow-up debt in the phase 3
  receipt (daemon runs standalone + covered by CI test-evidence paths).

JOB_DONE: S13 close-gate arbitrage complete — GO (scope = projection/preview/debt only).