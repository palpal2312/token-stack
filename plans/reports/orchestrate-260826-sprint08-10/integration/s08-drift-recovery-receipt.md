# Sprint 08 transformed-promotion drift recovery receipt

JOB_DONE: S08-DRIFT-RECOVERY

| Path | Before SHA-256 | Archive path | Archive SHA-256 | Manifest preimage | After SHA-256 |
|---|---|---|---|---|---|
| `go/internal/runlearning/runlearning.go` | `3d653bc725460b1469e6baa45003f415be22f0bfae91e5651ed32965efe86e6c` | `plans/reports/orchestrate-260826-sprint08-10/integration/drift-archive/runlearning.go.before-recovery.bin` | `3d653bc725460b1469e6baa45003f415be22f0bfae91e5651ed32965efe86e6c` | `ABSENT` (removed before promotion) | `6e99c6701c6cdfd6e77e4bc57c8cfb834a3394db35106e7d1798e6bddd8e6af0` |
| `src/lib/llmops/contracts.ts` | `e129cbd5e6f94c403f413bea48992c8600f6de1242faaa804dd0632b4b5649a6` | `plans/reports/orchestrate-260826-sprint08-10/integration/drift-archive/contracts.ts.before-recovery.bin` | `e129cbd5e6f94c403f413bea48992c8600f6de1242faaa804dd0632b4b5649a6` | `72b624ffb8f9815007a27194f71c126d5664e7c32eb5ac35a05b565dd7f357dc` (exact `HEAD:src/lib/llmops/contracts.ts` bytes) | `3096d1ce712041c165eddfd6a6c49805eaecf50d317fd95af7685da8091afc7d` |

## Verification

- Candidate raw-byte hashes matched the specified promoted artifacts before copying.
- The master artifacts match the required candidate SHA-256 values after binary-safe copies.
- Only the two approved recovery paths and this recovery archive/receipt were written.
