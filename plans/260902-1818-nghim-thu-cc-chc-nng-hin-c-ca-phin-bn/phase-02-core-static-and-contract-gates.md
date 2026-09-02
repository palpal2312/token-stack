---
title: "Phase 2: Core static and contract gates"
phase: 2
status: done
priority: P1
effort: "4-6h"
dependencies: [1]
---

# Phase 2: Core static and contract gates

## Overview

Chạy các gate máy có sẵn để xác nhận build, type, unit/integration contracts và
các invariant được bảo vệ trước khi manual/UAT flow bắt đầu.

## Requirements

- [ ] Static suite và build/type checks chạy trên committed bytes.
- [ ] Protected controls, Pester S17 và S22 rehearsal chứng minh policy/runtime contracts.
- [ ] Mỗi lỗi ghi command, exit code, log path và impact; không nới assertion.

## Implementation Steps

1. Chạy `npm test`, `npm run go:check`, `npx tsc --noEmit`, `npm run protected:check`, `npm run pester:runner`.
2. Chạy `scripts/run-s22-local-rehearsal.ps1` và `scripts/run-total-tests.ps1 -SkipLive`.
3. Nếu có build/package path, chạy `npm run build` với artifact/log tách biệt và kiểm tra không sinh secret.

## Todo

- [ ] Static gate receipt captured.
- [ ] Contract failures triaged against owning module/test.

## Success Criteria

- [ ] Tất cả gate bắt buộc PASS; hoặc có blocker được owner/recheck ghi rõ.
- [ ] Receipt có commit hash, versions và counts.

## Risk Assessment

Parallel test runners có thể tranh port 3984/3737 hoặc store. Chạy tuần tự,
kiểm tra process/listener trước và dọn process do phase tạo.
