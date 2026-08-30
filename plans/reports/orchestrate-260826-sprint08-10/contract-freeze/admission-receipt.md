# Sprint 08 coordination admission receipt

- Observed: 2026-08-26 20:42:12 +07:00
- Contract package: `news-os.sprint08.contract-freeze` revision `1.0.0`
- Decision: **GO for one physical producer slot only**
- Scope: coordination admission only; this receipt does not dispatch a worker, create a worktree, register a migration, edit product code, or alter a release flag

## Gate inputs

- The promoted coordinator plan and all five linked phase files are present in this worktree.
- The contract-freeze package defines disjoint S08-A/B/C ownership, strict privacy fixtures, rollback boundaries, and a single shared-registration boundary.
- The independent arbiter verified the package hashes and contract coverage, returning HOLD only while promotion, live capacity, fresh dispatches, integration ownership, and first-ID approval remained unresolved.
- Promotion is now evidenced by current local plan/phase bytes; live admission and ownership decisions are recorded below.

## Bounded live OLC evidence

No credential value, capability value, environment value, raw transcript, or terminal output is reproduced in this receipt.

| Signal | Observation | Admission consequence |
|---|---|---|
| CPU | 6% aggregate load at sample time | Healthy headroom |
| Physical memory | 15.70 GiB total, 2.27 GiB free, 85.5% used | High pressure; do not admit parallel producer processes |
| System disk | 953.0 GiB total, 368.1 GiB free, 61.4% used | Healthy worktree/build headroom |
| Relevant processes | 3 Codex processes (0.37 GiB), 15 Node processes (0.73 GiB), and 9 Orca processes (1.69 GiB) at sample time | Existing load is non-zero and reinforces a one-slot cap |
| Orca worker accounting | Current Run: 6 retained/accounted terminals (4 retained, 2 release-unknown); 3 completed, 2 failed, 1 dispatched context. Global supervised terminals in `active` state: 0 | No active supervised producer consumes a slot, but retained/release-unknown accounting must not be treated as clean capacity for multiple writers |
| Codex preflight | `codex-cli 0.149.1`; authentication status succeeded; live help exposes headless `exec`, cwd, sandbox, approval, JSON capture, and last-message output controls | Available for one bounded, isolated producer dispatch; external timeout and current-worktree controls remain mandatory |
| MemoraX health | Repository scope is bound; configuration is present; search and add capabilities report enabled; retrieval injection is disabled by configuration | Healthy as advisory memory only; it supplies no execution authority and no raw memory was read |

The limiting signal is memory, not CPU or disk. **Admit one physical producer slot now. Do not admit a second or third producer concurrently without a fresh OLC sample showing materially improved memory headroom and reconciled terminal accounting.** The three logical lanes remain valid and may execute sequentially through the one physical slot.

## Frozen authority decisions

Exactly one logical role is named for shared integration: **Sprint 08 Integration Writer**.

That role alone may publish shared DTO exports or register accepted migration fragments after producer bytes stop changing and their receipts are hash-pinned. It owns no producer implementation and is not a second concurrent producer slot.

The following first reserved identifiers are approved for their named owners, but remain **unregistered** until valid fragments and receipts exist:

| Owner | Approved first ID |
|---|---|
| S08-A | `s08a_001` |
| S08-B | `s08b_001` |
| S08-C | `s08c_001` |
| Sprint 08 Integration Writer | `s08i_001` |

Approval does not permit reuse, cross-lane schema ownership, or direct edits to shared registries by a producer.

## Safety state

- `SEN_CHAT_LEGACY_WRITER` remains disabled; no legacy-writer change is authorized.
- Phase 21 remains blocked; no command-authority cutover or release transition is authorized.
- Sprint 08 community contribution remains local-only; no upload or publication is authorized.

## Remaining prerequisites

Before the admitted physical slot performs producer work, the coordinator must:

1. Select one logical producer lane for the slot and create a fresh lane-scoped Orca Task, Dispatch, and isolated worktree from the promoted base.
2. Copy that lane's exact ACTIVE/NEXT/FALLBACK assignment and allowed write set into the dispatch contract.
3. Require current-byte receipts, focused executable validators, and an independent lane arbiter before integration.
4. Recheck legacy-writer disabled and Phase 21 blocked at dispatch and again at receipt acceptance.
5. Re-run bounded OLC evidence before admitting any additional concurrent physical producer.

These are execution steps, not blockers to the one-slot admission decision itself. If the fresh Task/Dispatch/worktree cannot be created with the frozen ownership boundary, or if live pressure worsens before launch, this GO automatically returns to HOLD.

Status: DONE_WITH_CONCERNS
