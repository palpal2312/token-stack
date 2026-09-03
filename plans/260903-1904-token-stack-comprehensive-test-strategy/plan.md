---
title: "Token Stack Comprehensive Test Strategy"
description: "A deterministic, isolated, security-aware test strategy for the Token-Stack 14-layer CLI modules, setup flow, and profile verifier."
status: completed
priority: P1
effort: "3-5d"
tags: [token-stack, test, qa, ci, security]
blockedBy: []
blocks: []
created: 2026-09-03
---

# Token-Stack Comprehensive Test Strategy

## Overview

Replace the ad-hoc executable scripts under `tests/` with an isolated Node test
suite and add contract, CLI, setup, and controlled live-verifier coverage. The
plan covers Token-Stack only (`core/`, `bin/`, `skills/`, registry, and its
tests); it deliberately excludes the unrelated Agentic OS Next.js and Go
surfaces co-located in this worktree.

## Scope Challenge

- Existing code: ten standalone Node assertion scripts cover the seven core
  modules, setup, a CLI smoke, and stress cases; `tests/test-all-layers.cjs`
  serially shells out to each one. GitHub CI currently runs `npm run test`,
  which exercises Agentic OS tests, not this Token-Stack runner.
- Requested scope: a detailed plan for testing this repository. This plan
  delivers a test architecture and execution roadmap, not product features or
  upstream-provider credentials.
- Complexity: more than eight files across Node, PowerShell, registry and CI;
  five phases are justified because isolation must precede stateful and live
  testing. Selected mode: HOLD SCOPE / deep test-planning analysis.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Make every Token-Stack test hermetic: no user profile, global CLI, persistent cache, daemon, or network dependency by default. | P1 |
| 2 | Protect behavioral and schema contracts for all locally implemented core layers. | P1 |
| 3 | Verify PowerShell CLI, setup, registry, and verifier behavior through controlled seams. | P1 |
| 4 | Add CI gates with truthful unit, integration, optional live, and security verdicts. | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Baseline and safety contract](./phase-01-start.md) | Pending |
| 2 | [Isolate test runtime](./phase-02-isolate-test-runtime.md) | Pending |
| 3 | [Protect core contracts](./phase-03-protect-core-contracts.md) | Pending |
| 4 | [Exercise CLI and setup safely](./phase-04-exercise-cli-and-setup-safely.md) | Pending |
| 5 | [Enforce CI quality gates](./phase-05-enforce-ci-quality-gates.md) | Pending |

## Test Architecture

```text
fixtures + temporary test home + fake executables/listeners
                         |
                         v
core unit contracts -> registry/PowerShell integration -> CLI process tests
                         |                                  |
                         +-------------+--------------------+
                                       v
                         offline CI gate + opt-in live gate
```

The default gate must be offline and deterministic. A separate, explicitly
opted-in live profile gate may probe a loopback proxy and a provider only when
an injected credential is available; it must redact all request headers,
response bodies, paths outside the repository, and secrets from its receipt.

## Current Risks to Close

| Risk | Evidence | Planned control |
|---|---|---|
| User-state mutation | semantic-cache defaults to a user-home file; setup provisions a user-home workspace | inject a per-test home/cache and assert cleanup |
| False CLI confidence | `cli-e2e.test.cjs` calls the global `token-stack` command but converts failure into a warning | invoke the repository script directly and require a non-zero failure |
| CI coverage gap | `.github/workflows/ci.yml` invokes the worktree's `npm run test`, not the Token-Stack suite | add a dedicated Token-Stack command and CI job |
| Unsafe verifier design | verifier reads local profile auth and contains a fallback authentication path | remove fallback behavior; test secret-free source and injected-only auth |
| Non-standard runner | tests are standalone scripts with hand-rolled output | migrate to Node's built-in `node:test` with TAP-compatible reporting and coverage |

## Non-Goals

- Do not start or stop a user-owned proxy, ClickHouse instance, or global CLI.
- Do not make paid/upstream API calls in default CI.
- Do not claim benchmark percentages as correctness or coverage evidence.
- Do not alter the pending Sub2API resale-gateway plan; it has no explicit
  dependency on this foundational QA work.

## Success Criteria

- [ ] `npm run test:token-stack` is repeatable from a clean checkout and has no
      writes outside its temporary test root.
- [ ] Every core module has deterministic happy-path, invalid-input, boundary,
      and regression coverage, including secret rejection and schema invariants.
- [ ] CLI/setup tests exercise repository-local entrypoints and fail closed.
- [ ] Offline CI runs lint/static checks, unit tests, integration tests, and a
      repository-secret scan; live verification is opt-in and produces a
      redacted receipt.

<!-- slug: token-stack-comprehensive-test-strategy -->
