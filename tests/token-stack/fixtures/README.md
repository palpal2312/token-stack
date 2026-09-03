# Token-Stack Test Fixtures Contract

## Provenance and Principles

1. **Synthetic by Design**: All test fixtures, responses, and profiles must be 100% synthetic. No real API keys, bearer tokens, passwords, cookies, or user profile files may ever be stored or generated in this directory.
2. **Deterministic & Offline**: Fixtures must never require external internet connectivity or live upstream endpoints.
3. **Redaction & Secret-Free**:
   - Any API key mock must follow synthetic canary patterns, e.g.:
     - `synthetic-test-canary-token`
     - `synthetic-test-canary-key`
   - Real keys matching `sk-[A-Za-z0-9]{20,}` with high entropy are scanned and blocked by `scripts/check-token-stack-secrets.cjs`.
4. **No Machine or Absolute Paths**:
   - Fixtures must never embed absolute developer paths (e.g. `C:\Users\...` or `/home/...`). Use relative paths or dynamic runtime injection.
5. **Fixture Directory Structure**:
   - `fixtures/fuzz/`: Minimized regression corpora from fast-check and fuzzing.
   - `fixtures/verifier/`: Scripted SSE payloads, HTTP responses, and test profiles.
   - `fixtures/install-profiles/`: Test profile configs for installer/setup certification.
