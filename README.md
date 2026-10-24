# Nexora Agent

Trợ lý nghiên cứu xây trên LangGraph, có web app, Research Notebook cộng tác,
Research Chat và CLI. Pipeline research chính của web app ưu tiên đọc nguồn,
theo dõi bằng chứng và tạo báo cáo có trích dẫn; CLI/LangGraph Studio vẫn có
graph analyst-interview đa tác nhân riêng.

Graph analyst/interview trong CLI phát triển từ mẫu
[research-assistant.ipynb](https://github.com/langchain-ai/langchain-academy)
(module-4, LangChain Academy). Web app hiện dùng thêm một graph evidence-first
riêng cho quy trình nghiên cứu, phân tích paper và kiểm tra citation.

Muốn chạy thử? Bắt đầu tại [hướng dẫn clone và chạy local](#getting-started).

## Dự án nghiên cứu cộng tác

Sau khi đăng nhập web app, mở **Dự án / Projects** từ thanh điều hướng hoặc
từ notebook của từng lĩnh vực trong **Fields**. Trước khi vào Notebook/Dự án,
tài khoản chưa đặt tên sẽ được chuyển đến **Profile → Chỉnh sửa hồ sơ** để
lưu một **tên người dùng duy nhất** (3–30 ký tự, không có `@`). Các trường
hồ sơ khác không bắt buộc. Tên này hiện trên hồ sơ/avatar, dùng để tìm người,
kết nối và gửi lời mời. Tên trùng (không phân biệt hoa/thường và khoảng trắng
thừa) bị từ chối; lưu tên và hồ sơ cùng một giao dịch. Lưu xong quay lại
Notebook, lĩnh vực hoặc link trang/dự án vừa định mở, kể cả sau tải lại trang.
Có thể đổi tên tại Profile; quyền truy cập và lời mời gắn với ID tài khoản,
không đổi theo tên. Tên đã đặt trước đây vẫn được giữ nguyên.

- Tạo nhóm kín rồi tạo nhiều dự án theo Toán, Lý, Hóa, Sinh hoặc AI; hoặc tạo
  dự án cá nhân. Trong dự án nhóm, chọn quyền của toàn nhóm hoặc giới hạn cho
  thành viên được mời.
- Research Notebook có cây trang cha/con, tìm kiếm tên và nội dung theo quyền,
  kéo thả/sắp xếp trang cùng cấp. Editor dạng khối hỗ trợ menu `/`, kéo thả khối,
  định dạng chữ, tiêu đề, danh sách, checklist, trích dẫn, mã, bảng và công thức
  LaTeX trực tiếp. Có bình luận, mốc phiên bản giữ cấu trúc khối và xuất
  Markdown/JSON; nhập JSON thêm vào cuối trang sau xác nhận. WebSocket chuyển các bản cập nhật
  Yjs; SQLite lưu log nên tải lại hoặc mở trên thiết bị khác vẫn có nội dung.
  Trạng thái “All changes synced” chỉ hiện sau khi server xác nhận đã lưu.
  Nội dung chưa đồng bộ có bản dự phòng trong sessionStorage theo tài khoản
  và trang; mất mạng khóa thao tác sửa và tự kết nối lại. Đừng đóng tab nếu
  vẫn còn thay đổi chưa lưu. Hiện hỗ trợ presence, chưa có con trỏ từ xa.
- Mời vào nhóm, dự án hoặc chỉ một trang với quyền xem/bình luận/chỉnh sửa.
  Link trang không tự cấp quyền; lời mời phải được người nhận chấp nhận.
  Kết bạn cũng không tự mở bất kỳ dự án hay trang nào.
  Có danh sách trang được chia sẻ, lời mời đang chờ có thể hủy và điều chỉnh
  vai trò trực tiếp; thu hồi quyền cũng có hiệu lực với editor đang mở.
- Phân việc, gán người phụ trách và tập hợp nguồn chung. Có thể chủ động chọn
  metadata paper đã lưu hoặc chép notebook/báo cáo cá nhân vào trang chung.
  Ghi chú đọc paper, notebook Fields và báo cáo cá nhân không tự động chia sẻ.
- Khung nghiên cứu riêng cho năm lĩnh vực và mẫu ghi chú đọc paper có thể
  chèn vào trang. Cột Sources chèn trích dẫn metadata, link trang khác và xem
  backlink theo quyền. Chọn mục và nguồn để chuẩn bị brief, xem trước nội dung;
  thao tác này không chạy AI hay tiêu thụ quota cho đến khi bấm bắt đầu Research.
- Trang Markdown cũ không bị ghi đè tự động. Chọn “Convert to blocks” để nâng
  cấp; bản gốc được lưu trong lịch sử, bố cục Markdown đặc biệt có thể cần sửa.
  JSON là bản sao giữ cấu trúc editor; xuất Markdown có thể mất một số định dạng.
- Quản lý vai trò thành viên, chuyển quyền sở hữu, rời/lưu trữ/khôi phục nhóm,
  lưu trữ/khôi phục trang và dự án. Rời hoặc bị xóa khỏi nhóm thu hồi các quyền
  dự án/trang được cấp trực tiếp trong nhóm đó.

Dữ liệu cộng tác nằm trong `AUTH_DATABASE_PATH` (mặc định
`data/deep-research.db`); thư viện paper riêng nằm trong `PAPER_DATABASE_PATH`.
Khi sao lưu hoặc chuyển host cần giữ cả hai SQLite database, thư mục báo cáo
và biến môi trường bí mật. **Research Notebook** cá nhân/cộng tác lưu ở server
theo quyền dự án/trang. **Device scratchpad** trong Fields vẫn là ghi chú nhanh
trong localStorage của từng trình duyệt; chỉ bản sao chủ động chuyển vào
Research Notebook mới nằm trên server. Việc lưu trữ không xóa vĩnh viễn dữ liệu.

Chạy local bằng `run-app.ps1` hoặc khởi động backend và Vite riêng; Vite cần
proxy WebSocket cho đường `/api` (đã cấu hình trong `frontend/vite.config.ts`).
Trên Windows, launcher kiểm tra đúng thư mục làm việc và loại tiến trình trước
khi dừng server cũ; xử lý cả worker Python còn giữ socket sau khi reloader cha
đã thoát và Vite được chạy bằng đường dẫn tương đối. Không dừng ứng dụng khác
chỉ vì đang giữ cổng. Cài `backend/requirements.txt` để có dependency kiểm tra
tiến trình. Dùng `./run-app.ps1 -CheckOnly` để kiểm tra mà không dừng server;
`-NoBrowser` để chạy mà không tự mở trình duyệt. Không chạy hai launcher đồng
thời; nếu cổng thuộc dự án khác hoặc không xác minh được, launcher sẽ dừng và
báo lỗi cụ thể. Việc khởi động lại sẽ ngắt các phiên đang chạy trên server cũ.
Khi triển khai production cần HTTPS/WSS, `AUTH_SESSION_SECRET` mạnh,
`AUTH_COOKIE_SECURE=true`, `CORS_ORIGINS` chính xác, backup định kỳ và quy định
giữ/xóa dữ liệu của host. Thiết kế hiện tại phù hợp một host SQLite với số
người cùng sửa vừa phải; chưa phải dịch vụ cộng tác phân tán quy mô lớn.
Log Yjs đang append-only, chưa có cơ chế compact tự động; host cần theo dõi
kích thước database. Không sửa/xóa log thủ công vì có thể làm mất khả năng
khôi phục tài liệu. Các mốc phiên bản là bản lưu thủ công, không phải backup
toàn hệ thống. Khi phục hồi mốc, nội dung hiện tại được lưu một mốc trước đó.

<a id="getting-started"></a>
## Bắt đầu từ đầu: clone và chạy local

### Yêu cầu

- Git.
- Python 3.11 trở lên.
- Node.js bản LTS kèm npm để chạy giao diện web.
- Một API key cho LLM (Groq, Google Gemini hoặc OpenAI) và một
  [Tavily API key](https://tavily.com) để tìm kiếm web. Tài khoản/provider có
  thể tính phí hoặc giới hạn quota riêng; hãy kiểm tra chính sách của họ.
- Docker Desktop chỉ cần nếu muốn chạy backend bằng Docker.

### 1. Clone repository

Lấy URL HTTPS từ nút **Code** trên trang GitHub của repository đã public, sau
đó chạy:

```bash
git clone <URL-HTTPS-cua-repository>
cd deep-research-agent
```

Thay `<URL-HTTPS-cua-repository>` bằng URL thật của repository. Nếu bạn clone
vào thư mục có tên khác, dùng tên thư mục đó ở lệnh `cd`.

### 2. Tạo môi trường Python và cài backend

Trên Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r backend\requirements.txt
```

Nếu PowerShell chặn kích hoạt môi trường, chỉ mở quyền cho cửa sổ hiện tại rồi
chạy lại lệnh activate:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Trên macOS/Linux:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r backend/requirements.txt
```

`requirements.txt` cài LangGraph, LangChain, các adapter LLM, Tavily, công cụ
CLI và thư viện xử lý tài liệu. `backend/requirements.txt` cài FastAPI,
WebSocket, SQLite collaboration support, upload và các thư viện phụ trợ. Cài
cả hai file để chạy đầy đủ ứng dụng.

### 3. Tạo và điền `.env`

Tại thư mục gốc repository:

```powershell
Copy-Item .env.example .env
```

Hoặc macOS/Linux:

```bash
cp .env.example .env
```

Mở `.env` và điền các giá trị sau:

| Biến | Cần cho | Cách cấu hình |
|---|---|---|
| `LLM_PROVIDER` | Research có dùng LLM | Chọn đúng một: `groq`, `gemini` hoặc `openai`. Dùng `auto` nếu muốn tự chọn provider theo API key đang có. |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | Research có dùng LLM | Chỉ cần điền key cho provider đã chọn. Chọn model được tài khoản/provider của bạn hỗ trợ qua biến `*_MODEL`. |
| `TAVILY_API_KEY` | Tìm kiếm web | Điền API key Tavily. Khi thiếu biến này, các yêu cầu research cần tìm kiếm web sẽ không lấy được nguồn mới. |
| `AUTH_SESSION_SECRET` | Ký session đăng nhập | Có thể để mẫu cho lần chạy local đầu tiên; trước khi public server, bắt buộc thay bằng secret ngẫu nhiên mạnh. |
| `APP_ENV`, `AUTH_DEV_LOGIN`, `AUTH_COOKIE_SECURE` | Đăng nhập local | Giữ mặc định `development`, `true`, `false` để hiện nút tài khoản development trên máy local. Không bật đăng nhập development trên production. |
| `FRONTEND_URL`, `BACKEND_URL`, `CORS_ORIGINS` | Kết nối web/API | Giữ URL local `127.0.0.1` khi chạy theo hướng dẫn này. Khi dùng domain khác, cập nhật đúng origin và bật HTTPS. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Đăng nhập Google | Tùy chọn cho local; callback mặc định là `http://127.0.0.1:8000/api/auth/callback/google`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Đăng nhập GitHub | Tùy chọn cho local; callback mặc định là `http://127.0.0.1:8000/api/auth/callback/github`. |
| `ADMIN_EMAILS` | Host Console | Email tài khoản được cấp vai trò Host, phân tách bằng dấu phẩy. Để trống nếu không cần Host Console. |

Tùy chọn nâng cao: `LANGSMITH_TRACING=true` cùng `LANGSMITH_API_KEY` bật
tracing cho graph; OpenCode worker cần cấu hình riêng như
[hướng dẫn Research Chat/OpenCode](docs/research-chat-opencode.md); snapshot
GitHub/R2 chỉ cần khi host có filesystem tạm, xem phần comments trong
`.env.example` và mục vận hành bên dưới. Không cần cấu hình các tính năng này
để chạy local cơ bản.

Các biến `VITE_PRO_MONTHLY_PRICE` và `VITE_TEAM_MONTHLY_PRICE` chỉ điều khiển
con số hiển thị; bản self-hosted không tích hợp thu tiền hay tự cấp license.
Vite đọc biến `VITE_*` từ `frontend/.env`, không phải root `.env`. Không thêm
API key, OAuth secret hoặc secret server vào bất kỳ biến `VITE_*` nào: frontend
build sẽ nhúng chúng vào JavaScript công khai. File `.env` đã được Git bỏ qua;
không commit file này.

### 4. Database và thư mục dữ liệu

Không cần cài PostgreSQL/MySQL và không cần tạo bảng thủ công. Backend tự tạo
thư mục, file SQLite và schema khi các tính năng tương ứng khởi tạo. Mặc định
mọi đường dẫn tương đối tính từ thư mục gốc repository:

| Biến | Mặc định | Nội dung |
|---|---|---|
| `AUTH_DATABASE_PATH` | `data/deep-research.db` | Tài khoản, profile, audit log, nhóm/dự án, Research Notebook và dữ liệu cộng tác. |
| `PAPER_DATABASE_PATH` | `data/paper-library.db` | Thư viện paper và collection cá nhân. |
| `RESEARCH_CHAT_DATABASE_PATH` | `data/research-chat.db` | Hội thoại research, message, job và file đính kèm của Research Chat. |
| `RESEARCH_DATA_DIR` | `data/research` | `documents.db`, cache nguồn và PDF người dùng đã tải lên. |
| `AVATAR_DIR` | `data/avatars` | Avatar tải lên. |
| `REPORTS_DIR` | `reports` | Report Markdown và metadata đi kèm. |

Các thư mục `data/` và `reports/` không được commit. Để sao lưu local, dừng
backend trước rồi sao chép cả `data/` và `reports/`; dừng server giúp SQLite
ghi xong journal/WAL trước khi copy. Không xóa file database để “reset” khi
còn cần dữ liệu. SQLite phù hợp cho một host; không đặt database lên nhiều
worker hay một filesystem chia sẻ tùy tiện.

### 5. Cài frontend

Tại thư mục gốc repository:

```bash
npm --prefix frontend ci
```

Không cần tạo `frontend/.env` khi frontend và backend chạy theo các địa chỉ
mặc định: Vite đã proxy `/api`, `/ws` và `/health` đến backend. Chỉ sao chép
`frontend/.env.example` thành `frontend/.env` nếu triển khai frontend riêng
hoặc cần đặt `VITE_API_BASE_URL`; các biến trong file này là cấu hình công
khai, không phải nơi lưu secret.

### 6. Khởi động ứng dụng

Trên Windows, sau khi cài Python dependencies và Node/npm, có thể chạy cả
backend và frontend bằng:

```powershell
.\run-app.ps1
```

Mở `http://127.0.0.1:5173`, chọn **Dùng tài khoản phát triển cục bộ** để vào
app mà không cần thiết lập OAuth. Nhấn `Ctrl+C` tại cửa sổ PowerShell để dừng.
Không chạy hai `run-app.ps1` cùng lúc. Script không tự dừng ứng dụng khác chỉ
vì ứng dụng đó giữ cổng 8000 hoặc 5173.

Trên macOS/Linux, hoặc khi cần debug, mở hai terminal tại thư mục gốc. Terminal
thứ nhất chạy API:

```bash
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal thứ hai chạy frontend:

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

Kiểm tra API tại `http://127.0.0.1:8000/health`; tài liệu FastAPI ở
`http://127.0.0.1:8000/docs`. Luôn chạy lệnh từ thư mục gốc để `.env` và các
đường dẫn SQLite tương đối được tìm thấy đúng chỗ.

### Chạy riêng CLI

CLI sử dụng graph analyst/interview trong `agent/graph.py`. Chạy tương tác:

```bash
python main.py "RAG và fine-tuning khác nhau thế nào?" --max-analysts 2 --depth standard
```

Mặc định CLI dừng để bạn duyệt analyst và section. Chạy một lượt không dừng:

```bash
python main.py "RAG là gì?" --max-analysts 1 --depth quick --no-interrupt
```

Report được ghi trong `reports/`. `quick`, `standard` và `deep` đặt các mức
trần khác nhau cho số vòng, truy vấn, tài liệu và độ dài report; số lần gọi
LLM/tìm kiếm thực tế phụ thuộc đường đi graph và kết quả đã cache. Với chế độ
interactive, `--user-id` chọn namespace research profile trong store của tiến
trình hiện tại.

### Chạy backend bằng Docker (tùy chọn)

Sau khi tạo `.env` và cài Docker Desktop:

```bash
docker compose up --build api
```

Lệnh này chạy backend API; frontend vẫn cần chạy bằng Vite như hướng dẫn trên.
Compose mount `reports/` nhưng không mount mặc định thư mục SQLite `data/` vào
host. Nếu dùng Docker để giữ dữ liệu qua lần tạo lại container, hãy thêm bind
mount `./data:/app/data` vào service `api` trong `docker-compose.yml` trước
khi có dữ liệu thật. Dừng bằng `docker compose down`.

### Deploy frontend lên Cloudflare Workers

Worker `deep-research-agent` hiện phục vụ **frontend tĩnh**; nó không chạy
FastAPI/Python. Từ thư mục gốc project, chạy `npm ci`, sau đó `npm run build`
để cài dependencies của frontend và tạo `frontend/dist`. Đăng nhập Wrangler
một lần bằng `npx wrangler login`, rồi chạy `npm run deploy` để build và deploy
theo `wrangler.jsonc`.

Backend thử nghiệm đang chạy tại Render và Worker chuyển tiếp `/api/*`,
`/ws/*`, `/health` qua `BACKEND_ORIGIN` trong `wrangler.jsonc`. Frontend dùng
cùng domain với API nên không cần `VITE_API_BASE_URL`. Kiểm tra
`https://deep-research-agent.tranminhkhoi8407.workers.dev/health` trước khi
thử đăng nhập. `FRONTEND_URL`, `BACKEND_URL` và `CORS_ORIGINS` trên Render đều
dùng chính xác domain Worker. OAuth callback tương ứng là
`https://deep-research-agent.tranminhkhoi8407.workers.dev/api/auth/callback/google`
hoặc `/github`. Không đặt OAuth secret hay API secret có tiền tố `VITE_`: các
biến `VITE_*` được nhúng vào mã frontend. Hướng dẫn và giới hạn Render Free
nằm trong [docs/render-deploy.md](docs/render-deploy.md).

Nếu đăng nhập Wrangler qua trình duyệt gặp lỗi CSRF, có thể dùng API token
Cloudflare được giới hạn quyền Workers Edit trong biến môi trường của terminal
hiện tại (`CLOUDFLARE_API_TOKEN`, kèm `CLOUDFLARE_ACCOUNT_ID` nếu cần). Không
commit token vào repository và không gửi token qua chat.

### Đăng nhập và bảo vệ session

Có thể tạo tài khoản email/mật khẩu, đăng nhập qua Google/GitHub sau khi cấu
hình OAuth, hoặc dùng nút development trên máy local. Sau khi đăng nhập,
header hiển thị avatar, tên tài khoản và menu đăng xuất. API report, REST
research và WebSocket đều yêu cầu session hợp lệ. Mật khẩu nội bộ được băm;
OAuth access token chỉ dùng trong callback để đọc hồ sơ cơ bản, không được lưu
vào cookie hoặc ổ đĩa. Session cookie được ký và đặt HTTP-only. Report của
tài khoản OAuth được lưu trong thư mục riêng theo mã băm user ID; tài khoản
development dùng thư mục `reports/` gốc.

Để thử giao diện ngay trên máy local, bấm **Dùng tài khoản phát triển cục bộ**.
Nút này mặc định chỉ có ở `APP_ENV=development`. Khi deploy thật, đặt:

```env
APP_ENV=production
AUTH_DEV_LOGIN=false
AUTH_COOKIE_SECURE=true
AUTH_SESSION_SECRET=<chuỗi-ngẫu-nhiên-dài>
FRONTEND_URL=https://ten-mien-frontend-cua-ban
BACKEND_URL=https://ten-mien-api-cua-ban
CORS_ORIGINS=https://ten-mien-frontend-cua-ban
```

Tạo secret bằng lệnh:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Với **Google Cloud Console**, tạo OAuth Client loại **Web application**, thêm
redirect URI sau rồi điền credential vào `.env`:

```text
http://127.0.0.1:8000/api/auth/callback/google
```

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Với **GitHub → Settings → Developer settings → OAuth Apps**, đặt Authorization
callback URL rồi điền credential:

```text
http://127.0.0.1:8000/api/auth/callback/github
```

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Sau khi sửa `.env`, dừng ứng dụng bằng `Ctrl+C` và chạy lại `./run-app.ps1`.
Hai nút sẽ tự chuyển từ **Chưa cấu hình** sang trạng thái có thể bấm. Khi dùng
domain thật, thay hai callback URL bằng `BACKEND_URL` tương ứng và bật HTTPS.

Pipeline research của web app chạy theo hướng evidence-first: phân tích brief,
tìm và đọc một số nguồn trong giới hạn ngân sách, đánh giá câu hỏi nào còn
thiếu bằng chứng, tìm/đọc bổ sung khi còn quota, rồi soạn report, tạo visual,
audit trích dẫn và cho người dùng review trước khi hoàn tất. Citation phải trỏ
đến đoạn trích có thật trong tài liệu đã đọc; URL tìm thấy hoặc snippet tìm
kiếm không tự được xem là bằng chứng đã đọc. Chế độ `quick`, `standard`,
`deep` thay đổi trần thời gian, lượt gọi model, tìm kiếm, tài liệu và dung
lượng bằng chứng; không bảo đảm số lượt cố định hay chi phí cố định.

Nút **VIE / ENG** trên thanh đầu trang đổi toàn bộ giao diện và đặt ngôn ngữ
đầu ra cho brief, report và phần tổng hợp. Graph CLI có thể đặt ngôn ngữ
riêng trong state. Lựa chọn giao diện được lưu trên trình duyệt.

Thanh điều hướng chính có 5 khu vực:

- **Tổng quan:** thống kê report, nguồn duy nhất, phiên deep và các brief gợi ý.
- **Nghiên cứu:** cấu hình và theo dõi pipeline real-time như mô tả ở trên.
- **Lĩnh vực:** workspace chuyên biệt cho Toán, Vật lý, Hóa học, Sinh học và
  Khoa học máy tính (AI), gồm category, playbook, notebook, checklist và LaTeX.
- **Thư viện:** bắt đầu từ 5 lĩnh vực Toán, Lý, Hóa, Sinh, AI; quản lý report
  Markdown và tìm/lưu paper từ arXiv hoặc metadata tạp chí qua Crossref.
- **Kho nguồn:** gom URL từ mọi report, khử trùng theo URL, hiển thị chất lượng
  và report nào đã sử dụng nguồn đó.

Các mục **Cài đặt**, **Hướng dẫn** và **Bảng giá** vẫn mở được từ Personal Hub
(avatar) hoặc footer. **Host Console** chỉ hiện trong Personal Hub của tài khoản
Host, không nằm trên thanh điều hướng. Cài đặt lưu lựa chọn ngôn ngữ, depth,
auto-approve và tùy chọn giao diện; Hướng dẫn có 15 bài và tiến độ đọc; Bảng
giá trình bày license Free/Researcher Pro/Team. Số analyst là tham số của CLI
graph; graph evidence-first đang dùng cho web quyết định phạm vi qua ngân sách,
không fan-out theo analyst count. Host Console quản lý thành viên, report,
nhật ký hoạt động và tình trạng dịch vụ.

### Personal Hub và hồ sơ nghiên cứu

Nhấn avatar ở header để mở **Personal Hub**. Menu này hiển thị danh tính,
provider, quyền Host/Member, license và các lối tắt tới hồ sơ, thư viện report,
lĩnh vực nghiên cứu, tiến độ Guide, cài đặt và Pricing. Chọn **Hồ sơ** để mở
trang `/#/profile` với thống kê lấy từ thư viện thật: số report, nguồn duy nhất,
phiên deep, nguồn chất lượng cao, heatmap 12 tháng, chuỗi hoạt động, cột mốc,
bản đồ lĩnh vực, tiến độ Guide và report gần đây.

Trong Personal Hub, **Giao diện** cho phép chọn **Theo hệ thống**, **Sáng**
hoặc **Tối**. Lựa chọn được lưu trong trình duyệt và áp dụng ngay cho cả trang
đăng nhập lẫn workspace; chế độ Theo hệ thống tự theo cài đặt sáng/tối của máy.

### Guided Product Tour

Ở lần đăng nhập đầu tiên, workspace mời người dùng tham quan (có thể chọn
**Để sau**). Tour chính gồm 8 bước nối Tổng quan → Nghiên cứu → Lĩnh vực →
Thư viện → Kho nguồn → Hồ sơ. Bốn tour ngắn giải thích sâu hơn về Research,
bộ công cụ Lĩnh vực, thư viện paper và Host Console; tour Host chỉ dành cho
tài khoản có quyền Host thật. Mở lại hoặc xem lại tour đã hoàn tất từ **Tour
hướng dẫn** trong Personal Hub, nút trên trang Guide, hay nút trợ giúp tại
từng khu vực.

Tour làm nổi bật thành phần thật trên trang, hỗ trợ bước trước/tiếp, tạm dừng,
bỏ qua, bàn phím và màn hình nhỏ. Việc chọn lĩnh vực trong tour thư viện là
thao tác điều hướng thực; tour không tự khởi chạy Research, lưu paper, sửa
license hay thực hiện thao tác quản trị. Tiến độ được lưu theo tài khoản qua
`GET /api/auth/onboarding` và `PUT /api/auth/onboarding/{tour_id}`, kèm bản sao
localStorage để tiếp tục khi mất kết nối. Đổi tài khoản không làm lẫn tiến độ.

Thiết kế giao diện dùng lớp `frontend/src/design.css` cho nhịp chữ, chiều sâu,
trạng thái hover/focus và chuyển trang thống nhất. Trang Tổng quan có thẻ mô tả
ba bước nghiên cứu ngay trong hero. Các hiệu ứng chỉ dùng CSS, không tải thêm
thư viện animation; tùy chọn hệ thống **Reduce motion** sẽ tắt các chuyển động
trang trí. Thanh điều hướng giữ nhãn ở màn hình desktop đủ rộng và thu gọn
thành biểu tượng khi không gian hạn chế.

Người dùng có thể tự sửa tên hiển thị, bio, địa điểm, trường/tổ chức, website
và tối đa tám lĩnh vực quan tâm. Các trường này được lưu theo tài khoản trong
SQLite qua `GET/PATCH /api/auth/profile`; email, avatar, role và license không
thể sửa từ form vì vẫn thuộc nhà cung cấp OAuth hoặc Host Console.

### Lĩnh vực nghiên cứu và scientific toolkit

Mục **Lĩnh vực** tạo một workspace riêng cho năm nhóm chuyên môn. Mỗi nhóm có
sáu category (tổng cộng 30 category), phương pháp phân tích, ưu tiên nguồn,
câu hỏi audit, bốn mẫu công thức và ba playbook có thể đưa thẳng sang Research:

- **Toán học:** đại số, giải tích, hình học & topology, xác suất & thống kê,
  toán ứng dụng và phương pháp số.
- **Vật lý:** cơ học, điện từ & quang học, lượng tử, nhiệt & thống kê, tương đối
  & thiên văn, vật chất ngưng tụ.
- **Hóa học:** hữu cơ, vô cơ, hóa lý, phân tích, vật liệu và hóa sinh.
- **Sinh học:** sinh học phân tử, tế bào, di truyền & genomics, sinh thái & tiến
  hóa, thần kinh học và công nghệ sinh học.
- **AI:** machine learning, deep learning, NLP/LLM/agent, computer vision,
  reinforcement learning, AI safety & evaluation.

Notebook, checklist và bản nháp LaTeX được tự động lưu riêng theo lĩnh vực
trong trình duyệt. Preview công thức dùng KaTeX (bao gồm cú pháp hóa học
`\\ce{...}`); người dùng có thể sao chép, đưa công thức vào note, tải file
`.tex` hoặc xuất note Markdown.

Khi chọn một playbook hoặc tạo brief riêng, giao diện chuyển sang **Nghiên cứu**
và đính kèm có chủ đích các trường `research_domain`, `research_category`,
`research_notes`, `latex_context` và `source_preferences`. Backend đưa phần này
vào brief, bước lập kế hoạch và các node evidence/report; note luôn được đánh
dấu là bối cảnh chưa kiểm chứng. Báo cáo hoàn tất ghi lại domain/category trong Methodology; Thư viện
có thể lọc và hiển thị metadata đó. Tên nguồn trong workspace là ưu tiên tìm
kiếm, không phải cam kết rằng mọi API nguồn đã được tích hợp.

### Thư viện học thuật theo lĩnh vực

**Library** mở ở trang chọn Mathematics, Physics, Chemistry, Biology hoặc
Artificial Intelligence. Mỗi lĩnh vực có danh mục arXiv phù hợp và bảy tạp chí
chuyên ngành được chọn (định danh bằng ISSN). **My research reports** là không gian
riêng cho báo cáo do agent tạo. Trong thư viện của một lĩnh vực, chọn
**Discover** để xem bản thảo arXiv mới nhất hoặc tìm theo từ khóa/chủ đề. Chọn
**Field journals** để xem bài mới của cả bảy tạp chí, chọn một tạp chí cụ thể,
hoặc nhập từ khóa để tìm chỉ trong nhóm đó. Truy vấn Crossref luôn bị giới hạn
bằng các ISSN thuộc lĩnh vực đang mở, không còn tìm toàn kho lẫn ngành. Danh sách phân trang,
chi tiết paper hiển thị tác giả, ngày công bố, abstract, DOI, nơi công bố và
liên kết tới bài gốc/PDF khi nguồn cung cấp. PDF luôn mở ở nguồn gốc; hệ thống
không tải hay lưu toàn văn có bản quyền.

Các tạp chí hiện được chọn theo từng lĩnh vực:

| Lĩnh vực | Tạp chí |
| --- | --- |
| Toán học | Annals of Mathematics; Journal of the AMS; SIAM Journal on Applied Mathematics; Inventiones mathematicae; Acta Mathematica; Duke Mathematical Journal; Journal of Differential Geometry |
| Vật lý | Physical Review Letters; Nature Physics; Physical Review X; Reviews of Modern Physics; Physical Review D; The Astrophysical Journal; Journal of High Energy Physics |
| Hóa học | Journal of the American Chemical Society; Nature Chemistry; Angewandte Chemie International Edition; Chemical Reviews; ACS Catalysis; Chemical Science; Organic Letters |
| Sinh học | Nature Genetics; The EMBO Journal; PLOS Biology; Cell; Molecular Cell; Genome Biology; eLife |
| AI | Nature Machine Intelligence; Journal of Machine Learning Research; IEEE TPAMI; Artificial Intelligence; Machine Learning; Neural Networks; Pattern Recognition |

Đây là bộ sưu tập tạp chí theo ngành, không phải toàn bộ bài báo đã xuất bản
trong ngành đó. Bài liên ngành vẫn có thể xuất hiện; kiểm tra nội dung và nơi
công bố của từng bài trước khi sử dụng làm bằng chứng.

Nhấn **Save paper** để thêm vào **My papers**. Sau đó có thể đánh dấu sao,
chuyển trạng thái *To read / Reading / Read / Archived*, viết ghi chú và xếp
paper vào nhiều **Collections** theo lĩnh vực. Có nút sao chép BibTeX và
**Research this paper** để tạo brief mới dựa trên bài đang chọn. Ghi chú,
trạng thái và bộ sưu tập lưu theo tài khoản trên backend; tìm kiếm bên ngoài
chỉ gửi từ khóa, mã chủ đề hoặc ISSN, không gửi ghi chú cá nhân. Một paper có
thể được lưu ở nhiều lĩnh vực nhưng dùng chung ghi chú/trạng thái đọc của tài
khoản.

Metadata được lấy trực tiếp từ [arXiv API](https://info.arxiv.org/help/api/)
và [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
Kết quả tìm kiếm được cache 1 giờ; arXiv được giới hạn nhịp gọi để tránh vượt
quá tải nguồn công khai. Không cần API key mới. Có thể đặt `SCHOLARLY_CONTACT_EMAIL`
trong `.env` bằng email liên hệ thật của người host để nhận diện khi gọi
Crossref. SQLite mặc định ở `data/paper-library.db`, đổi bằng
`PAPER_DATABASE_PATH`; cần backup tệp này cùng dữ liệu tài khoản khi chuyển
server. Phân loại arXiv hiện chỉ bao phủ một phần Hóa học; với mảng Hóa nên
ưu tiên tìm qua tạp chí Crossref. arXiv là preprint, không đồng nghĩa với bài
đã bình duyệt; danh sách tạp chí là lối tắt khám phá, không xác thực chất lượng
từng bài. Thông tin tạp chí/DOI cần kiểm tra ở trang gốc trước khi trích dẫn.

### Footer và Information Center

Footer xuất hiện trên toàn bộ workspace với lối tắt tới sản phẩm, hỗ trợ và
nhóm nội dung pháp lý. Các trang này dùng hash route nên có thể mở trực tiếp,
không cần backend route riêng và vẫn đọc được trước khi đăng nhập:

```text
/#/privacy       Chính sách quyền riêng tư
/#/terms         Điều khoản sử dụng
/#/security      Tiêu chuẩn và checklist bảo mật
/#/cookies       Cookie và localStorage đang sử dụng
/#/accessibility Cam kết khả năng truy cập
/#/help          Trung tâm trợ giúp
/#/changelog     Nhật ký thay đổi
/#/about         Giới thiệu sản phẩm
```

Guide và Pricing cũng có hash route riêng sau khi đăng nhập:

```text
/#/guide                 Trang hướng dẫn và mục lục 15 bài
/#/guide/quick-start     Deep link tới một bài cụ thể
/#/pricing               Free / Researcher Pro / Team
/#/profile               Hồ sơ và tiến độ nghiên cứu cá nhân
```

Giá hiển thị có thể cấu hình trong `frontend/.env`:

```env
VITE_PRO_MONTHLY_PRICE=149000
VITE_TEAM_MONTHLY_PRICE=499000
```

Trang Pricing hiện không tích hợp checkout, không lưu thẻ và không tự thu
tiền. Khi user chọn Pro/Team, lựa chọn chỉ được giữ trong localStorage; Host
phải gán license và ngày hết hạn ở Host Console. Nếu triển khai thương mại,
đơn vị vận hành cần tích hợp payment, hóa đơn, thuế, hoàn tiền và enforcement
quota riêng thay vì coi trang niêm yết là một giao dịch đã hoàn tất.

Nội dung mô tả đúng hành vi hiện tại của code, bao gồm danh mục cookie,
dịch vụ xử lý dữ liệu bên thứ ba, thời hạn phiên và các giới hạn của bản
self-hosted. Trước khi mở hệ thống cho người dùng bên ngoài, host phải thay
thông tin đơn vị vận hành, kênh liên hệ, thời hạn lưu trữ và điều khoản phù
hợp với khu vực pháp lý của mình. Đây là mẫu minh bạch sản phẩm, không thay
thế tư vấn pháp lý hoặc chứng nhận tuân thủ độc lập.

### Host Console và phân quyền

Thêm email của người vận hành vào `.env` (có thể khai báo nhiều email, phân
cách bằng dấu phẩy):

```env
ADMIN_EMAILS=your-google-email@gmail.com,your-github-email@example.com
AUTH_DATABASE_PATH=data/deep-research.db
```

Sau khi đăng nhập bằng Google hoặc GitHub, tài khoản có email nằm trong
`ADMIN_EMAILS` được gán vai trò **Host** và thấy mục **Host Console** trong
Personal Hub khi nhấn avatar (không nằm trên thanh điều hướng). Đây là danh sách
quyền duy nhất ở cả development và production; tài khoản Local Researcher cũng
chỉ là Member và không được vào Host Console nếu email của nó không có trong
danh sách.

Host Console có năm màn hình:

- **Tổng quan:** số thành viên, report, dung lượng lưu trữ, phiên nghiên cứu
  đang chạy, tình trạng OAuth/LLM và hoạt động gần đây.
- **Thành viên:** tìm kiếm theo tên/email, lọc theo provider, trạng thái và
  license; xem quyền được đồng bộ từ `ADMIN_EMAILS`; gán gói Free/Pro/Team và
  ngày hết hạn; tạm khóa hoặc khôi phục tài khoản. Hệ thống chặn Host tự khóa
  để tránh mất quyền quản trị.
- **Reports:** xem report của mọi tài khoản và xóa nội dung không còn cần thiết.
- **Hoạt động:** audit log cho đăng nhập, đăng xuất và mọi thao tác quản trị.
- **Hệ thống:** trạng thái backend, môi trường chạy, nhà cung cấp LLM, Google,
  GitHub và chế độ đăng nhập local. Secret/API key không được trả về giao diện.

Dữ liệu tài khoản, vai trò và audit log nằm trong SQLite tại
`AUTH_DATABASE_PATH`; thư mục `data/` mặc định đã được bỏ khỏi Git. Với tài
khoản Google/GitHub, `ADMIN_EMAILS` là danh sách quyền Host duy nhất: tài khoản
không còn nằm trong danh sách sẽ tự trở về Member. Quyền được kiểm tra lại ở
backend trên mỗi request, nên ẩn menu phía frontend không phải là lớp bảo vệ duy
nhất. Tài khoản bị tạm khóa sẽ bị đăng xuất ở request tiếp theo.

Sau khi đăng nhập thành công, web hiển thị một chuyển cảnh chào ngắn và mượt;
các mục trên thanh điều hướng cũng có chuyển động giữ ngữ cảnh. Thiết lập hệ
điều hành **Reduce motion** được tôn trọng và sẽ tắt các animation không cần thiết.

Thư viện không phụ thuộc bộ nhớ tạm của backend. Các API `GET /api/reports`,
`GET /api/reports/{filename}` và `DELETE /api/reports/{filename}` đọc trực
tiếp thư mục `reports/`, có kiểm tra đường dẫn để không truy cập ra ngoài thư
mục. Vì vậy lịch sử vẫn còn sau khi restart server hoặc refresh trình duyệt.

## Kiến trúc kỹ thuật

### Stack

| Lớp | Công nghệ chính | Vai trò |
|---|---|---|
| Agent | Python 3.11+, LangGraph, LangChain, Pydantic | State machine, node xử lý, model output có schema và điều phối vòng lặp/nhánh song song. |
| Model và tìm kiếm | Groq, Google Gemini hoặc OpenAI; Tavily; Wikipedia/arXiv ở graph CLI | Sinh kế hoạch/nội dung và tìm nguồn. Chọn provider/model bằng `.env`; tìm kiếm web cần `TAVILY_API_KEY`. |
| API | FastAPI, Uvicorn, REST, WebSocket | Đăng nhập, research, streaming tiến trình, tài liệu, notebook, cộng tác và chat. |
| Dữ liệu | SQLite, file cục bộ, Yjs/pycrdt | Tài khoản, thư viện, hội thoại, tài liệu, report và nội dung notebook. |
| Web | React 18, TypeScript, Vite, BlockNote, Yjs, KaTeX | Giao diện nghiên cứu, editor khối cộng tác, công thức và report. |
| Triển khai | Docker; Cloudflare Workers cho frontend tĩnh; Render được mô tả như preview | Worker chỉ phục vụ frontend và proxy API; nó không chạy Python/FastAPI. |

### Bản đồ mã nguồn

```text
agent/
  deep_research.py       graph evidence-first được backend web sử dụng
  graph.py               graph analyst/interview dùng bởi CLI và langgraph.json
  nodes.py, prompts.py   node/prompt của graph analyst-interview
  state.py               state TypedDict và Pydantic schemas
  model_output.py        chuẩn hóa/kiểm tra output LLM và citation
  documents.py           đọc/cache tài liệu, PDF và trích xuất text
  research_contract.py   schema brief, report, evidence, visual và ngân sách
backend/
  main.py                FastAPI, REST, WebSocket và khởi tạo dịch vụ
  auth.py, accounts.py   session, password, OAuth, profile và vai trò
  collaboration.py       nhóm/dự án/notebook và đồng bộ Yjs
  paper_library.py       paper/collection; research_chat*.py lưu chat/job
frontend/
  src/                   React/TypeScript UI và mô hình phía client
  vite.config.ts         dev server cùng proxy REST/WebSocket đến API
main.py                  CLI cho graph analyst/interview
langgraph.json           đăng ký graph analyst/interview cho `langgraph dev`
run-app.ps1              launcher backend + Vite trên Windows
docs/                    hướng dẫn tính năng và deployment chi tiết
tests/                   kiểm tra backend, agent và frontend
```

### Tài liệu theo chủ đề

- [Evidence-first research, report và LaTeX/PDF](docs/evidence-first-research.md)
- [Research Chat và cấu hình OpenCode worker](docs/research-chat-opencode.md)
- [OpenCode Direct thử nghiệm local](docs/research-opencode-direct.md)
- [Tạo và xuất research visual](docs/research-visual-explorer.md)
- [Nhóm, dự án, thảo luận và meeting](docs/research-discussions.md)
- [Research Notebook và project workspace](docs/project-workspaces.md)
- [Workspace theo lĩnh vực](docs/field-workspaces.md)
- [Ảnh và URL trong notebook](docs/notebook-media.md)
- [Friends và thông báo](docs/notifications-and-friends.md)
- [Triển khai backend preview trên Render](docs/render-deploy.md)

Build frontend từ root repository bằng:

```bash
npm run build
```

Script root cài đúng lockfile trong `frontend/`, chạy TypeScript check và Vite
build; output nằm tại `frontend/dist/`. Đây là build frontend, không đóng gói
Python backend. Dockerfile cài hai bộ requirements Python và khởi chạy FastAPI.

### Hai LangGraph riêng trong repository

Web app và CLI/Studio hiện không gọi chung một graph. Chúng giải quyết hai
kiểu research khác nhau; khi sửa luồng cần kiểm tra đúng entry point.

#### 1. Graph evidence-first của web app

`backend/main.py` import `graph` và `batch_graph` từ
`agent/deep_research.py`. REST research và WebSocket `/ws/research` chạy graph
này. Trình tự chính:

```text
understand_brief
  → collect_evidence
  → assess_coverage ── còn thiếu bằng chứng và còn ngân sách → collect_evidence
          └────────── đủ/đã chạm giới hạn ─────────────────→ draft_report
  → generate_visuals → audit_evidence → improve_report
  → human_review_section → apply_editorial_feedback → finalize_report
```

- `understand_brief` chuẩn hóa ngôn ngữ, lĩnh vực, mode và ngân sách; model
  tạo objective, câu hỏi và truy vấn tìm kiếm. Nếu LLM lỗi, có brief dự phòng
  để graph không tự bịa kết quả tìm kiếm.
- `collect_evidence` tìm bằng Tavily, đọc tài liệu qua `DocumentStore`, dùng
  cache theo chủ sở hữu và chọn đoạn văn bản trong ngân sách. Upload paper/PDF
  có thể làm nguồn chính. Không coi search snippet là nội dung tài liệu đã đọc.
- `assess_coverage` đánh giá từng câu hỏi bằng evidence đã trích; nếu còn
  thiếu, graph có thể đọc thêm đoạn hoặc tìm tiếp đến khi đủ coverage/quota.
- `draft_report`, `generate_visuals`, `audit_evidence` và `improve_report`
  tạo report theo schema, kiểm chứng citation/visual và sửa điểm yếu trong
  giới hạn lượt gọi.
- `human_review_section` là điểm dừng để người dùng phản hồi; backend tiếp tục
  graph bằng checkpoint sau khi nhận feedback. `finalize_report` lưu report và
  metadata nguồn.

Graph này có ngân sách rõ cho LLM calls, search, document reads, token ước
tính, thời gian và output. Các con số token là ước tính cho quản lý budget,
không phải hóa đơn provider hay cam kết giá.

#### 2. Graph analyst-interview của CLI và LangGraph Studio

`main.py` import graph từ `agent/graph.py`. Cấu hình `langgraph.json` cũng
đăng ký `./agent/graph.py:graph`; vì vậy `langgraph dev` mở graph này chứ
không phải graph web evidence-first.

```text
load_research_profile → plan_research → create_analysts → human_feedback
  → Send() cho từng analyst
      → conduct_interview (subgraph)
          → hỏi → sinh queries → Tavily + Wikipedia/arXiv song song
          → lọc/đánh giá evidence → trả lời/lặp → viết section
  → human_review_section
  → write_report + write_introduction + write_conclusion song song
  → finalize_report → audit_report → save_research_profile
```

Các kỹ thuật LangGraph chính trong graph này:

1. **State có schema:** `agent/state.py` định nghĩa state bằng `TypedDict`,
   các payload cấu trúc dùng Pydantic. Mỗi node nhận state hiện tại và trả
   về dictionary chỉ chứa các trường cần cập nhật.
2. **Edges và routing:** `START`/`END`, `add_edge` và
   `add_conditional_edges` xác định luồng tuần tự hoặc nhánh/loop. Router
   quyết định feedback có cần sinh lại analyst hay interview đã đủ vòng.
3. **Fan-out/map-reduce:** `initiate_all_interviews` trả về `Send()` runtime
   cho từng analyst; số nhánh được quyết định từ state, không cần biết lúc
   định nghĩa graph. Kết quả `sections` và `sources` được gộp bằng reducer
   `Annotated[..., operator.add]`.
4. **Subgraph:** `interview_builder` là graph đầy đủ cho một interview,
   compile riêng rồi được gọi bởi node `conduct_interview` trong graph cha.
5. **Nhánh song song:** search web và nguồn thứ hai cùng chạy sau bước tạo
   queries; ba phần report/introduction/conclusion cũng được tạo song song,
   rồi join tại `finalize_report`.
6. **Human-in-the-loop:** graph interactive compile với
   `interrupt_before=["human_feedback", "human_review_section"]`. CLI đọc
   checkpoint, gọi `update_state()` và resume bằng input `None`; web graph có
   điểm review riêng và backend tiếp tục sau khi người dùng gửi phản hồi.

Một khung tối giản khi thêm node vào LangGraph:

```python
from typing import Annotated, TypedDict
import operator
from langgraph.graph import END, START, StateGraph

class State(TypedDict):
    topic: str
    trace: Annotated[list[str], operator.add]

def inspect_topic(state: State) -> dict:
    return {"trace": [f"đã nhận: {state['topic']}"]}

builder = StateGraph(State)
builder.add_node("inspect_topic", inspect_topic)
builder.add_edge(START, "inspect_topic")
builder.add_edge("inspect_topic", END)
graph = builder.compile()
```

Trong project thực tế, cần thêm schema cho state mới, cài node bằng
`add_node`, nối edge/router, xác định reducer nếu nhiều nhánh ghi cùng một
field, rồi cập nhật caller tương ứng (CLI, web hoặc Studio). Chỉ khai báo node
trong file chưa làm node chạy nếu không nối nó vào graph.

### Các vấn đề kỹ thuật đã xử lý

- **Concurrent update khi fan-out:** các `Send()` interview cùng kế thừa state
  có nhiều field scalar như `topic`. Nếu mỗi nhánh trả toàn bộ state về graph
  cha, LangGraph báo xung đột concurrent update vì không có reducer cho scalar.
  `conduct_interview` hiện là adapter: giữ state đầy đủ bên trong subgraph,
  chỉ trả `sections`/`sources` có reducer về parent graph.
- **Gộp dữ liệu song song:** state fields được nhiều node ghi cần reducer như
  `operator.add`; field đơn trị nên có một writer hoặc phải có quy tắc merge
  tường minh. Nếu thêm nhánh mới, kiểm tra `Annotated` trong `agent/state.py`.
- **Output LLM không ổn định:** `agent/model_output.py` và các Pydantic
  contract kiểm tra cấu trúc/quote trước khi đưa vào report. Provider khác nhau
  có thể trả content blocks hoặc structured output hơi khác, nên adapter LLM
  được khởi tạo lazy và cần thử với provider/model thực tế.
- **Citation và nội dung không đáng tin:** report dùng đoạn trích chính xác
  được đọc từ tài liệu; nội dung web/PDF được coi là dữ liệu, không phải chỉ
  thị cho agent. Citation được kiểm tra lại trước khi render; kết quả vẫn cần
  người đọc đánh giá chất lượng và ngữ cảnh nguồn.
- **Dừng graph để review:** CLI dùng checkpoint để chờ input. Checkpointer và
  store hiện tại là `MemorySaver`/`InMemoryStore` trong RAM, không phải lưu
  checkpoint bền vững. Khởi động lại process sẽ mất state đang dở và research
  profile của graph CLI.
- **Dev proxy và WebSocket:** khi chạy local, truy cập qua Vite ở port 5173;
  `frontend/vite.config.ts` chuyển `/api`, `/ws`, `/health` sang port 8000.
  Nếu đổi proxy/reverse proxy, phải cho phép WebSocket upgrade và gửi cookie
  credentials đúng origin.
- **Database và cộng tác:** SQLite + một backend host là cấu hình mục tiêu
  hiện tại. Dữ liệu Yjs ghi thành log cập nhật append-only, chưa tự compact;
  theo dõi dung lượng DB và không sửa log bằng tay. Bản version notebook là
  checkpoint nội dung thủ công, không phải backup đầy đủ của app.

### LangGraph Studio

Sau khi cài requirements và cấu hình `.env`, từ root chạy:

```bash
langgraph dev
```

Mở URL Studio/API mà CLI in ra. Graph Studio dùng mapping trong
`langgraph.json` (graph analyst/interview), thích hợp để xem node, state,
interrupt, loop và `Send()` fan-out. `langgraph dev` chỉ phục vụ graph agent;
nó không khởi chạy FastAPI, React app hay các API đăng nhập/cộng tác.

Trong `agent/nodes.py`, graph interview có thể đổi `SECOND_SOURCE` giữa
`"wikipedia"` (mặc định) và `"arxiv"`. Gói `arxiv` và `pymupdf` đã được khai
báo trong `requirements.txt`.

## Kiểm tra và build

Các lệnh sau chạy trong máy developer; một số integration/browser checks có
thể cần API key, server hoặc trình duyệt riêng:

```bash
python -m pytest tests/ -v
npm --prefix frontend run build
```

Python tests nằm trong `tests/`; frontend có các test Node/browser trong
`frontend/tests/` và script `test:*` trong `frontend/package.json`. Build
frontend chạy TypeScript check trước khi tạo `frontend/dist/`. Graph compile
không cần gọi provider, nhưng chạy research thật cần API key/model hợp lệ và
quota còn dùng được.

## Vận hành, bảo mật và giới hạn hiện tại

- **Không phải deployment multi-host:** session registry, một số rate limit,
  graph checkpoint và `InMemoryStore` nằm trong RAM của process. SQLite lock
  và Yjs synchronization hiện giả định một backend host; không scale nhiều
  replica sau load balancer khi chưa chuyển session/checkpoint/database sang
  dịch vụ dùng chung.
- **Lưu trữ bền vững:** giữ `data/`, `reports/`, secrets cần thiết và file
  uploads khi chuyển máy. Render Free có filesystem ephemeral; xem
  [hướng dẫn Render](docs/render-deploy.md) trước khi dùng. Snapshot GitHub/R2
  là tùy chọn trong `.env.example`, cần cấu hình credential và kiểm tra backup
  restore thực tế.
- **Bảo vệ production:** đặt `APP_ENV=production`,
  `AUTH_DEV_LOGIN=false`, secret ngẫu nhiên riêng cho `AUTH_SESSION_SECRET`,
  `AUTH_COOKIE_SECURE=true`, HTTPS/WSS, `FRONTEND_URL`, `BACKEND_URL` và
  `CORS_ORIGINS` đúng domain. Không public `.env`, OAuth/API keys, token hay
  database có dữ liệu người dùng. Đặt `ADMIN_EMAILS` tối thiểu cần thiết.
- **Quên mật khẩu:** luồng đặt lại hiện ghi link chứa token vào log backend;
  repository chưa nối dịch vụ gửi email. Token chỉ trả về response ở môi
  trường không production, vì vậy người dùng production chưa nhận được email
  khôi phục. Trước khi mở đăng ký cộng đồng, cần tích hợp mail provider hoặc
  quy trình khôi phục an toàn khác; hạn chế quyền truy cập log trong lúc đó.
- **Tác vụ PDF:** bộ trích xuất làm việc trên text; PDF scan/ảnh không tự được
  OCR. Bảng, công thức và nhãn hình có thể cần đối chiếu PDF gốc.
- **Tự host là tự vận hành:** chủ host chịu trách nhiệm chính sách lưu/xóa dữ
  liệu, sao lưu, điều khoản, thông tin liên hệ, monitoring và việc dùng API
  provider. Trang giá trong app chỉ là hiển thị, không phải hệ thống thanh
  toán hay xác nhận license.

## Sự cố thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| `No API key found for LLM_PROVIDER` | Kiểm tra tên `LLM_PROVIDER`, key đúng provider và `.env` ở root; dừng rồi chạy lại backend sau khi sửa. |
| `Search not configured` hoặc research không có nguồn mới | Điền `TAVILY_API_KEY`. Kiểm tra quyền/quota Tavily và truy cập Internet của backend. |
| `ModuleNotFoundError` khi chạy Python | Kích hoạt `.venv`, rồi cài lại cả `requirements.txt` và `backend/requirements.txt` bằng đúng Python trong môi trường đó. |
| npm báo thiếu package hoặc lỗi Vite | Cài Node.js/npm, chạy `npm --prefix frontend ci` từ root. |
| Cổng 8000/5173 đang được dùng | Dừng instance Nexora cũ. `run-app.ps1 -CheckOnly` chỉ kiểm tra launcher trên Windows; nếu cổng thuộc app khác, đổi cổng/proxy đồng thời thay vì kill tiến trình không rõ chủ sở hữu. |
| Trang mở nhưng API báo lỗi / WebSocket không kết nối | Dùng `http://127.0.0.1:5173`, kiểm tra backend `/health`, và giữ nguyên proxy trong `frontend/vite.config.ts`; reverse proxy phải hỗ trợ WebSocket. |
| OAuth quay lại lỗi redirect/CORS/cookie | Callback URL phải khớp tuyệt đối với provider; kiểm tra `FRONTEND_URL`, `BACKEND_URL`, `CORS_ORIGINS` và HTTPS/cookie flags theo môi trường. Local có thể dùng tài khoản development thay OAuth. |
| Dữ liệu biến mất sau khi thay container/redeploy | Xác nhận DB và reports nằm trên persistent disk/bind mount; Render Free không đảm bảo filesystem bền vững. Khôi phục từ bản backup đã kiểm tra. |
| LangGraph Studio không hiện web graph | `langgraph.json` hiện đăng ký `agent/graph.py:graph`; API/web app dùng `agent/deep_research.py`. Chạy backend + Vite để xem sản phẩm web. |
