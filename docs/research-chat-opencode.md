# Research: Chat Nexora và Chat OpenCode

## Phạm vi đã triển khai

Research mặc định mở giao diện hội thoại. Hai lựa chọn engine cho **cuộc trò
chuyện mới** dùng chung bố cục và lịch sử; không đổi engine/model giữa một phiên
vì sẽ làm mất tính nhất quán của ngữ cảnh và điều kiện dữ liệu.

- **Chat Nexora:** dùng model backend đang cấu hình. Chat là trao đổi sơ bộ;
  không tìm lại toàn bộ web/PDF ở mỗi tin nhắn.
- **Chat OpenCode mới:** chỉ dùng **Muse Spark 1.3 Free**
  (`muse-spark-1.3-contributor-free`), không có model selector. Khi bật bản local,
  worker `serve` cô lập hỗ trợ question/reply thật và trạng thái chờ người dùng.
  Xem [Muse và human-in-the-loop](research-opencode-direct.md). Không fallback
  trả phí, không tự đổi phiên MiMo/LongCat/configured-provider cũ.
- **Chat OpenCode (đường gateway cũ, chỉ session đã lưu):** backend gọi HTTP API của một `opencode serve` riêng, phiên
  bản được khóa ở **1.19.0**. Mỗi conversation được ánh xạ tới đúng một session
  lưu bền vững. Web không mở terminal `attach` hay gọi OpenCode trực tiếp.
  Phiên cũ giữ model và lịch sử, không được tự chuyển sang Muse. Phiên đã lưu
  với **Nexora · provider · model** dùng đúng API/model backend, không cần key Console.
  OpenCode vẫn điều phối session/tool loop; adapter chỉ chuyển tin nhắn và
  thực hiện một lượt gọi model có giới hạn.
- **OpenCode trực tiếp (bản thử local):** xem [hướng dẫn riêng](research-opencode-direct.md).
  Khi bật, chỉ cuộc trò chuyện Free mới dùng đường này. Session cũ không đổi;
  configured provider và Reports vẫn dùng đường hiện tại. CLI chính thức gọi
  provider bằng kết nối của chính nó, không qua HTTP proxy Python của Nexora.
- **Báo cáo:** là lối mở công cụ research hiện tại ở thanh trái. Chat không có
  nút tạo báo cáo hay form ngôn ngữ/độ sâu/paper. Pipeline, trình đọc, visual và
  PDF/LaTeX của công cụ cũ giữ nguyên. API báo cáo và lịch sử phiên cũ vẫn tương
  thích; báo cáo cũ trong hội thoại có lối chuyển sang Library.
- **Bố cục:** Research chat chiếm toàn màn hình, không có header/footer trang
  chính. Thanh bên có thể thu/mở và kéo đổi độ rộng (200–360 px); trên điện
  thoại dùng drawer có backdrop, Escape, giữ focus và không chặn ô nhập.
- **Điều hướng:** `#/research` luôn mở chat; `#/research/reports` là màn hình
  con tạo báo cáo, cũng tràn màn hình và không có header/footer trang chính.
  Reports có nút Quay lại trò chuyện cố định trong thanh điều hướng gọn (kể cả
  khi xem kết quả); chat có Về Nexora ở thanh trái, trên mobile có ngay ở đầu
  màn hình. Back/Forward và reload khôi phục đúng màn hình từ URL.
- Chuyển Chat ↔ Reports không reset bản nháp/tệp chưa gửi của chat hay brief
  báo cáo. Chat chỉ bị unmount khi rời Research/đổi tài khoản. Quay lại chat
  không tự dừng phiên báo cáo đang chạy; thanh Reports hiển thị trạng thái đó.
- **Đính kèm:** chọn nhiều tệp, kéo thả hoặc dán ảnh. Có thumbnail, xem ảnh lớn
  và gỡ tệp; chỉ upload khi bấm Gửi. Tệp gửi thành công được lưu với tin nhắn.
  Muse interactive mặc định xử lý PDF có chữ là đầu vào công khai, không có
  checkbox xác nhận từng file, bằng cách trích text ở backend; không gửi PDF gốc hay mở quyền dữ liệu
  riêng. Ảnh/loại file khác dùng Chat Nexora. PDF scan cần OCR, không tự giả đọc.
- Ghim, đổi tên, tìm theo tiêu đề, lưu trữ/khôi phục; mỗi tài khoản chỉ đọc/gửi/
  dừng các phiên của mình. Archive không xóa lịch sử.
- Tải lại trang nối lại lịch sử/lượt chạy; không tự gửi lại yêu cầu model. Mã
  gửi idempotent bảo vệ trường hợp server nhận tin nhưng response bị mất.
- Báo cáo một phần/không tạo được phân tích không được đánh dấu hoàn chỉnh.
- Workspace research cũ vẫn ở thanh trái; đường mở từ Library/Fields không
  tự chèn paper/ghi chú vào một conversation đang được khôi phục.

## Cách dùng

1. Research → Cuộc trò chuyện mới → Chat Nexora hoặc Chat OpenCode.
2. Với OpenCode mới, model cố định là **Muse Spark 1.3 Free**. Đọc/xác nhận điều
   kiện dữ liệu Contributor; chỉ gửi nội dung công khai. Không có lựa chọn model.
   Console/Free chỉ khả dụng khi có quyền API phù hợp; key không tự bật worker.
3. Nhập câu hỏi hoặc dùng kẹp giấy để chọn tài liệu/ảnh. Có thể gửi chỉ tệp.
4. **Gửi** để hỏi đáp sơ bộ. Ngôn ngữ theo lời nhắn, mặc định theo giao diện;
   không đem lựa chọn ngôn ngữ/độ sâu của báo cáo vào cuộc trò chuyện mới.
5. Muốn tạo báo cáo: **Báo cáo → Công cụ hiện tại** ở thanh trái. Đặt paper,
   ngôn ngữ, độ sâu và ngân sách trong công cụ cũ, không lặp lại ở chat.

Chat không được tự nhận đã đọc toàn văn, chạy code hay tái lập thí nghiệm. Khi
chưa có report, nó có lịch sử và ngữ cảnh tệp đính kèm được giới hạn, không tự
tìm lại nguồn. Trích đoạn tải lên là ngữ cảnh chưa kiểm chứng, không phải dẫn
chứng đã audit. Công cụ OpenCode chỉ thấy các trích đoạn được cấp ở lượt hiện tại.

## Giới hạn và dữ liệu đính kèm

- 5 tệp/lượt, tối đa 3 ảnh, 10 MB/tệp và tổng 20 MB. Lưu tối đa 100 MB/200 tệp
  mỗi tài khoản; draft upload chưa gắn tin nhắn hết hạn sau 24 giờ khi intake kế
  tiếp chạy. Tệp đã gửi không bị xóa bởi việc lưu trữ hay đổi hội thoại.
- PDF có chữ, DOCX, TXT/Markdown/CSV/JSON và một số tệp mã nguồn UTF-8 được
  trích chữ cục bộ. Không thực thi code, macro, HTML; không giải nén lên đĩa.
  Tối đa 20.000 ký tự/tệp được lưu, ngữ cảnh chữ cho model tối đa 16.000 ký tự
  chia cho các tài liệu gần nhất. Tài liệu dài có cảnh báo; không cam kết đọc
  toàn văn hay giữ đúng công thức/bảng. PDF scan không có chữ cần OCR riêng.
- PNG/JPG/WebP được kiểm tra pixel và giải mã, xoay theo EXIF, chuẩn hóa JPEG
  tối đa 1600×1600 và bỏ metadata. Không chấp nhận SVG, URL ảnh tùy ý hay đường
  dẫn tệp của model. Giới hạn giải mã 20 triệu pixel, tối đa 2 parser đồng thời.
- Khả năng đọc ảnh lấy từ `get_llm().profile.image_inputs`; model không xác
  định khả năng bị chặn, không đoán từ tên provider và không tự chuyển model.
  [LangChain model profiles và multimodal](https://docs.langchain.com/oss/python/langchain/models#multimodal).
- OpenCode chỉ gửi dữ liệu riêng khi chính sách server cho phép. Hai model
  Free không tự được cấp quyền này. Ảnh trong OpenCode dùng model
  `nexora-configured`: gateway thêm ảnh chuẩn hóa đã kiểm tra chủ sở hữu vào
  HumanMessage của provider; không nới lỏng việc chặn ảnh/URL từ worker. Mỗi
  ảnh dự trù thêm 4096 input token trước khi gọi, usage thực tế lưu từ provider.
- Mọi upload/read/delete/send kiểm tra đăng nhập và chủ sở hữu. ID ngẫu nhiên
  không chứa tên hay đường dẫn. Nội dung không xuất hiện trong danh sách chat,
  metadata trả về hay localStorage. Download dùng no-store/nosniff; tài liệu
  chỉ tải xuống, không thực thi trong browser. Tệp đã gắn tin nhắn không thể bị
  xóa qua endpoint xóa draft.
- Kiểm thử dùng model/API giả lập, không gửi tài liệu thật hay gọi LLM trả phí.

## Khởi động local (Windows)

Chạy một lần từ thư mục dự án, trong virtual environment của backend:

```powershell
.\.venv\Scripts\python.exe scripts/configure_opencode.py
npm.cmd install --prefix data/opencode/runtime opencode-ai@1.19.0 --no-audit --no-fund
```

Helper tạo `data/opencode/runtime.env` và `opencode.json` nếu chưa có, không
ghi đè profile có sẵn. File này có hai secret độc lập; không commit hoặc gửi
lên browser. Không dùng mật khẩu, thư mục config hay session desktop cá nhân.
Trên máy chặn npm postinstall, launcher dùng trực tiếp executable đã được gói
trong `opencode-windows-x64`; không cần mở toàn bộ quyền install-script.

Nếu đã cài profile đời trước (chỉ có model Free), cập nhật profile riêng:

```powershell
.\.venv\Scripts\python.exe scripts/configure_opencode.py --refresh-profile
```

Helper sao lưu file profile trước khi cập nhật; giữ nguyên credentials, DB và
session. Sau đó restart **worker riêng** và backend. Không đổi profile desktop.

Trong terminal riêng:

```powershell
.\run-opencode.ps1
```

Sau đó khởi động/restart backend Nexora theo cách đang dùng. Backend đọc
`data/opencode/runtime.env` khi khởi động; nếu env/profile mới được tạo sau đó,
phải reload backend. Tại UI có nút Kiểm tra lại kết nối. Status không gọi model.
Profile dùng loopback 4096 và gateway backend 8000; dùng `--port` và `--backend`
khi cấu hình một profile mới nếu cần đổi. Không dừng tiến trình lạ chiếm port.
`run-app.ps1` hiện khởi động backend/frontend, **không tự khởi động worker**.
Thêm API key vào `.env` không tạo tiến trình `opencode serve`; cần giữ terminal
`run-opencode.ps1` chạy riêng. Key Console dùng tên `OPENCODE_UPSTREAM_API_KEY`
ở backend; không đổi sang `VITE_*`, không đưa vào trình duyệt.

**Kiểm tra lại ngày 2026-10-13 cho mặc định MiMo:** `.env` có đúng biến key,
Console config chấp nhận key (HTTP 200). Profile kết nối riêng đã tồn tại,
không xung đột env; nhưng không có listener ở 4096, status trả
`opencode_unreachable`. Một lượt MiMo bằng CLI OpenCode 1.19.0 cô lập, chỉ
yêu cầu trả lời “OK”, dùng chính service key đó vẫn trả
`opencode_free_tier_restricted`. Khởi động worker sẽ xử lý lỗi kết nối local,
không bảo đảm hết lỗi quyền Free tier phía dịch vụ. Không thử model trả phí,
không gửi tài liệu/tin nhắn người dùng và không đổi credentials desktop.

**Worker kết nối không đồng nghĩa tất cả model dùng được.** Kiểm tra thật ngày
2026-10-13: request vô danh trả 403 `FreeTierError`; cả lượt qua CLI OpenCode thật
với thông tin phiên được giữ nguyên cũng bị từ chối. Không giả mạo client để
lách giới hạn. Vì thế **lựa chọn Console** cần quyền API dịch vụ phù hợp qua
`OPENCODE_UPSTREAM_API_KEY` ở backend. Thiếu quyền thì model Console bị chặn,
không làm khóa model Nexora đang cấu hình. Không copy key desktop hoặc gửi key
trong chat/browser. Lựa chọn `nexora-configured` không gọi endpoint Console.

**Cập nhật kiểm tra có service key:** key được xác thực bằng
`GET /console/api/v2/config` (HTTP 200), workspace trả về cả LongCat và MiMo,
và xác nhận endpoint `https://opencode.ai/inference/openai/v1`. Gateway đã
được cập nhật theo endpoint này. Tuy nhiên cả hai model vẫn trả HTTP 403
`FreeTierError` khi chạy qua OpenCode thật 1.19.0; thử trực tiếp provider gốc
trong CLI riêng (không qua gateway Nexora) cũng bị từ chối với cùng loại lỗi.
Các lượt này chỉ dùng câu hỏi chào công khai, không gửi tài liệu người dùng.

Vì vậy **key hợp lệ, model có trong danh sách và worker kết nối không bảo đảm
Free-tier inference được chấp nhận**. Status chỉ kiểm tra cấu hình/key có sẵn,
không tự phát sinh lượt inference để kiểm chứng mỗi lần mở trang. Không kết
luận lỗi do số dư $0 và không hướng dẫn nạp tiền như một cách chắc chắn sửa lỗi.
Theo [tài liệu inference](https://opencode.ai/v2/docs/console/api/inference/),
free chat có thể không cần key, nhưng các kiểm tra thực tế trên môi trường này
vẫn bị dịch vụ từ chối. Cần xác minh điều kiện truy cập với OpenCode hoặc kiểm
tra flow đăng nhập chính thức tương thích; không giả header/session desktop.
Việc test CLI trực tiếp chỉ phục vụ chẩn đoán, không mở đường bỏ gateway/budget
trong ứng dụng production.

Service account hiện nằm ở **Settings → Service accounts** trên Console đã
đối chiếu từ ảnh giao diện người dùng. Chỉ cấp quyền `Inference only`. Không
đổi quyền, tự tạo token OAuth, nạp tiền hoặc lấy credentials desktop để xử lý
Free-tier denial mà chưa có yêu cầu/ủy quyền tương ứng.

**Kiểm tra device login sau đó:** người dùng đã tự xác nhận link đăng nhập
Console chính thức do `opencode console login` tạo. Phiên mới chỉ nằm trong
`data/opencode/console-diagnostic`, không lấy auth của desktop và không đổi
worker production. OAuth gốc xác thực HTTP 200 với workspace có cả hai model.
Cả lượt dùng kết nối Console gốc của CLI và lượt dùng token thực tại endpoint
hiện hành trong OpenCode thật vẫn bị `FreeTierError` cho LongCat và MiMo.
Không kết luận lỗi do đăng nhập chưa thành công, số dư $0 hoặc chỉ do gateway.

`debug config` **che API key thành `***`**. Giá trị che không phải credential;
không dùng nó để thử API hoặc suy luận rằng token thật sai. V1 device login
lưu phiên ở bảng Account/AccountState của DB riêng, khác với credential store
của integration V2. Helper chỉ đọc đúng DB diagnostic đã tạo cho lượt này.
Credential có phạm vi người dùng; không tự đưa nó vào backend phục vụ toàn bộ
users thay service account `Inference only`. Profile diagnostic bị Git ignore;
không sao chép DB/token này vào frontend, logs công khai hoặc bản deploy.

**Đính chính sau phép đối chứng:** các chẩn đoán cũ ở trên đều dùng profile
`permission: {"*": "deny"}`. Không được suy từ những lỗi đó rằng tài khoản/key
không bao giờ dùng được MiMo. Cùng key, CLI 1.19.0 và built-in build, chế độ
`ask` (không auto-approve) đã trả lời thành công; đổi riêng quyền thành `deny`
lại bị FreeTierError. OpenCode đang có [báo cáo lỗi agent bị giới hạn tool](https://github.com/anomalyco/opencode/issues/50627)
và [xác nhận giới hạn Free với harness bên ngoài](https://github.com/anomalyco/opencode/issues/49621).
Bản trực tiếp đã kiểm tra hai lượt cho cả MiMo và LongCat thành công với bộ
bảo vệ thật. Đây không phải bảo đảm Free tier được chấp thuận cho dịch vụ web
công khai nhiều người dùng, hay bảo đảm chính sách không thay đổi.

### Giữ đúng model và metadata qua nhiều lượt

Khi tạo conversation với configured provider, lưu provider/model thực tế vào
DB. Mỗi lượt mới kiểm tra lại cấu hình trước khi tạo job. Nếu model/provider
đổi, phiên cũ báo `opencode_configured_model_changed`, không chuyển âm thầm.
Key chỉ ở backend; worker chỉ có secret gateway riêng, không nhận key model.

Adapter chuyển user/system/assistant/tool thành tin nhắn LangChain và gọi
chính `get_llm()` của Nexora với giới hạn output, timeout và zero retries. Không
thực thi tool trong adapter: OpenCode gọi tool và reader kiểm tra ID ở server.
Tool result phải khớp tool-call ID; input ảnh/file URL tùy ý bị từ chối.

Metadata gốc của response gọi công cụ (gồm thought signature khi provider cần)
lưu theo **owner + session + tool-call ID + model binding**, không đưa ra browser
hoặc SSE công khai. Khi replay, kiểm tra cả tên và arguments; không dùng metadata
phiên khác hoặc dựng chữ ký giả. Backup DB chat cùng worker DB/state là bắt buộc.
Audit dùng phiên riêng và dọn metadata sau khi đóng.

SSE của configured adapter hiện **buffer câu trả lời hoàn chỉnh** rồi phát theo
giao thức Chat Completions; chưa phải streaming token liên tục từ provider.
Giới hạn/stop vẫn kiểm tra trong lúc chờ model; không gọi lại khi timeout.

`serve` là worker; `attach` chỉ dành cho quản trị debug bằng terminal:

```powershell
.\run-opencode.ps1 -Session <session-id-cua-worker-rieng>
```

ID runtime không gửi về browser. Quản trị có thể xem cột `runtime_session` của
conversation trong DB riêng hoặc liệt kê session bằng API worker đã xác thực.
Không dùng `attach` để tạo session mới cho mỗi tin nhắn.

## Ranh giới dữ liệu và ngân sách

Browser → API Nexora đã xác thực → job lưu SQLite → worker riêng → gateway có
ngân sách → model đã chọn. MCP reader quay về Nexora, chỉ mở ID trích đoạn được
cấp cho job đang chạy. Không có shell, chỉnh file, đường dẫn/URL tùy ý, private
project, API key trong prompt, hay quyền tự chọn provider/model trả phí.

- Một worker hiện chỉ xử lý **một lượt OpenCode tại một thời điểm**, được khóa
  bằng lease SQLite xuyên process. Phiên khác báo worker bận, không chuyển model.
  Chat Nexora không phải chờ lease này. Chưa có queue phân tán nhiều worker.
- Mọi request model, kể cả lượt công cụ hoặc xử lý ngữ cảnh của OpenCode, phải
  qua gateway: kiểm tra model, số lần gọi, dự phòng token vào/ra và deadline
  trước khi chuyển tiếp. Phần dự phòng là ước lượng bảo thủ, không phải hóa đơn.
- Chat OpenCode tối đa 4 request model, 20.000 token đầu vào ước lượng, 6.000
  token đầu ra dự phòng, 90 giây; mỗi request được cấp tối đa 1.800 token ra.
  Chat Nexora một request. Báo cáo theo budget Quick/Standard/Deep hiện có.
- Hết ngân sách, bị dừng hoặc nhà cung cấp từ chối: không tự tăng budget/chuyển
  model. Chỉ tự sửa có mục tiêu trong các bước report khi budget hiện có cho phép.
- Dừng chặn request/công cụ tiếp theo, gửi abort tới OpenCode. Request model đã
  được nhà cung cấp nhận có thể vẫn tiêu tốn chi phí; timeout tối đa 60 giây.
- Lượt bỏ dở hơn 900 giây được đánh dấu interrupted; không replay khi khởi động.
- Không xếp hạng các model Free hay cam kết chất lượng tốt hơn native: cần A/B
  trên cùng tài liệu, câu hỏi, budget, tiêu chí citation và độ đúng sơ đồ.

Đường gateway lịch sử: configured provider của Nexora. Allowlist Console cũ có LongCat
2.5 Preview Free và MiMo-V2.6-Flash Free. Nhãn chính sách
đã đối chiếu thời điểm 2026-10-13 với [OpenCode Zen](https://opencode.ai/docs/zen/)
và mô tả model, **không bảo đảm chính sách/capacity không đổi**. Quản trị phải
kiểm tra lại trước khi bật model cho dữ liệu thật. Nemotron Ultra/Lightning và
Muse Contributor không được gửi dữ liệu riêng dù thêm nhầm vào private allowlist.

Các model **Console/Free** mặc định chỉ nhận nguồn công khai. Upload PDF, ghi chú
riêng và LaTeX context bị chặn ở server. `OPENCODE_PRIVATE_MODELS` chỉ có hiệu lực với
model thuộc nhóm zero-retention đã đánh giá và được quản trị chủ động cho phép;
không tự bật vì người dùng tick checkbox. Nội dung người dùng tự gõ có thể chứa
bí mật: cảnh báo này không thay thế phân loại/redaction/DLP phía vận hành.

Configured provider giữ quyền PDF/ghi chú hiện có của Nexora và điều kiện dữ
liệu của chính provider đó; không mặc định coi nó là zero-retention. Không gửi
tài liệu sang Console/Free khi chọn configured model. Có thể tắt lựa chọn này
bằng `OPENCODE_ENABLE_CONFIGURED_PROVIDER=false`; không tạo fallback tự động.

## Vận hành / triển khai

- Static frontend Cloudflare **không chạy được worker này**. Chỉ push frontend
  không đủ; backend và worker cần host có process chạy liên tục và private
  networking. Chưa deploy thay đổi này lên Workers/Render trong lượt triển khai.
- Dùng ổ bền vững cho `RESEARCH_CHAT_DATABASE_PATH`, `REPORTS_DIR`,
  `RESEARCH_DATA_DIR` và DB/state/cache của worker. Render Free ephemeral không
  thích hợp cho tài khoản/lịch sử thật. Backup phải giữ mapping chat/session.
- Không public port worker hoặc mật khẩu/server URL. Private gateway vẫn bắt
  Bearer secret, không nhận URL/provider/credentials từ web hay model.
- Cô lập OS/container, non-root, tài khoản/volume riêng, giới hạn CPU/RAM/PID,
  hạn chế mạng ra. OpenCode permission **không phải OS security sandbox**; bản
  local này được kiểm tra phạm vi công cụ, chưa chứng minh cô lập container.
- Một worker nhiều tài khoản vẫn là một trust boundary chung. Nếu cần dữ liệu
  nhạy cảm hoặc nhiều tenant, dùng worker/credential/scope riêng mỗi tenant và
  queue được cấp lease chính xác. Không tăng worker replica chung DB tùy ý.
- Không ghi prompt, trích đoạn, cookie hoặc secret vào log analytics mặc định.
  Không expose route config của worker qua reverse proxy công khai.
- Khi session gốc mất, báo lỗi; không âm thầm tạo session mới để che mất memory.
  Đổi CLI/schema chỉ sau khi chạy lại protocol tests và security preflight.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_research_chat.py tests/test_opencode_native.py -q
.\.venv\Scripts\python.exe scripts/check_opencode_runtime.py --binary data/opencode/runtime/node_modules/opencode-windows-x64/bin/opencode.exe
cd frontend
npm.cmd run test:research
npm.cmd run build
# Với Vite test server và Playwright đã cài:
npm.cmd run test:chat:browser
```

Protocol test chạy **OpenCode thật 1.19.0**, provider hoàn toàn mô phỏng, DB/profile
riêng và port loopback tạm: reader search/read, JSON StructuredOutput, cùng
session qua nhiều lượt và restart, không gửi trùng, hai conversation có session
khác nhau. Test không gọi model thật và không đo chất lượng câu trả lời.
`--route console` chạy lại protocol test với Console transport mô phỏng.
Thêm `--console-model mimo-v2.6-flash-free` để chọn MiMo; mặc định là LongCat.
`--route console --live-public-smoke` kiểm tra opt-in một lượt chào thật với
service key trong backend. Kết quả lỗi là lỗi thật, không chuyển model hoặc
coi là kiểm thử đạt. `scripts/check_opencode_console_access.py --binary <CLI>
--model <một-trong-hai-Free-model> --live` so sánh với CLI provider gốc trong
profile tạm riêng; không đọc auth desktop, không in/lưu key vào profile.
`scripts/opencode_console_login.py --binary <CLI>` bắt đầu device flow chính
thức với profile diagnostic riêng, cần người dùng tự xác nhận trên browser.
Thêm `--status` chỉ kiểm tra OAuth/workspace (không gọi model).
`check_opencode_console_access.py --credential-source console-login` kiểm tra
kết nối CLI gốc; `--credential-source console-token` kiểm tra token OAuth thực
trong bộ cấu hình chỉ cho hai Free model. Cần `--live` cho cả hai; mọi lỗi phải
được báo rõ, không retry hoặc dùng paid fallback. Đây chỉ là chẩn đoán local,
không phải thiết kế OAuth cho ứng dụng đa người dùng.
`--live-configured-smoke` là kiểm tra opt-in gọi model thật đang cấu hình: chào
tiếng Việt, đọc trích đoạn tổng hợp bằng MCP, replay kết quả/metadata vào model,
JSON StructuredOutput, restart worker và hỏi tiếp trong cùng session. Kiểm tra
ngày 2026-10-13 đã qua với **Gemini 3.5 Flash Lite**; không gửi PDF/ghi chú thật.
Đây là kiểm tra tích hợp, không chứng minh chất lượng research cao hơn. Free-tier
Console từng bị từ chối vẫn được ghi nhận là thất bại, không phải ca đạt.
Browser test dùng component thật, API mô phỏng: sáng/tối, mobile, lịch sử, reload,
archive/restore/đổi tên/ghim, stop, retry idempotent, private PDF guard, report và
visual dùng chung. Không thao tác nhóm/tài khoản thật của người dùng.

### Sidebar và hoạt động (2026-10-13)

Tên chế độ trên giao diện là **Chat** (engine `nexora`) và **Research Together**
(engine `opencode`), giữ nguyên hai tên tiếng Anh ở cả UI Việt/Anh. Nhãn áp dụng
cho bộ chọn chế độ, tiêu đề, lịch sử, lời trả lời, Search và Activity. Đây chỉ là
đổi cách hiển thị; không đổi ID engine, model Muse, phiên đã lưu hoặc chính sách
dữ liệu. Tên OpenCode/Muse vẫn xuất hiện trong thông tin kỹ thuật khi cần.

Giao diện mới nhóm **Đã ghim / Cuộc trò chuyện**, có menu ba chấm dọc ngay
trên từng phiên: đổi tên, ghim/bỏ ghim, lưu trữ và xóa. Tên đặt thủ công không
bị lượt tin nhắn đầu tiên ghi đè. Không còn bộ lọc Archived hoặc nút khôi phục.
Các bản archive cũ không bị xóa hàng loạt; API archive cũ vẫn giữ để tương thích.

Archive mới cần xác nhận xóa vĩnh viễn và dùng `DELETE /api/research/chats/{id}`.
Server kiểm tra chủ sở hữu, phiên active/đang chờ người dùng, worker và lease
trước khi xóa. Phiên direct chỉ dọn đúng thư mục owner/conversation đã kiểm tra,
từ chối symlink/junction; gateway cũ phải dọn được native session trước khi xóa.
Lỗi dọn phiên giữ bản ghi hội thoại và trả mã lỗi an toàn. Tệp dùng chung với
chat khác và báo cáo đã lưu trong thư viện không bị xóa. Không tự dừng phiên.
Chỉ giữ bộ đếm giới hạn gồm owner/ID opaque/loại/thời điểm, tính trong cửa sổ
24 giờ (lượt chat 1 giờ), dọn bản ghi hết hạn khi tạo/xóa phiên tiếp theo.
Không có tên, nội dung hoặc tệp và không thể khôi phục chat. Xóa hội thoại
không đặt lại giới hạn gửi hoặc tạo phiên.

**Search** (`Ctrl+K`, hoặc `Cmd+K`) tìm tên và toàn bộ tin nhắn đã lưu, không
chỉ 200 tin đang hiển thị; không tìm trong bytes tệp đính kèm. Kết quả tối đa
50 chat, riêng tài khoản đang đăng nhập; truy vấn ngắn hơn 2 ký tự không chạy.
**View activity** (`Ctrl+Alt+U`) hiển thị các lượt gần đây và phiên đang chạy;
click mở đúng hội thoại, chờ câu trả lời người dùng có biểu tượng riêng.
API `/activity` và summary không trả prompt, worker URL/token hoặc native ID.

Trong khi Research được mount (kể cả khi mở Reports con), polling tuần tự mỗi
2 giây theo dõi các session nền. Chime hai nốt do ứng dụng tự tạo chỉ phát cho
transition đã thấy active → completed, không coi failed/cancelled/partial hoặc
awaiting_input là hoàn tất. Sau tương tác người dùng mới kích hoạt âm thanh;
nếu trình duyệt chặn, trạng thái hình vẫn hoạt động. Có bật/tắt trong Activity,
ghi nhớ theo người dùng. Web Locks + bản ghi ID hữu hạn ngăn phát trùng giữa
các tab trên trình duyệt hỗ trợ; không phát lại lịch sử khi reload.

`npm run test:activity:browser` kiểm tra UI thật với toàn bộ API mô phỏng:
nhóm ghim, menu từng row, bản nháp khi rename chat khác, xác nhận/xóa, phiên nền,
human wait, search nội dung/shortcuts/response cũ, âm báo một lần/tắt/multi-tab,
reload và sáng/tối/mobile. Test không thay đổi dữ liệu hay gọi model thật.

Tài liệu giao thức: [Server](https://opencode.ai/docs/server/),
[SDK](https://opencode.ai/docs/sdk/), [Permissions](https://opencode.ai/docs/permissions/).
Chuẩn gateway/tool messages được đối chiếu theo **OpenAI Docs**:
[Function calling](https://developers.openai.com/api/docs/guides/function-calling),
[Chat Completions SSE](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).
Việc dùng chuẩn này không đổi provider sang OpenAI.
