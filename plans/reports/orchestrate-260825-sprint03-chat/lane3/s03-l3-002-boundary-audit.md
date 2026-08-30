# S03-L3-002 — Privacy + Orca/Gateway boundary audit

Date: 2026-08-25. Lane: 3. Runner: `qa/fixtures/sprint03/boundary-audit.py` (exit 0 = no open finding). Evidence: `s03-l3-002-boundary-audit-evidence.json`.

## Result: 14/14 PASS (final rerun, 147 files scanned)

Finding BA-01 (dispatch capability persisted in Lane 2 report `s03-l2-ctx9bc531-verify.md`) was scrubbed by Lane 2 on controller request; rerun confirms zero credential-shaped strings in the evidence tree. Rule carried to the runbook in S03-L3-004: reports reference `msg_*`/`task_*`/`ctx_*` IDs only, never `dcap_*` capabilities or token values.

### Boundary posture verified (PASS)

| Check | Evidence |
|---|---|
| Go listener loopback-only; non-loopback host disables proxy | `goApiProxy.ts` host allowlist |
| Proxy fails closed when token missing; never unauthenticated | `goApiProxy.ts` `if (!token) return null` |
| All chat verbs behind `checkLocalRequest`; query tokens rejected | `sen/chat/route.ts` |
| Legacy writer gated behind explicit `SEN_CHAT_LEGACY_WRITER=1`; canonical mode fails metadata writes closed (501); no silent dual-write | `sen/chat/route.ts` |
| Shadow parity compares payload *shapes*, never values; mutating commands observation-only; shadow log under `AGENTIC_HOME/logs`, outside repo | `senShadowProxy.ts` |
| Stream events carry `redactionClass` end to end | `chat-client.ts` |
| No `SEN_API_TOKEN` assignments, bearer tokens, AWS-style keys, private keys, or agentic-token headers in 142 scanned evidence files (plans/, qa/, docs/) | secret scan |
| No `sen.env` inside the repo tree | filesystem scan |

### Resolved finding

- **BA-01 — dispatch capability persisted in a report (RESOLVED).** `plans/reports/orchestrate-260825-sprint03-chat/s03-l2-ctx9bc531-verify.md:9` contained a raw dispatch-capability string. Lane 2 scrubbed it on controller request; the rerun passes. Dispatch capabilities are bearer credentials for the orchestration channel; durable reports must carry message IDs, not capabilities.

## Scope limits

- Static checks read Lane 1/Lane 2 sources read-only; no fixes applied outside ownership.
- Secret scan covers plans/, qa/, docs/ (evidence trees), not product source or `~/.agentic-os` (privacy boundary respected — no credential files opened).
- Canonical listener is not configured on this machine, so runtime token-handling probes (e.g. header redaction in Go logs) remain pending-lane1, same as FI-10.

## Unresolved questions

- None open. (BA-01 scrub verified by the 14/14 rerun.)

JOB_DONE: S03-L3-002
