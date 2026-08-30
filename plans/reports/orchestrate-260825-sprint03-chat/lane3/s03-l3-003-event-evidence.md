# S03-L3-003 — Latency / loss / duplicate evidence runner

Date: 2026-08-25. Lane: 3. Runner: `qa/fixtures/sprint03/event-evidence-runner.ts` (exit 0 = all scenarios pass). Evidence: `s03-l3-003-event-evidence.json`.

## What it exercises

The REAL Lane 2 reconnect logic — `mergeEventsBySeq` / `hasEventGap` from `src/lib/sen/chat-client.ts` (imported, not reimplemented) — against injected failure streams. No network, no model tokens, deterministic. Closes matrix cells FI-04/FI-05 from S03-L3-001.

## Scenarios: 3/3 PASS

| Scenario | Injection | Result |
|---|---|---|
| FI-04 duplicate-tail-dedupe | reconnect refetch with 20-seq overlap | 140 events, each seq exactly once, strictly ordered |
| FI-05 loss-gap-refetch | middle event seq=57 dropped | `hasEventGap` fires at 57; refetch from `after_seq=56` restores 100/100, gap clears |
| reorder-sorted-merge | odd/even halves delivered out of order | 50 events merged strictly ordered |

## Latency evidence (this machine, fixture-level)

| Operation | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| cold merge | 1,000 | 0.17 ms | 0.20 ms | 0.20 ms |
| cold merge | 10,000 | 2.70 ms | 3.33 ms | 3.33 ms |
| cold merge | 50,000 | 10.55 ms | 16.38 ms | 16.38 ms |
| tail merge (reconnect hot path: 10k applied + 400 incoming, 200 new) | 400 | 0.55 ms | 1.34 ms | — |

Client-side continuity logic is milliseconds at 50k events — reconnect rendering cost is not a continuity risk; the risk stays at the persistence/transport boundary (covered by FI-01..03, FI-06). Compact observer line emitted per run: `S03-L3-003: 3/3 scenarios pass | tail-merge p50=… | cold-10k p50=…`.

## Scope limits

- Fixture-level: no live Go listener on this machine, so network/transport latency and server-side seq assignment are pending-lane1 (with FI-10).
- Latency numbers are single-machine samples (7 runs), not percentiles over production traffic.

JOB_DONE: S03-L3-003
