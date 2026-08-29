# S09-I5 Snapshot Return Promotion Receipt

- Task: task_6fd79fb23e17 (dispatch ctx_5ed767ec6e27)
- Date: 2026-08-29 (Asia/Saigon)
- Actor: palpal2312 <54031647+palpal2312@users.noreply.github.com>
- Source worktree: C:/Users/ADMIN/orca/workspaces/source/s09-snapshot-return
- Source commit: 07a66945ed26cfc06f41723dc4989617d1676080 (parent preimage 38c754c6f907ffb5b5f90ddfa626e54d8dee904e)
- Source receipt: plans/reports/sprint09/s09-c3-snapshot-return-receipt.md
- Promotion commit: 2be18dc56006ac2b473367268ad28cbd862e4fd1 on master (parent 137887a2c0447709901bdf4f3d62bd220d8c0727, stacking on S09-I4). Not pushed.

## 1. Source receipt validation

`newos-receipt-verify.ps1 -ReceiptPath <source receipt> -ProjectRoot <source worktree>` =>
verdict PASS, reason verified, markers 1, 3/3 hashes MATCH against source worktree disk bytes
(s09_snapshot.go, s09_snapshot_test.go, snapshot-cases.json).

## 2. Source bytes, EOL note, preimages, ownership

- **CRLF/LF normalization (documented, benign).** Source worktree runs `core.autocrlf=true`; its disk bytes are CRLF while committed blobs are LF. The source receipt pins therefore hash CRLF disk bytes and differ from the committed blob hashes. Content identity was proven cryptographically before any master write: for each of the 3 paths, CRLF-stripped disk bytes hash EXACTLY to the committed blob hash (blob == tr -d '\r' < disk), and `git diff 07a6694 -- <paths>` is empty. No semantic drift; promotion proceeds with canonical LF blob bytes.
- Canonical promoted bytes (LF blob SHA-256, == master worktree bytes post-copy):
  - `s09_snapshot.go` = `195afc71e38dd0cc0f74f58f9a892758e6165e1aeff31229eabee8bc0a48dd25`
  - `s09_snapshot_test.go` = `784059681c64666a77460870aca23e7a5c82d7a4b2060e0365b9179130118cfa`
  - `snapshot-cases.json` = `c554e78ba7e538cad89bcbb43b029fefb59eb50359441e71ab34f68e3abde515`
- Master preimages checked BEFORE any master write, against source-commit parent preimage `38c754c` AND current master tip `137887a2`: all three paths ABSENT in both commits, ABSENT in master worktree, no status entries. Clean new-file adds; zero drift. (Had any destination drifted, this run would have stopped BLOCKED without touching master.)
- Ownership: community lane-owned path (`go/internal/localdb/community/`) + qa sprint09 fixture path, exactly the product allowlist. `contracts.ts`/DTO barrels, migrations registry untouched; no API route changes.

## 3. Isolated commit procedure (master worktree and staged index preserved)

1. Pre-snapshot: `git ls-files -s` content hash `ad9440dd63dea362fd82145b7e7df224c8296b2fd5671a266d90df7525028a5b` (1893 staged entries), `git status --porcelain` hash `80412aeaeede2c37f94fbb1302376deeff3fda7ecc9f55f4c763b163d207975f`.
2. Temp index via `GIT_INDEX_FILE=$(mktemp -u)` (real index never opened for write):
   `git read-tree 137887a2` -> `git update-index --add --cacheinfo 100644,<blob>,<path>` for the 3 blobs from source commit 07a66945
   -> `git write-tree` -> `git commit-tree` as palpal2312 with parent 137887a2 -> `git update-ref refs/heads/master <commit> 137887a2` (CAS on old tip).
   Temp index deleted. No reset/checkout/clean/stash/merge/amend/push and no unrelated staging.
3. The 3 candidate files were materialized into the master worktree from the committed blobs (`git show <commit>:<path> > <path>` — LF canonical bytes, not the CRLF source disk copies) and SHA-256 re-verified byte-identical to the blob pins above. Nothing else in the worktree was touched.
4. No post-commit `git add` into the real index (identity requirement); phantom status entries documented in §4.

## 4. Post-commit verification

- Commit path list (`git show --name-only`): exactly 3 adds — `go/internal/localdb/community/s09_snapshot.go`, `go/internal/localdb/community/s09_snapshot_test.go`, `qa/fixtures/sprint09/snapshot-cases.json`.
- Author/committer: palpal2312 <54031647+palpal2312@users.noreply.github.com>; parent 137887a2.
- Commit blob SHA-256 = worktree SHA-256 = pins (§6), 3/3.
- Real staged index: `git ls-files -s` content hash AFTER = `ad9440dd63dea362fd82145b7e7df224c8296b2fd5671a266d90df7525028a5b` — IDENTICAL to before; entry count 1893 unchanged.
- `git status --porcelain` after hash `6dfcdfa6f460a9fc15d13062cc3b3f3077f74a5e41ddea278083bbcb25ca7671` differs from before ONLY in the 3 promoted paths' status lines: `D  `+`??` pairs (phantom staged-deletion because the preserved index lacks HEAD's new entries; worktree bytes present and hash-verified). All unrelated staged/dirty entries untouched, including the S09-I4 phantom lines from the earlier promotion.
- `git diff --check 137887a2..master` => clean.

## 5. Focused tests (master worktree, final bytes)

```
$ cd go && go vet ./internal/localdb/community/     # clean (exit 0)
$ go test -count=1 ./internal/localdb/community/
ok  agentic-os/internal/localdb/community  1.640s   # 33 PASS / 0 FAIL (verbose count)
```

## 6. Current-byte SHA-256 (master worktree, post-commit; LF canonical)

```text
195afc71e38dd0cc0f74f58f9a892758e6165e1aeff31229eabee8bc0a48dd25 go/internal/localdb/community/s09_snapshot.go
784059681c64666a77460870aca23e7a5c82d7a4b2060e0365b9179130118cfa go/internal/localdb/community/s09_snapshot_test.go
c554e78ba7e538cad89bcbb43b029fefb59eb50359441e71ab34f68e3abde515 qa/fixtures/sprint09/snapshot-cases.json
```

Note for verifiers: the SOURCE receipt pins hash the source worktree's CRLF disk bytes (`6d9248d2…`, `1427e5e3…`, `49afa797…`); they verify under the source root. This receipt pins canonical LF bytes; identity between the two is proven in §2.

## 7. Rollback

- Commit only (no index/worktree side effects beyond the 3 files):
  `git update-ref refs/heads/master 137887a2c0447709901bdf4f3d62bd220d8c0727`
  then delete the 3 files. Master staged set and unrelated dirty state unaffected either way.

## Controls

legacy_writer: disabled (untouched); phase_21: blocked (untouched); no migrations/DTO/shared registration changes; `contracts.ts` untouched; single writer palpal2312/admin; no push, no merge; unrelated staged/dirty/untracked master state preserved (real staged index content byte-identical before/after).

## State (status protocol)

State: WAITING_ON coordinator `term_038f4e23-0651-4597-ad45-55345605cb87`.
- Prerequisite: a fresh dispatch (new preamble + TASK block) naming the next unit of work.
- Why it blocks the next step: this promotion task is complete and settled by `worker_done`; the worker protocol forbids starting new or unrelated work. Only the coordinator can authorize what follows (remaining sprint lanes, close-gate progression, or arbiter).
- Safe work remaining now: none on this task — receipt written and verified PASS, tests/vet/diff-check green, rollback documented. No silent waiting.
- Recheck trigger: arrival of a new dispatch preamble + TASK block as terminal input.

Status: DONE
Summary: S09-C3 snapshot-return outputs promoted to master as 2be18dc5 (3 allowlisted paths only) via temporary isolated index after source receipt PASS, CRLF/LF content-identity proof, preimage no-drift check, and blob-canonical copies; go vet clean, 33/33 community tests PASS, diff-check clean, real-index before/after identity preserved.
Concerns/Blockers: Source receipt pins hash CRLF disk bytes (source autocrlf=true) and differ from committed LF blob hashes; identity proven by normalization (§2) and both pin sets recorded for verifiers. Phantom `D `+`??` status on the 3 promoted paths is cosmetic, the documented cost of exact index preservation.

JOB_DONE: S09-I5 snapshot return promotion complete, receipt hashes verify current committed bytes.
