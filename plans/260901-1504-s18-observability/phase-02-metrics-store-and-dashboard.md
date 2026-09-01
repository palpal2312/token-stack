---
phase: 2
title: "Metrics store + minimal dashboard"
status: pending
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Metrics store + minimal dashboard

## Overview
Wire the Phase 1 probe output into a durable, append-only metric series under
`%LOCALAPPDATA%\NEWSOS\s12-metrics\` and one dashboard view served by the
existing Next.js app — no third-party ingest and no charting dependency. The
probe's JSON lines become one JSONL file per metric family; a small read-only
API route plus a tiny page render the latest state (last sample, current alert
state per series) as plain HTML/table.

## Requirements
- Functional:
  - Metric store: `scripts/s18-slo-probes.ps1` appends each emitted sample to
    `%LOCALAPPDATA%\NEWSOS\s12-metrics\{availability|rpo|rto|writeverification}.jsonl`
    — one file per family, one JSON object per line, append-only (never in git;
    S16 backup-cadence lesson: metrics stay machine-local, outside the repo).
  - Store dir is created idempotently (probe it with a throwaway runId per
    ops-prep §1a, not real state).
  - Dashboard: an existing-app route
    `src/app/api/ops/metrics/route.ts` (GET) that reads the latest ~N lines of
    each JSONL and returns `{families: [{name, lastSample, ok, alerts: [..]}]}`,
    plus `src/app/ops/observability/page.tsx` rendering that payload as a plain
    table with an inline status dot — zero chart library (`ponytail:` a table of
    last-state + recent alert lines is the dashboard; sparklines are the
    upgrade path, not the v1).
- Non-functional:
  - Read-only surface: the API route only reads the metrics dir; it must not
    trigger probes or touch the canonical store.
  - Fail-closed render: if the metrics dir is missing/empty, the page renders
    `no data` state, never fabricated values (S11 demo-data lesson).
  - SSOT for thresholds stays in `scripts/s18-slo-probes.ps1`; the dashboard
    renders what the probes recorded, it does not re-derive SLO math.
  - No secrets in the metrics dir or dashboard payload.

## Architecture
- Writer = the same probe script, one flag (`-StoreDir`, default
  `%LOCALAPPDATA%\NEWSOS\s12-metrics`), appending one line per emitted sample
  with a line-parseable JSON shape (`{ts, metric, value, ok, alert?}`).
- Reader = one Next.js API route (GET) tailing each family file (read last 256
  lines) -> JSON payload; the page is a server component rendering the payload,
  no client JS needed for v1.
- Files are bounded by a monthly rotation on write (a `-Rotate` step in the
  cadence job: move the current JSONL to `<family>-YYYYMM.jsonl` when the month
  changes), keeping every file small and append-only within the month.
- Alert state for the dashboard comes from the `alert` field on the newest
  sample per family; per-family `lastSample.ok` drives the status dot.

## Related Code Files
- Add: `src/app/api/ops/metrics/route.ts`, `src/app/ops/observability/page.tsx`.
- Modify: `scripts/s18-slo-probes.ps1` (append + `-StoreDir` + rotation).
- Read: an existing simple API route (e.g.
  `src/app/api/sen/chat/route.ts` or a `qa-fixtures` route) for the read+JSON
  route pattern, an existing page for layout conventions,
  `plans/260831-0206-s12-phase12-cutover-pack/ops-prep.md` §1d (metrics dir is
  the contract location).

## Implementation Steps
1. Add `-StoreDir`/rotation to the probe script; make every `-RunOnce`
   invocation append one line per metric family.
2. Add the API route `GET /api/ops/metrics` reading last 256 lines per family
   from the store dir; return named families with `lastSample` + recent alerts.
3. Add the page `src/app/ops/observability` rendering the four families as a
   table with last-sample time, current ok/alert state, and the recent alert
   lines under each row.
4. Verify with a local daemon + probe run: page shows real last-sample values,
   an injected `alert:availability` line surfaces, an empty store dir renders
   the explicit `no data` state.
5. Smoke via the S11 `next build` + `next start` path (Turbopack `next dev`
   panics here — do not rely on it).

## Success Criteria
- [ ] `scripts/s18-slo-probes.ps1 -RunOnce` appends timestamped JSONL lines to
      `%LOCALAPPDATA%\NEWSOS\s12-metrics\` in the four family files.
- [ ] `GET /api/ops/metrics` returns the four families from disk; the
      `/ops/observability` page renders them at `next build` + `next start`.
- [ ] Empty/missing store renders `no data` (no fabricated values); a planted
      alert line is visible on the page.
- [ ] Zero third-party dependency added; metrics never enter git.

## Risk Assessment
Assumption: the existing app route/page conventions accept a read-only metrics
route (it is just a JSON GET + a server component — no new surface).
Signal: the API route tailing grows into a file-read bottleneck on rotation →
response: the yearly/monthly rotation keeps files small; tail 256 lines is O(1)
with `Get-Content -Tail` semantics on the store side and the route reads only
the last file per family.
Signal: `.jsonl` store contents drift from probe schema → response: the reader
skips malformed lines (append-only writer + tolerant reader); schema changes bump
the `metric` field name, not the file format.