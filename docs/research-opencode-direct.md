# OpenCode trực tiếp — bản thử local

## Dùng trên máy hiện tại

Sau khi đã bật bản thử và restart backend, vào **Research → Cuộc trò chuyện
mới → Chat OpenCode**. Hội thoại mới chỉ dùng **Muse Spark 1.3 Free**
(`muse-spark-1.3-contributor-free`), không có dropdown model. API server cũng
từ chối ID khác khi tạo phiên mới; không tự dùng bản Muse trả phí.
Đọc/xác nhận điều kiện dữ liệu Contributor trước khi gửi câu hỏi công khai.
Nội dung có thể được dùng huấn luyện model; không gửi bí mật/thông tin cá nhân.
Xác nhận được nhớ riêng theo tài khoản/trình duyệt/phiên bản điều kiện. Dòng
model/thông tin dữ liệu dưới chat đã bỏ; cảnh báo chỉ xuất hiện lúc cần xác nhận.

Phiên đã tạo trước đó giữ nguyên đường gateway và lịch sử; không tự chuyển
engine, model hoặc session. Nếu phiên cũ vẫn có lỗi FreeTierError, tạo phiên
mới để thử đường trực tiếp. Không xóa hay gửi lại tin nhắn của phiên cũ.

Mặc định trong source là tắt. Bật bằng `OPENCODE_DIRECT_ENABLED=true` tại env
server hoặc `data/opencode-direct/runtime.env`, sau đó restart backend. Tắt
bằng `false` và restart: phiên direct được giữ nhưng không tự chuyển sang
gateway. Không đưa biến/key vào `VITE_*` hoặc nhập key trong trình duyệt.

API key dùng đúng `OPENCODE_UPSTREAM_API_KEY` hiện có. Không lấy token/DB
desktop; không thay đổi số dư, billing hoặc quyền Console. Hồ sơ runtime,
session DB/cache/log riêng được Git ignore; bảo vệ và backup chúng như dữ liệu
cá nhân của server, không export logs thô ra công khai.

## Đường chạy và session

Backend vẫn xác thực tài khoản, kiểm tra owner, lưu conversation/job/message,
idempotency và giới hạn tần suất. CLI OpenCode **1.19.0 chính thức** dùng
provider `opencode`, model được chọn, rồi gọi dịch vụ trực tiếp từ Bun.
Không HTTP relay Python, không dựng header/TLS identity, không thêm tool giả.

Phiên MiMo/LongCat trực tiếp cũ chạy `opencode run` cho mỗi lượt, với DB riêng tại
`data/opencode-direct/conversations/<owner-hash>/<conversation-id>/`.
Lượt tiếp theo dùng đúng `--session` đã lưu; lịch sử OpenCode vẫn tồn tại sau
khi tiến trình CLI kết thúc. Đây không phải một tiến trình `serve` thường trực
cho từng cuộc trò chuyện. Đường `serve/attach` cũ vẫn giữ nguyên, không trộn
session của hai đường hoặc của desktop.

Phiên Muse mới dùng `direct_hil_v1`: mỗi lượt khởi động **OpenCode serve thật**
trên loopback, password ngẫu nhiên chỉ ở backend, trong đúng profile của hội
thoại. Web gọi backend; không nhúng terminal `attach`, không lộ port/password.
Muse dùng Responses API, guard kiểm tra `input`, `max_output_tokens`, `store=false`
và usage của `response.completed`; không chuyển đổi giả sang Chat Completions.

## Hỏi lại người dùng (human in the loop)

Agent có công cụ `question` thật. Chỉ hỏi khi mục tiêu/phạm vi/sở thích thiếu
làm thay đổi đáng kể câu trả lời. Câu hỏi được kiểm tra cấu trúc, tối đa 3 câu
mỗi lần và 3 lần hỏi/lượt. Người dùng chọn đáp án hoặc nhập ý riêng rồi bấm
**Gửi câu trả lời**; không có đáp án chọn sẵn hoặc tự gửi. Có Bỏ qua và Dừng.

- Trạng thái `awaiting_input` lưu trong DB của Nexora, giữ câu hỏi khi refresh.
- Khi chờ, thả lease model/reader để cuộc trò chuyện khác có thể dùng worker;
  không gọi model, không tiêu thêm ngân sách, không tính vào 90 giây xử lý.
- Chờ tối đa 30 phút, tối đa 4 lượt interactive còn sống trên server. Trả lời
  được kiểm tra owner + conversation + question, shape, expiry và idempotency.
- Khi tiếp tục phải lấy lại lease, giữ nguyên counters/ngân sách/token/session;
  không reset ngân sách mỗi lần hỏi. Nếu worker khác bận, chờ tối đa 60 giây.
- OpenCode 1.19 dừng loop khi question bị reject. Bỏ qua chủ động gửi native
  reject, abort đúng session để giải phóng run-state, rồi ONE continuation
  trong cùng session/ngân sách, ghi rõ không có lựa chọn hoặc consent. Đây
  không phải retry lỗi provider hay tự dựng câu trả lời thay người dùng.
- Worker Nexora heartbeat lúc chờ. Native pending Deferred chỉ ở memory;
  backend/worker mất thì câu hỏi đóng và báo interrupted, KHÔNG giả khôi phục
  request cũ hoặc tự replay model. Người dùng gửi tin mới trong phiên để tiếp.
- Khi backend cũ mất, chỉ cleanup đúng child serve đã ghi PID, creation-time,
  cwd; không dừng OpenCode desktop hoặc process theo tên/port.

## Bảo vệ trước khi thực hiện

- Phiên mới chỉ Muse Contributor Free; giữ hai ID Free MiMo/LongCat cho
  session cũ. Không paid fallback hay đổi model lúc lỗi.
- Profile lưu sẵn endpoint loopback không phải provider. Plugin không tải
  được thì không liên hệ upstream; lượt không được đánh dấu thành công.
- Plugin được review gắn vào `options.fetch` của SDK OpenCode. Mỗi request
  thực tế được kiểm tra URL/provider/model/session và xin reserve ở backend
  **trước** khi gọi `fetch` gốc. Metadata client gốc không bị giả mạo.
- Token quyền hạn ngẫu nhiên chỉ có hiệu lực trong một job. Session phải khớp
  owner + conversation + job. Job dừng/hết hạn hoặc sai session bị chặn.
- Mỗi lượt tối đa 4 request model, tổng reserve output 6.000 token, mỗi request
  tối đa 1.800 token, thời hạn 90 giây. Input reserve là toàn bộ số byte UTF-8
  của request + 4.096 dự phòng, gồm history/system/tool schema; tối đa 100.000
  mỗi request và 300.000 tổng mỗi lượt. Đây là dự phòng bảo thủ, không phải số
  token tokenizer đo chính xác. Token nhà cung cấp trả về được ghi riêng.
- `ask` giữ các tool thật của OpenCode trong cấu hình. `tool.execute.before`
  chặn mọi built-in trước execution (shell, read, edit, task, webfetch…);
  không auto-approve. Chỉ reader Nexora có nguồn được cấp cho job và
  StructuredOutput được phép; riêng Muse interactive cho phép `question`.
  Quyền hỏi người dùng không cấp quyền shell/host file. Reader dùng token riêng từng job; bridge cũ
  không đọc được scope của job/người dùng tiếp theo.
- Khi bấm Dừng, server thu hồi job trước; monitor dừng đúng process đã tạo và
  descendants của nó, không dừng worker cũ hay process dựa vào số port.
- Không tự replay request khi mất kết nối/restart. Lượt hỏi tiếp là request
  mới, dùng session cũ và kiểm tra ngân sách lại.

Bản thử mặc định coi PDF gửi vào Muse interactive là đầu vào công khai, không
cần checkbox/xác nhận từng file. Chọn file không tự upload: bấm Gửi mới upload
và gửi excerpt sang model. Server lưu `attachment_data_policy=public_pdf_default_v1`
để ghi đúng chính sách xử lý, KHÔNG tự ghi người dùng đã tick consent. Trường
`attachment_data_ack` cũ chỉ còn cho tương thích/idempotency, không dùng làm gate.
Lịch sử PDF có/không có flag cũ đều được đọc theo chính sách mặc định mới.

"Công khai" là phân loại đầu vào xử lý của model, KHÔNG đăng/chia sẻ PDF cho
người khác: API tải file/hội thoại vẫn yêu cầu đúng owner, không đổi ACL hay
publish lên Library/Group/Project. Vẫn kiểm tra owner và loại file ở mọi lượt,
kể cả question resume. Điều kiện Contributor training của nhà cung cấp không đổi.

PDF được parse trên server bằng bộ đọc sẵn có, chỉ đưa excerpt text vào packet
untrusted; KHÔNG gửi PDF gốc, file URL/base64, ảnh trang hoặc cho phép native
host-read. Tổng excerpt cho Muse tối đa 10.000 byte UTF-8, chia cho tài liệu;
phần bị cắt được đánh dấu partial. Không coi chữ PDF là evidence đã kiểm chứng.
PDF scan không có chữ cần OCR; PDF mã hóa/sai định dạng bị từ chối rõ ràng.
Chưa đọc được hình/biểu đồ trong PDF. Tối đa 5 file, 10 MB/file, 20 MB/lượt.

Không mở quyền private chung: ảnh/tệp khác, PDF riêng, research notes và LaTeX
context vẫn chặn ở Muse. Session MiMo/LongCat direct hoặc gateway cũ không tự
có PDF opt-in này. Chat Nexora/configured provider giữ hỗ trợ file/ảnh hiện có.
**Reports** giữ pipeline cũ; direct không tự tạo báo cáo.

Đây là cô lập hồ sơ và chặn tool ở tầng ứng dụng, **không phải OS/container
sandbox**. Trước khi dùng cho website công khai cần sandbox tiến trình,
review vận hành/secret/log/backup và xác nhận quyền sử dụng Free tier từ
OpenCode. Kết quả local thành công không tự tạo quyền sử dụng SaaS.

## Kiểm thử

Offline mặc định, chạy CLI thật và guard thật nhưng provider mô phỏng:

```powershell
.\.venv\Scripts\python.exe scripts/check_opencode_direct.py
.\.venv\Scripts\python.exe scripts/check_opencode_interactive.py
.\.venv\Scripts\python.exe scripts/check_opencode_interactive.py --pdf
```

Bao gồm tool shell độc hại không tạo được file, cùng session qua restart CLI,
dừng lượt đang chờ, hỏi tiếp sau dừng và plugin bị thiếu không gọi provider.
Unit tests kiểm tra auth, owner/session, model, cancel/expiry, ngân sách,
settlement chống trùng và token reader không dùng lại ở job khác.
Harness interactive thêm native question/reply, refresh, duplicate reply,
pause/release/resume budget, stop, skip, host-tool denied và cùng session.

Hai lệnh sau là opt-in, có gọi model thật bằng câu hỏi công khai:

```powershell
.\.venv\Scripts\python.exe scripts/check_opencode_direct.py --live
.\.venv\Scripts\python.exe scripts/check_opencode_direct.py --live --model longcat-2.5-preview-free
.\.venv\Scripts\python.exe scripts/check_opencode_interactive.py --live
.\.venv\Scripts\python.exe scripts/check_opencode_interactive.py --live --pdf
```

Ngày 2026-10-13, cả MiMo và LongCat hoàn tất hai lượt trong cùng session,
request được reserve trước dispatch và có usage đo thực. Không tài liệu
người dùng, không paid fallback. Đây là kiểm thử tích hợp, không phải đánh giá
chất lượng research hoặc cam kết luôn có capacity/Free eligibility.

Muse Contributor Free cũng đã kiểm thử thật ngày 2026-10-13: model gọi native
question, job chuyển awaiting_input, trả lời tùy chỉnh rồi hoàn tất trong cùng
session với 2 request được metered. Không gửi tài liệu/ngữ cảnh của người dùng.
Kiểm thử phát hiện và sửa việc yêu cầu hiện tại bị trộn vào lịch sử untrusted:
packet có `current_user_request` riêng, còn history/excerpts vẫn không có quyền
thay đổi quy tắc/tool. Đây là kiểm thử chức năng, không phải benchmark chất lượng.

PDF cũng đã kiểm thử với Muse thật: PDF tự tạo chỉ có dữ liệu giả công khai,
model trả đúng số trong excerpt và hỏi tiếp vẫn trả đúng trong cùng session.
Không dùng/gửi PDF của người dùng cho thử nghiệm này.
