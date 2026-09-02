# S22 Phase-21 provisioning + canary receipt (production host)

## Verdict

**PASS-CANARY.** Production Docker host provisioned and monitored; canonical
canary write durable through container restart; readback canonical.

Host: `agent-os-s17:latest` container `newsos-s22-prod`, `-p 3737:3737`,
loopback daemon `127.0.0.1:3979` inside image, volume `newsos-s22-data:/data`,
`SEN_PLANE_STORE_DIR=/data/store`, approval `P21-A01-20260902`.

## Evidence

- Container deployed; `api/orchestration/state` reachable through forwarded
  port (host healthz 200, 3737) immediately after start.
- Canary write (canonical `/api/sen/chat`, auth `x-agentic-os-token`):
  POST 200 — `{"commandId":"8572e64e8d49c40426f4b7e63f213e85","turnSeq":1,
  "turnId":"turn-s22-readback-1","chatAttemptId":"attempt-s22-readback-1",
  "sessionId":"s22-readback","status":"queued","createdAt":"2026-09-02T06:26:56Z"}`
  (S15 P1 shape via `mapCanonicalChatReceipt`: camelCase + canonical ids).
- Readback: GET 200 — `{"turns":[{"role":"user",
  "text":"readback check 13:26:55","ts":"2026-09-02T06:26:56Z"}],
  "canonical":true}`.
- **Durability:** `docker restart newsos-s22-prod` → healthz 200 after restart,
  same turn intact in readback (RPO close to zero; restart recovery proven on
  the production host, not only in the isolated rehearsal).
- Container log: `INFO sen-plane listening addr=127.0.0.1:3979 store_root=/data/store`.

## Boundaries / invariants held

- No `legacy_writer` or `phase_21` change: `npm run protected:check` still
  PASS (`legacy_writer disabled`, `phase_21 blocked`).
- Token used for auth only, not printed; store on host loopback only.
- No production user data touched; canary session id namespaced `s22-*`.

## Next gate

Phase 3 cutover step (`legacy_writer: enabled` as the single recorded gate
action) is NOT done here and requires the Phase-3 freeze + write-verify +
rollback drill before any flip.