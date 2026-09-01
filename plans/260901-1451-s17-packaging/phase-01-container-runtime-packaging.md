---
phase: 1
title: "Container/runtime packaging"
status: pending
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Container/runtime packaging

## Overview
One multi-stage Dockerfile builds sen-plane (Go) and the app (`next build`) into
a single image; the container starts the daemon and the Node server together.
Default bind addresses stay loopback as today; the container overrides only the
app's listen host so `docker run -p` can forward it.

## Requirements
- Functional: `docker build` → one image; container start runs sen-plane +
  Node server in one process tree; `GET /` and `GET /healthz` respond.
- Non-functional:
  - Loopback default preserved: sen-plane binds `127.0.0.1` in-container
    (`SEN_PLANE_ADDR` default) since both processes share one network
    namespace; only the app listener binds `0.0.0.0` (`AGENTIC_OS_HOST=0.0.0.0`)
    so `-p 3737:3737` forwarding works.
  - `node-pty` is a native module (`serverExternalPackages` in
    `next.config.ts`) — build it in a stage with a compiler toolchain, copy the
    compiled module to a slim runtime.
  - No secrets baked in; all configuration through `.env.example` names
    (Phase 2) and container env.
  - `.dockerignore` keeps `.next`, `node_modules`, `qova` QA trees, `.git`,
    plans/runtimes and machine-local stores out of the build context.

## Architecture
- Stage `go-build` (`golang:1.26`): `go vet` + `go test` (the `go:check`
  commands, run in-container — this is the reuse) then
  `go build -o /sen-plane ./cmd/sen-plane`.
- Stage `node-build` (`node:24-bookworm-slim` + build-essential/python3 for
  node-pty): `npm ci`, `npm run build` (copies ghostty WASM, runs `next build`).
- Stage `runtime` (`node:24-bookworm-slim`, `--from=node-build` node_modules +
  `.next` + `server.ts` + `package.json`; `--from=go-build` `/sen-plane`).
- Entrypoint (single shell line): start `/sen-plane` in the background on the
  loopback address, exec `node server.ts --prod`.

## Related Code Files
- Add: `Dockerfile`, `.dockerignore` (repo root).
- Read: `server.ts` (port/host from `AGENTIC_OS_HOST`/`AGENTIC_OS_PORT`),
  `next.config.ts` (`serverExternalPackages: ["node-pty"]`), `go/cmd/sen-plane`
  (`SEN_PLANE_ADDR`, `SEN_PLANE_STORE_DIR`), `package.json` (`build`, `start`,
  `go:check`), `.github/workflows/ci.yml` (go:check commands to mirror in-stage).

## Implementation Steps
1. Add `.dockerignore` excluding `.next`, `node_modules`, `.git`,
   `plans/runtimes/*`, `_tmp-*`, `*.before-recovery.bin`, QA trees, and the
   local store dirs referenced in existing merge-hygiene lessons.
2. Add `Dockerfile` per the three-stage architecture above.
3. Verify locally: `docker build` succeeds; `docker run -p 3737:3737` serves the
   dashboard and `GET /api/...` through sen-plane (daemon healthz reachable
   in-container); `docker run` with no published port keeps everything loopback.

## Success Criteria
- [ ] `docker build` completes with go vet/test green in the build log.
- [ ] One `docker run -p 3737:3737` serves dashboard + sen-plane-backed API;
      chat round-trip observed through the container.
- [ ] Loopback default intact: no image code change binds an external interface
      unless the one documented app-host override says so.

## Risk Assessment
Assumption: GitHub runners that build the smoke test can run Docker.
Signal: `node-pty` fails to compile on the runtime base image — response: keep
the full build in the `node-build` stage (has the compiler toolchain) and only
copy artifacts into `runtime`; never compile node-pty in `runtime`.
Signal: `next start` needs `server.ts` files not copied — response: copy the
whole app source, not just `.next` (custom server + `src/` are required at
runtime).