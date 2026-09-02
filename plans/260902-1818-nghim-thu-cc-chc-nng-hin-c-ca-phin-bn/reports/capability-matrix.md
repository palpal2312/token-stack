# Capability Matrix — Phase 1

**Commit:** `3776156` | **Owner:** acceptance run 2026-09-02

Legend: **PASS** | **FAIL** | **BLOCKED** | **SKIP** | **NOT-IN-SCOPE** | **NOT-PRODUCTION**

| ID | Capability group | Preconditions | Check | Evidence | Disposition |
|----|------------------|---------------|-------|----------|-------------|
| C01 | Dashboard / navigation | Dev or prod build; loopback | Core route smoke + module registry tests (full 62-route walk **NOT-RUN**) | `reports/surface-acceptance.md`; `desktop-module-registry.spec.ts` | **PASS** (core subset only) |
| C02 | Agent profiles / chat | Local dashboard; optional CLI | Sen/canonical adapter tests; `/sen` HTTP 200 | `canonical-chat-adapter.test.ts`; surface smoke | **PASS** (CLI-dependent chat not live-tested) |
| C03 | Sen canonical writer | Protected controls closed | `protected:check`, S10 suites | `reports/static-gate-receipt.md` | **PASS** |
| C04 | Orchestration / kanban | Local journal data | `/orchestration` 200; orchestration-state API; Orca tests | surface smoke; `orca-reconcile.spec.ts` | **PASS** |
| C05 | Goals | Vault optional | `/goals` 200; `GET /api/goals` | surface smoke | **PASS** (vault connected on this host) |
| C06 | **Journal page (`/journal`)** | Vault optional | Page 200; API GET/POST guarded; day file under Journal/ | surface smoke 2026-09-02 recheck | **PASS** |
| C14 | **`GET /api/goals` local guard** | Token or session cookie | Unauthenticated → 401 | surface smoke recheck | **PASS** |
| C07 | Memory | Vault optional | `/memory` 200 | surface smoke | **PASS** |
| C08 | Dify integration | API token; Dify instance optional | Namespace `/api/integrations/dify/**`; connections GET | `GET …/connections` → 401 without token | **BLOCKED** (auth preflight only; no E2E workflow) |
| C09 | Settings | `desktop_shell_v2` flag | Page renders; no production write path | `settings/page.tsx` — empty snapshot / fixture gate | **NOT-PRODUCTION** |
| C10 | Backup / recovery / S22 | Go + local fixtures | S22 rehearsal script | `S22-LOCAL-REHEARSAL-PASS` | **PASS** |
| C11 | Static gates | Committed bytes | npm/go/tsc/pester/protected | `reports/static-gate-receipt.md` | **PASS** |
| C12 | Production build | Clean `.next/dev` | `npm run build` | build log 2026-09-02 (pass after dev cleanup) | **PASS** |
| C13 | Live container E2E | `newsos-s22-prod` on `127.0.0.1:3737` + shared host token | total-tests live steps | `total-e2e-test-2026-09-03T053945.json` — 3/3 PASS | **PASS** |
| C15 | QA fixture routes (4) | Dev server | `/qa-fixtures/*` in build manifest | build route list | **NOT-IN-SCOPE** (test fixtures) |
| C16 | Agent list `/agents` | Dynamic routes only | `/agents` → 404; `/agents/new` → 200 | surface smoke | **PASS** (no index route by design) |

## README / docs vs shipped surface

| Claim | Shipped? | Disposition |
|-------|----------|-------------|
| "Journal page — daily entries" (README) | **Yes** — `/journal` + vault writer | **PASS** |
| Dify Local Workflow Bridge (README) | API namespace exists | **BLOCKED** for full UAT |
| Settings persistence (user expectation) | Preview/fixture only | **NOT-PRODUCTION** |

## Recheck owners

| Finding | Owner action | Trigger |
|---------|--------------|---------|
| C06 `/journal` shipped | Product — done 2026-09-02 | Recheck page+API smoke |
| C14 goals GET guard | Security — done 2026-09-02 | Unauthenticated GET must stay 401 |
| C08 Dify E2E | Integrations — run with token + connection | Credentials available |
| C13 Live E2E | Ops — done 2026-09-02; use `scripts/publish-s22-prod.ps1` after recreate | Container loses host publish or token drift |
