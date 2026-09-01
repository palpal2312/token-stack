# S15 Phases 2-3 — app surfaces + CI/ops receipt

## Status
DONE. P2: sen/chat daemon POST accepts the kanban `session` alias (c545abf);
UI surfaces (slots/attempts/chat) run through the daemon opt-in as built in S12-14
— code-level defaults stay legacy/offline until SEN_DAEMON_URL is runtime-set.
P3: CI gains a `canonical-smoke` job (build sen-plane on a temp store, healthz,
POST a chat turn, assert turn_seq/chat_attempt_id) — merged (d61d1d8); npm kept
as the CI package manager (pnpm note stays in the phase plan as optional).

## Restore drill (real)
9/9 backup transcripts hash-verified OK on copy-back →
`sha256sum -c backup-manifest.sha256` exit 0.

JOB_DONE: S15 P2-P3 verified; close gate next.
