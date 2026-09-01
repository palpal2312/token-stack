# S14 Phases 1-3 — CI and dev-loop receipt

## Status
DONE. `npm run test` = 56/56 (shell 20 + parser 3 + s10 33) · `npm run go:check`
= go vet + 15 packages ok (via PowerShell in package.json script) ·
`scripts/dev-sen-plane.ps1` parses (builds+starts sen-plane on a dev store root,
prints 5 URLs + PID) · `.github/workflows/ci.yml` (windows-latest, Node 24 + Go
1.26; jobs test/go/tsc; push+PR triggers; no deploy, no secrets).

## Notes
- CI uses npm ci + package.json "test" — package manager decl is pnpm; may
  switch CI to pnpm later (non-blocking).
- Dev-loop: kept as an opt-in helper (does not auto-spawn in `next dev`).

JOB_DONE: S14 P1-3 verified locally; close gate next.
