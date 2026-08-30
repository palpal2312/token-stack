# Sprint 08 master promotion rollback receipt

JOB_DONE: S08-MASTER-PROMOTION-ROLLBACK

## Result

Rollback was not applied.  The required pre-mutation guard found two unexpected destination hashes, so no promotion destination was restored or removed.

## Guard source

- Manifest: `C:/Users/ADMIN/orca/workspaces/source/sprint08-integration/plans/reports/orchestrate-260826-sprint08-10/integration/s08-promotion-manifest.md`
- Master root: `C:/Users/ADMIN/Documents/Agent OS/source`

## Exact before / after hashes

No destination was mutated; each after value is therefore identical to the recorded before value.

| Path | Manifest promoted hash | Before SHA-256 | After SHA-256 | Expected rollback state | Guard result |
|---|---|---|---|---|---|
| `go/internal/admission/s08a_001_admission.go` | `b034e3a9bc6759a85a2275275f47aa74aaef1f840595b2854d4b1f609ba4d93e` | `b034e3a9bc6759a85a2275275f47aa74aaef1f840595b2854d4b1f609ba4d93e` | `b034e3a9bc6759a85a2275275f47aa74aaef1f840595b2854d4b1f609ba4d93e` | `ABSENT` | matched promoted hash |
| `go/internal/admission/s08a_001_admission_test.go` | `9490ad5b247b6d8d2b951571a65b34b5cb90370bc031b67961a50ebb84d91328` | `9490ad5b247b6d8d2b951571a65b34b5cb90370bc031b67961a50ebb84d91328` | `9490ad5b247b6d8d2b951571a65b34b5cb90370bc031b67961a50ebb84d91328` | `ABSENT` | matched promoted hash |
| `go/internal/allocator/live_scoring_allocator.go` | `f5071a43ef1836444de69a94f4952d6ddef5653be3b9e2f90d64e3279c151d3b` | `f5071a43ef1836444de69a94f4952d6ddef5653be3b9e2f90d64e3279c151d3b` | `f5071a43ef1836444de69a94f4952d6ddef5653be3b9e2f90d64e3279c151d3b` | `79608171bd74158d4b9341a50f4e0a173696889f78db8bfa65b92f0783548b84` | matched promoted hash |
| `go/internal/allocator/fairness_test.go` | `924d197ae71368363fc59395b8ee6752bec218b9c764836e40f14da4d3003e99` | `924d197ae71368363fc59395b8ee6752bec218b9c764836e40f14da4d3003e99` | `924d197ae71368363fc59395b8ee6752bec218b9c764836e40f14da4d3003e99` | `ABSENT` | matched promoted hash |
| `go/internal/scheduler/catchup.go` | `c07feced0684aefe4aa2864cb0c7d458aa950c15d4c581cd4b25860215f32bbd` | `c07feced0684aefe4aa2864cb0c7d458aa950c15d4c581cd4b25860215f32bbd` | `c07feced0684aefe4aa2864cb0c7d458aa950c15d4c581cd4b25860215f32bbd` | `ABSENT` | matched promoted hash |
| `go/internal/scheduler/catchup_test.go` | `4d651c9da08340933d283d6b2370a623370fe7d77532b22ec3524a2f31b1bdb9` | `4d651c9da08340933d283d6b2370a623370fe7d77532b22ec3524a2f31b1bdb9` | `4d651c9da08340933d283d6b2370a623370fe7d77532b22ec3524a2f31b1bdb9` | `ABSENT` | matched promoted hash |
| `src/app/api/sen/scheduler/forecast/route.ts` | `3bf04a9654f3013a87a9113d28a30fb55a211872d43a5df0138f7903844f1740` | `3bf04a9654f3013a87a9113d28a30fb55a211872d43a5df0138f7903844f1740` | `3bf04a9654f3013a87a9113d28a30fb55a211872d43a5df0138f7903844f1740` | `ABSENT` | matched promoted hash |
| `src/features/forecast/forecast.ts` | `d0abdb4ee30891a58496373d4543a13dcb608ba77696f0a604a27b813dbea2ff` | `d0abdb4ee30891a58496373d4543a13dcb608ba77696f0a604a27b813dbea2ff` | `d0abdb4ee30891a58496373d4543a13dcb608ba77696f0a604a27b813dbea2ff` | `ABSENT` | matched promoted hash |
| `src/features/forecast/forecast.test.ts` | `68e1b1d37ad2f1e9df9fb619b4fafc07494d032af9c29954dbffd8bc1241691c` | `68e1b1d37ad2f1e9df9fb619b4fafc07494d032af9c29954dbffd8bc1241691c` | `68e1b1d37ad2f1e9df9fb619b4fafc07494d032af9c29954dbffd8bc1241691c` | `ABSENT` | matched promoted hash |
| `src/features/forecast/ForecastCard.tsx` | `5917cc06955d5dcf7ae884eeb32e49ab2f994d95531ef1a7c7e68b70c2078556` | `5917cc06955d5dcf7ae884eeb32e49ab2f994d95531ef1a7c7e68b70c2078556` | `5917cc06955d5dcf7ae884eeb32e49ab2f994d95531ef1a7c7e68b70c2078556` | `ABSENT` | matched promoted hash |
| `qa/fixtures/sprint08/a/forecast-low-confidence.json` | `b1e0bf644b5517194068f550cc2cd87ccf808648d5edd4d45ce9935c837d6f43` | `b1e0bf644b5517194068f550cc2cd87ccf808648d5edd4d45ce9935c837d6f43` | `b1e0bf644b5517194068f550cc2cd87ccf808648d5edd4d45ce9935c837d6f43` | `ABSENT` | matched promoted hash |
| `go/internal/memory/memory.go` | `e21a1b9aebc58400ef0ae4a86b99d4f51dc711ac2ac6412ca2b9481bcda91564` | `e21a1b9aebc58400ef0ae4a86b99d4f51dc711ac2ac6412ca2b9481bcda91564` | `e21a1b9aebc58400ef0ae4a86b99d4f51dc711ac2ac6412ca2b9481bcda91564` | `ABSENT` | matched promoted hash |
| `go/internal/memory/memory_test.go` | `3df11370428a68292e61d702c907dd40e5eb0c3e7b9e1530bb9b7ce40bfbe90e` | `3df11370428a68292e61d702c907dd40e5eb0c3e7b9e1530bb9b7ce40bfbe90e` | `3df11370428a68292e61d702c907dd40e5eb0c3e7b9e1530bb9b7ce40bfbe90e` | `ABSENT` | matched promoted hash |
| `go/internal/memory/s08b_001-governed-memory.sql` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | `ABSENT` | matched promoted hash |
| `qa/fixtures/sprint08/b/memory-cases.json` | `153a6ad27682dfa0d63a23d1bccd56eb3c17f360d7bfd45077bd65f7744ddc12` | `153a6ad27682dfa0d63a23d1bccd56eb3c17f360d7bfd45077bd65f7744ddc12` | `153a6ad27682dfa0d63a23d1bccd56eb3c17f360d7bfd45077bd65f7744ddc12` | `ABSENT` | matched promoted hash |
| `go/internal/runlearning/runlearning.go` | `6e99c6701c6cdfd6e77e4bc57c8cfb834a3394db35106e7d1798e6bddd8e6af0` | `3d653bc725460b1469e6baa45003f415be22f0bfae91e5651ed32965efe86e6c` | `3d653bc725460b1469e6baa45003f415be22f0bfae91e5651ed32965efe86e6c` | `ABSENT` | **unexpected hash; stopped** |
| `go/internal/runlearning/runlearning_test.go` | `46e9b37cd2add4539335de32236c5c74717be54c829f02f8cd379ba46ed99afd` | `46e9b37cd2add4539335de32236c5c74717be54c829f02f8cd379ba46ed99afd` | `46e9b37cd2add4539335de32236c5c74717be54c829f02f8cd379ba46ed99afd` | `ABSENT` | matched promoted hash |
| `go/internal/runlearning/s08c_001-run-learning.sql` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | `ABSENT` | matched promoted hash |
| `qa/fixtures/sprint08/c/run-learning-cases.json` | `cab2ce9759f31f8c8dac4dff80ee924197fcf14733f5384b7c9f39b0ca865cbf` | `cab2ce9759f31f8c8dac4dff80ee924197fcf14733f5384b7c9f39b0ca865cbf` | `cab2ce9759f31f8c8dac4dff80ee924197fcf14733f5384b7c9f39b0ca865cbf` | `ABSENT` | matched promoted hash |
| `go/internal/localdb/product/schema.go` | `ff9d2b337b930bde60edb0783e58c56d2f700e56e64388204974bf9c9f2a509f` | `ff9d2b337b930bde60edb0783e58c56d2f700e56e64388204974bf9c9f2a509f` | `ff9d2b337b930bde60edb0783e58c56d2f700e56e64388204974bf9c9f2a509f` | `d9160e63aee84f00c39d827f52fee34123b6330f0691814f65b777de725dec94` | matched promoted hash |
| `go/migrations/s08b_001-governed-memory.sql` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | `e5612221dce12711f7800fd721736b10f5d065e46999129553060165f815e9a4` | `ABSENT` | matched promoted hash |
| `go/migrations/s08c_001-run-learning.sql` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | `85b735090917fb570b7bcbe7afa229e14b5145d419d3ccdee74a44f8d47c8c43` | `ABSENT` | matched promoted hash |
| `src/lib/llmops/contracts.ts` | `3096d1ce712041c165eddfd6a6c49805eaecf50d317fd95af7685da8091afc7d` | `e129cbd5e6f94c403f413bea48992c8600f6de1242faaa804dd0632b4b5649a6` | `e129cbd5e6f94c403f413bea48992c8600f6de1242faaa804dd0632b4b5649a6` | `72b624ffb8f9815007a27194f71c126d5664e7c32eb5ac35a05b565dd7f357dc` | **unexpected hash; stopped** |

## Verification

The required rollback-state verification and `git diff --check` were intentionally not run, because the guard prohibits proceeding after unexpected hashes. The working tree confirms the two conflicting paths are independently dirty: `go/internal/runlearning/runlearning.go` is untracked and `src/lib/llmops/contracts.ts` is modified.
