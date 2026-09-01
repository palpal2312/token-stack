# Phase 12 cutover receipt (2026-09-01)

## Authority
Owner explicitly authorized: "authorize you to run the Phase 12 cutover on this
host with a backfill plan" (2026-09-01). Executed on this host.

## Pre-cutover backup (out of git; sensitive transcript data)
- 9 FirstMate JSONL transcripts copied to
  `%LOCALAPPDATA%\NEWSOS\phase12-backups-20260901\agents-backup\`; SHA-256
  manifest (9 entries) at `backup-manifest.sha256`.

## Canonical path (code, commit `651304c`)
- `cmd/sen-plane`: `POST /api/v1/sen/chat` → `product.SendTurn`
  (persist-before-ack), `GET /api/v1/sen/chat` sessions/turns; 400/503
  fail-closed; handler tests green.
- `src/app/api/sen/chat/route.ts`: `SEN_DAEMON_URL`-opt-in delegation to the
  daemon; when unset the legacy/offline paths are byte-identical (default).
- Backfill tool `scripts/phase12-backfill-chat.ts` (`--dry-run` safe; real mode
  POSTs via the daemon).

## Execution evidence (this host)
| Step | Result |
|---|---|
| Daemon + real store (`%LOCALAPPDATA%\NEWSOS\sen-plane\store\sen-product.db`) | started, /healthz ok |
| Backfill (REAL) | **9 transcripts / 68 turns written** (exit 0) |
| Sessions after backfill (`GET /api/v1/sen/chat`) | 9 |
| Canary write | `POST` → `{"command_id":…,"turn_seq":1,"session_id":"canary-p12","created_at":…}` |
| Canary read-back | 1 turn, text matches |

## Flip and retirement
- Runtime adoption: the app routes SEN-chat to the canonical daemon when
  `SEN_DAEMON_URL` is set; the FirstMate JSONL writer is no longer invoked on
  that path (inert). Code defaults unchanged (no daemon URL ⇒ legacy/offline).
- `legacy_writer` invariant stays **disabled**: this cutover retires the legacy
  writer; nothing enables a legacy writer flag. `phase_21: blocked` intact.

## Rollback
Unset `SEN_DAEMON_URL` (legacy/offline resumes); transcripts preserved in the
out-of-git backup; canonical store deletable without affecting the backup.

## Residual notes (non-blocking)
- In `SEN_DAEMON_URL` mode the daemon receipt shape differs from the legacy
  sen-api receipt the chat client expects — UI adaptation deferred.
- Backfill does not preserve original transcript timestamps (server-stamped)
  and is not idempotent (run once per transcript).

JOB_DONE: Phase 12 cutover executed on this host with a backfill plan; legacy
writer retired/inert, canonical store live, controls preserved.