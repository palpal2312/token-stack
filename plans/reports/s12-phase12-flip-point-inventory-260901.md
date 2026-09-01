# Phase 12 flip-point inventory (2026-09-01)

Panel: pre-cutover arbiter verdict `s12-phase12-precutover-arbiter-verdict.md`
(LEGACY-REMAINS-OPEN). Real distinct legacy writer exists; nothing flipped;
`legacy_writer: disabled` and `phase_21: blocked` remain.

## Legacy writer (current when flag set)
- `src/app/api/firstmate/chat/route.ts` + `src/lib/sen-sessions.ts` +
  `src/lib/builders/history.ts` — FirstMate SEN-chat JSONL transcripts
  under `~/.agentic-os/agents/`.
- `src/app/api/sen/chat/route.ts` — explicit delegation: `if
  (process.env.SEN_CHAT_LEGACY_WRITER === "1")` (lines 30/54/102/153); default
  OFF (absent ⇒ false). Comment 18: "explicit rollback flag …, never silently
  dual-write".

## Canonical writer (target)
`go/internal/localdb/product/{chat,store,database}.go` + community sqlite_store
+ orca store. `src/app/api/sen/chat/route.ts:42` confirms "canonical chat is
not configured" in-repo — canonical Go chat wiring is a live-host step.

## Flip-point ledger (all OFF by default; do NOT enable without owner GO)
| Flip | Control | Current |
|---|---|---|
| SEN_CHAT_LEGACY_WRITER delegation | env only; `=== "1"` | OFF (absent) |
| legacy_writer invariant | semantic string; 0 `enabled` hits in src/go | disabled |

## Owner live-host sequence (to close Phase 12)
1. onboarding-host.ps1 → fix FAILs (env names incl. canonical chat config).
2. ops-prep 1a-1g provisioning; watchdog install+enable; backup second volume.
3. Freeze release bytes; pre-cutover backups pinned.
4. Wire canonical Go chat on the host (the "canonical chat is not configured"
   gap). Live canary with real SLO/RPO/RTO.
5. Atomic cutover: SEN_CHAT_LEGACY_WRITER confirms canonical; write-verify new
   adapter canonical + JSONL inert; retire/inert the FirstMate fallback.
6. Evidence chain → Phase 12 arbiter GO → CLOSED_GO → Finalize (gated).
Rollback: unset flag / restore branch. Any failure → NO_GO, legacy stays
disabled.

JOB_DONE: flip-point inventory recorded; cutover executes only on the owner's
live host.
