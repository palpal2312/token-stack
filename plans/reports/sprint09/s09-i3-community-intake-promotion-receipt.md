# S09-I3 Community Intake Promotion Receipt

- Task: task_22a31668d1ad (dispatch ctx_70e15e8a950f)
- Date: 2026-08-29 (Asia/Saigon)
- Actor: palpal2312 <54031647+palpal2312@users.noreply.github.com>
- Source worktree: C:/Users/ADMIN/orca/workspaces/source/s09-community-intake
- Source receipt: plans/reports/sprint09/s09-c1-community-intake-receipt.md (Status: DONE)
- Promotion commit: 38c754c6f907ffb5b5f90ddfa626e54d8dee904e on master (parent 27319a6bd1f52a5343d2bb4d07db65cc902b1667). Not pushed.

## 1. Source receipt validation

`newos-receipt-verify.ps1 -ReceiptPath <source receipt> -ProjectRoot <source worktree>` =>
verdict PASS, reason verified, markers 1, 3/3 hashes MATCH (s09_intake.go, s09_intake_test.go, intake-cases.json).

## 2. Source bytes, preimages, ownership

- Source SHA-256 recomputed from source worktree: identical to receipt pins (see hash block below).
- Master preimages: all three paths ABSENT in HEAD, worktree, and index before promotion (clean new-file adds; no overwrite, no ambiguity).
- `qa/fixtures/` existed in master only as untracked files of other sprints (sprint03/04/08, frontend-performance-budget.json, phase-19a-u0-evidence.json); `qa/fixtures/sprint09/` did not exist. No other-lane fixture touched.
- Ownership: community lane-owned path (go/internal/localdb/community) + qa sprint09 fixture path, matching the allowed-path list exactly; `community/migrations.go` untouched; no DTO/shared registration change.

## 3. Isolated commit procedure (master staged index preserved)

1. Pre-snapshot: `git status --porcelain` (1237 lines) and `git ls-files -s` (1890 entries).
2. Copied the three source files into the master worktree; SHA-256 re-verified byte-identical to source.
3. Temp index via `GIT_INDEX_FILE=$TEMP/s09i3-index` (real index never opened for write):
   `git read-tree HEAD` -> `git add -- <3 paths>` (staged set inspected: exactly the 3 A entries)
   -> `git write-tree` (18805461ec617e179c105c65889735213b3d034f)
   -> `git commit-tree` as palpal2312 with parent HEAD -> `git update-ref refs/heads/master`.
   Temp index deleted afterwards. No reset/checkout/clean/stash/merge/amend used.
4. Post-commit, the 3 files were added to the REAL index with plain `git add` (no-op entries
   equal to HEAD blobs) solely to eliminate phantom staged-deletion (`D `) status that a
   HEAD-advanced/index-preserved state otherwise shows; every one of the 1890 pre-existing
   index entries is byte-for-byte untouched.

## 4. Post-commit verification

- Commit path list (`git diff-tree -r HEAD`): exactly 3 adds — go/internal/localdb/community/s09_intake.go,
  go/internal/localdb/community/s09_intake_test.go, qa/fixtures/sprint09/intake-cases.json.
- Working bytes: SHA-256 after commit identical to source pins (hash block below).
- Real index: `git ls-files -s` before vs immediately after temp-index commit = IDENTICAL (diff empty).
- Staged name/status set: `git diff --cached` after = 999 names (961 A + 31 M + 7 D), same set as before
  promotion; `git status --porcelain` before/after differs ONLY in untracked enumeration of `qa/fixtures/`
  (git no longer collapses the directory line since qa/fixtures/sprint09 is now tracked; the same
  untracked files are listed individually). Zero staged-side differences.
- `git diff --check HEAD~1 HEAD` => clean.

## 5. Focused C1 tests

- `go vet ./internal/localdb/community/` => clean (exit 0)
- `go test -count=1 ./internal/localdb/community/` => ok 1.473s — 26/26 top-level PASS, 0 FAIL
  (6 S09 intake tests incl. 46 subtests + 20 baseline)
- `go test -count=1 ./internal/runlearning/` => ok 0.625s

## 6. Current-byte SHA-256 (master worktree, post-commit)

27bdd44be6a148ec1d67d57abadc555ba1f6600e890692dbe87843642dc31e51 go/internal/localdb/community/s09_intake.go
196385e746390c33ab51d803ec0a3a6ecd98186a5f40574344350f6f5805e2e1 go/internal/localdb/community/s09_intake_test.go
432852253750254b5d7911bd70a58bf37afd8e4ca7c5b7eb3252f74de6b81531 qa/fixtures/sprint09/intake-cases.json

## 7. Rollback

- Commit only (no index/worktree side effects beyond the 3 files):
  `git update-ref refs/heads/master 27319a6bd1f52a5343d2bb4d07db65cc902b1667`
  then remove the 3 no-op index entries (`git rm --cached -- <3 paths>`) and delete the 3 files.
  Master staged set and unrelated dirty state unaffected either way.

## Controls

legacy_writer: disabled (untouched); phase_21: blocked (untouched); no migrations/DTO/shared
registration changes; single writer; no push; unrelated staged/dirty/untracked master state preserved.

JOB_DONE: S09-I3 community intake promotion complete, receipt hashes verify current committed bytes.
