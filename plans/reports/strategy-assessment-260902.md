# NEWS OS — đánh giá chiến lược (2026-09-02)

## 1. Thực trạng
- **Đã xong (có evidence):** S10–S21, Phase 12 legacy cutover, runtime repair,
  observability, packaging (Docker), guard runtime `npm run protected:check`.
  Chuỗi đóng bằng arbiter/static-verify; 58/58 test, 15 pkgs Go, tsc 0,
  `legacy_writer disabled`, `phase_21 blocked`.
- **Vận hành đang chạy:** daemon sen-plane (task), probe SLO 30s (healthz 200),
  backup cadence daily + 2 cycles, archive/ledger đầy đủ.

## 2. Điểm mạnh
- Kiến trúc hai tầng rõ (Go control plane + Next proxy), fail-closed, redacted,
  evidence-first; mọi biến thiên đi qua gate; code đủ test; clone một-lệnh được
  (docker) — chạy được nơi khác.

## 3. Rủi ro / nợ thật
- **Phase-21 chưa mở** — release thật chưa từng xong; stale theo thiết kế, nhưng
  đó là quyết định chiến lược duy nhất còn treo.
- Legacy "dead-code" SEN đã dừng; các legacy surface khác (builder CLI chat,
  fleet-board/kanban) vẫn live — không phải canonical, đợi quyết thay thế.
- Observability còn thô (dashboard bảng; chưa alert push ra ngoài). CI container
  job cần runner (đã có Docker máy này, Actions chưa).
- Phụ thuộc host cá nhân (Docker Desktop/WSL); chưa có hạ tầng production.

## 4. Lựa chọn chiến lược (owner chọn 1)
1. **Giữ plateau + vận hành** (0 phí thiết kế): chỉ theo dõi SLO/backup; không
   phát triển. Phù hợp nếu hệ là công cụ cá nhân/ổn định.
2. **Mở Phase-21 (release thật):** lập plan cutover sản xuất (host, backup,
   canary, arbiter), chốt `legacy_writer: enabled` chỉ khi canonical đủ chuẩn
   production; quyết định lớn nhất về độ lớn hệ.
3. **Đưa canonical thành default toàn diện + mở rộng sản phẩm:** refine UI (chat
   canonical phẳng), kanban/kaneo, multi-goal scheduler, Dify/LLMOps. Chọn làm
   việc có giá trị ngay trên nền vững.

## 5. Khuyến nghị
Chọn **(1) ngắn hạn** (dừng đúng, vận hành) rồi quyết **(3)** nếu còn cần hệ lớn;
**(2)** chỉ khi có yêu cầu release thật từ bên ngoài. Cơ sở: hệ bền, evidence
đủ; thêm công trước khi có nhu cầu là lãng phí (YAGNI).

JOB_DONE: đánh giá chiến lược hoàn tất; quyết định thuộc owner.