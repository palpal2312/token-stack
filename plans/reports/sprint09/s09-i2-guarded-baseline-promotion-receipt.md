# S09-I2 Guarded Baseline Promotion Receipt

- Task: task_ae96087dfb3b (dispatch ctx_216c49cf17b4)
- Date: 2026-08-29 (Asia/Saigon)
- Actor: palpal2312 <54031647+palpal2312@users.noreply.github.com>
- Source commit: 3612de15809add932fef8746c80047a530664110 (feat(news-os): register sprint 08 data baseline, 2026-08-28)
- Promotion commit: 27319a6bd1f52a5343d2bb4d07db65cc902b1667 (feat(news-os): promote sprint 08 data baseline into master)
- Branch: master (base 0b99c6db367670e768d464ff6b5c750320da55e9). Not pushed.

## Scope (28 paths, exclusive)

go/go.mod, go/go.sum, go/internal/localdb/{community,core,handoff,product}/**, go/internal/runlearning/**

## Verification (pre-staging)

1. Enumerated source-commit paths: `git ls-tree -r --name-only 3612de15 -- <scope>` => 28 files.
2. Byte-identity: `git cat-file blob 3612de15:<path> | sha256sum` vs `sha256sum <worktree file>` for all 28 => 0 mismatch, 0 missing.
3. Source commit is NOT an ancestor of master HEAD (verified `git merge-base --is-ancestor` => false), so promotion was required.
4. Staged exactly the 28 verified paths with `git add -- <paths>` (no merge/reset/checkout/clean/stash used at any point).
5. Staged blob IDs re-compared to source commit blob IDs via `git ls-files -s` vs `git rev-parse 3612de15:<path>` => 0 mismatches.
6. Staged names inspected: 1 M (go/go.mod) + 27 A; diff stat 7673 insertions(+), 1 deletion(-) — identical to source commit stat.
7. One conventional commit created under palpal2312 identity. Runtime sqlite artifacts (*.db/-shm/-wal) intentionally excluded.

## Incident and repair (transparency)

First commit attempt (efe5107, superseded) swept in 999 pre-staged unrelated paths
(960 staged adds, 31 staged modifications, 1 AM, 7 staged deletions incl. public/pets/boba/*)
that were already in the index before this run. Repair used index-only operations
(`read-tree`, `update-index --index-info`, `commit --amend`); no worktree byte was touched,
no forbidden op used. Final state machine-verified:
- HEAD 27319a6 contains exactly the 28 scope paths.
- `git diff --cached --name-only | wc -l` => 999 (unrelated staged set restored exactly).
- Staged deletions (7) restored as staged deletions; AM file restored with original staged blob + unstaged worktree modification; unstaged .gitignore modification untouched.

## Current-byte SHA-256 (28 files, match source commit and worktree)

f12342e5a408417c1ee158aba663c30055a19491268f04c9b50fc32361e0307f go/go.mod
60a5003ec0f1ba15d880e0d11a7d8158c86c1aec095d429bb48109568aa5a9ed go/go.sum
2d1ab1242e358321dafa5380dde1b1f7ceac999c8eed905a2ed3fbedbb61aca7 go/internal/localdb/community/adversarial_test.go
64090203c79e522a0f962193da280d3c43b8b21462094bf2255161784cd9cc7e go/internal/localdb/community/community_test.go
baf0392afa3882ee10f45ce274a46982f4946d54fd2b5ede8151c833bdad517f go/internal/localdb/community/export_envelope.go
2b5a4ad98a6db31e0a8e84e004acba71eef1e60daea2acc86478c942c6730236 go/internal/localdb/community/migrations.go
6ce96f5c7837cadf2c8825fdd477a67655b3ee39d585f1b81b851879f2cc57df go/internal/localdb/community/sanitizer.go
6c5725c176a701db0b6074345a00fcf7a3772f226cf7ea9477f9bc1dd344a14c go/internal/localdb/community/schema.go
8a9e276337e18fe7fdfc19b8a2016522da6596884aae580c5869924bb7b82c70 go/internal/localdb/community/sqlite_store.go
533c15bad7acad409936d02f1d6cb6d46b34d7a5db3521d42eab3f54e59b6494 go/internal/localdb/community/store.go
0c116ed193885f4ba19c1764e95da2f62259a118191d5a180fb6abe700875fa6 go/internal/localdb/core/backup.go
fd2442e6f5ffc17703c508418b9edd44588da38d09d29cfc0ebeb5da60bd1a1b go/internal/localdb/core/backup_test.go
2d62571856c98f335107c1400c12a4dd8d544724bcd611474a0572b7c6840fd2 go/internal/localdb/core/database.go
343025c90d6c9e5d48c437f343edcd10a8919a10477ecc89cd923709ce8d5ea1 go/internal/localdb/core/database_test.go
b005ca461e4595b7c8c947ecad37c348369f0f0df1a781c6141378624275c2a4 go/internal/localdb/core/migration.go
3fe889d56c8202ea81ea89b3a73d44ae5e8c6fdcdddd01d996b08fa4592eefe0 go/internal/localdb/handoff/adapter.go
ccc7575ff1e0149edbd733c87620d4bd2d83e3c8f192681bc25d39caec08cda7 go/internal/localdb/handoff/adapter_test.go
5a30496ab7b7364bb34ff8972d464ad20b16953e1ee663c270eb37fe097adcbf go/internal/localdb/product/acknowledgement_test.go
fcf9e5141854f68f8a0f438113bf6d06f6fc6c08087ae498ff69e96375b21561 go/internal/localdb/product/chat.go
0e03f7a971337ddae7ad36417ecab404cc54b068008ed464464691d6a5c6afd6 go/internal/localdb/product/chat_test.go
2ca60dfde217b825fc5c86db3ba5f27ca5859806e5f7e6f2483fe64c601a7732 go/internal/localdb/product/conformance_test.go
126c61c737e9329b95d4099ab00f569c5bd49aed9ef71293dc788107b230d9cb go/internal/localdb/product/database.go
2be2875edcc0be7f4506252686f201afbc623622dbf8bb64b84a8ed1914ce822 go/internal/localdb/product/database_test.go
ff9d2b337b930bde60edb0783e58c56d2f700e56e64388204974bf9c9f2a509f go/internal/localdb/product/schema.go
c33fd53de994c6259ad025c8a062aafd50693fd74d8c83ef3c23df8938be81ea go/internal/localdb/product/store.go
6e99c6701c6cdfd6e77e4bc57c8cfb834a3394db35106e7d1798e6bddd8e6af0 go/internal/runlearning/runlearning.go
46e9b37cd2add4539335de32236c5c74717be54c829f02f8cd379ba46ed99afd go/internal/runlearning/runlearning_test.go
85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43 go/internal/runlearning/s08c_001-run-learning.sql

## Test/vet verdicts

- `go vet ./internal/localdb/... ./internal/runlearning/...` => exit 0 (clean)
- `go test -count=1 ./internal/localdb/... ./internal/runlearning/...` =>
  ok community 2.238s, ok core 1.666s, ok handoff 2.196s, ok product 2.210s, ok runlearning 0.694s
- `go test -count=1 -run "Migration|Schema|Mirror" ./internal/orca/...` => ok 0.921s (adjacent mirror check)

## Root migrations mirror failure (out of scope, reported exactly)

Does NOT reproduce in this worktree: go/migrations/ contains all four mirror files
(000003_sen_chat_durability.sql, 000004_orca_dispatch_cursors.sql, s08b_001-governed-memory.sql,
s08c_001-run-learning.sql); TestChatMigrationSQLMirrorExists and internal/orca schema mirror test pass.
No repository-root migrations/ directory exists here and no test or script in this checkout
references one, so the previously reported failure mode is absent from promoted-scope results.

## Constraints honored

Legacy writer untouched; Phase 21 untouched; no product code edited beyond committing
already-verified current baseline bytes; no push performed; unrelated dirty/untracked
master changes preserved exactly.

JOB_DONE: guarded promotion complete, receipt hashes verify current committed bytes.
