# Sprint 03 Independent Arbiter — GO

Date: 2026-08-25 (18:26 SGT). Scope: read-only verification of Sprint 03 lane
receipts (Lane 1 SQLite chat authority, Lane 2 SEN chat client/proxies/UI, Lane 3
recovery/boundary/evidence). Mode: no edits to source/docs; no commits.

## Verdict: GO (slice evidence is sound; Phase 21 must stay blocked)

GO on the lane deliverables as-receipted. Phase-21 promotion was NOT performed
and must remain blocked — see Phase-21 check below. GO here ≠ Phase-21 GO.

## 1. File existence — 25/25 claimed files present

All Lane 1 (6), Lane 2 (11 + 3 tracked-modified), Lane 3 fixture (6) files exist.
Lane 2 proxy routes `attempts/[id]/{events,stop,retry}` and
`sessions/[id]/{active,thread}` present under `src/app/api/sen/chat/`.

## 2. JOB_DONE markers — all present

- Lane 1: `JOB_DONE: S03-L1-001..004`, `JOB_DONE: S03-L1` (S03-L1-004-receipt.md; job reports carry per-job markers)
- Lane 2: `JOB_DONE S03-L2-001..004`, `JOB_DONE S03-L2` (s03-l2-final-receipt.md); `JOB_DONE: S03-L2-CANONICAL-CHAT` (lane2/S03-L2-receipt.md)
- Lane 3: `JOB_DONE: S03-L3-001..004` (s03-l3-00x-*.md)

## 3. SHA-256 — 17/17 MATCH (against final receipts)

Lane 1 (S03-L1-004-receipt.md, recorded 18:17) — 6/6 MATCH:
schema.go, chat.go, chat_test.go, store.go, database.go,
`go/migrations/000003_sen_chat_durability.sql`.

Lane 2 (lane2/S03-L2-receipt.md, recorded 18:24) — 11/11 MATCH:
chat-client.ts, chat-query-keys.ts, __tests__/chat-client.test.ts, chat/route.ts,
attempts/[id]/{events,stop,retry}/route.ts, sessions/[id]/{active,thread}/route.ts,
SenView.tsx, qa/tests/sen-chat.spec.ts.

At-rest hashes re-computed by arbiter; exact match ⇒ nothing changed since the
receipts were recorded. Earlier 17:03 receipt (s03-l2-canonical-chat-receipt.md)
lists different hashes for chat-client.ts/test/qa-spec — superseded by the 18:24
fb2 final dispatch; on-disk bytes match the NEWEST receipt. Not an integrity gap.

## 4. Bounded read-only checks (arbiter-ran)

| Check | Bound | Result |
|---|---|---|
| `go test -count=1 -timeout 60s -v ./internal/localdb/product/ -run 'TestSendTurn\|...\|TestChatMigration'` | 60s | **PASS 6/6, exit 0** (test exec 1.536s; wall 1m39s cold-compile — see L1) |
| `go test -count=1 -timeout 60s ./internal/localdb/core/ ./internal/localdb/product/` | 60s | **ok 2/2 packages, exit 0** (warm 14.8s) |
| `npx tsx --test src/lib/sen/__tests__/chat-client.test.ts` | 60s | **pass 7 / fail 0** (5.3s) |
| `npx tsx --test qa/tests/sen-chat.spec.ts` | 60s | **pass 15 / fail 0** (3.0s) |
| `npx tsx qa/fixtures/sprint03/event-evidence-runner.ts` (real Lane 2 `mergeEventsBySeq`/`hasEventGap`) | 60s | **pass 3 / fail 0, exit 0** (8.3s) — FI-04/FI-05 confirmed against real fns, not fixtures |

Lane 3 exit-0 claims for `failure-inject.py` (6 fixture cells), `sqlite-inspect.py`
(FI-07 ×2 promoted DBs), `boundary-audit.py` (14/14) verified from persisted
evidence JSONs only — runners NOT re-executed to keep the arbiter strictly
read-only (they write fixture DBs / would overwrite evidence JSON).

## 5. Phase-21 promotion — NOT performed (confirmed)

- `run-manifest.json`: `"phase_20":"open"`, `"phase_21":"blocked"` (17:18).
- `report.md`: "Phase 20 is open; Phase 21 remains blocked."
- Every `phase-21` reference in lane reports is `NEXT: phase-21 promotion gate` —
  a proposed next step, never a done action.
- git log (HEAD 0b99c6d): no promotion/phase-21 commits; all lanes committed zero.
- Git tracking state matches the final Lane 2 receipt exactly (4 tracked-modified,
  7 untracked/working-tree) ⇒ delivery is working-tree only, nothing promoted.
- Live daemon e2e never ran (canonical listener not configured; FI-10 pending-lane1)
  — no basis for promotion exists, and none was claimed.

## 6. Limitations

1. **Wall-clock**: first narrow Go run took 1m39s (cold `modernc.org/sqlite`
   compile), exceeding the 60s arbiter bound for that invocation; `go -timeout 60s`
   never fired (compilation, not test time). Matches S03-L1-004 anomaly note; warm
   rerun 14.8s. Not a product failure.
2. Lane 3 reports carry **no per-file SHA-256 manifest** — integrity of
   fixture/report artifacts rests on exit-0 evidence JSONs, not hashes.
3. FI-01..03/06/08/09 cells run against a **reconstructed contract fixture**, not
   the canonical Lane 1 DDL; FI-10 unrun. Pending-lane1 re-point stands.
4. `tsc --noEmit` full-project: lane's own 60s run **timed out** and lane did not
   claim green; arbiter did not re-run (outside the bounded set). Typecheck of
   full project is **unproven** — only the tsx test surfaces are green.
5. Numeric nit: boundary-audit evidence JSON `filesScannedForSecrets: 148` vs
   report/dispatch-summary `147`. Cosmetic, no finding impact.
6. S03-L3-002/003 were descoped from the original Lane-3 dispatch then completed
   by a follow-up dispatch — sequencing noise only; artifacts exist and pass.
7. `_tmp-unit.err` / `_tmp-unit.out` (0-byte) residue in the report dir — vestigial.

## 7. Remaining before Phase-21 opening (not arbiter-blocking for the slice)

- Re-point FI-01..03/06/08/09 at the canonical Lane 1 store; run FI-10 runtime
  probe against a configured listener.
- Full-project `tsc --noEmit` (green, bounded) before any promotion claim.
- Optional: per-file SHA-256 manifest for Lane 3 fixture evidence.

**Bottom line**: receipted evidence verified at-rest and by bounded re-run; hashes
match; no Phase-21 promotion. GO on the Sprint-03 lane slice.