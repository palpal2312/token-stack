# Review brief — S10..S19 + Phase 12 (handoff ngày 2026-09-01)

Gửi kèm cho người review. Reviewer NÊN tự chạy các lệnh bên dưới trên chính
repo này, không tin lời mô tả — evidence là byte đang nằm trên master.

## 1. Bối cảnh 30 giây
Repo NEWS OS di chuyển từ S09 sang một chuỗi 10 sprint + 1 gate cutover, mỗi
bước đóng bằng **arbiter độc lập** trên byte committed → `CLOSED_GO` → journal.
Mục tiêu review: xác nhận chuỗi đóng chuẩn, không có gap, không vi phạm
invariant, và nêu rõ rủi ro còn lại mà owner phải quyết.

## 2. Phạm vi review
- Evidence bắt buộc xem: `plans/reports/` — 11 `s*-CLOSED_GO-record.md` +
  `s12-phase12-CLOSED_GO-record.md` + `retro-260901-s10-to-s19.md` +
  `review-brief` này.
- Mã cần soi kỹ nhất: `go/cmd/sen-plane/main.go`, `go/internal/orca/store.go`,
  `go/internal/localdb/product/chat.go`, `src/app/api/sen/chat/route.ts`,
  `src/app/api/firstmate/chat/route.ts` (guard 410), `scripts/run-s17.ps1`,
  `scripts/s18-slo-probes.ps1`, `Dockerfile`, `.github/workflows/ci.yml`.
- Bảng điểm 11 scope + commit CLOSED_GO: xem mục 1 của
  `docs/session-summary-20260831-0901.md`.

## 3. Lệnh breed lại (chạy hết, không bỏ)
```powershell
npm run test                                   # >=58 pass
cd go; go build ./...; go vet ./...; go test ./internal/... ./cmd/sen-plane  # all ok
npx --no-install tsc --noEmit -p tsconfig.json # 0 errors
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/newos-master/scripts/newos-receipt-verify.ps1 -ReceiptPath "plans/reports/sprint10/s10-phase5-closeout-receipt.md"          # PASS 8/8
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/newos-master/scripts/newos-receipt-verify.ps1 -ReceiptPath "plans/reports/sprint10/s10-phase5-current-byte-close-packet.md"     # PASS 25/25
grep -rEn "legacy_writer: enabled|phase_21: enabled" src/ go/   # 0 hits
Get-Content %LOCALAPPDATA%\NEWSOS\s12-metrics\slo.jsonl -Tail 5  # xem avail
```
Invariant cần xác nhận RÕ trong từng record CLOSED_GO: `legacy_writer:
disabled`, `phase_21: blocked`, không release/cutover/flip, arbiter là session
mới (không phải tác giả packet).

## 4. Điểm rủi ro cần soi đặc biệt (đã biết)
1. **Observability đo được = daemon đang DOWN** — `slo.jsonl` ghi healthz 000,
   consec_fails tăng. Probe task chạy, sen-plane không chạy bền. Đây có phải
   trạng thái chấp nhận được (task kiểm soát là safety detector) hay cần daemon
   luôn bật? Quyết định thuộc owner.
2. **S17 từng NO_GO rồi GO** — đọc lại `s17-go-independent-arbiter-verdict.md`
   sau remediation (5 blocker: runtime copy server/src, cadence nội dung, env
   names-only, runner, README) — binary hài lòng chưa.
3. **Shell S19 chỉ host-local** — env DESKTOP_SHELL_V2=1 qua switch, production
   chưa flip. Đúng gate.
4. **CI container jobs** chưa chạy trên runner có Docker — chỉ có trên giấy.
5. **Backup cadence 2 vòng 9/9** — tự động hóa lịch vẫn ngoài repo.

## 5. Verdict schema
Mỗi focus trả: `PASS` / `FAIL` / `WARN` + 1 dòng lý do + dòng chứng cứ (path).
Kết luận: `REVIEWED <PASS|FAIL>` cho cả chuỗi, kèm danh sách rủi ro owner phải
quyết (nếu có). Không sửa code; không flip gì.

## 6. Người review
Tự chạy fresh (không dùng transcript của tác giả) — session độc lập, đúng tinh
thần arbitrage của chuỗi này.