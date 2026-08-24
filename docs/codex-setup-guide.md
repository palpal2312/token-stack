# Hướng Dẫn & Tổng Kết Kinh Nghiệm Cài Đặt Token Stack Cho OpenAI Codex CLI

Tài liệu đúc kết toàn bộ quy trình, kiến trúc, bài học kinh nghiệm xử lý sự cố (troubleshooting) và các quy chuẩn thực chiến khi triển khai giải pháp **4-Layer Token Stack** cho **OpenAI Codex CLI** trên môi trường Windows (`C:\Users\ADMIN\.codex`).

---

## 1. Tổng Quan Kiến Trúc 4 Tầng Tối Ưu

```text
+-------------------------------------------------------------------------------+
|                             4-LAYER TOKEN STACK                               |
+-------------------------------------------------------------------------------+
|  Layer 1: CODE REDUCTION        -> Ponytail (KISS, YAGNI, No fluff code)      |
|  Layer 2: PROMPT/WORD REDUCTION -> Caveman (Concise technical responses)      |
|  Layer 3: CLI OUTPUT REDUCTION  -> RTK - Rust Token Killer (Filters outputs)  |
|  Layer 4: API CONTEXT REDUCTION -> Headroom Proxy (Lossless context compress) |
+-------------------------------------------------------------------------------+
```

| Tầng | Công nghệ / Công cụ | Nhiệm vụ | Vị trí & Cấu hình |
|---|---|---|---|
| **Layer 1: Code** | **Ponytail** | Cắt giảm mã nguồn thừa, triệt để tuân thủ YAGNI, ưu tiên standard library | `~/.codex/skills/ponytail*` |
| **Layer 2: Words** | **Caveman** | Loại bỏ filler words trong câu trả lời nhưng giữ nguyên thuật ngữ kỹ thuật | `~/.codex/skills/caveman*` |
| **Layer 3: CLI Output** | **RTK (Rust Token Killer)** | Lọc gọn output dài dòng từ CLI (`git diff`, `tsc`, `test`, `build`) trước khi nạp vào context | `%LOCALAPPDATA%\rtk\rtk.exe` & `~/.codex/RTK.md` |
| **Layer 4: API Context** | **Headroom Proxy** | Proxy nén ngữ cảnh và lịch sử hội thoại, duy trì prefix cache | `~/.local/bin/headroom.exe` (Port dynamic `8791`) |

---

## 2. Quy Trình Cài Đặt Từng Bước Cho Codex

### Bước 1: Liên kết Skills Router & Agent Skills (Layer 1 & Layer 2)
Codex CLI hỗ trợ cấu trúc skill thông qua thư mục `skills/<skill_name>/SKILL.md`.

Sử dụng NTFS Junction (không cần quyền Admin) để liên kết trực tiếp từ kho nguồn `token-stack`:
```powershell
$source = "C:\Users\ADMIN\Documents\token-stack\skills"
$target = "C:\Users\ADMIN\.codex\skills"
New-Item -ItemType Directory -Path $target -Force | Out-Null

@('token-stack', 'token-stack-health', 'token-stack-report', 'token-stack-setup') | ForEach-Object {
    $dest = Join-Path $target $_
    if (-not (Test-Path -LiteralPath $dest)) {
        New-Item -ItemType Junction -Path $dest -Target (Join-Path $source $_)
    }
}
```

Đồng thời liên kết các skill của `ponytail` và `caveman` vào `~/.codex/skills/`.

---

### Bước 2: Cài đặt & Tích hợp RTK (Layer 3)
1. **Binary chính thức**: `%LOCALAPPDATA%\rtk\rtk.exe`.
2. **Tạo shims hệ thống**:
   - `C:\Users\ADMIN\bin\rtk` (Git Bash shim: `exec "$LOCALAPPDATA/rtk/rtk.exe" "$@"`)
   - `C:\Users\ADMIN\bin\rtk.cmd` (CMD / PowerShell shim: `"%LOCALAPPDATA%\rtk\rtk.exe" %*`)
3. **Cấu hình tự động cho Codex**:
   ```powershell
   rtk init -g --codex
   ```
   *Lệnh này tự động sinh file `~/.codex/RTK.md` và gắn chỉ thị `@RTK.md` vào `~/.codex/AGENTS.md`.*

---

### Bước 3: Cấu hình Headroom Proxy (Layer 4)
1. **Tạo thư mục dữ liệu SQLite độc lập**:
   ```powershell
   New-Item -ItemType Directory -Path "C:\Users\ADMIN\.codex\headroom-data" -Force | Out-Null
   ```
2. **Cấu hình tệp môi trường `~/.env.codex` & `~/.codex/.env`**:
   ```dotenv
   HEADROOM_PORT=8791
   HEADROOM_UPSTREAM=http://127.0.0.1:5173
   HEADROOM_DB_PATH=C:\Users\ADMIN\.codex\headroom-data\headroom.db
   OPENAI_BASE_URL=http://127.0.0.1:8791/v1
   ANTHROPIC_BASE_URL=http://127.0.0.1:8791
   ```
3. **Đăng ký SessionStart Hook trong `~/.codex/hooks.json`**:
   ```json
   {
     "hooks": {
       "SessionStart": [
         {
           "matcher": "startup|resume|clear|compact",
           "hooks": [
             {
               "type": "command",
               "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\\Users\\ADMIN\\.codex\\hooks\\headroom-ensure.ps1\"",
               "timeout": 120
             }
           ]
         }
       ]
     }
   }
   ```

---

## 3. Tổng Kết 7 Bài Học Kinh Nghiệm & Xử Lý Sự Cố (Crucial Gotchas)

### 🔴 Bài học 1: Bắt buộc dùng UTF-8 NO BOM cho parser Rust của Codex
- **Hiện tượng**: Khởi động Codex bị báo lỗi:
  - `Skipped loading 4 skill(s) due to invalid SKILL.md files: missing YAML frontmatter delimited by ---`
  - `failed to parse hooks config hooks.json: expected value at line 1 column 1`
- **Nguyên nhân**: Lệnh PowerShell mặc định (`Set-Content -Encoding UTF8`) ghi file kèm Byte Order Mark (`0xEF, 0xBB, 0xBF`). Trình phân giải Rust (`serde_json` và YAML parser) của Codex không chấp nhận 3 byte ẩn này ở đầu file.
- **Giải pháp**: Luôn ghi file cấu hình và tài liệu bằng UTF-8 không BOM:
  ```powershell
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
  ```

---

### 🔴 Bài học 2: Cấp phát cổng động trong dải 8787 – 9999 (Dynamic Port Allocation)
- **Hiện tượng**: Nếu cố định cổng `8787` cho tất cả các profile (Codex, Claude, Kimi), profile khởi động sau sẽ chiếm dụng hoặc xung đột upstream với profile khởi động trước.
- **Giải pháp**: Thuật toán `Get-NextFreePort` quét toàn bộ dải `8787..9999`, kết hợp kiểm tra cấu hình trong các file `.env.*` và thăm dò socket thực tế (`[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)`) để gán cổng trống đầu tiên khả dụng.

---

### 🔴 Bài học 3: Cô lập đường dẫn SQLite Database (`--memory-db-path`)
- **Hiện tượng**: Instance Headroom thứ 2 khởi động lên vài giây rồi tự động biến mất/crash ngầm không rõ nguyên nhân.
- **Nguyên nhân**: Headroom mặc định ghi dữ liệu bộ nhớ token vào `~/.headroom/headroom.db`. Khi nhiều instance chạy đồng thời, file SQLite bị lock độc quyền khiến các instance sau crash.
- **Giải pháp**: Bắt buộc thêm tham số `--memory-db-path "C:\Users\ADMIN\.codex\headroom-data\headroom.db"` riêng biệt cho từng profile.

---

### 🔴 Bài học 4: Xử lý độ trễ khởi động nguội (Cold Start 60–90s)
- **Hiện tượng**: Khi mới khởi động Headroom, gọi `/readyz` hoặc `/health` bị báo `Connection Refused`.
- **Nguyên nhân**: Headroom cần nạp trước (pre-load) các mô hình tokenizers và parsers nén ngữ cảnh.
- **Giải pháp**: Hook khởi động `headroom-ensure.ps1` phải thực hiện vòng lặp thăm dò (polling) endpoint `http://127.0.0.1:<port>/readyz` với thời gian chờ tối đa 90 giây trước khi xác định lỗi.

---

### 🔴 Bài học 5: Tự động nhận diện Harness & Model trong bộ công cụ kiểm tra
- **Hiện tượng**: Chạy `$token-stack:health` trong Codex nhưng kết quả hiển thị `Harness: Claude` và `Model: UNKNOWN`.
- **Giải pháp**: Nâng cấp `token-stack-health.ps1` và `token-stack-report.ps1` tự động nhận diện tiến trình cha `codex`, tự động đọc model từ `~/.codex/config.toml` (ví dụ: `gpt-5.6-luna`), và probe đúng cổng `8791` của Codex.

---

### 🔴 Bài học 6: Chạy kiểm tra Probe Loopback trực tiếp
- **Hiện tượng**: Kết quả health check báo `Headroom: UNKNOWN - đã cấu hình nhưng chưa chạy`.
- **Nguyên nhân**: Cờ `-SkipRuntimeProbes` được truyền vào khiến script bỏ qua bước gửi request kiểm tra cổng và trả về `UNKNOWN`.
- **Giải pháp**: Bỏ cờ `-SkipRuntimeProbes` trong hướng dẫn gọi mặc định để script probe nhanh loopback `/readyz` trong 1–2s và trả về trạng thái `[OK]`.

---

### 🔴 Bài học 7: Quản lý ngân sách ngữ cảnh Skill của Codex
- **Hiện tượng**: Xuất hiện cảnh báo `Skill descriptions were shortened to fit the skills context budget`.
- **Ý nghĩa**: Đây là cơ chế tự động bảo vệ context của Codex khi số lượng skill trong `~/.codex/skills/` hoặc `~/.agents/skills/` quá nhiều. Codex chỉ thu gọn phần mô tả ban đầu và vẫn nạp/gọi được đầy đủ tất cả các skill khi cần.

---

## 4. Lệnh Kiểm Tra & Báo Cáo Tiết Kiệm (Verification)

### Kiểm tra sức khỏe 4 tầng:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.codex/skills/token-stack-health/scripts/token-stack-health.ps1"
```

**Output chuẩn hoàn hảo:**
```text
directory=C:\Users\ADMIN\Documents\Agent OS\source
profile=C:\Users\ADMIN\.codex
harness=codex
model=gpt-5.6-luna
harness  [OK     ] codex present
model    [OK     ] configured=gpt-5.6-luna runtime=external
ponytail [OK     ] installed=true enabled=true
caveman  [OK     ] installed=true enabled=true
rtk      [OK     ] shim=true binary=true version=present
headroom [OK     ] installed=true configured=true running=true port=8791 http=200
```

### Báo cáo thống kê số token đã tiết kiệm:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.codex/skills/token-stack-report/scripts/token-stack-report.ps1"
```