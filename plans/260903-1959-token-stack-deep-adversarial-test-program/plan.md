---
title: "Token Stack Deep Adversarial Test Program"
description: "Extend the 19-test Token-Stack baseline into a hermetic adversarial, property, mutation, chaos, lifecycle, compatibility, soak, and controlled-live certification program."
status: complete
priority: P1
effort: "10-15d"
branch: master
tags: [token-stack, test, qa, security, fuzzing, mutation, performance]
blockedBy: []
blocks: []
created: 2026-09-03
---

# Token Stack Deep Adversarial Test Program

## Outcome

Turn the completed foundational suite into production-grade evidence: deterministic offline tests must expose contract violations, hostile inputs, partial failures, unsafe lifecycle behavior, secret leakage, compatibility drift, resource leaks, and performance regressions without touching user state or a paid provider.

## Baseline And Scope Challenge

- Reuse: 19/19 tests, 84.89% lines, 73.75% branches, 81.08% functions; repository-local runner, temp roots, secret scan, loopback verifier, CI job.
- Requested scope: deeper testing plan only. No implementation in this planning pass.
- Complexity: seven CJS modules plus PowerShell, installer, registry, networking, packaging, CI, and live boundary justify eight gated phases.
- Mode: HOLD SCOPE / deep. The completed [foundational strategy](../260903-1904-token-stack-comprehensive-test-strategy/plan.md) is prior evidence, not a blocker.

## Constraints

- Offline by default; only ephemeral `127.0.0.1` listeners.
- All mutable state under a unique temp root; scrub inherited environment.
- Start/stop only test-owned processes; zero orphan PID/listener after every run.
- Never persist credentials, raw provider payloads, private paths, or user files.
- Preserve public behavior unless a failing test proves a safety/testability defect.

## Non-Goals

- No Sub2API resale gateway work or dependency on its pending plan.
- No Next.js, Go, Agentic OS UI/daemon testing.
- No paid provider call in PR CI; no benchmark marketing claim as correctness evidence.
- No claim of Linux/macOS CLI support until its full PowerShell/install matrix passes.

## Phases

| # | Phase | Depends on | Effort |
|---|---|---|---:|
| 1 | [Hermetic harness and failure model](./phase-01-start.md) | — | 1.5-2d |
| 2 | [Core property and deterministic fuzz](./phase-02-core-property-and-deterministic-fuzz.md) | 1 | 2-3d |
| 3 | [Mutation and coverage-guided fuzzing](./phase-03-mutation-and-coverage-guided-fuzzing.md) | 2 | 1-2d |
| 4 | [PowerShell CLI, registry, and lifecycle](./phase-04-powershell-cli-registry-and-lifecycle.md) | 1 | 2-3d |
| 5 | [Verifier protocol chaos and redaction](./phase-05-verifier-protocol-chaos-and-redaction.md) | 1, 4 | 1.5-2d |
| 6 | [Installer, packaging, and compatibility](./phase-06-installer-packaging-and-compatibility.md) | 1, 4 | 1.5-2d |
| 7 | [Performance, soak, and resource bounds](./phase-07-performance-soak-and-resource-bounds.md) | 2, 4, 5 | 1-2d |
| 8 | [CI evidence and live certification](./phase-08-ci-evidence-and-live-certification.md) | 3, 5, 6, 7 | 1-2d |

## Plan-Wide Gates

- 100% required tests pass; zero skipped/cancelled cases in the offline PR gate.
- Zero writes outside temp root, external connections, secret-canary matches, unowned kills, orphan processes/listeners.
- Overall core coverage at least 85% lines / 75% branches initially. Critical files `semantic-cache.cjs`, `turn-folder.cjs`, `cot-governor.cjs`, and `guardrail.cjs` each require at least 90% lines / 80% branches.
- Fixed-seed properties reproduce by seed/path; minimized fuzz corpus is non-secret.
- Mutation score at least 75% overall / 80% critical after calibration; every survivor classified.
- Twenty consecutive full offline runs have zero flakes.
- Each receipt names commit, command, Node/PowerShell version, seed, fixture hash, duration, and cleanup verdict.

## Decisions Before Execution

1. Treat Node 24 and Windows PowerShell 5.1 as authoritative today; pwsh 7 and non-Windows are characterization until support is explicitly adopted.
2. Use `node:test` + `fast-check`; schedule StrykerJS; keep Jazzer.js optional until deterministic fuzz corpus and timeouts are stable.
3. Make missing credentials/profile a nonzero certification preflight failure, while ordinary offline verification retains explicit SKIP.
4. Keep timing advisory until a controlled baseline has variance at or below 10%; correctness and leak gates remain blocking.
5. Critical invariants are `CACHE-SECRET` (no secret persistence/return), `FOLD-PRESERVE` (live/error/order/schema preservation and non-expansion), `COT-BOUND` (finite policy-bound budget and valid max tokens), and `GUARD-FAIL-CLOSED` (bounded loop detection, usage cap, transient-only replay).
6. One live certificate permits at most two upstream calls total (direct + proxy), ten requested output tokens total, a fixed synthetic prompt of at most eight tokens, and an estimated cost ceiling of USD 0.02. Missing trustworthy price metadata fails preflight.

## Success Criteria

- [ ] Every exported core/PowerShell contract owns happy, boundary, invalid, security, and failure-injection scenarios.
- [ ] Installed CLI works from a relocated clean prefix without checkout-only environment variables.
- [ ] HTTP/SSE chaos cannot produce false PASS or secret-bearing artifacts.
- [ ] Lifecycle tests prove ownership before termination and leave no resources behind on success, failure, or timeout.
- [ ] PR, scheduled, and protected-live workflows have distinct triggers, budgets, exit semantics, and evidence.
- [ ] Whole-plan validation finds zero stale paths, unsupported claims, or unresolved contradictions.

## Red-Team And Validation Log

- Accepted and resolved: failpoints/rollback for both installers; exact critical-file/invariant set; executable performance formula; explicit live call/token/cost ceiling.
- Dependency graph: acyclic. Cited production paths/interfaces: verified against current worktree.
- Validation questions resolved: safe phase order, measurable gates, default-off live access, evidenced support matrix, and no gateway dependency all have explicit plan contracts.
- Whole-plan consistency sweep: all plan and phase files reread; four decision deltas reconciled; unresolved contradictions: 0.

## Research

- [Research summary](./reports/research-summary.md)

<!-- slug: token-stack-deep-adversarial-test-program -->
