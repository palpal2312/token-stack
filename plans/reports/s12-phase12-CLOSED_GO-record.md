# Phase 12 CLOSED_GO record

## Status

Phase 12 (legacy chat-writer cutover) closed as **GO** on 2026-09-01 on the
independent verdict `plans/reports/s12-phase12-go-independent-arbiter-verdict.md`
(master `8699509`). Owner-authorized with a backfill plan.

## What closed

- Legacy FirstMate JSONL chat data (9 transcripts) backed up out-of-git
  (`%LOCALAPPDATA%\NEWSOS\phase12-backups-20260901`, 9 SHA-256 hashes) and
  **backfilled into the canonical Go store** (68 turns, verified).
- Canonical path live: `sen-plane` `POST/GET /api/v1/sen/chat` →
  `product.SendTurn`; canary write+read-back verified.
- `src/app/api/sen/chat/route.ts`: `SEN_DAEMON_URL` opt-in delegation; when
  unset the pre-cutover legacy/offline behavior is byte-identical (no silent
  dual-write). `SEN_CHAT_LEGACY_WRITER=1` is never assigned.
- Retired/inert: legacy FirstMate writer no longer invoked on the canonical
  path; nothing enables a legacy writer flag.

## Arbiter verification (live, at 8699509)

`GET /api/v1/sen/chat` → **10 sessions, 69 turns** (68 backfilled + canary-p12) ·
`legacy_writer: enabled` / `phase_21: enabled` = **0 hits** · backup manifest
present.

## Controls (hard invariants, unchanged)

`legacy_writer: disabled` · `phase_21: blocked`. This GO does NOT open release,
promotion, or Phase 21; desktop-shell and other forward work are unrelated and
stay gated as before.

## Residual (tracked, non-blocking)

SEN_DAEMON_URL-mode chat-client receipt-shape adaptation (UI layer) deferred;
backfill is server-stamped (original ts not preserved) and run-once per
transcript.

JOB_DONE: Phase 12 legacy cutover executed, verified, and closed as GO;
canonical store is the chat writer, legacy inert, controls preserved.