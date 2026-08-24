# Orca Concepts Summary

## Tổng quan

Orca là Agent Development Environment dùng để chạy và điều phối nhiều coding agent. Orca không phải model AI; nó khởi chạy các CLI agent như Codex, Claude Code hoặc OpenCode, cô lập thay đổi bằng Git worktree, theo dõi quá trình thực thi và hỗ trợ review diff.

## Các đơn vị chính

| Đơn vị | Ý nghĩa |
|---|---|
| Goal | Mục tiêu người dùng muốn đạt được; gần với `objective` của Run |
| Run | Toàn bộ một chiến dịch orchestration, chứa các Task và inbox của coordinator |
| Task | Một việc cụ thể cần hoàn thành trong Run |
| Dispatch | Một lần thử giao và thực thi Task; retry tạo Dispatch mới |
| Worker | Vai trò của agent khi được orchestration giao Task |
| Agent session | Process AI CLI thực tế đang chạy |
| Terminal | PTY/process surface nơi shell hoặc agent process chạy |
| Worktree | Git checkout và branch riêng dùng để cô lập thay đổi code |
| Repository | Codebase Git chứa checkout chính và các worktree |
| Host | Máy local, SSH host hoặc remote Orca server nơi process thực sự chạy |
| Runtime | Tiến trình Orca mà CLI đang kết nối và điều khiển |
| Message | Thông tin trao đổi như status, heartbeat, question, escalation hoặc `worker_done` |
| Decision gate | Quyết định phải được giải quyết trước khi Task có thể tiếp tục |

## Quan hệ giữa các đơn vị

```text
Goal
└── Run objective
    └── Task
        └── Dispatch
            └── Worker role
                └── Agent session/process
                    └── Terminal
                        └── Worktree
                            └── Repository
                                └── Host / Orca Runtime
```

Mô tả bằng một câu:

> Trong một Run, coordinator giao một Task, tạo một Dispatch, trong đó một Agent session đóng vai trò Worker, chạy trong một Terminal tại một Worktree cô lập.

## Quy trình hoàn chỉnh

Ví dụ goal: sửa lỗi đăng xuất khi refresh token.

1. Tạo Run với objective tìm nguyên nhân, sửa lỗi và kiểm tra regression.
2. Chia Run thành các Task: điều tra, implement và kiểm thử.
3. Khi Task sẵn sàng, coordinator khởi chạy Worker.
4. Orca chọn hoặc tạo Worktree và branch riêng.
5. Orca tạo Terminal trong Worktree.
6. Orca khởi chạy Codex hoặc Claude Code, tạo Agent session.
7. Việc giao Task cho Worker được ghi nhận thành một Dispatch.
8. Worker đọc code, sửa file, chạy test và gửi heartbeat hoặc question khi cần.
9. Worker gửi `worker_done` kèm `taskId`, `dispatchId` và outcome.
10. Dispatch thành công làm Task hoàn thành; Task phụ thuộc tiếp theo chuyển sang sẵn sàng.
11. Khi mọi Task hoàn tất, coordinator review diff, merge kết quả và kết thúc chiến dịch.

Ví dụ nhiều lần thử:

```text
Task: Fix checkout bug
├── Dispatch 1 → Codex → failed
├── Dispatch 2 → Claude → interrupted
└── Dispatch 3 → Codex → succeeded
```

Task vẫn là cùng một việc cần làm; mỗi lần giao hoặc retry là một Dispatch khác.

## Worktree có phải sandbox không?

Worktree là **sandbox cô lập thay đổi Git**, không phải security sandbox.

Worktree cô lập:

- branch, Git index và working directory;
- file tracked và thay đổi chưa commit;
- diff của từng agent hoặc phương án.

Worktree không cô lập:

- filesystem bên ngoài worktree;
- network, environment variables và credentials;
- SSH key, Docker daemon, database hoặc cloud resources;
- process hệ điều hành và các thư mục được symlink hoặc dùng chung.

Nếu cần cách ly bảo mật thực sự, nên chạy Orca/agent trong restricted user, container hoặc VM. Worktree giúp ngăn các agent giẫm lên code của nhau và giúp loại bỏ diff, nhưng không ngăn agent tác động lên máy.

## Khi nào cần structured orchestration?

Dùng Run, Task và Dispatch khi cần:

- nhiều worker hoặc nhiều agent;
- dependency/DAG giữa các công việc;
- ownership và completion tracking;
- retry history;
- heartbeat, question, escalation hoặc decision gate.

Với một yêu cầu đơn giản, chỉ cần Worktree, Terminal và Agent session; không nhất thiết phải tạo Run và Task.

## Công thức ghi nhớ

```text
Goal ≈ Run objective
1 Run → nhiều Tasks
1 Task → một hoặc nhiều Dispatch attempts
1 Dispatch → một Worker thực hiện
Worker = Agent session trong vai trò được giao việc
Agent session chạy trong Terminal
Terminal thuộc Worktree
Worktree cô lập thay đổi Git, không cô lập bảo mật
```

## Tham khảo

- [Orca repository](https://github.com/stablyai/orca)
- [Orca CLI overview](https://www.onorca.dev/docs/cli/overview)
- [Orca orchestration](https://www.onorca.dev/docs/cli/orchestration)
- [Worktrees](https://www.onorca.dev/docs/model/worktrees)
- [Agents and sessions](https://www.onorca.dev/docs/model/agents-sessions)
