# S03-L2 Receipt: Canonical SEN Chat — Typed Client, Thin Proxies, Reconnect/Replay UI

## Status
- **Run**: `run_9e31ed9e73d5` (Sprint 03, lane 2 — Pi fallback, executes the fenced Antigravity lane)
- **Dispatch**: `ctx_de78e27b491f` / task `task_e8941cd3769d`
- **Ownership honored**: `src/app/api/sen`, `src/lib/sen`, `src/components/SenView.tsx`, `qa/tests/sen-chat*` only
- **Commits**: none (working-tree delivery only)
- **Verification**: 16/16 tests passing; full-project `tsc --noEmit` exit 0

---

## 1. Delivered

### 1.1 Typed client — `src/lib/sen/chat-client.ts` (new)
Canonical Chat C4 surface typed end to end: `ChatSession`, `ChatTurnRow`, `ChatAttempt`, `ChatStreamEvent`, `SendTurnReceipt`, `SendTurnInput`. Functions: `sendTurn` (persist-before-ack; client mints `s-<uuid>` session ids and forwards the caller's `commandId` as the retry/replay key), `listSessions` (canonical flag), `getThread` (after_seq cursor), `getActiveAttempt` (404 → null for pending-recovery), `getEventsAfter`. Reconnect rules as pure functions: `mergeEventsBySeq` (dedupe by seq, first-write-wins, ordered) and `hasEventGap` (detects a replayed-tail gap → triggers authoritative thread refetch). `eventText` normalizes payload display text.

### 1.2 Thin proxies — `src/app/api/sen/chat/*` (new/modified)
All pure forwards to the Go control plane, no computation, local-only guarded (`checkLocalRequest`), canonical flag on the session list. Four surfaces:
- `chat/route.ts` — POST `/api/sen/chat` forwards SendTurn with the client's command id (replay key never re-minted by the proxy); GET returns session list with `canonical:true` or legacy delegation behind `SEN_CHAT_LEGACY_WRITER=1` (fail-closed PATCH/DELETE otherwise, so no silent dual-write).
- `attempts/[id]/events/route.ts` — stream event tail with `after_seq`/`limit` (the reconnect read).
- `sessions/[id]/active/route.ts` — active attempt or 404 (pending-recovery read).
- `sessions/[id]/thread/route.ts` — cursor thread read with `after_seq`/`limit`.

### 1.3 Reconnect/replay UI — `src/components/SenView.tsx` (modified)
- `pollCanonicalTail`: follows one attempt's persisted event tail, merges by seq (no double-render on refetch), on `hasEventGap` refetches the canonical thread and resets the cursor, terminates when the attempt leaves the active set, then does the authoritative thread refetch.
- Pending recovery `useEffect`: reopening a session whose attempt is still queued/claimed/running resumes the tail with a blank assistant row instead of starting fresh.
- Command-id replay on send: the ack's server-issued ids replace the optimistic rows; error path keeps the draft.
- `applyCanonicalEvent`: progress/summary text accumulates on the assistant row; thinking/tool lines roll the activity indicator.

### 1.4 Focused tests
- `src/lib/sen/__tests__/chat-client.test.ts` — 4 unit tests on the merge/gap/text/id-seeding rules.
- `qa/tests/sen-chat.spec.ts` — 12 integration tests over the typed client with mocked fetch: canonical envelope + persist-before-ack, s- id minting, commandId replay passthrough, error-shape normalization, canonical session list, cursor thread URL (+ url-encoding), active-attempt 404→null, empty/null events envelope → `[]`, status fallback for non-JSON errors.

---

## 2. Verification evidence (run now, this dispatch)

```
$ npx tsx --test src/lib/sen/__tests__/chat-client.test.ts
# pass 4 / fail 0

$ npx tsx --test qa/tests/sen-chat.spec.ts
# pass 12 / fail 0

$ npx tsc --noEmit -p tsconfig.json
# exit 0 (full-project, zero errors; includes SenView + routes + client)
```

## 3. Package checksums (SHA-256)
```
303eac3f343bc9872afa286ac040d11f387511fff0c3f8c94ce40c2f5bde943a  src/lib/sen/chat-client.ts
6afb525ddbd6d22311c7aa5eaa227aa22b67560e4541bd50add5cc9b54586993  src/lib/sen/__tests__/chat-client.test.ts
d6b4457183dbf0a1eda0558664d3a83f67aaa57e4104ff77cadb80653e132309  src/app/api/sen/chat/route.ts
98c2a058d55bd64217b83f8d9236ccbe05220327a0888b3082a7136395a5724f  src/app/api/sen/chat/attempts/[id]/events/route.ts
45926ee66e2e4dac12c0786372a08c69bbc6242398373e0c9f1d228e08642f51  src/app/api/sen/chat/sessions/[id]/active/route.ts
bfb56f4cf024276c2a54b7a09c9508e12a0dc750037913edb0cd577a058e38b1  src/app/api/sen/chat/sessions/[id]/thread/route.ts
ebaa416bd8ac39c31e4a9a921eb79db5c2b6acd0f938d638146a320d939fcaa9  qa/tests/sen-chat.spec.ts
```

## 4. Left for the runbook / next lanes
- End-to-end Go listener + proxy integration gate against a live canonical daemon (external to this lane's props: needs the Go control plane up).
- Legacy-writer rollback path (SEN_CHAT_LEGACY_WRITER=1) unchanged and still delegated; already covered by existing FirstMate routes.

---

JOB_DONE: S03-L2-CANONICAL-CHAT. NEXT: phase-21 promotion gate on the canonical SEN Chat surface.