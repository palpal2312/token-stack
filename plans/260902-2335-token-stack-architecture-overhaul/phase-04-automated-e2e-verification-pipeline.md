# Phase 04: Automated 3-Stage E2E Verification Pipeline

## Context Links
- Parent Plan: [plan.md](file:///C:/Users/ADMIN/Documents/token-stack/plans/260902-2335-token-stack-architecture-overhaul/plan.md)
- Sub2API Testing Suite: `account_test_service.go`, upstream billing probes

## Overview
- **Date**: 2026-09-02
- **Description**: Implement an automated, zero-assumptions verification pipeline that tests port readiness, upstream credentials/quotas, and proxy streaming before reporting any profile as ready.
- **Priority**: P1
- **Implementation Status**: pending
- **Review Status**: pending

## Key Insights
- Setup bugs often hide behind vague error messages:
  - 401 from Kimi because of model suffix `[1m]`.
  - 400 from Sub2API because of unmapped model aliases (`claude-opus-4-5`).
  - 429 from Alibaba because weekly quota is exhausted.
  - ConnectionRefused because the proxy port was down.
- A 3-stage validation pipeline isolates exactly which layer is failing in seconds.

## Requirements
1. Implement `core/verifier.ps1`:
   - **Stage 1 (Port & Proxy Liveness)**:
     - Calls `GET http://127.0.0.1:<PORT>/readyz`.
     - Validates HTTP 200 and parses JSON status (`{"status":"healthy","ready":true}`).
   - **Stage 2 (Direct Upstream Probe)**:
     - Sends a lightweight payload (`stream: true`, `max_tokens: 5`) directly to `HEADROOM_UPSTREAM` using the profile's API key.
     - Confirms upstream credentials, model name acceptance, and quota availability.
   - **Stage 3 (Proxy-Mediated Streaming Probe)**:
     - Sends the same payload through `http://127.0.0.1:<PORT>/v1/messages`.
     - Confirms end-to-end token streaming (`event: message_start`, `event: content_block_delta`).
2. Diagnostic Error Classifier:
   - Categorizes failures with actionable recommendations:
     - `PROXY_DOWN`: Headroom port is not listening. Run `token-stack up`.
     - `MODEL_REJECTED`: Upstream rejected model string (e.g. `kimi-k3[1m]`). Fix model name.
     - `QUOTA_EXHAUSTED`: Upstream 429 quota exhaustion. Switch account or wait for reset.
     - `AUTH_FAILED`: Invalid API key in settings or database.

## Related Files
- `C:\Users\ADMIN\Documents\token-stack\core\verifier.ps1`
- `C:\Users\ADMIN\Documents\token-stack\bin\token-stack.ps1`

## Implementation Steps
1. Write core HTTP probe logic supporting streaming SSE responses.
2. Implement the 3-stage pipeline in `core/verifier.ps1`.
3. Integrate with CLI `token-stack verify [<profile>]`.
4. Output formatted color-coded diagnostic summaries to console.

## Todo List
- [ ] Create `core/verifier.ps1`
- [ ] Implement Stage 1 (readyz probe)
- [ ] Implement Stage 2 (direct upstream probe)
- [ ] Implement Stage 3 (proxy stream probe)
- [ ] Add failure classifier with suggestions

## Success Criteria
- Running `token-stack verify kimicode` tests all 3 stages and prints `PASS: KimiCode 100% Operational`.
- Running `token-stack verify` against an expired key immediately reports `QUOTA_EXHAUSTED` with the exact reset timestamp.
