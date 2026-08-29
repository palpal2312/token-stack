# S09-I4 Controlled Delivery Promotion Receipt

- Task: task_62f217803a86 (dispatch ctx_8f31555c58b8)
- Date: 2026-08-29 (Asia/Saigon)
- Actor: palpal2312 <54031647+palpal2312@users.noreply.github.com>
- Source worktree: C:/Users/ADMIN/orca/workspaces/source/s09-controlled-delivery
- Source commit: 9e97018 (fix on top of feb8b7f; see §2 note)
- Source receipt: plans/reports/sprint09/s09-c2-controlled-delivery-receipt.md (Status: DONE)
- Promotion commit: 137887a2c0447709901bdf4f3d62bd220d8c0727 on master (parent 38c754c6f907ffb5b5f90ddfa626e54d8dee904e). Not pushed.

## 1. Source receipt validation

`newos-receipt-verify.ps1 -ReceiptPath plans/reports/sprint09/s09-c2-controlled-delivery-receipt.md -ProjectRoot <source worktree>` =>
verdict PASS, markers 1, 3/3 hashes MATCH (workflow.ts, workflow-graph.test.ts, graph-cases.json).
Candidate committed blobs at the source commit re-hashed (`git show <commit>:<path> | sha256sum`) — byte-identical to receipt pins.

## 2. Source bytes, preimages, ownership

- Master preimages checked BEFORE any master write, against source-commit parent preimage `38c754c`:
  - `src/lib/llmops/workflow.ts`: `git diff 38c754c -- <path>` EMPTY (worktree+index == preimage blob `bb9d901255c0f3e3bc4e6c89425873467039af1a`); no drift.
  - `src/lib/__tests__/workflow-graph.test.ts`, `qa/fixtures/sprint09/graph-cases.json`: ABSENT in preimage commit, ABSENT in master worktree, no status entries; no drift.
- Ownership: controlled-delivery lane-owned path (`src/lib/llmops/workflow.ts`) + focused test + lane fixture, exactly the allowed-path list. No API routes, shared DTOs, migrations, community, or snapshot edits.
- Note: first promotion attempt `7d69ee7` carried bytes that failed the repo-pinned TypeScript 5.9.3 check in this worktree (TS2352 cast at `workflow.ts:275`; the source worktree has no local `typescript` install, so its earlier `npx tsc` there ran a placeholder package and reported a void pass). The stale commit was rolled back (`update-ref` to 38c754c), the cast fixed through `unknown` in the source lane (commit 9e97018, 12/12 tests still PASS), the source receipt re-pinned and re-verified PASS, and promotion redone with the fixed bytes. This receipt supersedes that attempt.

## 3. Isolated commit procedure (master worktree and staged index preserved)

1. Pre-snapshot: `git ls-files -s` content hash `ad9440dd63dea362fd82145b7e7df224c8296b2fd5671a266d90df7525028a5b` (1893 staged entries), `git status --porcelain` hash `8c7aae3ac803062988ff1b3a4af33c773de5effb9fc32155dc471896b8b74848`.
2. Temp index via `GIT_INDEX_FILE=$(mktemp -u)` (real index never opened for write):
   `git read-tree 38c754c` -> `git update-index --add --cacheinfo 100644,<blob>,<path>` for the 3 blobs from source commit 9e97018
   -> `git write-tree` -> `git commit-tree` as palpal2312 with parent 38c754c -> `git update-ref refs/heads/master <commit> 38c754c` (CAS on old tip).
   Temp index deleted. No reset/checkout/clean/stash/merge/amend/push and no unrelated staging.
3. The 3 candidate files were copied into the master worktree and SHA-256 re-verified byte-identical to the receipt pins (required so this receipt verifies against current worktree bytes). Nothing else in the worktree was touched.
4. Unlike the I3 precedent, NO post-commit `git add` into the real index was performed: the task requires real-index before/after identity, so the phantom status entries are accepted and documented (§4).

## 4. Post-commit verification

- Commit path list (`git show --name-only`): exactly 3 paths — `qa/fixtures/sprint09/graph-cases.json`, `src/lib/__tests__/workflow-graph.test.ts`, `src/lib/llmops/workflow.ts`.
- Author/committer: palpal2312 <54031647+palpal2312@users.noreply.github.com>; parent 38c754c.
- Commit blob SHA-256 = worktree SHA-256 = receipt pins (hash block below), 3/3.
- Real staged index: `git ls-files -s` content hash AFTER = `ad9440dd63dea362fd82145b7e7df224c8296b2fd5671a266d90df7525028a5b` — IDENTICAL to before. Entry count 1893 unchanged.
- `git status --porcelain` after hash `80412aeaeede2c37f94fbb1302376deeff3fda7ecc9f55f4c763b163d207975f` differs from before ONLY in the 3 promoted paths' status lines: `MM src/lib/llmops/workflow.ts` (index holds preimage blob; HEAD+worktree hold candidate bytes) and `D  `+`??` pairs for the two new files (phantom staged-deletion because the preserved index lacks HEAD's new entries; worktree bytes present and hash-verified). All 84+ unrelated staged/dirty entries untouched.
- `git diff --check 38c754c..master` => clean.

## 5. Focused tests and type check (master worktree, final bytes)

```
$ npx tsx --test src/lib/__tests__/workflow-graph.test.ts
ℹ tests 12  ℹ pass 12  ℹ fail 0        # graph bounds + crash-resume/merge-safety, final bytes
$ npx tsc --noEmit                      # repo-pinned TypeScript 5.9.3, whole repo
(exit 0, no output)                     # clean, incl. dirty-tree state
$ git diff --check 38c754c..master      # clean
```

## 6. Current-byte SHA-256 (master worktree, post-commit)

```text
eaca3f85577d97b3175eec3617e41a6342d1dc4e6b54066bdea836e9ac24331f src/lib/llmops/workflow.ts
1946287ccb12a429bd7bb25cc9ef9445d5da3120fb6674876ccbd084fe2ff3e5 src/lib/__tests__/workflow-graph.test.ts
6b4fcd09987061b798a60d99b21062b2f69e0937c84fce7f56294211bee42a62 qa/fixtures/sprint09/graph-cases.json
```

## 7. Rollback

- Commit only (no index/worktree side effects beyond the 3 files):
  `git update-ref refs/heads/master 38c754c6f907ffb5b5f90ddfa626e54d8dee904e`
  then restore `src/lib/llmops/workflow.ts` to preimage bytes (`git show 38c754c:src/lib/llmops/workflow.ts > src/lib/llmops/workflow.ts`) and delete the 2 new files.
  Master staged set and unrelated dirty state unaffected either way.

## Controls

legacy_writer: disabled (untouched); phase_21: blocked (untouched); no migrations/DTO/shared registration changes; single writer palpal2312/admin; no push, no merge; unrelated staged/dirty/untracked master state preserved (real staged index content byte-identical before/after).

## State (status protocol)

State: WAITING_ON coordinator `term_038f4e23-0651-4597-ad45-55345605cb87`.
- Prerequisite: a fresh dispatch (new preamble + TASK block) naming the next unit of work.
- Why it blocks the next step: both assigned tasks are settled — S09-C2 lane work committed on `s09-controlled-delivery` (9e97018, unpushed per orders) and this S09-I4 promotion committed on master (137887a2, unpushed). The worker protocol forbids starting new or unrelated work after `worker_done`; only the coordinator can authorize what follows (e.g., remaining sprint lanes, close-gate progression).
- Safe work remaining now: none on the settled tasks — receipts written and verified PASS, tests/tsc/diff-check green, rollback paths documented. No silent waiting: there is no self-serve remainder.
- Recheck trigger: arrival of a new dispatch preamble + TASK block as terminal input.

Status: DONE
Summary: S09-C2 controlled-delivery outputs promoted to master as 137887a2 (3 allowed paths only) via temporary isolated index after receipt PASS, preimage no-drift check, and byte-identical copies; one stale-bytes attempt rolled back after the repo-pinned tsc 5.9.3 caught TS2352, fixed in source lane (9e97018) and re-promoted with 12/12 tests, clean tsc, clean diff-check, and real-index before/after identity.
Concerns/Blockers: Phantom `MM`/`D `+`??` status on the 3 promoted paths is the documented consequence of preserving the real staged index exactly (i3-style no-op `git add` deliberately omitted); cosmetic only, worktree bytes == HEAD bytes == receipt pins.

JOB_DONE: S09-I4 controlled delivery promotion complete, receipt hashes verify current committed bytes.
