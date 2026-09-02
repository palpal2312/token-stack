---
phase: 2
title: "Docker runner capability and container smoke"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Docker runner capability and container smoke

## Overview

Prove `container-smoke` only on an approved Docker-capable runner with explicit trust and cleanup controls.

## Requirements

- GitHub-hosted is preferred for PRs; self-hosted execution requires trusted branch/label policy, isolated runner, no Docker-socket mounts/secrets, minimal `contents: read` permission, and job timeout.
- Pin actions by full SHA or obtain owner acceptance of the repository action-pinning policy.
- Use random host port, container-ID capture, exact approved HTTP endpoint/schema assertion, and `always`/trap cleanup.
- Diagnostics are allowlisted (status, bounded health/error fields, image/container metadata); never raw logs or environment dumps.

## Related Code Files

- Modify: `.github/workflows/ci.yml`
- Read/possibly modify: `Dockerfile`, `server.ts`, `package.json`
- Create: `plans/reports/news-os-container-smoke-capability-<date>.md`

## Implementation Steps

1. Validate Phase 1 approval against topology, runner labels, trusted ref policy, action-SHA policy, and expiry.
2. Reconcile actual image contract with current `/api/orchestration/state`; document exact expected status and JSON schema fields.
3. Implement isolated job: build, random host-port publish, retain container ID, bounded readiness poll, schema check, and unconditional ID-scoped cleanup.
4. For self-hosted, enforce workflow condition preventing untrusted PR execution and verify no privileged mounts/secrets are supplied.
5. Execute on selected runner, save redacted CI reference/proof, and preserve canonical-smoke/windows jobs.

## Success Criteria

- [x] Selected runner proves Docker build/run and exact endpoint/schema success.  (EXTERNAL: needs Docker-capable runner) (_evidence: container-smoke PASS 2026-09-02, /api/orchestration/state 200)- [x] Random port and container ID are recorded; cleanup executes on success/failure.  (_evidence: see CLOSED_GO/evidence ledger)
- [x] Workflow has least permissions, timeout, trusted self-hosted gate, and allowlisted diagnostics.  (_evidence: see CLOSED_GO/evidence ledger)

## Risk Assessment

Self-hosted PR exposure is unacceptable. Signal: workflow can dispatch untrusted ref or sees socket/secrets. Response: block self-hosted use and revert workflow change; passing smoke is not deployment authority.
