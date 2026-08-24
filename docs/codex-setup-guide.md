# Kinh nghiệm cài đặt Token Stack cho Codex CLI

Tài liệu đúc kết toàn bộ quy trình, kiến trúc, kinh nghiệm xử lý lỗi và các lưu ý thực chiến khi cài đặt bộ giải pháp **4-Layer Token Stack** cho **Codex CLI** (`C:\Users\ADMIN\.codex`).

---

## 1. Tổng quan Kiến trúc 4 Tầng

| Tầng | Công nghệ | Nhiệm vụ | Vị trí / Cấu hình |
|---|---|---|---|
| **Layer 1: Code** | **Ponytail** | Cắt giảm code thừa, tuân thủ YAGNI, ưu tiên standard library | `~/.codex/skills/ponytail*` |
| **Layer 2: Words** | **Caveman** | Cắt bỏ filler words trong phản hồi nhưng giữ nguyên thuật ngữ kỹ thuật | `~/.codex/skills/caveman*` |
| **Layer 3: CLI Output** | **RTK (Rust Token Killer)** | Lọc bớt output dài từ command line (`git diff`, `test`, `build`, etc.) | `%LOCALAPPDATA%\rtk\rtk.exe` & `~/.codex/RTK.md` |
| **Layer 4: API Context** | **Headroom Proxy** | Proxy nén ngữ cảnh và lịch sử hội thoại, duy trì prefix cache | `~/.local/bin/headroom.exe` (Port `8791`) |

---

## 2. Các Bước Cài Đặt Chi Tiết

### Bước 1: Cài đặt Skills Router & Agent Skills (Layer 1 & 2)
Codex CLI hỗ trợ cấu trúc skill thông qua thư mục `skills/<skill_name>/SKILL.md`.

Sử dụng NTFS Junction để liên kết trực tiếp từ kho nguồn `C:\Users\ADMIN\Documents\token-stack\skills`:
- `token-stack`
- `token-stack-health`
- `token-stack-report`
- `token-stack-setup`

Đồng thời liên kết các skill của `ponytail` và `caveman` vào `~/.codex/skills/`.

```powershell
$source = "C:\Users\ADMIN\Documents\token-stack\skills"
$target = "C:\Users\ADMIN\.codex\skills"
@('token-stack', 'token-stack-health', 'token-stack-report', 'token-stack-setup') | ForEach-Object {
    New-Item -ItemType Junction -Path (Join-Path $target $_) -Target (Join-Path $source $_)
}
```

---

### Bước 2: Cài đặt & Cấu hình RTK (Layer 3)
1. Binary chính thức: `%LOCALAPPDATA%\rtk\rtk.exe` (v0.45.0).
2. Tạo shims để gọi được từ mọi terminal:
   - `C:\Users\ADMIN\bin\rtk` (Git Bash shim: `exec "$LOCALAPPDATA/rtk/rtk.exe" "$@"`)
   - `C:\Users\ADMIN\bin\rtk.cmd` (CMD/PowerShell shim: `"%LOCALAPPDATA%\rtk\rtk.exe" %*`)
3. Chạy lệnh cấu hình tự động cho Codex:
   ```powershell
   rtk init -g --codex
   ```
   *Lệnh này tự động tạo `C:\Users\ADMIN\.codex\RTK.md` và gắn `@RTK.md` vào `C:\Users\ADMIN\.codex\AGENTS.md`.*

---

### Bước 3: Cấu hình Headroom Proxy Cổng Riêng (Layer 4)

#### ⚠️ 3 Nguyên tắc Bắt buộc (Critical Pitfalls):
1. **Dynamic Port Allocation (8787 - 9999)**: Không cố định cổng, hệ thống tự động dò quét dải cổng từ 8787 đến 9999 (kiểm tra cả cấu hình profile và trạng thái TCP Socket thực tế trên máy) để cấp phát cổng trống đầu tiên.
   - `.claude-sub2api-02`: `8787`
   - `.claude-kimicode`: `8788`
   - `.claude-fugu`: `8789`
   - `.claude-sub2api`: `8790`
   - **`.codex`**: **`8791`**
2. **SQLite DB Path Isolation**: Bắt buộc truyền tham số `--memory-db-path "C:\Users\ADMIN\.codex\headroom-data\headroom.db"`. Nếu dùng chung DB mặc định, instance thứ 2 trở đi sẽ bị crash ngầm do SQLite lock.
3. **Cold Start 60-90s**: Headroom mất khoảng 60–90 giây để pre-load mô hình tokenizer/compressor. Trong giai đoạn này endpoint sẽ báo Connection Refused — đây là hiện tượng bình thường, script kiểm tra cần loop poll `readyz` tối đa 90s.

#### Cấu hình tệp môi trường `~/.env.codex` & `~/.codex/.env`:
```dotenv
HEADROOM_PORT=8791
HEADROOM_UPSTREAM=http://127.0.0.1:5173
HEADROOM_DB_PATH=C:\Users\ADMIN\.codex\headroom-data\headroom.db
OPENAI_BASE_URL=http://127.0.0.1:8791/v1
ANTHROPIC_BASE_URL=http://127.0.0.1:8791
```

#### Hook tự động khởi động (`SessionStart`):
Tạo hook [headroom-ensure.ps1](file:///C:/Users/ADMIN/.codex/hooks/headroom-ensure.ps1) trong `~/.codex/hooks/` và đăng ký vào `~/.codex/hooks.json`:
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

## 3. Lệnh Kiểm Tra Sức Khỏe (Health Check)

Chạy lệnh kiểm tra định kỳ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "C:\Users\ADMIN\Documents\token-stack\skills\token-stack-health\scripts\token-stack-health.ps1" `
  -ProfileDirectory "C:\Users\ADMIN\.codex"
```

**Kết quả chuẩn:**
```text
harness  [OK] claude/codex present
rtk      [OK] shim=true binary=true version=present
headroom [OK] installed=true configured=true running=true port=8791 http=200
```

