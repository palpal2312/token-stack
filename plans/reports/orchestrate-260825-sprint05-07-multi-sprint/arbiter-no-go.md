# Sprint 05-07 Independent Close Arbiter

- Date: 2026-08-26
- Scope: phases 02-04, authoritative S05-G1/S06/S07 receipts, and current bytes in the three producer worktrees
- Verdict: **NO-GO**
- Phase 21: **BLOCKED**

## Decision

Sprint 05-07 cannot close. The producer suites are mechanically green on their
own current bytes, but the combined promotion set is not single-valued and
multiple phase success criteria remain documented gaps rather than delivered
contracts. The S05-G1 rerun was sufficient to unlock dependent work, not to
waive the final Sprint 05, 06, or 07 close gates.

## Mechanical rerun (current bytes)

| Producer | Command | Result |
|---|---|---|
| S07-L1 | `go test -count=1 ./internal/maintainer/` | PASS |
| S07-L1 | `node --test --import tsx src/lib/maintainer/maintainer.test.ts` | PASS, 11/11 |
| S07-L1 | `node --test --import tsx qa/fixtures/sprint07/verify-s07-l1-maintainer.test.ts` | PASS, 12/12 |
| S07-L2 | `npx tsx --test src/lib/maintainer/__tests__/maintainer.test.ts` | PASS, 6/6 |
| S07-L3 | `node --test qa/fixtures/sprint07/verify-s07-l3-maintainer-gates.test.ts qa/fixtures/sprint07/verify-s07-l3-poisoning-rollback.test.ts` | PASS, 37/37, including the explicit V8 gap sentinel |

These passes validate each isolated producer surface. They do not establish
that the three worktrees can be promoted together or that phase acceptance
criteria are complete.

## Receipt and current-hash verification

- S06-L1: 8/8 receipt pins match current bytes.
- S06-L2: 4/4 receipt pins match current bytes.
- S06-L3: 3/3 receipt pins match current bytes.
- S07-L1: 11/11 receipt pins match current bytes.
- S07-L2: 2/2 receipt pins match current bytes.
- S07-L3 authoritative `s07-l3-001-maintainer-gates-report.md`: 5/5 pins match current bytes.
- The earlier S07-L3 receipt `verify-260826-0904-GH-07-s07-l3-poisoning-rollback.md` is superseded by later Lane 3 bytes: its `qa/fixtures/sprint07/scenarios.json` and `README.md` hashes no longer match. The later authoritative receipt correctly pins them.
- S05-G1 rerun: 19/19 receipt pins match current bytes across the three producer worktrees.

Every count above was recomputed from the receipt's 64-hex SHA-256 rows and
the referenced current file in its producer worktree; no receipt assertion was
accepted solely from report prose.

## Cross-worktree path collisions

The untracked producer sets contain four exact repo-relative collisions, all
with different bytes:

| Path | Lane 1 SHA-256 | Lane 3 SHA-256 |
|---|---|---|
| `qa/fixtures/sprint06/README.md` | `3a6ae2c519769cfafc83714a345aca63988546eebf62142dec9a6fa0f11979a2` | `a4ad958c336c5573e939c74bffd81326f60659c1fe62c19d8d8a7cc723123493` |
| `qa/fixtures/sprint06/scenarios.json` | `57f05b7354a8c6ca5a451123685d1983c35a172f1d84fcfae729ba0f4bfe68c9` | `05219fd7cf622f0de124fa715bb2283cce55df55bae52fe85c692ce278ec85f8` |
| `qa/fixtures/sprint07/README.md` | `d2592ad06b889c8205a5a2d1c978aaf5d60623f21f2615495a605883ef6a1b34` | `310a5bc2d5017c22b96adc067fcbdf4e456d1d48ff26ec5e109666de217b5d50` |
| `qa/fixtures/sprint07/scenarios.json` | `6b501068fe7f1119d5940c1dace92940f9db9c01c56dfa488575b8478c793939` | `b1b82c4a51d29bce2f99dfce5ff0dfc9e3fb95e90f6c8d0e4aaa3899d7abd3f5` |

Lane 1/Lane 2 and Lane 2/Lane 3 have zero exact untracked-path
intersections. The four Lane 1/Lane 3 collisions require an integration owner
and new post-reconciliation hashes before promotion.

## Blocking documented gaps

### Sprint 05

- The final phase requires exactly-one Project SEN, cross-project privacy, and
  SQLite/restart continuity. The authoritative fixture evidence remains 4/7:
  exactly-one Project SEN, unscoped visibility, and restart durability are
  documented gaps G1-G3.
- There is no independent final Sprint 05 GO receipt; S05-G1 explicitly served
  as an early dependent-work contract freeze.

### Sprint 06

- The Lane 3 receipt records cross-language OLC digest divergence, divergent
  loop-bound semantics, and raw/unbounded loop feedback.
- Required progress projection, Run-level readiness/review gates, and an Orca
  proposal envelope are missing.
- The phase requires deterministic approved-proposal-to-Orca compilation and a
  single Run review verdict; those contracts are not present, so isolated
  producer tests cannot satisfy phase success.

### Sprint 07

- Lane 3's V8 sentinel proves a throwing verifier can strand a repair in
  `verifying` without automatic rollback, contrary to the phase requirement
  that failed or unverifiable repair rolls back.
- The producer reports disagree about ownership/integration of inventory,
  fingerprints, checkpoint seams, repair policy, recipe explanations, and the
  maintenance API. No integrated end-to-end contract proves checkpoint before
  mutation through verified rollback and sanitized recipe persistence.
- The duplicate fixture paths above make the promotion bytes ambiguous.

## Phase 21 guard

The master run manifest still records `phase_21: blocked`. No untracked
producer artifact matching Phase 21/Sprint 21 was found, and this arbiter makes
no Phase 21 change. Phase 21 must remain blocked after this verdict.

## Required closure evidence

1. Reconcile the four fixture collisions under a single integration owner and
   publish new current-byte pins.
2. Close Sprint 05 gaps G1-G3 and issue a final Sprint 05 GO.
3. Implement and verify the missing Sprint 06 compilation/projection/review
   contracts and privacy/parity gaps.
4. Integrate Sprint 07 surfaces, make verifier exceptions rollback-safe, and
   prove the end-to-end maintenance state machine against the promoted bytes.
5. Re-run independent Sprint 05, 06, and 07 close gates while Phase 21 remains
   blocked.

JOB_DONE: S05-07-ARBITER
