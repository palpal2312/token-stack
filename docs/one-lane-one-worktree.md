# One lane, one worktree

The convention for Orca lifecycle lanes since Sprint 10: **one lifecycle lane =
one git worktree**, and the **worktree dir basename == lane id == branch name**.

Lane-id grammar (mirror of `isLaneId` in `src/lib/orchestration-state.ts`):

    ^(lane-[a-z0-9-]+|s\d{2}-[a-z0-9-]+)$

The global report hook (`~/.claude/hooks/lane-report.cjs`) derives the lane id
from the session cwd basename — new lanes need no registration. The board
(127.0.0.1:3740/orchestration) is journal-driven and picks lanes up when they
write lifecycle events; nothing in this convention changes board code.

## Exemptions

- **Master checkout** (`Documents\Agent OS\source`, branch `master`) is not a
  lane. It hosts the dev server and is the promotion target; its session gets
  the master report template.
- **Scratch/verifier trees** (detached HEAD, e.g. `s09-b2-clean-verifier`) are
  not lanes. A scratch dir whose name matches the lane grammar will still
  receive the lane template via derivation — ignore it there, and never write
  lifecycle events from a scratch tree.

## Legacy overrides (dir != lane id)

Kept in `LEGACY_OVERRIDES` in the hook; drop a row when its worktree is removed.

| worktree dir | lane id |
|---|---|
| `s09-snapshot-return` | `lane-a` |
| `s09-controlled-delivery` | `lane-b` |
| `s09-close-gate-audit` | `lane-c` |

Sprint-02 dirs (`source-sprint-02-lane-N`) predate the journal and stay
unmapped/silent.

## Creation contract

Whoever creates a lane worktree (orca dispatch) must name the dir and the
branch exactly after the lane id. The orchestrate-* run `state.json` records
the same dir in its per-lane `worktree` field.

## Removal procedure

1. Run the advisory gate: `scripts\lane-worktree-gate.ps1 -Lane <lane-id>`.
2. `SAFE` (exit 0): remove the worktree (`git worktree remove <dir>`), then
   delete the branch if nothing else needs it.
3. `NOT SAFE` (exit 2): promote the missing evidence to master first
   (commit-only guarded promotion), re-run the gate, and keep the branch until
   the gate says SAFE.

The gate is advisory: it never blocks any git command. It answers one question
— is everything this lane proved already in master HEAD?
