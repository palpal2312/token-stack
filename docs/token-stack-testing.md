# Token-Stack Testing Guide

This guide documents the execution, structure, and quality gates of the **Token-Stack Deep Adversarial Test Program**.

## 1. Quick Start Commands

All tests execute from the repository root using repository-local scripts, hermetic sandboxes, and loopback sockets:

```powershell
# 1. Complete Offline Test Suite (88 tests across 16 suites)
npm run test:token-stack

# 2. Coverage Ratchet (Line ≥85%, Branch ≥75%, Critical ≥90%/80%)
npm run test:token-stack:coverage

# 3. Bounded Parser Fuzzing (1,000 pure iterations)
powershell -File scripts/test-token-stack-fuzz.ps1 -Iterations 1000

# 4. Soak, Memory Bounds & Core Latency Microbenchmarks
powershell -File scripts/test-token-stack-soak.ps1 -Cycles 1000

# 5. Scheduled Mutation Testing Gate
powershell -File scripts/test-token-stack-mutation.ps1

# 6. Flake Detection Loop (N=10/20 iterations without retry masking)
powershell -File scripts/test-token-stack-flake.ps1 -Runs 10 -StopOnFailure

# 7. Protected Live Provider Certification (Requires explicit authorization)
powershell -File scripts/certify-token-stack-live.ps1 -Profile default -ApiKey "<key>" -AllowLive
```

## 2. Test Architecture & Directory Structure

- **`tests/token-stack/`**:
  - `environment-contract.test.cjs`: Sandbox boundary, env scrubbing, zero host touching.
  - `core.test.cjs`: Unit tests for pure core algorithms.
  - `core-properties.test.cjs`: Fast-check property-based generative invariants (8 properties, 500 runs each).
  - `core-fuzz-regressions.test.cjs`: Replay runner for 12 regression corpus cases.
  - `powershell-cli.test.cjs`: Subcommand routing, strict exit codes, argument injection safety.
  - `registry-port.test.cjs`: Atomic registry JSON updates, concurrency, port allocation boundaries.
  - `setup-install.test.cjs`: Setup dry-run zero write verification, apply mode, corrupted settings recovery.
  - `process-lifecycle.test.cjs`: Headroom proxy readiness probe, clean tree-killing, zero orphan processes.
  - `verifier-chaos.test.cjs`: Scripted failure matrix (400, 429, 500, truncated SSE, socket reset).
  - `redaction.test.cjs`: Secret canary leak detection across stdout, stderr, and disk files.
  - `installer.test.cjs`: Installation idempotency and rollback verification.
  - `packaging.test.cjs`: CommonJS module syntax, package.json integrity, script definitions.
  - `compatibility.test.cjs`: Node >=18, PowerShell >=5.1, cross-platform path handling.
  - `soak-stress.test.cjs`: 1,000 sustained cycles, memory heap bounds (<35MB), 500-entry cache cap.
  - `benchmarks.test.cjs`: Latency microbenchmarks asserting all core operations execute in <2.0ms.
  - `integration.test.cjs`: End-to-end integration and profile flow.

- **`tests/token-stack/helpers/`**:
  - `filesystem-snapshot.cjs`: Recursive disk snapshotting and boundary escape assertions.
  - `network-harness.cjs`: Ephemeral loopback server (127.0.0.1 only), header sanitizer, port rebind verifier.
  - `process-harness.cjs`: Owned PID tracking, Windows process tree-killing (`taskkill /PID /T /F`), foreign PID refusal.
  - `fake-anthropic-server.cjs`: Scripted Anthropic and Headroom proxy mock with fault injection.

- **`tests/token-stack/fixtures/`**:
  - `README.md`: Provenance rules (100% synthetic, zero real credentials).
  - `fuzz/core-regression-corpus.json`: 12-scenario regression corpus.
  - `verifier/`: Valid and truncated SSE streams, test profiles.
  - `install-profiles/`: Clean and corrupted profile templates.

## 3. Quality Gates & Coverage Ratchet

| Target | Line Coverage % | Branch Coverage % | Status |
|---|:---:|:---:|:---:|
| `core/guardrail.cjs` | 100.00% | 92.59% | ✅ PASS |
| `core/turn-folder.cjs` | 100.00% | 94.12% | ✅ PASS |
| `core/cot-governor.cjs` | 97.62% | 96.15% | ✅ PASS |
| `core/semantic-cache.cjs` | 96.20% | 94.64% | ✅ PASS |
| `core/model-router.cjs` | 100.00% | 100.00% | ✅ PASS |
| **All Modules Aggregate** | **88.79%** | **80.74%** | ✅ PASS |

## 4. Safety & Redaction Principles

1. **Zero Secret Leakage**: `scripts/check-token-stack-secrets.cjs` statically scans all `.cjs`, `.js`, `.ps1`, `.json`, `.md`, `.sse`, and `.yml` files before testing.
2. **Hermetic Isolation**: Tests run strictly in `os.tmpdir()` with inherited sensitive environment variables (`TOKEN_STACK_API_KEY`, `ANTHROPIC_API_KEY`) scrubbed.
3. **No External Egress in CI**: All tests communicate only with loopback `127.0.0.1` sockets.
4. **Live Provider Protection**: Live certification requires explicit `-AllowLive`, allowlisted hosts (`api.anthropic.com`, `api.kimi.com`, `*.aliyuncs.com`), and strict caps (max 2 requests, 10 output tokens, USD 0.02 cost).

