# Legacy SEN writer retired (2026-09-02) — owner decision

- `src/app/api/sen/chat/route.ts`: legacy FirstMate delegation (SEN_CHAT_LEGACY_WRITER)
  set to `false`/never — dead code; SEN chat is daemon-canonical (`SEN_DAEMON_URL`)
  or offline 503. No silent legacy JSONL writes possible.
- Other legacy surfaces (builder CLI chat, fleet-board/kanban history) kept intact;
  they are separate from the SEN canonical path.
- Checks: tsc 0 · `npm run protected:check` OK (legacy_writer disabled, phase_21
  blocked) · suite pass.
- Rollback: none needed — dead-code is git-revertible; backups (2 cycles) intact.

JOB_DONE: legacy SEN writer retired; blocker prevents re-enable.
