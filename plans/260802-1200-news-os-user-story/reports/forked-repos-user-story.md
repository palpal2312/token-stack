
## 5. aisuite & OpenWorker (LLM Router & Agentic Runtime)
* **Cách áp dụng:** Mặc dù không fork trực tiếp, codebase của News OS tích hợp sâu Design Pattern và nguyên lý của hai dự án này tại tầng lõi (Core Engine):
  * **aisuite:** Lớp Router/Adapter của OS (`src/lib/routers`) tuân theo kiến trúc provider của `aisuite`. Nó chuẩn hoá mọi API (OpenAI, Anthropic, Gemini) về cùng một định dạng (VD: tự động map `input_schema` của Anthropic hay dịch system prompt). Vòng lặp Tool Runner (`max_turns`) cũng được xây dựng dựa trên `client.py` của aisuite để quản lý lỗi không làm đứt gãy luồng chạy của LLM.
  * **openworker:** Lớp Runtime (`src/lib/agentRuntime`) kế thừa tư tưởng của OpenWorker. Nó ứng dụng chuẩn MCP (Model Context Protocol) để thiết lập môi trường phân quyền (delegation), kiểm soát Token cục bộ, quản lý Timeout và quyết định tool nào được phơi bày cho LLM (gating).
* **User Story:**
  > **Là một DevOps/System Engineer**, tôi muốn xây dựng một mạng lưới agent phức tạp mà không bị phụ thuộc vào một nhà cung cấp LLM cụ thể nào. Bằng cách thiết lập cấu hình trong News OS, tôi có thể chỉ định `@claude` gọi một tool (qua MCP chuẩn của openworker), sau đó kết quả được lớp `aisuite` router tiếp nhận và tự động biên dịch lại mượt mà để trả sang cho `@codex` xử lý bước tiếp theo. Tôi không bao giờ phải lo lắng về việc SDK của các hãng không tương thích với nhau.

---

## 6. Kiến trúc tri thức: Tái sử dụng Mã nguồn mở qua Sen

Về cơ bản, News OS sinh ra để giải quyết bài toán: **Làm sao để sử dụng, tích hợp và bảo trì (maintain) hàng chục dự án Open Source khác nhau một cách dễ dàng nhất?**

Thay vì phụ thuộc vào trí nhớ của lập trình viên, mọi kinh nghiệm, cấu hình, và cách kết nối (bridge) các repo open source đều được lưu thẳng vào **Knowledge Base (Obsidian Vault)**.

**Vai trò của Sen (Firstmate):**
* **Sen** đóng vai trò là một quản gia công nghệ/kỹ sư trưởng. Nó đọc liên tục các tài liệu từ Knowledge Base này. 
* Khi có yêu cầu làm một sản phẩm mới, Sen sẽ tự động đề xuất và **hướng dẫn tích hợp** các công nghệ Open Source phù hợp. Nó biết cách "bắt tay" với Dify, biết cách điều phối HeyGen, và biết cách tổ chức thư mục mà không làm rối mã nguồn chính.

**User Story:**
> **Là một DevOps / Architect**, tôi không còn đau đầu mỗi khi các dự án Open Source ra phiên bản mới làm gãy code. Nhờ có Sen, mọi tri thức sử dụng Dify hay OMI đều được lưu lại. Khi khởi tạo một tính năng mới cần dùng AI Workflow, Sen tự động lôi kinh nghiệm cũ ra, viết sẵn các đoạn script tích hợp (Bridge) và hướng dẫn tôi cách gắn kết chúng vào sản phẩm mới, giảm 90% thời gian nghiên cứu lại tài liệu (Documentation) của các repo mã nguồn mở đó.

## 7. News OS: Siêu tác nhân (Meta-Agent) chuyên tái cấu trúc Open Source

Từ góc nhìn kiến trúc hệ thống, News OS không chỉ là một công cụ, mà bản thân nó là một **Agent khổng lồ được trang bị Knowledge Base về Best Practices**. Nó hiểu sâu sắc cách thế giới mã nguồn mở (Open Source) hoạt động.

Khi được giao nhiệm vụ tạo ra một sản phẩm mới, quy trình của News OS bao gồm:
1. **Quét và đánh giá (Scout & Evaluate):** Sử dụng các mô hình AI để tìm kiếm các repo open source tốt nhất giải quyết bài toán hiện tại.
2. **Khai thác và Fork:** Đưa ra quyết định giữ nguyên (thông qua API Bridge) hoặc trực tiếp **Fork** mã nguồn mở đó về nếu cần tinh chỉnh sâu.
3. **Rebuild (Tái cấu trúc):** Áp dụng các "Best Practices" được tích lũy trong Vault để viết lại, tối ưu hoá, hoặc chuyển đổi mã nguồn (porting) sang một framework mới, biến một project thô ráp thành một sản phẩm thương mại hoặc một tính năng hoàn thiện, đồng nhất với hệ sinh thái đang có.

**User Story:**
> **Là một Tech Founder**, tôi có một ý tưởng sản phẩm mới nhưng đội ngũ phát triển lại mỏng. Tôi đưa ý tưởng vào News OS. Hệ thống Meta-Agent này lập tức tra cứu kho tri thức của nó, tìm thấy một Repo Open Source đang giải quyết được 80% vấn đề. Thay vì bảo tôi tự nghiên cứu, News OS tự động **fork** repo đó về, đọc hiểu toàn bộ kiến trúc, lược bỏ các tính năng thừa, và **rebuild** lại core logic đó ghép vào nền tảng Next.js hiện đại của tôi, áp dụng đúng các best practice về bảo mật và hiệu suất mà nó đã học được từ trước. Kết quả là tôi có một sản phẩm mới (Product) sẵn sàng ra mắt thị trường chỉ trong vài ngày.
