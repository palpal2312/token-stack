# NEWS OS — session summary 2026-08-30 RT 2026-09-01 (S10..S19 + Phase 12)

## 1. Tổng quan chuỗi

Mười sprint (S10–S19) cộng một gate cutover (Phase 12), đóng liên tục bằng cùng
pattern: **plan → cook → independent arbiter trên byte committed → CLOSED_GO →
journal lifecycle event**. Mọi verdict từ session-con mới (không phải tác giả
packet), mọi thứ fail-closed khi có blocker.

| Scope | Nội dung | Commit CLOSED_GO |
|---|---|---|
| S10 | Controlled execution scope + close; live-runtime arbiter no-go ban đầu, đóng theo evidence | `e2bad67`/`05eefea` |
| S11 | Review + split rewrite-baseline (17 topic) → merge master; desktop-shell slice smoke | `4876a49` |
| S12 | Go control-plane wiring (sen-plane daemon), coverage sweep + speculative API cut, enable-gate | `462fcd6` |
| Phase 12 | Legacy chat cutover: FirstMate JSONL → canonical Go store, backfill 68 turn + canary, arbiter GO | `30f21e8` |
| S13 | Orca-store projection (slots/attempts live), preview-enable, tsc 0 | `192aec5` |
| S14 | QA harness, dev-loop starter, CI workflow | `d09d5db` |
| S15 | Canonical DTO alignment (turn_id/chat_attempt_id thật), CI smoke, restore drill | `7033a2a` |
| S16 | Canonical-default runtime, legacy freeze (410 guard), backup cycle 2 | `b7a64d7` |
| S17 | Packaging: Dockerfile 3-stage, env template, run harness, container CI — NO_GO → sửa 5 blocker → GO | `9155fb8` |
| S18 | Observability: SLO probes, metrics route + dashboard, scheduled task, cadence | `b3330ed` |
| S19 | Desktop-shell rollout switch (host-local) | `4d15528` |

## 2. Kiến trúc kết quả

- **Go control plane** (`go/cmd/sen-plane` + `go/internal/*`): orca store (dispatch,
  cursor monotonic), product chat store (`SendTurn`), slots/attempts projection;
  loopback-only, fail-closed.
- **App (Next 16)**: proxy → daemon qua `SEN_DAEMON_URL`; chat canonical default
  fail-closed (503/410), legacy JSONL writer frozen bằng 410 guard.
- **Packaging**: Dockerfile 3-stage (Go vet/test trong stage + Next + node-pty
  native; runtime chỉ copy artifact), `.env.example` names-only, `run-s17.ps1`
  (-Native / -Container / -Shell).
- **Observability**: probe loop 30s (Availability/RPO/RTO) → `slo.jsonl`,
  `/api/ops/metrics`, `/ops/observability`, scheduled task 30m + backup cadence
  `sha256sum -c`.
- **Evidence hệ thống**: journal `~/.agentic-os/orchestration-state.jsonl`, 11
  CLOSED_GO records, receipt verify (8/8 + 25/25), memory ak cho controller sau.

## 3. Invariants giữ xuyên suốt

`legacy_writer: disabled` (và frozen/dùng), `phase_21: blocked`, desktop shell
OFF production, không release/cutover/flip ngoài scope được arbitra. Cắt giảm
transient runtime data khỏi git; backup ngoài git 2 vòng 9/9.

## 4. Hiện trạng (check cuối 2026-09-01)

- Regression: npm test 58/58 · go build/vet + 15 pkgs · tsc 0 · chains PASS ·
  controls 0 enabled.
- Probe task đang chạy; **tín hiệu đầu: sen-plane daemon không chạy bền**
  (`healthz 000`, consec_fails 24) — metric thật đầu tiên báo lỗi availability.
- Housekeeping (archive index, retro, memory checkpoint) viết xong, chưa commit
  (theo chỉ dẫn).

## 5. Owner tiếp theo (đề xuất)

1. Commit 3 doc housekeeping: `plans/_archive/README.md`,
   `plans/reports/retro-260901-s10-to-s19.md`, `docs/newsos-master-memory.md`.
2. Quyết định chạy sen-plane bền (vd `run-s17.ps1 -Mode Native` hoặc task
   daemon) để observability hết cảnh báo; xem lại `slo.jsonl` sau 1–2 ngày.
3. Tiện hóa: CI container jobs cần runner có Docker; backup cadence tự động hóa
   ngoài repo.

Chi tiết đầy đủ từng sprint: `plans/reports/retro-260901-s10-to-s19.md`.