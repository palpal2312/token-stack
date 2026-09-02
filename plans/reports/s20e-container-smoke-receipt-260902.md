# Container smoke receipt (2026-09-02)

Docker Desktop started (daemon 29.6.1) after owner approval. Dockerfile fixed:
- toolchain (python3/make/g++) for node-pty in the nodebuild stage;
- COPY . . moved BEFORE npm ci so the postinstall
  `scripts/copy-ghostty-wasm.mjs` exists during lifecycle hooks.

`docker build -t agent-os-s17 .` → PASS. Container run smoke:
- `docker run -p 3737:3737 -e SEN_PLANE_STORE_DIR=/data/store`
- GET /api/orchestration/state → **200**
- GET /sen → **200**
- logs: "Agent OS dashboard http://0.0.0.0:3737 (prod + herdr ws)"
Container cleaned up. Evidence that phase-2 (docker runner + container smoke)
is now REAL on this host.

JOB_DONE: container smoke PASS; S17/0037 docker items closed with evidence.
