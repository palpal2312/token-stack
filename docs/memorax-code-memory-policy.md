# MemoraX Code memory policy

MemoraX Code is the shared memory layer for the NEWS OS Master and Orca
workers. It is an aid to durable learning, not an execution authority and not
a replacement for SQLite, Orca receipts, manifests, or handoffs.

## Boundaries

- Master may store reusable, redacted orchestration lessons: OLC decisions,
  provider/fallback failure patterns, gate rules, and verified recovery steps.
- Workers may store reusable technical lessons and verification outcomes that
  help future runs. They must not store raw prompts, transcripts, source code,
  private project data, personal data, credentials, tokens, or unredacted
  terminal output.
- Project-scoped memory stays in the active repository/worktree boundary.
  Do not intentionally create one shared memory namespace across unrelated
  projects.
- Orca remains the source of truth for execution state. MemoraX memories are
  advisory context and never authorize a dispatch, lease claim, gate bypass,
  or promotion.

## Operating rule

Use the installed `$memorax-code` skill in Codex or `/memorax-code` in Claude
Code only when the memory is explicitly useful. Before adding a memory, reduce
it to: situation, verified cause, corrective action, and evidence pointer.
Review retrieved memories against current repository evidence before acting.

Automatic writeback is enabled by the local MemoraX setup, but the Master and
worker prompts must still enforce the boundary above. If a turn contains
private or sensitive material, do not add it to memory; record only a sanitized
lesson in the project docs or handoff when required.

## Runtime ownership

The local MemoraX backend is separate from existing Headroom proxies. Its port
is configured by the local MemoraX installation and must not displace an
existing worker proxy. Verify with `memorax-code status` before dispatching
workers. A healthy adapter does not prove that a provider has quota or that an
Orca worker is running.

## Recovery

On backend or adapter failure, continue using Orca receipts, run manifests,
SQLite state, and the Master failover protocol. Repair MemoraX separately; do
not block a sprint or bypass a gate solely because memory retrieval is
unavailable.
