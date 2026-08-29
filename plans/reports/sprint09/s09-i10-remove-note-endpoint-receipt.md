# S09-I10 Remove Note Endpoint Receipt

- Task: task_62afef5e8272 (dispatch ctx_1251bb05fe55)
- Date: 2026-08-30 (Asia/Saigon)
- Actor: palpal2312 (integration owner, master checkout C:/Users/ADMIN/Documents/Agent OS/source)
- User approval: YES — this removal is the user-approved I10 scope, dispatched verbatim by the controller ("User-approved scope: remove the unapproved mutable orchestration note endpoint and restore API GET-only behavior as I7 specified").
- Product commit: fc3cafbf9de57a96c994699cdcfb19b2fbfebeb7 on master (parent f97f5e4719058616799404503c00b84c4571721f). Not pushed.

## 1. Scope executed (exactly the allowed changes)

1. Deleted `src/app/api/orchestration/note/route.ts` (old blob ea42b23ed44cd38a32afa89b640f6ef31d55e79f) — the unapproved mutable endpoint (POST with `appendNote` write), introduced after I7 in f26f01a. Empty `note/` directory removed.
2. Edited only the obsolete POST-note instructions in `scripts/orchestration-state-event.ps1` (comment block): removed the `Invoke-RestMethod -Method Post .../api/orchestration/note` examples for master situation/close and lane run/next card lines; script now documents controller-only JSONL state events and GET state reads, with no POST API guidance. Old blob 42d3ecccc6b8c8fc8b3ddf47b8f86193034d2877 -> new blob 4da4131ff9392e800b04178e2d8f8541ef2b4584.

Nothing else altered: `src/lib/orchestration-notes.ts`, orchestration board/page/state route, journal behavior, contracts.ts, manifests, DTOs, migrations, legacy writer, Phase 21, and all unrelated dirty/staged/untracked master state are untouched. Grep across the repo (excluding node_modules) confirms no remaining `orchestration/note` reference anywhere.

## 2. Real-index baseline (before/after identical)

- Real staged index BEFORE: 1898 entries, content hash f84ed3633c63d0a16bfeebd63cc53ad65570e5fc.
- Real staged index AFTER product commit: 1898 entries, content hash f84ed3633c63d0a16bfeebd63cc53ad65570e5fc (byte-identical; re-verified again after receipt commit below).
- Pre-existing dirty state preserved as found, including staged deletions of `src/app/api/orchestration/note/route.ts` and `src/lib/orchestration-notes.ts` with both re-present as untracked worktree files — not mine to resolve; the temp-index commit below records the removal relative to HEAD only.

## 3. API route surface proof (orchestration, HEAD-committed)

- BEFORE (f97f5e4): `src/app/api/orchestration/note/route.ts` exports GET,POST; `src/app/api/orchestration/state/route.ts` exports GET.
- AFTER (fc3cafbf): only `src/app/api/orchestration/state/route.ts` exists, exports GET. No non-GET handlers remain on the orchestration API surface — I7 GET-only behavior restored.

## 4. Isolated commit procedure (real index untouched)

Temp index via `GIT_INDEX_FILE=<temp>`: `git read-tree f97f5e4` -> `git update-index --force-remove src/app/api/orchestration/note/route.ts` -> `git hash-object -w` the edited script + `git update-index --cacheinfo 100644,4da4131f…,scripts/orchestration-state-event.ps1` -> `git write-tree` = ecabbd1401e181e2043469c111d1302709458b14 -> `git commit-tree` with parent f97f5e4 -> `git update-ref refs/heads/master fc3cafbf… f97f5e4…` (CAS; any concurrent master advance would have failed). Temp index deleted. No reset/checkout/clean/stash/merge/amend/push, no unrelated staging.

## 5. Post-commit verification

- `git show --name-only fc3cafbf` => exactly `scripts/orchestration-state-event.ps1` and `src/app/api/orchestration/note/route.ts`.
- Committed script blob SHA-256 0dce40da6cc6526566286dc0152e662ecda8cf7541151c4d22954edead3af14f == worktree file hash (byte-identical; prior worktree hash 79675fba637154cfcdb3d0e3b5b9c581f8fe56565a7a7dc0bc4c4195e9273805).
- `git diff --check f97f5e4..fc3cafbf` => clean (privacy/diff check; no secrets, no whitespace damage).

## 6. Validation (master bytes)

- `npx --no-install tsc --noEmit` (repo-pinned TypeScript 5.9.3) => exit 0, no output.
- `npx --no-install tsx --test src/lib/__tests__/orchestration-state.test.ts` => 20/20 pass; `orchestration-board.test.ts` => 3/3 pass.
- Live preview (existing dev server PID 7656 on 127.0.0.1:3740, loopback only, serving this worktree with hot reload; AGENTIC_OS_HOME=/tmp/orch-preview-home):
  - `GET /api/orchestration/state` => 200, envelope `{schemaVersion, requestId, result, error}` with lanes/events/notes.
  - `POST /api/orchestration/state` => 405 (GET-only preserved).
  - `GET /api/orchestration/note` => 404 (route removed).
  - `POST /api/orchestration/note` (valid-shaped body `{"text":"i10 probe must not persist","field":"situation"}`) => 404 with NO WRITE: notes journal `/tmp/orch-preview-home/orchestration-notes.jsonl` byte-identical before/after (SHA-256 ca0beefa09a4dcec79200eb665539addc1ea374eacb97f8a2ce0270f22bf7de1, size 1723, mtime unchanged).
  - `GET /orchestration` => 200, banner renders `no execution authority`, `legacy_writer: disabled`, `phase_21: blocked`.
- A second dev-server instance could not be started (Next 16 single-dev-server lock per project dir); validation ran against the existing controller-sanctioned preview, which serves current worktree bytes. Left PID 7656 running as found.

## 7. State protocol (post-I10)

- Writes: controller-only JSONL state events via `scripts/orchestration-state-event.ps1` (requires `ORCHESTRATION_CONTROLLER=1`; validated state machine, redaction markers, atomic mkdir writer lock). No HTTP write endpoint exists.
- Reads: `GET /api/orchestration/state` (full) or `?compact=1` (cards + situation/close + lastWrite, short keys) or `?compact=state` (statuses/counters/lastWrite only). Page `/orchestration` is read-only.
- Master situation/close and lane run/next card lines are historical notes data served read-only via the state GET; new state flows only through controller JSONL events.

## 8. Current hashes

- Master HEAD: fc3cafbf9de57a96c994699cdcfb19b2fbfebeb7 (product commit).
- HEAD tree: ecabbd1401e181e2043469c111d1302709458b14.
- Parent (pre-I10 HEAD): f97f5e4719058616799404503c00b84c4571721f, tree 3a892fe0f9a3aed6f324751cdaba432b2c515212.
- This receipt lands as a separate temp-index commit on top of fc3cafbf (same CAS procedure); see `git log -2` on master.

## 9. Rollback

`git update-ref refs/heads/master f97f5e4719058616799404503c00b84c4571721f <current>` then restore the two paths from f97f5e4 if file restoration is wanted. Real staged index and unrelated dirty/untracked state unaffected either way.

## Controls

`legacy_writer: disabled` (untouched, live-verified on page banner); `phase_21: blocked` (untouched, live-verified); no migrations/DTO/manifests/contracts changes; single writer via CAS; no push, no merge; unrelated staged/dirty/untracked master state preserved (real index byte-identical before/after). This receipt records the user-approved removal only and issues NO GO for anything beyond it.

Status: DONE; Summary: Deleted the unapproved mutable note endpoint (fc3cafbf on master via temp index, parent f97f5e4) and stripped POST-note guidance from the state-event script, restoring the I7 GET-only orchestration API; tsc clean, 23/23 orchestration tests pass, live checks show state GET 200 / note POST 404 with no write / page banner intact, real index byte-identical. Concerns/Blockers: none for this scope; the pre-existing staged deletions of the note route and orchestration-notes.ts in the real index remain as found (unrelated dirty work, out of scope). NO GO issued.
