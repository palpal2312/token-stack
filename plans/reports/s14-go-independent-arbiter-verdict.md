# S14 GO — independent close-gate arbiter verdict

## Status

**GO** for the S14 CI/dev-loop scope ONLY, reviewed at master `b058b72`
(`b058b72063ff85175034e3d91127dbf71fe34013`) on 2026-09-01.

## Authority

Independent S14 close-gate arbiter (not the packet author). Read-only gate
review against the S14 plan `plans/260901-0847-s14-ci-and-devloop/plan.md` and
phase receipt `plans/reports/s14-phase1-3-ci-devloop-260901.md`. This GO does
NOT authorize release, cutover, legacy-writer enablement, Phase 21, or any
production desktop-shell flip. Finalize remains gated.

## Checks + outcomes

| # | Check | Outcome |
|---|---|---|
| 1 | Plan + report read | PASS — S14 scope is QA harness / dev-loop starter / CI workflow only |
| 2 | `npm run test` | PASS — 56/56 (shell 20 + parser 3 + s10 33) |
| 3 | `npm run go:check` | PASS — `go vet ./...` clean · 15 packages test green (internal/... + cmd/sen-plane) |
| 4 | `npx --no-install tsc --noEmit -p tsconfig.json` | PASS — exit 0, 0 errors |
| 5 | `scripts/dev-sen-plane.ps1` on master | PASS — tracked at HEAD; parses; build+start dev daemon against isolated dev store, prints URLs + PID, opt-in (no auto-spawn) |
| 6 | `.github/workflows/ci.yml` on master | PASS — tracked at HEAD; windows-latest, jobs test/go/tsc (Node 24, Go 1.26), push+PR triggers; no deploy, no secrets |
| 7 | Chain: newos-receipt-verify on s10 closeout + close packet | PASS — closeout receipt 8/8 hashes match · close packet 25/25 hashes match (verdict PASS) |
| 8 | S12/S13 CLOSED_GO records | PASS — `plans/reports/s12-CLOSED_GO-record.md` (verified at 47cdda0) and `plans/reports/s13-CLOSED_GO-record.md` (d3eb963) both present, both correctly scoped |

## Controls

- `grep 'legacy_writer: enabled' src/ go/` -> 0 hits.
- `grep 'phase_21: enabled' src/ go/` -> 0 hits.
- Only config text present: `legacy_writer: disabled; phase_21: blocked`.
- Desktop-shell flag `src/shell/desktop-shell-flag.ts` stays OFF by default —
  returns false unless env `DESKTOP_SHELL_V2` is exactly `1`/`true`; ON path never
  auto-mounted (suite covers "desktop shell v2 is OFF by default").
- S14 diff adds harness/script/workflow only; no flip authority introduced.

## SHA-256 pins

- `ade4f452443d0491c2943fdfd0b0f9c067d791989915408adfa35fb5618ff358` plans/260901-0847-s14-ci-and-devloop/plan.md
- `b4c23eeabcd8524993ad7b79344ce702ec862ecdb9000fefa2014366e94053ed` plans/reports/s14-phase1-3-ci-devloop-260901.md
- `7f8b10519658c47eb77d2f6759bcdf51a025c9ba6796e10a99f85fc0ca6fa314` scripts/dev-sen-plane.ps1
- `d437137c43c6a1bb8aef951c42bb23d6fcf1b1d060fd5e230c5a8049ab245bc4` .github/workflows/ci.yml
- `54e03ffa51b001c7ac50edd5fb0cb61eaaeccd17e4fc7d6a067c762b6e8e5c72` plans/reports/s12-CLOSED_GO-record.md
- `19ed3b26f447f8691b32fbeb04b7d07e8d5c461896cff6c29424878401643fe0` plans/reports/s13-CLOSED_GO-record.md

## Scope limits

Authorizes closing the S14 plan (QA harness `test:all`, go:check, sen-plane
dev-loop starter, CI workflow). Non-blocking note carried from the phase
receipt: CI uses npm ci + "test" while package manager decl is pnpm — may switch
CI to pnpm later.

JOB_DONE: S14 independent arbiter GO recorded.