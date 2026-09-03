---
phase: 5
title: "Verifier Protocol Chaos and Redaction"
status: complete
priority: P1
effort: "1.5-2d"
dependencies: [1, 4]
---

# Phase 5: Verifier Protocol Chaos and Redaction

## Overview

Prove the three-stage verifier classifies HTTP/SSE/auth/transport failures correctly, cannot false-PASS on partial streams, and never leaks credentials.

## Requirements

- All default scenarios use one test-owned loopback server on an ephemeral port.
- Offline requests to non-loopback targets are blocked before connection.
- Live authorization, credential, profile, egress, redirects, timeout, and receipt policies are explicit.

## File Inventory

| Action | File | Purpose / test impact |
|---|---|---|
| Create | `tests/token-stack/verifier-chaos.test.cjs` | HTTP/transport/SSE/state matrix |
| Create | `tests/token-stack/redaction.test.cjs` | Canary scan of stdout/stderr/artifacts/encoded forms |
| Create | `tests/token-stack/helpers/fake-anthropic-server.cjs` | Status/delay/reset/chunk/request-capture scenarios |
| Create | `tests/token-stack/fixtures/verifier/*.json` | Registry/profile cases |
| Create | `tests/token-stack/fixtures/verifier/*.sse` | Valid, split, malformed, truncated streams |
| Modify | `scripts/check-token-stack-secrets.cjs` | Scan shipped/generated text types and encodings |
| Conditional | `core/verifier.ps1` | Correct proven authorization/egress/SSE/redaction defects |

## Test Scenario Matrix

| Case | Expected verdict / invariant |
|---|---|
| ready 200 + complete start/content/terminal SSE | PASS; ordered event evidence |
| ready 404/500, connect reset, slow headers/body, timeout | bounded FAIL; later stage policy explicit |
| upstream 400 model, 401/403 auth, 429 quota, 500/503 | typed FAIL; no raw body/key |
| empty 200, malformed frame, split event, truncated/no terminal, oversized body | never PASS; byte/time cap |
| no flag, no credential, missing/nonexistent profile | ordinary offline SKIP; certification preflight nonzero |
| arbitrary HTTP host, URL userinfo/query credential, redirect | blocked; key never forwarded |
| canary in key/body/path/model/profile/exception | absent raw, Base64, and URL-encoded in all output/artifacts |

## Function / Interface Checklist

- [ ] Params: `Profile`, `RegistryPath`, `ApiKey`, `AllowLive`; wrapper env authorization.
- [ ] Exit semantics: PASS=0, intentional offline SKIP=0, attempted/certification failure≠0.
- [ ] Stage 1 `/readyz`; Stage 2 direct `/v1/messages`; Stage 3 proxy `/v1/messages` complete SSE.
- [ ] Egress allowlist accepts loopback fixtures and explicit approved HTTPS live host only.
- [ ] Receipt stores verdict, HTTP class, event sequence, byte count, TTFB/duration—not content/headers.

## Dependency Map

```text
phase 1 network harness + phase 4 lifecycle -> protocol chaos -> redaction/egress proof -> phases 7 and 8
```

## Implementation Steps

1. Build scripted server with request capture limited to booleans/hashes.
2. Implement full status, reset, delay, chunk, truncation, redirect, and oversize matrix.
3. Inject unique secret canaries through every sensitive surface; scan all artifacts and encodings.
4. Separate ordinary offline SKIP from certification preflight failure.
5. Assert complete event sequence and bounded resource cleanup; do not depend on PowerShell-native error text.

## Success Criteria

- [ ] Every matrix case completes within stage timeout plus tolerance and produces correct exit/verdict.
- [ ] Invalid/partial/oversized streams never report operational.
- [ ] Zero secret-canary match or unapproved connection; request log proves header presence only by hash/boolean.
- [ ] Server closes, connections abort, and ephemeral port rebinds after every case.

## Risk Assessment And Rollback

Windows PowerShell 5.1 buffers responses and differs from pwsh 7. Assert project-owned semantic categories and event parsing. If true streaming cannot be proven with the current client, fail certification and replan the transport implementation; do not relax the oracle to HTTP 200.

## Todo

- [x] Implement deterministic protocol chaos server.
- [x] Complete HTTP/transport/SSE matrix.
- [x] Prove egress and redaction policies.
- [x] Separate offline and certification semantics.
