# S15 close-gate independent arbiter verdict

## Status

**GO** — Sprint 15 (canonical adoption and app integration) closes as recorded.

## Authority

Independent close-gate arbiter (not the S15 author; read-only except this
verdict). Recorded at master `5d6abbc` (2026-09-01, `HEAD`). Closes the S15
canonical-adoption scope ONLY per `plans/260901-1356-s15-canonical-adoption-and-ui/plan.md`
(phases 1-4). This GO does NOT authorize release, promotion/cutover of default
runtime behavior, enabling any legacy writer, Phase 21, or any flip:
canonical remains opt-in by default (`SEN_DAEMON_URL` unset → runtime behavior
byte-identical to pre-S15).

## Checks and outcomes

All checks evaluated at HEAD `5d6abbce275bd5d59e11db77b289c152d5f64c2b`.

| # | Check | Outcome |
|---|-------|---------|
| 1 | Plan + phase 1 + phases 2-3 receipts read; scope = P1 DTO alignment + daemon opt-in, P2 UI surfaces, P3 CI/ops | PASS — plan phases all "Pending" in plan.md; receipts mark phase 1 DONE and phases 2-3 DONE; close-gate (phase 4) is this trial |
| 2 | `npm run test` | PASS — 58/58, 0 fail (incl. canonical-chat-adapter "maps canonical snake_case receipt to the consumer shape with real PKs" + "maps a second turn incrementally") |
| 2 | `go build ./... && go vet ./... && go test ./cmd/sen-plane ./internal/localdb/product` | PASS — build exit 0, vet exit 0, both test packages ok |
| 2 | `npx tsc --noEmit -p tsconfig.json` | PASS — exit 0, 0 errors |
| 3 | Canonical DTO: `go/cmd/sen-plane/main.go` `SenChatTurnResponse` (lines 74-82) | PASS — carries `turn_id` (`json:"turn_id"`), `chat_attempt_id` (`json:"chat_attempt_id"`), `status` (`json:"status"`), plus command_id/turn_seq/session_id/created_at |
| 3 | `src/app/api/sen/chat/route.ts` daemon POST | PASS — gates on `senDaemonURL()` (`SEN_DAEMON_URL` opt-in; unset → null → pre-existing C4/canonicalEnabled/legacy-writer path unchanged, lines 165-166); accepts `session` alias fallback after `sessionId` (lines 80-82); maps daemon response through `mapCanonicalChatReceipt` (lines 99-102, real PKs only, never synthesized) |
| 3 | Legacy path unchanged when `SEN_DAEMON_URL` unset | PASS — `SEN_DAEMON_URL` has no default assignment anywhere (git grep: referenced only in docs, tests that set/delete the var, and the route gate); canonical is opt-in by default |
| 4 | CI: `.github/workflows/ci.yml` `canonical-smoke` job | PASS — job at line 42: build sen-plane, `/healthz` must be ok, POST a chat turn, assert `turn_seq >= 1` + chat_attempt_id present, then stop the daemon |
| 4 | Restore drill receipt | PASS — phase2-3 report records drill; real manifest re-checked: `sha256sum -c backup-manifest.sha256` on `%LOCALAPPDATA%\NEWSOS\phase12-backups-20260901` = 9/9 OK, exit 0 |
| 5 | Chains: `newos-receipt-verify` on S10 closeout receipts | PASS — both `s10-phase5-closeout-receipt.md` and `s10-phase5-current-byte-close-packet.md` verdict PASS, all hash pins match (incl. packet pin of closeout receipt `72d07cd…`) |
| 5 | S12 Phase 12 + S13/S14 CLOSED_GO records | PASS — `s12-phase12-CLOSED_GO-record.md` (Phase 12 legacy cutover GO at `8699509`), `s13-CLOSED_GO-record.md` (GO at `d3eb963`), `s14-CLOSED_GO-record.md` (GO at `b058b72`) all present |
| 6 | Controls: `grep src/ go/` for `legacy_writer: enabled` / `phase_21: enabled` | PASS — 0 hits (grep exit 1 = no matches) |

## sha256 pins

Evidence examined at HEAD `5d6abbc`:

```text
f9fdd568f840163996eed6739965a3771da3b3d0ee296c0288d1d3178072bc2b plans/260901-1356-s15-canonical-adoption-and-ui/plan.md
56ef35b203b015e2201413657548594761e9943b6bf17c324e4ebb06675195f3 plans/reports/s15-phase1-adapter-260901.md
fc0f63d04e226a9bd4f86bfcb8e3d47404d6a78669b2380573856e1cecc1589c plans/reports/s15-phase2-3-ui-and-ops-260901.md
cd8c66ceb7541d51db444b2dc169c8f76bd4d37cc9961b2098b61c6801fc99c3 src/app/api/sen/chat/route.ts
e3c15e3c673913dffbde4d53aec1b816b219a65ebff97a389314ca0ed978c0dc src/lib/sen/canonical-chat-adapter.ts
ac0712991225187c0d4e25cb5411a2b9b56ef634f0ebf3a1ccdf1c45c215bb2c go/cmd/sen-plane/main.go
6392c1f01756f6715df90218e3cba9b63ae1a8d37b53d0e00bf0f401a215844d .github/workflows/ci.yml
8adeb5e498fe6310f946a8edf06d09e2c44623cb278fa694abd4f53170d522a5 plans/reports/s12-phase12-CLOSED_GO-record.md
19ed3b26f447f8691b32fbeb04b7d07e8d5c461896cff6c29424878401643fe0 plans/reports/s13-CLOSED_GO-record.md
c04b9cbb46bebe15cdec0a49833bb9548e13e6bf31f1a93eabdc3de5d88ba859 plans/reports/s14-CLOSED_GO-record.md
c60936c665af8329cfc1cf1ed9069e9f5c17745d04f5905903846e85be191290 plans/reports/sprint10/s10-phase5-closeout-receipt.md
72d07cd336d9829302179f7fbaaac276d57be79360531eb94a1ad24b4e0cc0d2 plans/reports/sprint10/s10-phase5-current-byte-close-packet.md
```

(The two S10 receipts were independently re-verified through
`newos-receipt-verify` against their in-file pins: all `match: true`.)

## Controls

- `legacy_writer: disabled` — 0 hits for `legacy_writer: enabled` across `src/` and `go/`.
- `phase_21: blocked` — 0 hits for `phase_21: enabled` across `src/` and `go/`.
- Canonical chat remains opt-in by default: no `SEN_DAEMON_URL` default/assignment ships in env, package.json scripts, or dev tooling; when unset the sen/chat legacy/offline path is unchanged.
- This GO grants no release, cutover/flip, legacy-writer, or Phase 21 authority.

## Note

`agent-kanban/dispatch` POST without `sessionId` 400s when daemon mode is
active — pre-existing since S12 delegation, becomes visible only when
SEN_DAEMON_URL is runtime-set (tracked in the phase-1 receipt). Non-blocking
for this close.

JOB_DONE: S15 close gate verified independently as GO.