# Token-Stack Deep Adversarial Test Program: Reviewer Handover Guide

> **Mục đích**: Tài liệu bàn giao toàn diện dành cho Reviewer / QA Engineer để kiểm tra, tái hiện kết quả kiểm thử và đánh giá tài liệu của hệ sinh thái Token-Stack 2.0/3.2.

---

## 1. Lệnh Kiểm Thử Nhanh (Quick Verification)

Tất cả các lệnh chạy từ thư mục gốc repository (`source/`):

```powershell
# 1. Chạy toàn bộ 88 Test Cases (Offline Hermetic Suite - 100% Pass kỳ vọng)
npm run test:token-stack

# 2. Kiểm tra Code Coverage & Coverage Ratchet (Line 88.79%, Branch 80.74%)
npm run test:token-stack:coverage

# 3. Bounded Fuzz Testing (1,000 chu kỳ fuzz không crash)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-token-stack-fuzz.ps1 -Iterations 1000

# 4. Soak, Quản lý Bộ nhớ & Microbenchmarks (1,000 chu kỳ tải, latency <2ms)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-token-stack-soak.ps1 -Cycles 1000

# 5. Flake Detection Loop (Chạy lặp 10 lần liên tiếp không có test chập chờn)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-token-stack-flake.ps1 -Runs 10 -StopOnFailure

# 6. Quét rò rỉ mã khóa tĩnh (Zero Credential Scan)
node scripts/check-token-stack-secrets.cjs
```

---

## 2. Bảng Đối Chiếu Chỉ Số Chất Lượng & Coverage Ratchet

Tất cả 5 module lõi quan trọng đều đã vượt qua chuẩn chất lượng cam kết:

| Module | Line Coverage % | Branch Coverage % | Function Coverage % | Đánh giá |
|---|:---:|:---:|:---:|:---:|
| `core/guardrail.cjs` | **100.00%** (Gate ≥90%) | **92.59%** (Gate ≥80%) | **100.00%** | ✅ VƯỢT CHUẨN |
| `core/turn-folder.cjs` | **100.00%** (Gate ≥90%) | **94.12%** (Gate ≥80%) | **100.00%** | ✅ VƯỢT CHUẨN |
| `core/cot-governor.cjs` | **97.62%** (Gate ≥90%) | **96.15%** (Gate ≥80%) | **100.00%** | ✅ VƯỢT CHUẨN |
| `core/semantic-cache.cjs` | **96.20%** (Gate ≥90%) | **94.64%** (Gate ≥80%) | **85.71%** | ✅ VƯỢT CHUẨN |
| `core/model-router.cjs` | **100.00%** | **100.00%** | **100.00%** | ✅ HOÀN HẢO |
| **Toàn bộ hệ thống** | **88.79%** (Gate ≥85%) | **80.74%** (Gate ≥75%) | **86.61%** | ✅ ĐẠT CHUẨN |

---

## 3. Bản Đồ Tài Liệu & File Cần Kiểm Tra (Checklist Đối Chiếu)

Reviewer vui lòng kiểm tra tính nhất quán giữa tài liệu và mã nguồn tại các liên kết sau:

### Kế hoạch và Báo cáo nghiệm thu
- Kế hoạch tổng thể: `plans/260903-1959-token-stack-deep-adversarial-test-program/plan.md` (Status: `complete`)
- Báo cáo 8 Phase chi tiết:
  - `phase-01-start.md`: Hermetic Harness & Failure Model
  - `phase-02-core-property-and-deterministic-fuzz.md`: Property Generators & Invariants
  - `phase-03-mutation-and-coverage-guided-fuzzing.md`: Mutation & Coverage-Guided Fuzzing
  - `phase-04-powershell-cli-registry-and-lifecycle.md`: PowerShell CLI, Registry, and Lifecycle
  - `phase-05-verifier-protocol-chaos-and-redaction.md`: Protocol Chaos & Redaction
  - `phase-06-installer-packaging-and-compatibility.md`: Installer, Packaging, Compatibility
  - `phase-07-performance-soak-and-resource-bounds.md`: Performance, Soak, Resource Bounds
  - `phase-08-ci-evidence-and-live-certification.md`: CI Evidence & Live Certification
- Mẫu bằng chứng kiểm thử: `plans/260903-1959-token-stack-deep-adversarial-test-program/reports/test-evidence-template.md`

### Tài liệu kỹ thuật và Hợp đồng kiểm thử
- Hướng dẫn kiểm thử chính: `docs/token-stack-testing.md`
- Bản kê khai kiểm thử & Giới hạn tài nguyên: `tests/test-manifest.md`
- Hợp đồng thử nghiệm đột biến (Mutation Contract): `tests/token-stack/mutation-contract.md`
- Quy chuẩn dữ liệu mẫu (Fixtures Contract): `tests/token-stack/fixtures/README.md`
- Quy trình chứng nhận Live Provider an toàn: `tests/token-stack/live-certification-checklist.md`

### CI/CD Workflows
- Workflow CI chính: `.github/workflows/ci.yml` (Bao gồm job `token-stack-test` với coverage ratchet)
- Workflow kiểm thử định kỳ: `.github/workflows/token-stack-deep-tests.yml` (Fuzz, Soak, Flake, Mutation)
- Workflow chứng nhận Live có bảo vệ: `.github/workflows/token-stack-live-certification.yml`

---

## 4. Các Nguyên Tắc An Toàn Cốt Lõi Đã Được Chứng Thực

1. **Hermetic Sandbox**: Mọi thao tác ghi file chỉ diễn ra trong thư mục tạm `os.tmpdir()/token-stack-*`. Không chạm vào `~/.claude`, `~/.gemini` hay `~/.token-stack`.
2. **Quản lý Tiến trình (Zero Orphan Processes)**: Mọi child process được gán PID, timeout tối đa và kết thúc dứt điểm bằng `taskkill /PID /T /F` trên Windows. Hệ thống từ chối can thiệp vào các PID ngoài phạm vi kiểm thử.
3. **Mạng Loopback 100%**: Mọi socket kiểm thử chỉ bind `127.0.0.1` trên các cổng tạm thời (ephemeral ports) và giải phóng tức thì. Không có kết nối ngoại vi nào trong quá trình chạy CI.
4. **Bảo mật & Che giấu mã khóa (Zero Secret Leaks)**: Static scanner quét toàn bộ mã nguồn, tài liệu, fixture; Dynamic test chứng minh canary token (dạng raw, base64 hay url-encode) hoàn toàn không rò rỉ ra console logs hoặc file ổ đĩa.
