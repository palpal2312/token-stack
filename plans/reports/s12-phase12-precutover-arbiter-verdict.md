# S12 Phase 12 Pre-Cutover Independent Arbiter Verdict

## Authority

Independent, read-only pre-cutover arbiter for the Phase 12 gate
(`plans/260831-0115-s12-phase12-cutover-gate/plan.md`), reviewing committed
bytes at master `d09d5db` from a fresh session not involved in authoring the
gate/runbook/ops-prep. No commits, no flips, no product-code edits made. This
report returns a READY-equivalent verdict on whether Phase 12 still has a
target in this repo, or is satisfiable by absence.

## Verdict

**LEGACY-REMAINS-OPEN** — a real, distinct legacy writer surface exists in this
repo and is the documented target of the Phase 12 cutover/retirement. The gate
is not satisfiable-by-absence; it requires the owner-provisioned live host and
the runbook execute. The `legacy_writer: disabled` invariant is a semantic
string with no enabling implementation, and nothing in this report flips it.

## Inventory actually run — every path that writes canonical SEN chat product data

| # | Path | What it writes | Bucket |
|---|------|----------------|--------|
| 1 | `go/internal/localdb/product/chat.go` | SQL INSERT/UPDATE into `sen-product.db` (`sen_session_turns`, `sen_chat_attempts`, `command_receipts`, `sen_chat_events`, `sen_runtime_checkpoints`, `sen_sessions`) — SendTurn/CompleteAttempt/checkpoint routines | **Canonical current writer** (Go product store) |
| 2 | `go/internal/localdb/product/store.go` | SQL INSERT/UPDATE into `sen-product.db` (`sen_messages`, `command_receipts`, `export_candidates`) | **Canonical current writer** |
| 3 | `go/internal/localdb/product/database.go` | Opens the canonical `sen-product.db` | **Canonical current writer** (open/owner) |
| 4 | `go/internal/localdb/community/sqlite_store.go` | SQL INSERT/UPDATE into `community-queue.db` (sanitized contributions, delivery attempts) | **Canonical current writer** (community store) |
| 5 | `go/internal/orca/store.go` | SQL INSERT/UPDATE into `orca-runtime.db` (dispatches, capability pins) | **Canonical current writer** (orca store) |
| 6 | `go/cmd/sen-plane/main.go` | HTTP daemon; serves `/api/v1/runtime/slots`, `runtime/attempts`, `codespace/summary`, `workspace/{id}/execution-preference` (PUT reads/writes no durable store yet — reflect-only). **Serves NO `/v1/sen/chat/*` handlers in-repo** | Canonical projection surface; canonical chat HTTP wiring is NOT in this repo |
| 7 | `src/app/api/sen/chat/route.ts` | Routing gate: Go-configured + flag off → proxy `/v1/sen/chat/*`; flag on → delegate to legacy FirstMate; unconfigured+off → 503 | **Gate / canonical router** — explicitly documents "The legacy FirstMate writer stays ONLY behind the explicit rollback flag `SEN_CHAT_LEGACY_WRITER=1`" |
| 8 | `src/app/api/firstmate/chat/route.ts` | Legacy SEN chat writer: `createSession`/`touchSession`/`appendTurn` → transcript JSONL under `~/.agentic-os/agents/firstmate-*/chat.jsonl` + `sessions.json` index (`src/lib/sen-sessions.ts`, `src/lib/builders/history.ts`) | **Distinct legacy writer** — file/JSONL transcript store, separate from SQLite |
| 9 | `src/app/api/builders/[id]/chat/route.ts` | Also `appendTurn` → JSONL transcripts (generic builder chat, same legacy history mechanism) | **Distinct legacy writer surface** (same JSONL history store) |
| 10 | `src/app/api/sen/route.ts`, `firstmate/route.ts`, `firstmate/agent|config|models|threads|…` | Legacy FirstMate overview/metadata routes aliased by the `sen/*` read surface | Distinct legacy compatibility surface |

Grep of `src/` + `go/` for SQL writes / file writes confirms no other writer of
SEN chat product data exists: kanban (`node:sqlite`) is explicitly read-only
(`readOnly: true`); `src/app/api/*` file writes (hy3coder, codex, omniroute,
sakana, …) are per-feature artifacts, not SEN chat canonical data.

## Item 2 — the second writer the gate is meant to retire

The gate's own readiness record (`plans/reports/s12-phase12-readiness-260831.md`)
pins "the legacy canonical write surface" as the SEN chat write path + localdb
store layer (sen/chat route, product/database+chat, community store, drill,
dashboard). The runbook step 6 says: "**Retire legacy**: only after N clean
observation cycle, retire the disabled legacy writer path (remove/`inert` the
surface), second write-verification."

The **real second writer** in code behind that surface is the **FirstMate JSONL
transcript writer** (`src/app/api/firstmate/chat/route.ts` +
`src/lib/sen-sessions.ts` + `src/lib/builders/history.ts`) plus the
`SEN_CHAT_LEGACY_WRITER` delegation branches in `src/app/api/sen/chat/route.ts`
(lines 30, 54, 102, 153, 164 — GET/POST/PATCH/DELETE). It is present,
functional, has its own durable store (JSONL files, not SQLite), and is
explicitly labelled legacy by the canonical route's own comment. It is the
removable predecessor superseded by the Go product store.

## Item 3 — invariant string has no enabling implementation (verified)

- `grep "legacy_writer: enabled" src/ go/` → **0 hits** (both trees).
- `grep "phase_21: enabled" src/ go/` → **0 hits**.
- Only runtime reference is the invariant banner
  `src/app/orchestration/page.tsx:209` (`legacy_writer: disabled; phase_21:
  blocked`) and the semantic stamp in the S10 drill receipt
  (`legacyWriter: "disabled"` in `scripts/s10-live-runtime-drill.ts` +
  `s10-live-runtime-receipt.json`), plus plan/receipt docs.
- The `legacy_writer` string is a *semantic* invariant, not a runtime toggle.
  The runtime rollback gate that would re-enable a legacy writer is the separate
  env var **`SEN_CHAT_LEGACY_WRITER=1`** — matched in code only inside
  `src/app/api/sen/chat/route.ts`. Default is off; fail-closed otherwise. This
  is exactly the "wrong-direction flip" hazard the ops-prep risk register flags
  (§5): the gate's docs describe the atomic step as a flag flip while the
  runtime knob is an env-var delegation gate.

## Item 4 — canonical writer is the current stack, but the legacy predecessor is not yet retired

`go/internal/localdb/product` (SQLite `sen-product.db`) and `go/internal/orca`
(`orca-runtime.db`) are the current canonical writers — there is no older module
writing the same SQLite product data. However, the SEN chat transcript product
data still has a **second, separate, live durability surface** (FirstMate JSONL)
that the rewrite did **not delete**: it was kept behind the rollback flag per
Phase 08b C4 / S03-L2, and no S11–S14 record claims it was inerted. The rewrite
consolidated *Go writers* (orcaslots→orca naming, spec API cut) but did **not**
retire the TS FirstMate chat writer.

## Why not NO-LEGACY (honesty check)

- The current canonical route still imports and delegates to the FirstMate
  writer under a runtime flag — proof the legacy path is live code, not a stub.
- No removal/inert receipt for the FirstMate JSONL chat surface exists in the
  S09–S14 chain (I10 removed the *orchestration note endpoint*, a different
  surface; nothing removed the FirstMate chat writer).
- The gate's own ops-prep/runbook were authored because a live-verifiable
  cutover was deferred — and the deployable target (FirstMate legacy surface +
  canonical Go chat wiring on a live host) is still present in the bytes.

## Remaining owner execution steps (the gate's target, unchanged)

On the owner-provisioned live staging host, per
`plans/260831-0206-s12-phase12-cutover-pack/runbook.md` +
`onboarding-host.ps1` + ops-prep §1a–1g:

1. Onboard the staging host (`onboarding-host.ps1`), fix FAILs (env names,
   `NEWSOS` dir, clone pinned clean); reinstall + enable the scheduled-task
   watchdog.
2. Provision per ops-prep: backup second volume, SLO probes ARMED (RPO/RTO
   thresholds set before canary), owner-only flip access, `%LOCALAPPDATA%\NEWSOS`
   write probe.
3. FREEZE: clone the pinned release bytes; record pre-cutover backup hashes +
   SHA-256 inventory of the pinned legacy write surface.
4. Run the runbook sequence on the live host: live canary (real SLO/RPO/RTO) →
   **atomic flip** (owner-only, single command; note the documented flip-polarity
   hazard — verify actual polled write-source state, not the config string) →
   write-verification (Go product store canonical on live host; FirstMate JSONL
   legacy inert) → **retire legacy** (inert, not delete) → post window.
5. Evidence chain: cutover receipt + live-canary receipt + rollback-drill
   receipt + security/privacy review receipt (no secrets), current-byte pinned.
6. Independent Phase 12 arbiter GO → `CLOSED_GO` record → controller Finalize
   (gated). Any gate failure → rollback branch → NO_GO, legacy stays/reverts to
   disabled.

## Protected controls (verified untouched by this report)

- `legacy_writer: disabled` — no `legacy_writer: enabled` in `src/`/`go/` (0).
- `phase_21: blocked` — no `phase_21: enabled` in `src/`/`go/` (0).
- `desktop_shell_v2` OFF by default; no flips, no commits, no file edits other
  than this report.

JOB_DONE: pre-cutover Phase 12 arbiter verdict recorded from current-byte
evidence — LEGACY-REMAINS-OPEN; the gate has a real target and requires owner
live-host execution of the runbook.