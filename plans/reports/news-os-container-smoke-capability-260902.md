---
title: "NEWS OS container smoke capability receipt"
date: 2026-09-02
plan: "260902-0037-news-os-plateau-operations-hardening-and-archive-reconciliation"
approval: "PLATEAU-CI-260902-01"
status: "blocked-external-runner-proof"
---

# NEWS OS container smoke capability receipt

## Implemented workflow controls

- All `actions/checkout`, `actions/setup-node`, and `actions/setup-go` references are pinned to verified full commit SHAs for their stated major versions.
- Workflow permission is `contents: read`.
- GitHub-hosted smoke permits only `master` push or `workflow_dispatch`; it never runs for pull requests.
- Self-hosted smoke uses only `[self-hosted, newsos-docker-isolated]` and requires `workflow_dispatch` with the explicit `run_self_hosted` input.
- Both smoke jobs use a random loopback-only host port, bounded readiness polling, a compact orchestration-state schema check, and `EXIT` cleanup for the exact container ID and temporary response file.
- Diagnostics contain only status, runner kind, container ID, and assigned port. No raw container logs, environment dump, or raw response body is emitted.

## Static verification

| Check | Result |
|---|---|
| YAML parse | PASS |
| All action references are 40-character SHA pins | PASS |
| Existing Windows `test`, `go`, `tsc`, and `canonical-smoke` jobs preserved | PASS |
| Bash syntax for both smoke scripts | PASS |
| Independent workflow review | PASS |

## External proof status

| Required proof | Status | Reason |
|---|---|---|
| GitHub-hosted build/run | BLOCKED | Workflow change is uncommitted and has not run on a trusted `master` push or manual dispatch. |
| Self-hosted build/run | BLOCKED | Requires an available `newsos-docker-isolated` runner and explicit manual dispatch. |
| Local Docker drill | NOT_RUN | The execution harness rejected the drill before any command or container started. |

## Boundary

This receipt grants no release, deployment, cutover, Finalize, legacy-writer enablement, or Phase 21 authority. Phase 2 remains in progress until a trusted runner produces redacted successful job evidence.
