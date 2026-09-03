# Token-Stack test manifest

| Area | Test command | Class | Allowed roots, ports, commands, and budgets |
|---|---|---|---|
| Environment & Isolation | `npm run test:token-stack` | Contract | Isolated sandbox (`withSandbox`), env scrub, zero host touch. Budget: 10s. |
| Core Units & Regressions | `npm run test:token-stack` | Unit | Pure Node.js; deterministic corpus replay. Budget: 5s. |
| Core Property Generators | `npm run test:token-stack` | Property | Fast-check generators across 8 invariants (500 runs each). Budget: 10s. |
| PowerShell CLI & Process | `npm run test:token-stack` | CLI/Process | Ephemeral registry, argument safety, process tree-kill, zero orphans. Budget: 20s. |
| Verifier Chaos & Redaction | `npm run test:token-stack` | Chaos/Redaction | Fault-injected loopback server, secret canary leak detection. Budget: 20s. |
| Installer & Packaging | `npm run test:token-stack` | Packaging | Clean install, idempotency, version compatibility (Node 18+, PS 5.1+). Budget: 25s. |
| Soak & Microbenchmarks | `npm run test:token-stack` | Soak/Perf | 1,000 sustained cycles, heap growth < 35MB, core latency < 2ms. Budget: 30s. |
| Bounded Parser Fuzzing | `powershell -File scripts/test-token-stack-fuzz.ps1` | Fuzz | 1,000+ pure fuzz iterations for DataLens, TurnFolder, SemanticCache. Budget: 30s. |
| Mutation Testing Gate | `powershell -File scripts/test-token-stack-mutation.ps1` | Mutation | Stryker / calibrated property gate (≥75% overall, ≥80% critical). Budget: 120s. |
| Flake Detection Loop | `powershell -File scripts/test-token-stack-flake.ps1 -Runs 10` | Flake | N-run repeatability without retry masking. Budget: 300s. |
| Provider/proxy verifier | `powershell -File scripts/certify-token-stack-live.ps1` | Live opt-in | Explicit `-AllowLive`, provider allowlist. Max 2 calls, 10 tokens output, $0.02 budget. |

## Isolation & Resource Bounds

1. **Filesystem Sandbox**:
   - All write operations must stay within isolated temp roots (`os.tmpdir()/token-stack-*`).
   - Boundary checks via `filesystem-snapshot.cjs` enforce zero writes to user directories (`USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`).
2. **Network Policy**:
   - Strictly loopback-only (`127.0.0.1`, `localhost`, `::1`).
   - Sockets must be destroyed and closed in test `finally` blocks. Ports must prove immediate rebindability.
   - All HTTP authorization and secret headers are sanitized via SHA256 hashes in test recordings.
3. **Process Lifecycle**:
   - All spawned processes are tracked with PID, run ID, and start timestamps.
   - Process trees are killed using `taskkill /PID <pid> /T /F` on timeout.
   - Zero orphan processes policy is asserted by `verifyZeroOrphanProcesses()`.
4. **Time Budgets**:
   - Per unit test: ≤10s.
   - Per integration subprocess: ≤25s.
   - Full offline test suite: ≤60s.
