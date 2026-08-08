# Kiến Trúc Lõi & Vòng Lặp Vận Hành của News OS (Sen's Engine)

Sức mạnh thực sự (Core capability) của News OS không nằm ở giao diện UI, mà nằm ở **hệ thống điều phối linh hoạt các CLI (Command Line Interfaces)** kết hợp với hệ thống dữ liệu thông minh. 

Dưới đây là các thành phần kiến trúc cốt lõi và cách chúng kết hợp với nhau tạo thành một nhà máy sản xuất phần mềm tự động (Autonomous Software Factory).

---

## 1. Kiến trúc thành phần (Component Architecture)

### 1.1. Router (Trạm trung chuyển API)
Nơi khai báo và quản lý tất cả các nguồn API (OpenAI, Anthropic, Gemini, Local LLMs, v.v.). Router chịu trách nhiệm định tuyến, chuẩn hoá dữ liệu và cung cấp "năng lượng" (intelligence) cho toàn bộ hệ thống.

### 1.2. CLI Builders (Các thợ xây)
Các CLI hoạt động như những Agent/Builder độc lập sẵn sàng nhận lệnh. Chúng được cấp quyền chạy thông qua các gói subscription và được cung cấp sức mạnh trí tuệ từ **Router** đã khai báo ở trên. Mỗi CLI có thể là một công cụ mã nguồn mở (như Claude Code, Aider, OpenDevin, v.v.).

### 1.3. Code Space (Herdr)
Môi trường thực thi (Execution Environment). **Herdr** chịu trách nhiệm chạy các CLI, quản lý không gian làm việc (workspace), và theo dõi tiến trình chạy code của các thợ xây này.

### 1.4. Sen (Kỹ sư trưởng & Giao diện chính)
Người dùng **chỉ cần giao tiếp duy nhất với Sen**. Sen đóng vai trò là "Bộ não" trung tâm:
- Lắng nghe ý tưởng.
- Lên kế hoạch (Plan).
- Chẻ nhỏ thành các Task và gắn lên bảng **Kanban**.

---

## 2. Vòng lặp Vận hành Tự động (Autonomous Workflow)

Quy trình làm việc không cần sự can thiệp của con người sau khi đã chốt kế hoạch:

1. **Phân bổ (Deployment):** Sen quét bảng Kanban, chọn ra các CLI Builder phù hợp nhất và tự động kích hoạt (deploy) chúng.
2. **Chạy song song (Parallel Execution):** Các CLI này nhận task và tiến hành code trên các **nhánh (git branch) khác nhau** hoàn toàn tự động bên trong không gian Herdr.
3. **Nghiệm thu (Acceptance & Merge):** Khi một CLI code xong, nó tự động commit và báo cáo lại cho Sen. Sen sẽ thực hiện việc kiểm thử, nghiệm thu (review). Nếu đạt chuẩn, Sen tự động **merge** nhánh đó vào nhánh chính.
4. **Triển khai vững chắc (Robust Deployment):** Quá trình vận hành LLM và đẩy code lên môi trường production được đảm bảo tính ổn định cao dựa trên việc tích hợp các kiến thức và nền tảng **LLMOps của Dify**.

---

## 3. Trí tuệ cốt lõi: Arena & Hệ thống Ranking (Định tuyến thông minh)

Giá trị cao nhất của Sen không chỉ là gọi lệnh, mà là **Dữ liệu phân bổ**. Vì hệ thống có thể bóc tách task cho hàng loạt CLI chạy đồng thời, Sen cần phải biết chính xác *Task loại nào thì nên giao cho CLI nào xử lý là tối ưu nhất?*

* **Arena (Đấu trường):** Tạo ra các tác vụ chuẩn (benchmark tasks) và ném vào cho các CLI cùng chạy để thi đấu.
* **Chấm điểm (Scoring):** Người dùng sẽ trực tiếp nghiệm thu và chấm điểm cho các kết quả này. (Tầm nhìn tương lai: Dữ liệu này sẽ được link với bảng xếp hạng - Ranking của cộng đồng).
* **Phân bổ thông minh (Smart Allocation):** Từ tập dữ liệu lịch sử này (CLI nào + Router/Subscription nào chạy tốt nhất cho Ngôn ngữ/Loại việc nào), Sen sở hữu một "Bản đồ năng lực". Khi có task mới trên Kanban, Sen dùng bản đồ này để **ưu tiên phân bổ task cho đúng CLI** nhằm đạt tốc độ, chất lượng và chi phí tối ưu nhất.

---

## Mở rộng User Story: "Vận hành đội quân CLI tự động qua Sen"

> **Là một Product Owner**, tôi có một bản mô tả tính năng phức tạp cần xây dựng. Tôi mở News OS và chỉ cần chat với **Sen**. 
>
> Sen lập tức dịch yêu cầu của tôi thành một bản Kế hoạch và ghim hàng loạt thẻ công việc lên bảng **Kanban**. Tại thời điểm này, công việc của tôi kết thúc.
> 
> Dưới nền hệ thống, Sen sử dụng dữ liệu từ **Arena Ranking** để phân tích: *"Task UI này dùng CLI A (powered by Claude Router) là tốt nhất, còn Task Backend Database này dùng CLI B (powered by OpenAI Router) là ít lỗi nhất"*. Nó lập tức ra lệnh cho **Herdr** kích hoạt các CLI này chạy song song trên các **git branch** riêng biệt.
> 
> Tôi nhâm nhi tách cà phê và thỉnh thoảng nhìn vào dashboard. Tôi thấy các CLI code xong, tự động commit. Sen đóng vai trò người kiểm duyệt (Reviewer) đứng ra nghiệm thu code của các CLI đó, nếu Pass thì nó tự động **merge** nhánh. Cuối cùng, hệ thống đóng gói và deploy sản phẩm một cách cực kỳ vững chắc thông qua cơ chế **LLMOps của Dify**. Tôi đã điều hành một đội dev ảo gồm nhiều CLI khác nhau hoàn thành dự án mà không cần tự tay gõ một dòng lệnh nào.

---

## 4. Trải nghiệm người dùng: Zero-UI & Giao diện tự thích ứng (Context-Aware Panel)

Một trong những triết lý thiết kế đột phá nhất của News OS là **"Người dùng không cần học cách sử dụng phần mềm" (Zero-learning curve)**. Trải nghiệm được thiết kế hoàn toàn xoay quanh hội thoại (Chat-driven), giảm thiểu tối đa việc sử dụng chuột.

### 4.1. Tương tác hội thoại làm trung tâm
Người dùng thao tác duy nhất tại khung chat với **Sen**. Dựa vào ngữ cảnh của cuộc trò chuyện, Sen sẽ đóng vai trò như một người điều phối UI (UI Controller) và tự động mở các màn hình tương ứng ở **Panel bên phải**:
- Khi bàn về tổng quan dự án ➔ Sen tự động mở màn hình **Mission Control**.
- Khi Sen lên plan và chẻ task ➔ Khung **Agent Kanban** tự động trượt ra để hiển thị tiến độ.
- Khi bàn luận và chỉnh sửa mã nguồn ➔ Khung **Code Space (Herdr)** hiện lên.
- Khi cần tra cứu tri thức cũ ➔ Biểu đồ **Memory Galaxy** xuất hiện.
- Khi người dùng muốn tinh chỉnh kết nối ➔ Màn hình **Dify**, **CLI Config** hoặc **Router Config** tự động bật mở.

### 4.2. Mở rộng User Story: "Điều khiển bằng ý nghĩ thông qua Chat"

> **Là một Product Builder**, tôi không bao giờ phải căng mắt tìm xem menu điều hướng (Navigation bar) của News OS nằm ở đâu hay phải tốn công click qua lại giữa các tab. 
> 
> Tôi bắt đầu ngày mới bằng việc gõ vào khung chat: *"Sen, cho tôi xem tổng quan hôm nay"*. Lập tức, panel bên phải mở màn hình **Mission Control**. 
> Tôi chat tiếp: *"Tiến độ cái tính năng Notification sao rồi?"*, panel bên phải mượt mà chuyển sang bảng **Agent Kanban** cho thấy các thẻ task đang chạy. 
> Thấy một task đang bị lỗi do thiếu biến môi trường, tôi gõ: *"Mở cấu hình Dify của luồng này lên để tôi check lại API Key"*. Không cần động đến chuột, màn hình **Dify Config** hiện ra ngay bên phải.
> 
> Toàn bộ quá trình vận hành dự án, cấu hình hệ thống, và giám sát code đều được tôi thực hiện chỉ bằng cách... gõ phím nói chuyện. Sen hiểu tôi đang cần nhìn thấy gì và nó tự động dọn sẵn dữ liệu đó ra trước mắt tôi.
