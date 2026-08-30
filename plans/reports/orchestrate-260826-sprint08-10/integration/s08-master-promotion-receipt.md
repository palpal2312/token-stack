# Sprint 08 master promotion receipt

- Candidate manifest: `C:/Users/ADMIN/orca/workspaces/source/sprint08-integration/plans/reports/orchestrate-260826-sprint08-10/integration/s08-promotion-manifest.md`
- Master root: `C:/Users/ADMIN/Documents/Agent OS/source`
- Scope: read-only verification of the idempotent 23-path candidate

## Current-byte hash verification

All 23 destination paths exist in master and their SHA-256 hashes exactly match the candidate manifest.

| Path | SHA-256 | Result |
|---|---|---|
| `go/internal/admission/s08a_001_admission.go` | `b034e3a9bc6759a85a2275275f47aa74aaef1f840595b2854d4b1f609ba4d93e` | PASS |
| `go/internal/admission/s08a_001_admission_test.go` | `9490ad5b247b6d8d2b951571a65b34b5cb90370bc031b67961a50ebb84d91328` | PASS |
| `go/internal/allocator/live_scoring_allocator.go` | `f5071a43ef1836444de69a94f4952d6ddef5653be3b9e2f90d64e3279c151d3b` | PASS |
| `go/internal/allocator/fairness_test.go` | `924d197ae71368363fc59395b8ee6752bec218b9c764836e40f14da4d3003e99` | PASS |
| `go/internal/scheduler/catchup.go` | `c07feced0684aefe4aa2864cb0c7d458aa950c15d4c581cd4b25860215f32bbd` | PASS |
| `go/internal/scheduler/catchup_test.go` | `4d651c9da08340933d283d6b2370a623370fe7d77532b22ec3524a2f31b1bdb9` | PASS |
| `src/app/api/sen/scheduler/forecast/route.ts` | `3bf04a9654f3013a87a9113d28a30fb55a211872d43a5df0138f7903844f1740` | PASS |
| `src/features/forecast/forecast.ts` | `d0abdb4ee30891a58496373d4543a13dcb608ba77696f0a604a27b813dbea2ff` | PASS |
| `src/features/forecast/forecast.test.ts` | `68e1b1d37ad2f1e9df9fb619b4fafc07494d032af9c29954dbffd8bc1241691c` | PASS |
| `src/features/forecast/ForecastCard.tsx` | `5917cc06955d5dcf7ae884eeb32e49ab2f994d95531ef1a7c7e68b70c2078556` | PASS |
| `qa/fixtures/sprint08/a/forecast-low-confidence.json` | `b1e0bf644b5517194068f550cc2cd87ccf808648d5edd4d45ce9935c837d6f43` | PASS |
| `go/internal/memory/memory.go` | `e21a1b9aebc58400ef0ae4a86b99d4f51dc711ac2ac6412ca2b9481bcda91564` | PASS |
| `go/internal/memory/memory_test.go` | `3df11370428a68292e61d702c907dd40e5eb0c3e7b9e1530bb9b7ce40bfbe90e` | PASS |
| `go/internal/memory/s08b_001-governed-memory.sql` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | PASS |
| `qa/fixtures/sprint08/b/memory-cases.json` | `153a6ad27682dfa0d63a23d1bccd56eb3c17f360d7bfd45077bd65f7744ddc12` | PASS |
| `go/internal/runlearning/runlearning.go` | `6e99c6701c6cdfd6e77e4bc57c8cfb834a3394db35106e7d1798e6bddd8e6af0` | PASS |
| `go/internal/runlearning/runlearning_test.go` | `46e9b37cd2add4539335de32236c5c74717be54c829f02f8cd379ba46ed99afd` | PASS |
| `go/internal/runlearning/s08c_001-run-learning.sql` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | PASS |
| `qa/fixtures/sprint08/c/run-learning-cases.json` | `cab2ce9759f31f8c8dac4dff80ee924197fcf14733f5384b7c9f39b0ca865cbf` | PASS |
| `go/internal/localdb/product/schema.go` | `ff9d2b337b930bde60edb0783e58c56d2f700e56e64388204974bf9c9f2a509f` | PASS |
| `go/migrations/s08b_001-governed-memory.sql` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | PASS |
| `go/migrations/s08c_001-run-learning.sql` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | PASS |
| `src/lib/llmops/contracts.ts` | `3096d1ce712041c165eddfd6a6c49805eaecf50d317fd95af7685da8091afc7d` | PASS |

## Focused checks

| Check | Result |
|---|---|
| `go test ./internal/admission ./internal/scheduler ./internal/allocator` | PASS |
| `go test ./internal/memory -count=20` | PASS |
| `go test ./internal/runlearning -count=100` | PASS |
| `go vet ./internal/runlearning` | PASS |
| `go test ./internal/localdb/core ./internal/localdb/product ./internal/allocator ./internal/builderexec ./internal/sandbox ./internal/scheduler` | PASS |
| `npx --no-install tsx --test src/features/forecast/forecast.test.ts` | PASS; 2/2 |
| `npx --no-install tsc --noEmit --pretty false` | PASS |

No copy, SQL application, publication, cutover, legacy-writer change, Phase 21 change, commit, or other source mutation was performed. The legacy writer remains disabled and Phase 21 remains blocked.

Status: DONE
JOB_DONE: S08-MASTER-PROMOTION
