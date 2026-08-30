# Sprint 10 receipt — orchestration board sprint-aware fix

**Date:** 2026-08-30 (+07)
**Writer:** lane-c (s09-close-gate-audit, close-gate audit lane)
**Fix commit:** `dc77a5cde54224169845410fef386e8012af57f5` (master)

## Problem

`http://127.0.0.1:3740/orchestration` stayed Sprint-09-hardcoded while Sprint 10
ran six distinct lanes:

1. Roadmap said `current: 9` — stale `run-manifest.json` (s09 active / s10 gated)
   outranked the real record on disk.
2. Board tracks were hard-coded to three S09 seats (`lane-a/b/c`, `TRACK_LANE_IDS`,
   `TRACK_LABELS`, `LANE_IDS`); sNN- lane ids could never render.
3. Preview dev server read the sandbox home (`%LOCALAPPDATA%\Temp\orch-preview-home`),
   not the official journal at `~/.agentic-os`.
4. `lane-report.cjs` hook had no Sprint-10 worktree mapping.

## Fix (dc77a5c)

- `deriveSprintRoadmap`: `plans/reports/sprintNN/` folders now override run-manifests
  (`close-gate-record.md` containing `CLOSED_GO` closes; `opening-manifest.md` opens).
- `isLaneId` generalized to `^(lane-[a-z0-9-]+|s\d{2}-[a-z0-9-]+)$`; one card per
  lifecycle lane; cards scope to the current sprint's lanes (fallback: all lifecycle
  lanes). S09 legacy rendering preserved via `LEGACY_TRACK`.
- API route derives roadmap + cards together so cards track `sprint.current`.
- `scripts/orchestration-state-event.ps1` `-Lifecycle` guard mirrors the generalized
  `isLaneId` (lane-* and sNN-* accepted).
- `~/.claude/hooks/lane-report.cjs`: six s10 worktrees mapped; home defaults to
  `%USERPROFILE%\.agentic-os`.
- Preview dev server restarted with no `AGENTIC_OS_HOME` override → reads official home.

## Journal reconstruction (13 events, writer `lane-c`)

Appended to the official append-only journal `~/.agentic-os/orchestration-state.jsonl`
via the controller-gated writer (`ORCHESTRATION_CONTROLLER=1`), timestamps taken from
git reflog/commit times (+07), evidence pairs from master-HEAD bytes:

| Lane | RUNNING | DONE evidence (sha256, first 8) |
|---|---|---|
| lane-c (I12 close) | — | `6c3c4977…` s09-i12-get-only-ping-correction-receipt.md |
| s10-evaluation-opening | 05:12:34 | `c437224b…` s10-evaluation-opening-manifest.md |
| s10-plan-input-recovery | 10:13:33 | `256d51f4…` phase-05-sprint-10-evaluation-operations-and-close-gate.md |
| s10-readonly-canary | 10:18:37 | `28f2a7ec…` s10-readonly-canary-receipt.md |
| s10-recovery-operations-evidence | 10:34:33 | `886bfc13…` s10-offline-recovery-operations-receipt.md |
| s10-evidence-gap-ledger | 10:31:49 | `f8231ee9…` s10-evidence-gap-ledger.md |
| s10-independent-arbiter | 11:16:51 | `d45d07ef…` s10-independent-close-gate-arbiter.md (at branch tip `318bd13`, promotion pending) |

## Verification

- Focused tests: 24/24 pass (`node --import tsx --test` on orchestration-state +
  orchestration-board suites), including the new sprint-folder roadmap override test
  and the current-sprint card-scoping test.
- Live `GET /api/orchestration/state?compact=state`: `sprint {total:11, closed:9,
  doing:1, current:10}`; exactly six s10 cards, all `DONE`; lastWrite `lane-c`.
- Full GET: 16 lanes, 55 events, 6 cards; page `/orchestration` 200.
- GET-only invariant held: `POST /api/orchestration/note` → 404; no ping route.

## Standing constraints honored

- Journal append-only, controller-gated, redaction-checked; no rewrite.
- Read-only board surface unchanged in authority: GET-only, loopback-only.
- S09 close gate remains CLOSED_GO (arbiter); S10 close gate remains NO_GO —
  this receipt changes no gate verdict.
