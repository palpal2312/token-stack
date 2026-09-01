---
phase: 3
title: "Verify + CI"
status: pending
priority: P1
effort: ""
dependencies: [1, 2]
---

# Phase 3: Verify + CI

## Overview
Prove the container commitment in CI and keep the Go gates to a single
definition. The container smoke `docker build` already runs `go vet` + `go
test` in its `go-build` stage — that IS the `go:check` reuse, so CI gains a
container job without duplicating the Go commands anywhere.

## Requirements
- Functional: CI builds the Phase 1 image and runs one smoke (serve dashboard,
  daemon healthz, chat round-trip) whenever the runner can run Docker; the
  identical smoke is documented for native runs so a Docker-less machine gets
  the same proof.
- Non-functional:
  - The Go verification commands appear once — `package.json` `go:check`
    (and in the Dockerfile `go-build` stage) — never re-written per job.
  - Container smoke is non-blocking at first if Docker is unavailable on the
    runner: gate it, don't break master.

## Architecture
- Add a `docker` job to `.github/workflows/ci.yml`:
  - `runs-on: ubuntu-latest` (native Docker, when runners allow) or
    `windows-latest` with a docker-available check; if the platform cannot run
    Docker, the job reports skipped and the native smoke (documented in README /
    run.ps1 output) is the equivalent evidence.
  - Steps: `actions/checkout@v4`, `docker build`, `docker run -p 3737:3737`
    with a temp store, then the same smoke body as Phase 1 verification:
    `GET /`, `GET /healthz`, one `POST /api/v1/sen/chat` and assert
    `turn_seq >= 1` (mirrors the existing `canonical-smoke` job), then stop.
- Keep the existing `canonical-smoke` job; the container job is additive.

## Related Code Files
- Modify: `.github/workflows/ci.yml`.
- Read: `package.json` (`go:check`), Phase 1 `Dockerfile`,
  `scripts/dev-sen-plane.ps1`, `.github/workflows/ci.yml` canonical-smoke body.

## Implementation Steps
1. Extract the smoke sequence already used in `canonical-smoke` (build daemon,
   start on `127.0.0.1:3979`, `healthz`, chat POST, assert turn) as the
   documented native equivalent (a short "smoke" section in README or a
   `scripts/smoke.ps1` reused by both the local user and CI copy).
2. Add the `docker` job to `ci.yml` per Architecture; wrap it so an
   un-dockered runner skips cleanly rather than failing the pipeline.
3. Run the full suite locally: `npm run go:check`, `npm run test`, `npx tsc
   --noEmit`, container smoke; confirm no command was duplicated.

## Success Criteria
- [ ] Container job builds the image and passes the healthz + chat smoke on a  (OPEN: see checklist audit ledger)
    (OPEN: see checklist audit ledger)
      Docker-capable runner; skipped cleanly otherwise.
- [x] Native smoke is documented and passes on Windows without Docker. (_evidence: see CLOSED_GO record)
- [x] `go:check` remains the single Go-command source; grep shows no duplicated (_evidence: see CLOSED_GO record)      vet/test invocations outside `package.json` and the Dockerfile stage.
- [x] `npm run test`, `npm run go:check`, and `npx tsc --noEmit` all green on (_evidence: see CLOSED_GO record)      the S17 changes.

## Risk Assessment
Assumption: the container job's Docker availability can be detected in CI —
signal: it cannot be cleanly detected — response: default the job to
`continue-on-error` with a clear skip marker, or run it on
`ubuntu-latest` where Docker is standard, and rely on the documented native
smoke as the required evidence.
Risk: smoke asserts a stable port while a parallel job collides — response: use
the ephemeral published port / `$RUNNER_TEMP` store pattern already proven in
`canonical-smoke`.