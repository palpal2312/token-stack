# Interactive Surface Acceptance — Phase 3

**Commit:** `3776156`  
**Server:** `http://127.0.0.1:3737` (`npm run dev:next`)  
**Run:** 2026-09-02

## Core route smoke

| Route | HTTP | Disposition | Notes |
|-------|-----:|-------------|-------|
| `/` | 307 | **PASS** | Redirect to default workspace |
| `/agents` | 404 | **PASS** | No index; use `/agents/new` (200) |
| `/agents/new` | 200 | **PASS** | |
| `/builders` | 200 | **PASS** | |
| `/sen` | 200 | **PASS** | |
| `/orchestration` | 200 | **PASS** | |
| `/agent-kanban` | 200 | **PASS** | |
| `/goals` | 200 | **PASS** | |
| `/memory` | 200 | **PASS** | |
| `/dify` | 200 | **PASS** | UI shell loads |
| `/settings` | 200 | **NOT-PRODUCTION** | Renders; persistence/write not shipped (see below) |
| **`/journal`** | **200** | **PASS** | `src/app/journal/page.tsx` + JournalView; sidebar Workspace nav |

### `/journal` finding (closed)

- README claim satisfied: daily entries → `Agentic OS/Journal/YYYY-MM-DD.md`
- Page + Sidebar + desktop module registry wired
- Recheck 2026-09-02: GET `/journal` → 200; `GET/POST /api/journal` with token → 200; unauthenticated → 401
- **Disposition: PASS** (was FAIL route gap)

## API capability families

| Endpoint | HTTP | Disposition | Notes |
|----------|-----:|-------------|-------|
| `GET /api/goals` | 200 (authed) / 401 (no token) | **PASS** | Guard added; unauthenticated → 401 |
| `GET /api/goals` Host:`evil.example.com` (no token) | 401 | **PASS** | Same guard; no vault leak |
| `GET /api/journal` | 200 (authed) / 401 (no token) | **PASS** | New surface; local guard on GET+POST |
| `POST /api/journal` | 200 (authed) | **PASS** | Appended smoke entry to vault day file |
| `GET /api/integrations/dify/connections` | 401 | **BLOCKED** | Correct auth rejection; full Dify workflow not exercised |
| `GET /api/version` | 200 | **PASS** | `{"version":"2026-07-21"}` |
| `GET /api/orchestration/state` | 200 | **PASS** | Valid JSON schema v1 |

## Settings surface (Phase 19a U5)

Per `src/app/settings/page.tsx`:

- `desktop_shell_v2` OFF → neutral placeholder
- No production write/update POST shipped
- Live read path uses **empty snapshot** unless `AGENTIC_OS_ALLOW_TEST_FIXTURE=1`

**Disposition: NOT-PRODUCTION** — do not mark settings persistence PASS.

## Dify namespace

Confirmed routes under **`/api/integrations/dify/**`** (not `/api/dify`). Twelve handler files present. Without session token, connection list returns 401 — expected. **End-to-end run/materialize/handoff not validated in this run.**

## Automated surface tests run

- `qa/tests/orca-*.spec.ts`, `phase-19a-u1-shell.spec.ts`, `desktop-module-registry.spec.ts`, `platform-capabilities.spec.ts` — **40/40 PASS**

## Not run

- Full 62-route browser walk (automated list only via build manifest + core smoke)
- Playwright E2E (no config in repo)
