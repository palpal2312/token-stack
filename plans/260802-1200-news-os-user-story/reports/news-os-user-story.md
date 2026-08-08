# Tóm tắt các chức năng của News OS (Agent OS) & Luồng Sử Dụng

**News OS (Agent OS)** là một nền tảng vận hành tập trung (AI-native operational platform) và là một workspace đa tác nhân (multi-agent workspace). Mục đích của nó là đón nhận các ý tưởng thô, các mục tiêu quản lý và chuyển đổi chúng thành các sản phẩm phần mềm hoặc nội dung hoàn chỉnh với sự ma sát thấp nhất từ con người. Nó cung cấp sự điều phối hợp nhất giữa các LLM (cả Local và Cloud), quản lý kiến thức, quản lý công việc và tự động hoá build.

---

## Các tính năng cốt lõi

### 1. Agent OS Orchestration Bridge (Hệ điều phối Agent)
* **`/pipeline` (Autonomous Pipeline):** Bộ máy workflow được thiết kế với Obsidian back-end. Pipeline này chia làm 4 bước: 
  1. *Capture* (Nhận yêu cầu thô). 
  2. *Classification & Shaping* (Phân loại yêu cầu thành project, action, idea, reference, escalate và lập task list).
  3. *Human Gate* (Chờ con người bấm duyệt một chạm trước khi chạy).
  4. *Execute & Ship* (Chạy build bằng các subagent và tạo live preview, đưa vào Builds Gallery).
* **`/room` (AI Agent Mastermind):** Giao diện nhóm chat (Group Chat) đa tác nhân nơi các LLM chuyên biệt như `@claude`, `@gemini`, `@codex` có thể tương tác đồng thời. Các agents tại đây có thể truy cập vault kiến thức (Obsidian), sinh action theo thời gian thực và tự động kích hoạt pipeline build.
* **`/arena` (Model Arena & Benchmarking):** Công cụ đấu trường so sánh. Nó đẩy cùng một prompt cho 2-4 builder (model) chạy đồng thời để so sánh thời gian TTFB (Time to First Byte), tổng thời gian chạy, tốc độ stream, và chi phí, từ đó chọn ra model mạnh nhất/rẻ nhất cho nhiệm vụ cụ thể.
* **`/paperclip` (Paperclip Integration & Builds):** Màn hình hiển thị danh sách các Issues và Builds giống như Kanban nâng cao. Tích hợp trực tiếp với Paperclip (cổng 3100) để theo dõi các sản phẩm đã được ship bởi agent với các bộ lọc trạng thái và live preview links.
* **`/dify` (Dify Workflow Engine):** Hệ thống tích hợp các luồng workflow từ bên thứ 3 (Dify). Nó phân tích các tham số truyền vào từ xa (text, number, boolean) và kích hoạt pipeline workflow trên Dify ngay từ trong News OS.

### 2. Không gian làm việc riêng rẽ cho LLM (LLM & Agent Workspaces)
* Hệ thống cung cấp các Workspace riêng cho từng model hoặc nhóm tác nhân chuyên biệt như: `/claude`, `/codex`, `/openclaw`, `/hermes`, `/glm`, `/kimi`, `/sakana`, `/grok`, `/sen`, `/firstmate`.
* Ở đây có các tính năng theo dõi session, chỉnh sửa file thô, và preview sandbox trực tiếp.
* Quản lý công việc: `/kanban` và `/agent-kanban` giúp hiển thị và kéo thả phân chia công việc cho các tác nhân AI một cách trực quan.

### 3. Media & Content Studio
* **`/video`, `/openmontage`, `/thumbnails`:** Studio tự động sản xuất video. Hệ thống tích hợp công cụ avatar/voices từ HeyGen và engine render Hyperframes để biến đổi script text thành video và theo dõi lịch sử làm ảnh thumbnail.
* **`/music`, `/studio`:** Sandbox thử nghiệm và làm các clip video/âm thanh ngắn do AI sinh ra.

### 4. Vault, Bộ nhớ & Biểu đồ Tri thức (Knowledge Graph)
* **`/memory`:** Khung nhìn Knowledge Graph dạng 3D (`react-force-graph-3d`), chức năng vector search tri thức (`/api/memory/search`), và tạo note, cũng như tích hợp với các thiết bị đeo như OMI.
* **`/journal`, `/notebook`:** Nơi lưu trữ nhật ký cá nhân cấu trúc và tích hợp với sức khoẻ của studio như NotebookLM.

### 5. Growth & Automation Engine
* **`/seo`, `/seo-guide`:** Công cụ tự động phân tích site, tiếp nhận văn bản transcript và sinh note kiến thức SEO cho dự án.
* **`/radar`, `/leads`, `/automations`, `/routers`:** Tự động hoá thu thập thông tin khách hàng, cấu hình điều hướng (routers) và theo dõi độ với reach tin nhắn.

---

## USER STORY: "A Day in the Life of a Tech Lead in News OS"

**Mở bài:** 
Trong vai trò là một Product Owner/Tech Lead, tôi mở News OS vào đầu ngày để quản lý và vận hành toàn bộ luồng phát triển sản phẩm của mình mà không cần phải chạy giữa hàng chục công cụ khác nhau.

**1. Giai đoạn "Khởi tạo Ý tưởng" (Capture & Classification):**
Trong lúc uống cà phê, tôi nảy ra một ý tưởng: *"Tôi cần làm một tính năng Push Notification mới cho ứng dụng News"* và thả nó vào màn hình **/pipeline**. Ngay lập tức, luồng *Classification & Shaping* của hệ thống quét qua Vault tri thức (Obsidian), nhận định đây là một `project` mới. Nó tự động vạch ra một kế hoạch chi tiết (plan.md) và phân rã thành một list các tasks nhỏ. Nó dừng lại ở bước *Human Gate*. Tôi kiểm tra lại kế hoạch và chỉ cần click một nút "Approve" duy nhất để cho phép hệ thống triển khai.

**2. Giai đoạn "Phân xử & Tranh luận" (Mastermind):**
Tôi nhảy sang màn hình **/room** và gõ: *"Các cậu nghĩ kiến trúc nào tốt nhất cho tính năng notification mới này?"* Ở đây, tác nhân `@codex` (chuyên về backend kiến trúc) lập tức đề xuất sử dụng Server-Sent Events (SSE) để tiết kiệm tài nguyên. Đồng thời, tác nhân `@claude` phản biện lại bằng cách đưa ra lưu ý về vấn đề kết nối khi mạng chập chờn. Thông qua cuộc hội thoại đa tác nhân (multi-agent) này, một quyết định kiến trúc cuối cùng được thống nhất và đẩy thẳng về lại `/pipeline` để thực thi.

**3. Giai đoạn "Thử nghiệm Lõi" (Arena):**
Vì một số subtask liên quan tới việc viết logic khó, tôi không chắc model nào sẽ xử lý tốt nhất. Tôi vào màn hình **/arena**, điền bài toán vào khung prompt chung và kích hoạt cùng lúc 4 model khác nhau. Màn hình chia ra 4 cột chạy song song; kết quả là Claude xử lý xong trong chưa tới 3 giây với code sạch sẽ nhất. Tôi chọn Claude làm model chính cho task này (crowning the winner) để đảm bảo tối ưu tốc độ và chi phí.

**4. Giai đoạn "Thực thi & Giám sát" (Execution & Ship):**
Các subagent được giao việc bắt đầu chạy ngầm (Autonomous Build). Khi hoàn thành, tôi không cần xem file code khô khan, mà mở màn hình **/paperclip** (hoặc check tab Gallery của Pipeline). Tại đó, tôi thấy một live web preview hiển thị tính năng Notification đang chạy thật trên sandbox. Nếu có issue gì, tôi ném lại vào **Kanban** tracker (`/agent-kanban`) để gán lại cho Agent.

**5. Giai đoạn "Bổ trợ Ngoại biên" (Automation & Content):**
Sau khi luồng code xong, tôi muốn tung ra chiến dịch marketing. Tôi thiết lập cấu hình trên màn hình **/dify** để gọi một luồng Remote Workflow tạo nội dung quảng bá, kết nối tới thư mục **/video** để AI (thông qua HeyGen) tự động render một clip quảng cáo giới thiệu tính năng Notification. Tất cả tài liệu kiến trúc, script marketing, và kết quả build đều được lưu lại, tạo chỉ mục thành một điểm sáng trong biểu đồ Knowledge Graph 3D ở mục **/memory**.

**Kết bài:**
Vào cuối ngày, mọi tính năng phần mềm, nội dung marketing, và báo cáo kỹ thuật đã được ship hoàn chỉnh. Thay vì tự code hay mở 20 cửa sổ Slack/Jira, tôi chỉ cần cung cấp ý tưởng, phê duyệt kiến trúc và tận hưởng quy trình rảnh tay nhờ sức mạnh điều phối tập trung của News OS.
---

## Cách Tích Hợp Các Dự Án Mở (Ecosystem Integrations) & User Stories Mở Rộng

Mặc dù News OS được tổ chức thành một Next.js Monorepo đồng nhất (không sử dụng `git submodules` hay chia thành nhiều nhánh fork rời rạc), hệ thống lại được thiết kế theo dạng **"Bridge & Orchestration"**. Điều này cho phép nó kết nối và ứng dụng trực tiếp sức mạnh từ các dự án/công nghệ mở (như Dify, Obsidian, OMI, Paperclip, HeyGen) thông qua các tầng API Bridge nội bộ.

### 1. Dify (Local Workflow Engine)
* **Cách áp dụng:** Không cần fork mã nguồn Dify, News OS xây dựng một lớp "Local Bridge" (`src/lib/dify`) để gọi và điều phối các luồng Dify đang chạy ở các cổng cục bộ (loopback). Hệ thống quản lý toàn bộ việc stream kết quả (SSE) về UI của Agent OS và kiểm soát giới hạn tài nguyên (Capacity Limits) cũng như bảo vệ hệ thống khỏi SSRF.
* **User Story:**
  > **Là một Backend Developer**, tôi muốn kích hoạt một workflow xử lý dữ liệu phức tạp đã được định nghĩa sẵn bên Dify từ ngay trong giao diện News OS (màn hình `/dify`). Sau khi chạy, tôi muốn toàn bộ output dạng stream và dữ liệu log được tự động lưu lại vào hệ thống quản lý LLMOps của News OS để tôi có thể theo dõi và kiểm soát chi phí thực thi mà không cần nhảy qua lại giữa 2 công cụ.

### 2. Obsidian & OMI (Open Memory Initiative)
* **Cách áp dụng:** Tích hợp trực tiếp qua File System (`src/lib/vault.ts`). News OS đọc trực tiếp thư mục Markdown Vault của Obsidian, đặc biệt là thư mục chứa bản ghi âm bộ nhớ của OMI Wearable (`Omi/Memories.md`). Từ đó nó vẽ ra một không gian biểu đồ tri thức 3D (Memory Galaxy) cho phép các AI Agents truy cập làm context.
* **User Story:**
  > **Là một Content Creator (hoặc Tech Lead)**, tôi muốn đeo thiết bị OMI để tự động ghi chú lại các ý tưởng xuất hiện trong cuộc họp. Khi về nhà mở News OS lên, tôi muốn hệ thống lập tức nhìn thấy các ghi chú này (được đồng bộ qua Obsidian Vault) hiển thị chớp nháy trên biểu đồ 3D Memory Galaxy, từ đó tôi có thể chỉ định `@claude` tự động lấy các ý tưởng đó và lên dàn ý (draft) cho bài blog ngày mai.

### 3. Paperclip & NotebookLM
* **Cách áp dụng:** Được mô đun hoá thành các cổng giao tiếp Build & Artifact (`src/app/paperclip`, `/api/notebooklm`). Cung cấp một bảng điều khiển trung tâm để hiển thị trạng thái code do AI viết (Build Status) và tự động kéo các tài liệu đã được tóm tắt từ NotebookLM.
* **User Story:**
  > **Là một Project Manager**, sau khi phê duyệt để AI Agent tự động code (qua `/pipeline`), tôi muốn mở màn hình `/paperclip` để xem trực tiếp danh sách các component đã build xong. Đồng thời, tôi có thể hỏi các câu hỏi xoáy sâu vào tài liệu dự án bằng kết nối với NotebookLM để xác nhận lại thiết kế hệ thống có đúng chuẩn ban đầu hay chưa.

### 4. HeyGen & Hyperframes (Video Generation)
* **Cách áp dụng:** Gắn kết thông qua API Adapters (`src/lib/heygen.ts`, `src/lib/videoAuto.ts`). Khởi tạo các khung hình video (Hyperframes) và gửi lệnh kết xuất video AI Avatar cho HeyGen.
* **User Story:**
  > **Là một Marketer**, sau khi bài viết hướng dẫn tính năng mới được AI duyệt và xuất bản, tôi muốn chạy một workflow trên màn hình `/video` để hệ thống tự động tóm tắt bài viết, chuyển thành kịch bản, và tự động gọi HeyGen để render một video người ảo thuyết trình về tính năng đó, tất cả hoàn toàn tự động chỉ với 1 cú click.

### 5. aisuite & OpenWorker (LLM Router & Agentic Runtime)
* **Cách áp dụng:** Mặc dù không fork trực tiếp hai dự án này, News OS đã xây dựng lớp nền tảng dựa trên triết lý và design pattern của **aisuite** (chuẩn hoá API các nhà cung cấp LLM) và **openworker** (môi trường runtime đa tác nhân, Model Context Protocol - MCP).
  * Lớp **Router/Adapter (`src/lib/routers/adapters`)** được viết theo chuẩn của `aisuite`, giúp hệ thống tự động chuẩn hoá input/output (ví dụ từ OpenAI sang Anthropic) và hỗ trợ chạy vòng lặp `max_turns` (tool loop) mà không bị giới hạn bởi một hãng AI cố định.
  * Lớp **Runtime (`src/lib/agentRuntime`)** được thiết kế theo `openworker` để quản lý Token API nội bộ, kết nối MCP (Model Context Protocol), phân phối lệnh từ Controller Agent sang Subagent, và cấp quyền phê duyệt/từ chối chạy tool một cách an toàn.
* **User Story:**
  > **Là một Developer tích hợp**, tôi không muốn phải viết lại code mỗi lần muốn đổi model từ OpenAI sang Anthropic hay một model Local. Tại `/arena`, khi tôi so sánh các model, lớp adapter chuẩn của `aisuite` bên dưới tự động "phiên dịch" prompt thành định dạng phù hợp. Cùng lúc đó, các model gọi Tool thông qua chuẩn MCP của `openworker`, cho phép chúng tự động tra cứu cơ sở dữ liệu nội bộ mà không cần phải viết riêng lẻ một plugin nào, hệ thống giữ hoàn toàn quyền kiểm soát bảo mật và timeouts.

---

## Tầm nhìn cốt lõi: News OS như một "Hệ điều hành tích hợp & Duy trì Mã nguồn mở" (Open-source Integration OS)

Về bản chất sâu xa, News OS không chỉ là một bảng điều khiển công cụ, mà nó là một **hệ thống giúp sử dụng và bảo trì (maintenance) các công nghệ mã nguồn mở (Open Source) một cách vô cùng dễ dàng**. 

Toàn bộ kinh nghiệm, lỗi thường gặp (troubleshooting), và tri thức cấu hình của các công nghệ mã nguồn mở này không bị thất lạc, mà được **tích luỹ liên tục vào Vault Tri thức (Knowledge Base / Memory Galaxy)**. 

### Vai trò của tác nhân Sen (`/sen` & `Firstmate`)
Trong hệ sinh thái này, **Sen** đóng vai trò là một "Kỹ sư trưởng" (Trí tuệ nhân tạo chuyên gia). 
* **Học hỏi và Tích luỹ:** Khi hệ thống hay con người làm việc với một repo mã nguồn mở mới (ví dụ như Dify, Paperclip, OMI), mọi lệnh config, luồng API, và cấu trúc thư mục đều được ghi nhận lại vào Vault.
* **Tái sử dụng cho Sản phẩm mới:** Khi có yêu cầu làm một sản phẩm phần mềm mới, Sen sẽ không code từ con số 0. Nó sẽ quét Knowledge Base, rút ra các "pattern" chuẩn nhất đã từng dùng với các repo open-source kia, sau đó hướng dẫn (guide) và trực tiếp viết code tích hợp các công nghệ đó vào sản phẩm mới một cách hoàn hảo.

### Mở rộng User Story: "Khởi tạo sản phẩm mới cùng Kỹ sư trưởng Sen"
> **Là một Software Architect**, tôi được giao nhiệm vụ tạo ra một ứng dụng "Chăm sóc khách hàng tự động bằng Video". 
> Thay vì phải tự đi tìm hiểu lại từ đầu cách cài đặt từng công cụ, tôi mở giao diện `/sen` trong News OS và ra lệnh: *"Thiết kế ứng dụng này giúp tôi"*. 
> 
> **Sen** lập tức truy xuất vào Knowledge Base và nhận ra: 
> 1. Hệ thống đã có kinh nghiệm dùng **Dify** để làm luồng hỏi đáp LLM.
> 2. Hệ thống đã có kinh nghiệm dùng **HeyGen/Hyperframes** để xuất video.
> 
> Sen tự động lắp ghép tri thức của 2 công nghệ Open Source này lại, xuất ra một bản thiết kế kiến trúc (plan.md), hướng dẫn tôi chạy lệnh `git clone` những module cần thiết, và tự động sinh ra các file "API Bridge" (tương tự như `src/lib/dify`) để nối chúng lại với nhau thành sản phẩm cuối cùng. Nếu sau này Dify có bản cập nhật mới (update version), Sen cũng sẽ đọc changelog và tự động bảo trì (maintain) đoạn code tích hợp đó giúp tôi.

### Tầm nhìn tối thượng: News OS - Một "Meta-Agent" với kho tri thức Best Practice Mã Nguồn Mở

Ở cấp độ cao nhất, bản thân **News OS hoạt động như một Siêu tác nhân (Meta-Agent)**. Nó không chỉ cung cấp UI quản lý, mà nó sở hữu một **Knowledge Base (Kho tri thức)** chứa đựng toàn bộ các **best practices (thực hành tốt nhất)** trong việc ứng dụng các dự án Open Source.

Nhiệm vụ tối thượng của Meta-Agent này là sử dụng tri thức đó để **tạo thành các sản phẩm mới**. Quá trình này không chỉ dừng ở việc gọi API (Bridge), mà còn bao gồm cả khả năng:
1. **Fork mã nguồn:** Lấy các open source tiềm năng về.
2. **Rebuild trên nền tảng mới:** Tái cấu trúc, đập đi xây lại hoặc chuyển đổi ngôn ngữ/framework (ví dụ: bóc tách core logic của một tool Python và rebuild lại UI trên nền Next.js của hệ thống).

**Mở rộng User Story: "Khởi tạo một Startup/Sản phẩm mới với News OS"**
> **Là một Product Builder (Người kiến tạo sản phẩm)**, tôi muốn xây dựng một nền tảng SaaS mới kết hợp giữa Workflow Automation và Video AI. 
> Thay vì bắt đầu từ đầu, tôi giao đề bài cho News OS. Với tư cách là một Meta-Agent, News OS truy xuất Knowledge Base của nó, tìm ra các best practice tốt nhất. Nó quyết định **fork** repo của một hệ thống quản lý luồng dữ liệu mở, loại bỏ các phần rườm rà, sau đó **rebuild** (xây dựng lại) các core function đó lên một kiến trúc mới hiện đại hơn, ổn định hơn. Cuối cùng, nó đóng gói tất cả lại thành một sản phẩm SaaS hoàn toàn mới cho tôi. Tôi vừa tiết kiệm được hàng tháng trời code lại từ đầu, vừa thừa hưởng được các tiêu chuẩn code (best practices) xịn nhất của cộng đồng mã nguồn mở.
