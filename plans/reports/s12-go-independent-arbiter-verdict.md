# S12 Close Gate — Independent Arbiter Verdict

## Authority and decision

Independent arbiter for the S12 close gate (wiring/coverage/planning scope),
reviewing committed evidence at master `47cdda0a122e59a4f8ca7d3c9e78e5110baf4308`
(not the packet author; read-only scrutineer).

**Decision: GO** for S12 close, per the decision rule (suites pass, go plane
green, S10/S11 chains intact, controls hold, enable-gate stays off, and the
speculative API cut holds — all verified independently below).

**Scope of this GO:** closes the S12 wiring/coverage/planning scope only
(go-plane runtime wiring phase 1 + 1b, coverage/de-risking phase 2, desktop-shell
enable-gate phase 3). This GO does **NOT** authorize release, cutover,
legacy-writer enablement, Phase 21, or flipping `desktop_shell_v2` in
production. Those remain owner-approved gates.

## Checks actually run (with outcomes)

| # | Check | Outcome |
|---|-------|---------|
| 1 | Evidence docs read: `plans/reports/s12-phase1-go-plane-wiring-260831.md`, `plans/260831-1452-s12-go-plane-integration-and-coverage/plan.md`, `plans/260831-1809-s12-desktop-shell-enable-gate/plan.md` | Phase 1+1b receipt DONE (live round-trip, 4/4 clients); enable-gate plan is definition-only ("PLAN ONLY — NOT AUTHORIZING A FLIP", `JOB_DONE: definition`) |
| 2 | `npx --no-install tsx --test` shell suite (7 files) | **pass 20 / fail 0** (expected 20) |
| 3 | `npx --no-install tsx --test qa/tests/s10-*.test.ts` | **pass 33 / fail 0** (expected 33) |
| 4 | `cd go && go build ./... && go vet ./...` | **BUILD_OK / VET_OK** |
| 5 | `cd go && go test -count=1 ./internal/... ./cmd/...` | **all ok**: 14 internal packages + `cmd/sen-plane` = 15 packages green (adapter, admission, allocator, builderexec, localdb/community, localdb/core, localdb/handoff, localdb/product, memory, orca, reconcile, runlearning, sandbox, scheduler, cmd/sen-plane) |
| 6 | `newos-receipt-verify.ps1` on `plans/reports/sprint10/s10-phase5-closeout-receipt.md` | **PASS** (1 JOB_DONE marker, 8/8 SHA-256 hashes match) |
| 7 | `newos-receipt-verify.ps1` on `plans/reports/sprint10/s10-phase5-current-byte-close-packet.md` (close-packet variant) | **PASS** (1 JOB_DONE marker, 25/25 SHA-256 hashes match) |
| 8 | Controls grep `legacy_writer:\s*enabled` and `phase_21:\s*enabled` in `src/` and `go/` | **0 hits** both keys, both trees |
| 9 | Control state confirmation | only reference is the invariant banner `legacy_writer: disabled; phase_21: blocked.` (`src/app/orchestration/page.tsx:209`); `desktop_shell_v2` OFF by default (`desktopShellV2Enabled` returns false unless env is exactly `1`/`true`; shell suite test "desktop shell v2 is OFF by default" passed) |
| 10 | Speculative API cut (`git show 6e92f8c`) | surgical: reconcile Decision/Classify/ObservationContract/ValidPhase/DiagnosticOverflow + allocator ReasonAlreadyAssigned removed (148 del / 1 ins); full-tree grep confirms all six symbols **gone** from `go/`; reconcile + allocator + orca tests green |

## Current-byte pins (sha256sum of verified artifacts)

```
9d9a1e87c0dda3ed8b65cc66401bbbf5ebc8dfeb11d9fa0475c9c670ce6bce87 *plans/reports/s12-phase1-go-plane-wiring-260831.md
e3fd07b7b757bbe8030442e7055ebcd98cde9fca428216b746bbaf5047930454 *plans/260831-1452-s12-go-plane-integration-and-coverage/plan.md
19dacf7e3bdfd6c761f7a75702d303f17173d39c270aeefe161a8c7e926230cd *plans/260831-1809-s12-desktop-shell-enable-gate/plan.md
ed8100fb7f861a31d2124499f745ecfca2540eb10709623d112fd1649d110f77 *src/shell/desktop-shell-flag.ts
410f9aca299c3fb1ddc646190a1c8f10800d2a9a7ae330a618b1645d03b90032 *src/shell/view-session-store.test.ts
e4c9130385756f45268aab063f2262710bf7e5840b821512816ec807f278820b *src/shell/intent-prefetch.test.ts
5ec43244fb0a467007b23abf45e7a435bc2e7f1f9d6df8c8f48cee4a18801811 *src/shell/desktop-shell-flag.test.ts
c8cb3a5d05e1af6f56762b35252fdf3ed141281f32d9476e2d5a8c9d0d844de8 *src/shell/desktop-module-registry.test.ts
8fbc0879fdb319d612db77e2350fa6d54f8bf01773f60bf5dd16721fda9954d8 *src/shell/panel-layout-store.test.ts
99875a2ceb2e011713f0e661474410445bdc7b474024db0355028d0230606870 *src/shell/panel-resize-controller.test.ts
488df9388048e5654305b0d7be81ab4102d052eadc59e5be3b06750f553ed32f *src/shell/sen-surface-store.test.ts
c60936c665af8329cfc1cf1ed9069e9f5c17745d04f5905903846e85be191290 *plans/reports/sprint10/s10-phase5-closeout-receipt.md
72d07cd336d9829302179f7fbaaac276d57be79360531eb94a1ad24b4e0cc0d2 *plans/reports/sprint10/s10-phase5-current-byte-close-packet.md
f9af3810926dcc01f72bbb1721b2f683be372f43d2955c6ab1e2e6c79d6b7cbd *plans/reports/sprint10/s10-CLOSED_GO-record.md
b263db009a83878138f14f7fa0caa0ec03bec2784dab7e88d96ae2bfc5eccef2 *plans/reports/s11-CLOSED_GO-record.md
16aea63f9aa905d8b0bf5e9351ed20dff705a1ce21c8702342cd72663e088f94 *qa/tests/s10-controlled-delivery.test.ts
```

## Protected controls (verified unchanged)

- `legacy_writer` stays `disabled` — no `legacy_writer: enabled` anywhere in `src/` or `go/`.
- `phase_21` stays `blocked` — no `phase_21: enabled` anywhere in `src/` or `go/`.
- `desktop_shell_v2` stays **OFF by default** (request-time env check, exact `1`/`true` only); the S12 enable-gate plan makes no flip — definition-only.

JOB_DONE: S12 close gate independently verified — GO, wiring/coverage/planning scope only; release/cutover/legacy-writer/Phase 21/desktop-shell flip remain ungated by this verdict.