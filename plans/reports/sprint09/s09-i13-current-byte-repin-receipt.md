# S09-I13 current-byte repin receipt

- Task: `task_e54651c89edf`
- Input HEAD: `e0233d395bd4ad8bd50ca1dff643c5b35604876b`
- Input tree: `d6819bd6a27a77857e62f57bced1abdd046a5181`
- Scope: evidence-only SHA-256 repin of the nine tracked paths pinned by the I8 manifest. No source, master, DTO, contract, configuration, or API changes.

## Why I8 is superseded as current-byte evidence

I8 remains historical promotion evidence, but it no longer describes the current bytes: the orchestration dashboard moved after its promotion, and I12 removed the legacy POST ping writer and its page controls. The input HEAD is `e0233d3` (`fix: remove legacy orchestration ping writer`) on top of the I12 input (`eb27b70`). This receipt replaces I8 only as advisory current-byte evidence; it issues no GO/NO-GO. The independent S09 arbiter remains the sole verdict authority and must re-evaluate these current bytes.

## SHA-256 recomputation

Each value below was recomputed directly from the file at the input HEAD worktree. The scope is the nine tracked `promotedPaths` entries in the I8 manifest, not broad discovery.

```text
71a00ff5846e718233faab4e94beed7bf4813263f1d8c392bcdc8b37627a2e79 go/internal/localdb/community/s09_intake.go
67ba96442110abf325d924f8bd0bffcbd65ad44bbdaa41ab7408a28622df3555 go/internal/localdb/community/s09_intake_test.go
8216bcedbf43cb5d21ea395178c55154cd199dc9b239ab18a6419de681cd5f32 qa/fixtures/sprint09/intake-cases.json
34b4da2598a815e3378c6a174c848376683cb505b06dea20028538969a2ced21 src/lib/llmops/workflow.ts
35eb7128473e8f0566495450217c67b2183229323e82309e3140b18c1ee0f76e src/lib/__tests__/workflow-graph.test.ts
dedbaa6f82cfeb6f50ad2c76678d7cd4eb7198868da5e73b7965fee3613c3574 qa/fixtures/sprint09/graph-cases.json
6d9248d288388867fff7a5658f373f93308638b1bb8720d86fbac4ab6f40edf9 go/internal/localdb/community/s09_snapshot.go
1427e5e343527f5ff32dfdebbbcb24b1a389b03d06c362ce34c34ef6ce5359c1 go/internal/localdb/community/s09_snapshot_test.go
49afa797f07afa625f71778a8fbb6d793500479679d1a652b9217af6c79faea2 qa/fixtures/sprint09/snapshot-cases.json
```

The two frozen contract-package paths listed separately in I8 are absent from this non-coordinator worktree and were not discovered, recreated, or treated as drift. I8 explicitly records them as untracked coordinator-checkout artifacts; this task therefore repins the nine tracked I8 promoted paths only.

## Control state

- Orchestration remains GET-only: no POST ping route or page control remains after I12/current HEAD.
- `legacy_writer: disabled`.
- `phase_21: blocked`.
- No authority changes: this is advisory evidence only, and the independent arbiter remains the sole verdict authority.

## Validation

- JSON parse: pass (`s09-i13-current-byte-repin`, nine path hashes).
- SHA-256 recomputation: nine scoped tracked paths completed as listed above.
- `git diff --check`: pass (no output).
- `npx --no-install tsx --test src/lib/__tests__/orchestration-state.test.ts src/lib/__tests__/orchestration-board.test.ts`: pass (23 passed, 0 failed, 0 skipped).

## State

Status: DONE
Summary: Recomputed and recorded SHA-256 values for all nine tracked I8 promoted paths at HEAD e0233d3/tree d6819bd6; I8 is superseded only as current-byte evidence after dashboard and I12 GET-only ping-removal movement. Legacy writer remains disabled, Phase 21 remains blocked, and no verdict was issued.
Concerns/Blockers: The two untracked frozen contract-package artifacts are absent from this non-coordinator worktree, as I8 documented; they were intentionally not recreated or broadened into this scoped repin.
