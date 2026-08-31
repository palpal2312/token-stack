# Rewrite-baseline review and topic split (feat/rewrite-baseline)

## Status

Controller review of the 361-file rewrite restored from the preflight stash
(original monolithic `a98d639`) against `master`. **Merge verdict: NOT READY.**
The branch was **split into 17 topic commits** (below) for reviewability. No
merge to `master` was performed. `legacy_writer: disabled`, `phase_21:
blocked`, and the S10 CLOSED_GO chain on `master` are untouched.

Review evidence: independent multi-agent workflow (5 cluster reviewers + 1
synthesizer, 6 agents) over `master..feat/rewrite-baseline`.

## What the rewrite is (layers)

- **Go control plane** (`go/internal/*`, module `agentic-os`): Orca dispatch
  authority + adapter capability negotiation, reconcile engine, Sprint 08-A
  gatekeeping (admission/scheduler/allocator), governed semantic memory.
- **Desktop shell** (`src/shell`, Phase 19a, flag-gated inert): rollout gates,
  view sessions, panels, SEN surface coordinator, ack-seed transcript authority.
- **Web refactor** (`src/app/api` proxies to the Go plane, query/virtualization,
  platform capability contract, settings preview, read-path hardening).
- **QA, docs, ops, deps** trees.

## Split applied (feat/rewrite-baseline, 17 commits)

```
feat(go)   orca dispatch authority + adapter capability negotiation
feat(go)   reconcile engine (reattach/quarantine slots)
feat(go)   Sprint 08-A gatekeeping (admission, scheduler catch-up, allocator tie-breaks)
feat(go)   governed semantic memory store + SQL migration fragments
feat(shell) rollout gates, dynamic boundary, pure module registry
feat(shell) persistent shell core — view sessions, view host, nav, a11y
feat(shell) resizable panel machinery
feat(shell) SEN surface coordinator + ack-seed transcript authority
feat(web)  Go control-plane proxy migration (sen chat + daemon reads + builder projection)
feat(web)  virtualization, heavy lazy bundles, query/realtime foundation
feat(web)  platform capability contract + settings preview + read-path hardening
test(qa)   recovery-runner evidence tree (Lane 3 fixtures, pycache excluded)
test(qa)   shell runtime + orca/platform/sen spec suite
docs(ops)  evergreen orchestration contracts
chore(ops) plan trees, orchestration executables, evidence receipts
chore(deps) js-yaml bump, lockfile sync, gitignore hygiene
chore(qa)  drop committed pycache junk
```

Junk removed from the branch: `.pyc` under `qa/fixtures/sprint03`,
`.memorax-code/adapters/codex/memory-skill-reminders.json` (transient session
turns). Content preserved: `git diff a98d639 <split HEAD>` shows only those
dropped paths plus the restored Phase 12 plan from `master`.

## Blockers before merge (merge not ready)

1. **Go module does not build as a whole**: `go build ./...` fails —
   `cmd/sen-daemon` imports `agentos.local/newsos/...` under `module agentic-os`.
   Fix module path or the import, then prove `go build ./...` + `go vet`.
2. **Shell reactivity bug**: `view-session-store` mutators call `persist()` but
   never `emit()`; subscribers never re-render (activeTab list stale). Fix
   `emit()` on every mutator (align with panel/sen-surface stores).
3. **Zero node:test suites** despite header claims for shell-heavy code; wire
   unit tests before merge. `src/app/settings/page.tsx` renders a hard-coded
   demo SNAPSHOT under `desktop_shell_v2` — fabricates capability data; replace
   with a real capability source or gate it behind a test fixture only.
4. **Duplicate SQL migration fragments**: `s08b_001-governed-memory.sql`
   duplicated in `go/internal/memory/` and `go/migrations/`; `000004` has a
   third manual copy in `orca/schema.go`. Keep one authoritative copy; pin
   others by hash or delete.
5. **Concurrency/UX pitfalls**: `AdvanceCursor` TOCTOU (add `AND output_cursor
   <= ?` on the UPDATE); allocator `RecordFeedback` lacks per-attempt dedup
   (skews EMA); `AdmitFair` mutates caller slices.
6. **Unused/speculative API**: `reconcile.Classify`/`ObservationContract` and
   allocator `ReasonAlreadyAssigned` have no in-repo consumer — cut or provide.

## Recommended path

1. Merge-readiness work above (small fixes + test wiring) as follow-up commits
   on the topic branches, or as an owner-assigned sprint.
2. When `go build ./...` + focused suites pass on the branch, review topic-by-
   topic and merge to `master` (or fold incrementally).
3. Only after the branch stabilizes, plan Sprint 11 (the exposed Phase 19a
   desktop shell and Go control-plane work are its most visible candidates).

JOB_DONE: rewrite-baseline reviewed (6-agent workflow), split into 17 topic
commits, junk removed, merge held as NOT_READY with explicit blockers.