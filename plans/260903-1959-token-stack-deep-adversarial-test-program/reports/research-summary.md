---
title: "Token-Stack deep test research summary"
status: completed
created: 2026-09-03
---

# Token-Stack Deep Test Research Summary

## Summary

Current evidence: 19/19 tests; 84.89% lines, 73.75% branches, 81.08% functions; Node 24 and Windows PowerShell 5.1; CI runs the offline Token-Stack job on Windows only.

## Findings

1. Default cache/router exports can inspect user state during import; `TOKEN_STACK_TEST_MODE` is unused by production code.
2. Async PowerShell helpers lack spawn-error, timeout, and owned-tree termination; shared aggregate execution has shown a partial-run hang.
3. Coverage is aggregate, human-output parsed, absent from CI, and excludes PowerShell.
4. Largest core gaps: Data Lens parsing/shell boundaries, Turn Folder branches, strict skill scope, HTML model override, bounded CoT override, canonical guardrail input/replay.
5. Installed wrapper smoke is absent; copied CLI may depend on checkout-only root injection.
6. `up` detaches without ownership; registry writes are non-atomic; port probe-then-bind is racy; two installers diverge.
7. Verifier may forward a key to an arbitrary upstream and validates buffered marker text rather than a complete SSE exchange.
8. Secret scan misses shipped/generated formats while test children inherit the host environment.
9. Only Node 24 + Windows PowerShell 5.1 is evidenced; broader support is unproven.

## Recommendations

- Establish isolation, timeout, ownership, and canary gates before fuzz/lifecycle work.
- Keep `node:test`; add `fast-check`; schedule StrykerJS; defer Jazzer.js until corpus and timeouts stabilize.
- Separate PR correctness, nightly deep jobs, and protected manual live certification.
- Treat timing as statistical evidence on controlled runners.

## Unresolved Questions

- Whether pwsh 7 and non-Windows CLI are product promises.
- Maximum scheduled runtime and protected live provider/cost budget.
- Whether Token-Stack tooling remains in the co-located package or gains a dedicated boundary.
