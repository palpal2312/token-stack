# Baseline Receipt — Phase 1

**Run at:** 2026-09-02T20:30+07:00  
**Commit:** `3776156a51428bd2d9bdff38b2e0d3c5cd84e632`  
**Branch:** `master`  
**Message:** `test(e2e): add total system harness`

## Environment

| Tool | Version / Status |
|------|------------------|
| Node.js | v24.5.0 |
| Go | go1.26.4 windows/amd64 |
| Docker | 29.6.1 (available) |
| Pester | available |
| Obsidian vault | **available** (`VAULT_AVAILABLE=true` at runtime — goals API returned `vault:true`) |
| Dashboard port | 3737 (canonical) |

## Inventory counts

| Surface | Count | Source |
|---------|------:|--------|
| Page routes (`page.tsx`) | 62 | `src/app/**/page.tsx` glob |
| API route handlers | ~347 | `next build` route manifest |
| npm test (default harness) | 58 tests | `npm test` |
| Go packages tested | 15 | `npm run go:check` |

## Active plan context

This acceptance run executes plan `260902-1818-nghim-thu-cc-chc-nng-hin-c-ca-phin-bn`. No hard dependency on S20/plateau; live container steps were intentionally skipped (`-SkipLive`).

## Unavailable prerequisites (explicit, not inferred PASS)

| Prerequisite | Disposition | Recheck trigger |
|--------------|-------------|-----------------|
| Live Docker container healthz | **SKIP** | Run `scripts/run-total-tests.ps1` without `-SkipLive` when container stack is up |
| Live canary write+readback | **SKIP** | Same |
| Live legacy surfaces inert | **SKIP** | Same |
| Dedicated Dify end-to-end with credentials | **BLOCKED** | Configure Dify connection + API token; rerun Phase 3 Dify family |
| Playwright browser suite | **NOT-RUN** | No `playwright.config.*` in repo; shell/Orca specs run via `tsx --test` instead |

## Authority surfaces read

- `README.md` — public capability claims (includes Journal page)
- `src/shell/desktop-module-registry.ts` — shell navigation authority
- `plans/260902-1818-*/plan.md` — acceptance scope and known gaps
