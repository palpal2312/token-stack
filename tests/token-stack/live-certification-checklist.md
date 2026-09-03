# Token-Stack Live Provider Certification Checklist

## Purpose & Boundaries

Live provider certification verifies live streaming and protocol compatibility against real upstream AI providers. Because live calls involve external network egress, authenticated credentials, and cost, live tests **must never run in automated PR CI**.

Live tests may only be executed in protected environments by authorized operators using `scripts/certify-token-stack-live.ps1`.

## Preflight Verification Checklist

Before triggering live certification, the operator must verify:

- [ ] **Offline Gates Green**: All 16 offline suites, property tests, and secret scans pass 100% locally.
- [ ] **Explicit Operator Switch**: `-AllowLive` switch must be explicitly passed.
- [ ] **Provider Host Allowlist**: Upstream endpoint must resolve to an approved host:
  - `api.anthropic.com`
  - `api.kimi.com`
  - `*.aliyuncs.com`
- [ ] **Strict Budget Boundaries**:
  - Request Count: strictly bounded to 2 requests (direct upstream probe + proxy streaming probe).
  - Output Tokens: capped at `max_tokens: 5` per request (10 tokens total).
  - Input Prompt: fixed 4-character synthetic string (`"Ping"`).
  - Maximum Estimated Cost: ≤ USD 0.02.
- [ ] **No Secret Logging**:
  - Raw API keys must never appear in stdout, stderr, or receipts.
  - Receipts record only a truncated SHA-256 fingerprint (`sha256:...`).
  - Response bodies in failure diagnostics are redacted.

## Post-Execution Receipt Verification

The emitted receipt (`reports/live-certification-<profile>-<timestamp>.json`) must contain:
1. `status`: `"CERTIFIED"`
2. `exit_code`: `0`
3. `upstream_host`: Verified domain
4. `credential_fingerprint`: Hashed fingerprint only
5. Zero unredacted keys or raw headers.
