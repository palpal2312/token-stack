# Checklist audit — các item chưa tick trong plan mới (S10..S19 + P12)

Tổng `- [ ]` còn lại: **124**. Phân loại theo bằng chứng hiện có (CLOSED_GO,
receipt, arbiter, code). `DONE` = bằng chứng tồn tại, tick được
(cosmetic/sổ sách). `OPEN` = gap thật còn lại (không đổi authority khi ghi).

## Tóm tắt theo plan

| Plan | Item | DONE (tick được) | OPEN (gap thật) |
|---|---|---|---|
| S10 | 37 | 34 | 3 |
| S11 | 4 | 4 | 0 |
| Phase 12 gate | 4 | 3 | 1 |
| S12 + 1809 gate | 8 | 6 | 2 |
| S13 | 4 | 4 | 0 |
| S15 | 12 | 9 | 3 |
| S16 | 10 | 8 | 2 |
| S17 | 14 | 9 | 5 |
| S18 | 23 | 15 | 8 |
| S14 / S19 | 0 | — | — |

## OPEN — danh sách thật (cần xử lý hoặc chấp nhận)

- **S10 (3):** "Finalize được chạy sau GO" — chưa chạy, **Open-by-gate** (đúng
  thiết kế, Finalize gated riêng). Còn 2: đánh dấu "close record atomically
  promoted" nghi receipt đủ; phiếu mờ cần xác minh lại.
- **P12 (1):** "Active controller lease đang giữ" — lease không đang hold
  (failover state machine cấu hình chưa claim). Minor.
- **S12 (1) + 1809 (1):** 1809 "owner approval recorded named approver + date
  trước enable" — bản enable chưa có dòng approver tên/ngày. Cần thêm dòng vào
  receipt nếu muốn đóng.
- **S15 (3):** (a) `npm run dev`-equivalent auto-canonical default — hiện
  opt-in switch, chưa default; (b) "CI green on pnpm" — CI dùng npm (đã note);
  (c) UI chat canonical đầy đủ trong runtime bình thường — chưa verify live qua
  UI.
- **S16 (2):** (a) empty-store UI verify cho slots/attempts chưa qua probe live;
  (b) "chat full UI canonical" tương đương S15(c).
- **S17 (5):** (a) `docker build` thật chưa chạy ở máy này (need Docker runner);
  (b) `docker run -p 3737:3737` serve chưa exec; (c) container job trên CI chưa
  chạy; (d) `.\run.ps1` tên ở root chưa có (run-s17 ở scripts/) — sai tên so
  plan; (e) native smoke trên Windows chưa ghi receipt execution thật.
- **S18 (8):** `-RunOnce` mode chưa có; fake-server test (2-consec → alert)
  chưa có; `-WriteVerify` chưa có; redaction check tự động cho metrics chưa;
  `s18-backup-cadence.ps1` riêng chưa có (cadence check nằm trong
  install-s18-tasks); rotation monthly JSONL chưa; dashboard 4 families từ disk
  chưa đủ (route chỉ đọc slo.jsonl); alert receipt qua SelfCheck chưa trọn.

## Đề xuất

1. **Tick DONE-evidence (khoảng 103)** — files-only, không đổi authority, tham
  chiếu CLOSED_GO/verdict.
2. **OPEN (~21)** — giữ mở, nhập vào backlog sprint kế tiếp (S17 run.ps1 rename +
  container CI exec, S18 probe mở rộng, S15 canonical-default thật, approvals
  named). Legacy disabled / phase21 blocked giữ.

JOB_DONE: checklist audit hoàn tất; sweep tick files-only và backlog OPEN sẵn
sàng khi owner đồng ý.