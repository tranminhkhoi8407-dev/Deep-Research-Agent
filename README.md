# Nexora Agent

Trợ lý nghiên cứu đa tác nhân: cho 1 chủ đề, hệ thống tự sinh N "analyst" với
góc nhìn khác nhau, mỗi analyst chạy song song phỏng vấn 1 "expert" ảo (search
+ tổng hợp), rồi gộp lại thành 1 báo cáo markdown hoàn chỉnh.

Xây trên [research-assistant.ipynb](https://github.com/langchain-ai/langchain-academy)
(module-4, LangChain Academy) — nhưng đóng gói thành 1 CLI dùng được hàng
ngày thay vì chạy 1 lần trong notebook.

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
Khi triển khai production cần HTTPS/WSS, `AUTH_SESSION_SECRET` mạnh,
`AUTH_COOKIE_SECURE=true`, `CORS_ORIGINS` chính xác, backup định kỳ và quy định
giữ/xóa dữ liệu của host. Thiết kế hiện tại phù hợp một host SQLite với số
người cùng sửa vừa phải; chưa phải dịch vụ cộng tác phân tán quy mô lớn.
Log Yjs đang append-only, chưa có cơ chế compact tự động; host cần theo dõi
kích thước database. Không sửa/xóa log thủ công vì có thể làm mất khả năng
khôi phục tài liệu. Các mốc phiên bản là bản lưu thủ công, không phải backup
toàn hệ thống. Khi phục hồi mốc, nội dung hiện tại được lưu một mốc trước đó.

## Cấu trúc project

```
deep-research-agent/
├── agent/
│   ├── __init__.py
│   ├── state.py       # TypedDict/Pydantic schemas: Analyst, InterviewState, ResearchGraphState
│   ├── prompts.py      # Toàn bộ prompt template, tách riêng để dễ tune
│   ├── nodes.py        # Node functions: create_analysts, search_web, generate_answer...
│   └── graph.py        # Ráp graph, export `graph` cho langgraph dev / main.py
├── tests/
│   └── test_graph.py   # Smoke test: graph compile đúng, không cần API key
├── backend/             # FastAPI + WebSocket stream tiến trình
├── frontend/            # Web app React/Vite
├── reports/            # Output .md sinh ra khi chạy (gitignored)
├── main.py             # CLI entry point
├── run-app.ps1         # Chạy backend + web app bằng một lệnh trên Windows
├── requirements.txt
├── langgraph.json       # Cho phép mở LangGraph Studio local (`langgraph dev`)
├── pyproject.toml
├── .env.example
└── README.md
```

## Cài đặt

```bash
cd deep-research-agent
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

python -m pip install -r requirements.txt -r backend/requirements.txt

cp .env.example .env
# Chọn LLM_PROVIDER, điền key LLM tương ứng và TAVILY_API_KEY thật vào .env
```

PowerShell trên Windows:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -r backend\requirements.txt
Copy-Item .env.example .env
```

Cần 2 API key:
- **Một LLM provider** — đặt `LLM_PROVIDER=groq`, `gemini`, hoặc `openai`,
  rồi điền key tương ứng. Có thể đổi model bằng `GROQ_MODEL`, `GEMINI_MODEL`,
  hoặc `OPENAI_MODEL`.
- **Tavily** — [tavily.com](https://tavily.com), free tier đủ dùng để research
  hàng ngày.

## Chạy

```bash
python main.py "So sánh RAG vs fine-tuning cho chatbot domain-specific tiếng Việt" --max-analysts 2 --depth deep
```

Lệnh trên dừng hai lần để review analyst và section. Muốn chạy thẳng để kiểm
tra nhanh hoặc dùng trong automation:

```bash
python main.py "RAG là gì?" --max-analysts 1 --depth quick --no-interrupt
```

Report sẽ được ghi vào `reports/<timestamp>-<topic>.md`.

Ba mức độ sâu:

| Chế độ | Vòng/analyst | Truy vấn web/vòng | Mục đích |
|---|---:|---:|---|
| `quick` | 1 | 1 | Kiểm tra nhanh, tiết kiệm quota |
| `standard` | 1 | 2 | Báo cáo cân bằng giữa chiều sâu và chi phí |
| `deep` | 2 | 3 | Nhiều góc nhìn, kiểm tra khoảng trống và audit report |

Chi phí tăng theo số analyst và độ sâu. Một phiên `deep` với 2 analyst có
thể thực hiện khoảng 20-30 lượt LLM và 12 truy vấn Tavily. Con số thực tế có
thể thấp hơn khi một bước dùng kết quả dự phòng hoặc nguồn bị trùng.

### Chạy API

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

Kiểm tra tại `http://localhost:8000/health`, tài liệu API tại
`http://localhost:8000/docs`.

Hoặc dùng Docker (cần mở Docker Desktop trước):

```bash
docker compose up --build api
```

### Chạy web app

Trên Windows, chạy một lệnh tại thư mục project:

```powershell
.\run-app.ps1
```

Script sẽ tự bật backend, cài thư viện frontend ở lần chạy đầu và mở web tại
`http://127.0.0.1:5173`. Nhấn `Ctrl+C` tại cửa sổ PowerShell để dừng cả hai.

Nếu muốn chạy từng phần để debug, mở hai cửa sổ terminal:

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000

# Terminal 2
npm --prefix frontend install
npm --prefix frontend run dev
```

Trong web app, nhập bất kỳ chủ đề đủ cụ thể, chọn **Nhanh / Tiêu chuẩn /
Chuyên sâu**, chọn số analyst rồi bấm **Bắt đầu nghiên cứu**. Bật **Tự động
duyệt** để chạy thẳng; tắt nó nếu muốn xem và góp ý cho nhóm analyst/các
section trước khi hệ thống viết report.

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

### Đăng nhập Google / GitHub

Web app có trang đăng nhập riêng. Sau khi đăng nhập, header hiển thị avatar,
tên tài khoản và menu đăng xuất; nhãn trạng thái backend không còn nằm trên
header (trạng thái hệ thống vẫn xem được ở **Cài đặt**). API report, REST
research và WebSocket đều yêu cầu session hợp lệ. Token của Google/GitHub chỉ
được dùng trong callback để đọc hồ sơ cơ bản, không được lưu vào cookie hay ổ
đĩa; cookie session được ký và đặt HTTP-only. Thư viện của mỗi tài khoản OAuth
được lưu trong thư mục riêng theo mã băm của user ID, vì vậy tài khoản này
không thể đọc report của tài khoản khác. Tài khoản development tiếp tục dùng
thư mục `reports/` gốc để giữ nguyên lịch sử local hiện có.

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

Chế độ **Chuyên sâu** không chỉ yêu cầu model viết dài hơn. Hệ thống sẽ lập
kế hoạch nghiên cứu, tách câu hỏi chính, tạo nhiều truy vấn tìm kiếm khác
nhau, loại nguồn trùng, chấm chất lượng và dùng một lượt LLM riêng để loại
nguồn SEO/lạc đề trước khi trả lời. Sau đó hệ thống chạy hai vòng phỏng vấn
cho mỗi analyst, chỉ ra thiếu hụt bằng chứng, rồi audit lại toàn bộ report. Citation
ID và danh mục nguồn cuối cùng được dựng từ URL hệ thống thực sự đã truy xuất,
không cho model tự bịa nguồn.

Nút **VIE / ENG** trên thanh đầu trang đổi toàn bộ giao diện và đồng thời đặt
ngôn ngữ đầu ra cho analyst, phần tổng hợp và report cuối cùng. Lựa chọn được
lưu trên trình duyệt cho lần mở sau.

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
Host, không nằm trên thanh điều hướng. Cài đặt lưu mặc định ngôn ngữ, depth, số
analyst và auto-approve; Hướng dẫn có 15 bài và tiến độ đọc; Bảng giá trình bày
license Free/Researcher Pro/Team. Host Console quản lý thành viên, report,
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
vào bước lập kế hoạch và từng analyst nhưng luôn đánh dấu note là bối cảnh chưa
kiểm chứng. Báo cáo hoàn tất ghi lại domain/category trong Methodology; Thư viện
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

### Chạy qua LangGraph Studio (xem graph trực quan)

```bash
langgraph dev
```

Mở link Studio hiện ra trong terminal — bạn sẽ thấy graph chạy real-time,
node nào đang active, state tại từng bước. Hữu ích để debug interview loop
hoặc hiểu rõ Send() fan-out ra sao trước khi đọc code.

## Test

```bash
pytest tests/ -v
```

Test không gọi LLM thật (chỉ kiểm tra graph compile + schema đúng), nên
chạy được kể cả không có API key thật trong `.env`.

## Đổi nguồn search thứ 2 (Wikipedia ↔ arXiv)

Trong `agent/nodes.py`, đổi biến `SECOND_SOURCE`:

```python
SECOND_SOURCE = "arxiv"      # cho chủ đề kỹ thuật/học thuật (paper, model, thuật toán)
SECOND_SOURCE = "wikipedia"  # cho chủ đề phổ thông hơn (mặc định)
```

Cần `pip install arxiv pymupdf` nếu chưa cài (đã có sẵn trong
`requirements.txt`).

---

## Kiến trúc hiện tại

```
topic + research_depth + max_analysts
   → plan_research (mục tiêu, câu hỏi chính, tiêu chí hoàn thành)
   → create_analysts (LLM sinh N Analyst persona theo research plan)
   → human_feedback (no-op node — v1 luôn "approve" ngay, xem v2 bên dưới)
   → initiate_all_interviews (Send × N)
         → N × conduct_interview
               → hỏi → sinh bộ query đa dạng
               → search song song Tavily + Wikipedia/arXiv
               → khử trùng + chấm nguồn + đánh giá độ đủ bằng chứng
               → expert trả lời bằng citation ID thật
               → lặp theo depth → viết evidence memo
               → mỗi interview trả về 1 "section"
   → sections (gộp đủ N section nhờ operator.add)
       ├→ write_report ─┐
       ├→ write_introduction ─┼→ finalize_report → final_report
       └→ write_conclusion ─┘
   → audit_report (deep: skeptical edit; mọi mode: khóa citation/bibliography)
```

3 kỹ thuật LangGraph lồng nhau trong 1 lần chạy:
- **Parallelization** (`add_edge(A, [B,C])`) — search_web + search_second_source
  chạy song song trong mỗi interview.
- **Sub-graph** — `conduct_interview` là 1 graph hoàn chỉnh (`interview_builder`)
  được compile rồi dùng làm 1 node trong graph cha.
- **Map-reduce** (`Send`) — số lượng interview song song = số analyst,
  không biết trước lúc code, quyết định lúc runtime.

---

## Roadmap

### v2 — Human-in-the-loop (module-3)

**Mục tiêu:** dừng graph trước khi chốt danh sách analyst để sửa/thêm góc
nhìn, và dừng lần 2 trước khi publish để review từng section.

**Việc cần làm trong `agent/graph.py`:**

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
graph = builder.compile(
    interrupt_before=["human_feedback"],
    checkpointer=memory,
)
```

**Việc cần làm trong `main.py`** (đổi từ `graph.invoke()` 1 lần thành vòng
lặp resume):

```python
thread = {"configurable": {"thread_id": "1"}}

# Chạy đến khi gặp interrupt đầu tiên
for event in graph.stream(initial_state, thread, stream_mode="values"):
    pass

# In danh sách analyst hiện tại cho user xem
state = graph.get_state(thread)
for analyst in state.values["analysts"]:
    print(analyst.persona)

feedback = input("Feedback (Enter để approve, hoặc gõ góp ý): ")
graph.update_state(
    thread,
    {"human_analyst_feedback": feedback or "approve"},
    as_node="human_feedback",
)

# Resume — nếu feedback không rỗng, graph tự quay lại create_analysts
# (logic này đã có sẵn trong initiate_all_interviews ở agent/nodes.py)
for event in graph.stream(None, thread, stream_mode="values"):
    pass
```

Điểm mấu chốt (xem `langchain-academy/module-3/module-3-giai-thich.md` phần
2-3 để hiểu sâu hơn): `graph.stream(None, thread, ...)` — truyền `None` nghĩa
là "tiếp tục từ checkpoint", không phải "chạy lại từ đầu". `as_node="human_feedback"`
báo cho LangGraph biết update này đến từ đúng node placeholder đó.

**Interrupt lần 2** (review từng section trước khi gộp): thêm 1 node
`human_review_section` tương tự pattern trên, đặt giữa `conduct_interview`
và `write_report`.

**Time travel** (không bắt buộc, nhưng hữu ích): nếu muốn so sánh 2 phiên
bản report khi đổi câu hỏi gốc, dùng `graph.get_state_history(thread)` để
lấy lại checkpoint cũ rồi fork — xem `module-3/time-travel.ipynb`.

### v3 — Long-term memory (module-5)

**Mục tiêu:** `InMemoryStore` theo `user_id` lưu các topic đã research để
tránh lặp tìm kiếm cũ; Trustcall duy trì 1 "research profile" (nguồn ưu
tiên, độ sâu mong muốn) — càng dùng càng cá nhân hoá.

**File mới: `agent/memory.py`:**

```python
from trustcall import create_extractor
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

model = ChatOpenAI(model="gpt-4o", temperature=0)

class ResearchProfile(BaseModel):
    """Sở thích research của user, học dần qua các lần dùng."""
    preferred_sources: list[str] = Field(
        default_factory=list,
        description="Nguồn user hay yêu cầu ưu tiên, vd: arxiv, tiếng Việt only",
    )
    preferred_depth: str = Field(
        default="balanced",
        description="'quick' | 'balanced' | 'deep' — độ sâu report user thường muốn",
    )
    past_topics: list[str] = Field(
        default_factory=list, description="Các topic đã research trước đây"
    )

profile_extractor = create_extractor(
    model, tools=[ResearchProfile], tool_choice="ResearchProfile"
)
```

**Đổi trong `agent/graph.py`** — compile với cả checkpointer (v2) lẫn store
(v3) cùng lúc, đúng pattern `module-5/studio/memory_store.py`:

```python
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()
graph = builder.compile(
    interrupt_before=["human_feedback"],
    checkpointer=memory,
    store=store,
)
```

**Node mới** (đặt trước `create_analysts`, đọc profile để đưa vào system
prompt) — cần thêm tham số `store: BaseStore` vào chữ ký hàm, LangGraph sẽ
tự inject:

```python
from langgraph.store.base import BaseStore

def load_research_profile(state: ResearchGraphState, config, store: BaseStore) -> dict:
    user_id = config["configurable"]["user_id"]
    namespace = ("research_profile", user_id)
    existing = store.search(namespace)
    profile = existing[0].value if existing else {}
    # profile giờ có thể format vào ANALYST_INSTRUCTIONS để analyst
    # được sinh ra có tính đến sở thích nguồn/độ sâu của user
    return {}  # (tuỳ bạn thiết kế state field để lưu profile này)
```

Xem `langchain-academy/module-5/module-5-giai-thich.md` mục 3-4 để hiểu
`enable_inserts=True` (Trustcall vừa update vừa insert entry mới trong 1
lần gọi) — áp dụng khi muốn `past_topics` tự động lớn dần mà không cần bạn
tự viết logic "cái nào cũ cái nào mới".

### v4 — Deploy thành sản phẩm thật (module-6)

**Mục tiêu:** bọc `graph.astream()` vào 1 FastAPI endpoint, frontend
React/TS stream tiến trình real-time — áp lại pattern WebSocket gateway đã
build ở Code for Glory, show "Analyst kỹ thuật đang tìm kiếm..." live thay
vì đợi cả report chạy xong.

**Thư mục mới: `backend/` (FastAPI, tách khỏi `agent/` core logic):**

```
backend/
├── main.py           # FastAPI app + WebSocket endpoint
├── schemas.py         # Pydantic request/response models cho API
└── requirements.txt   # fastapi, uvicorn, websockets
```

**`backend/main.py` — khung sườn WebSocket streaming:**

```python
from fastapi import FastAPI, WebSocket
from agent.graph import graph

app = FastAPI()

@app.websocket("/ws/research")
async def research_ws(websocket: WebSocket):
    await websocket.accept()
    payload = await websocket.receive_json()
    thread = {"configurable": {"thread_id": payload["session_id"], "user_id": payload["user_id"]}}

    initial_state = {
        "topic": payload["topic"],
        "max_analysts": payload.get("max_analysts", 3),
        "human_analyst_feedback": "approve",
    }

    # stream_mode="updates" trả về đúng phần THAY ĐỔI sau mỗi node —
    # đúng cái cần để show "node X vừa chạy xong" live, không cần gửi
    # nguyên state to mỗi lần (xem module-3-giai-thich.md mục 1)
    async for chunk in graph.astream(initial_state, thread, stream_mode="updates"):
        node_name = list(chunk.keys())[0]
        await websocket.send_json({"event": "node_complete", "node": node_name})

    await websocket.send_json({"event": "done"})
    await websocket.close()
```

**Frontend** (`agent/` không đổi, chỉ thêm phần connect WebSocket vào React
component có sẵn) — pattern giống hệt notification gateway ở Code for Glory:
1 `useEffect` mở `WebSocket`, `onmessage` cập nhật state hiển thị
"Analyst {name} đang tìm kiếm..." theo từng `node_complete` event nhận
được, thay vì chờ 1 response HTTP duy nhất.

**`langgraph.json` cho deployment** (khác file dev hiện tại — theo đúng
pattern `module-6/deployment/langgraph.json`):

```json
{
  "dockerfile_lines": [],
  "graphs": {
    "deep_research_agent": "./agent/graph.py:graph"
  },
  "python_version": "3.11",
  "dependencies": ["."]
}
```

(Bỏ `"env": "./.env"` khi deploy thật — dùng biến môi trường của platform
deploy thay vì file `.env` local.)

---

## Lưu ý

- `langchain_community.document_loaders` (dùng cho `ArxivLoader`,
  `WikipediaLoader`) đang trong lộ trình deprecate dài hạn của LangChain
  (chưa có standalone package thay thế ổn định cho cả 2 loader này tại thời
  điểm viết README) — vẫn hoạt động bình thường, chỉ là 1 deprecation
  warning khi import, không phải lỗi.
- Model mặc định `gpt-4o` khá tốn token khi `max_analysts` lớn (mỗi analyst
  = 1 interview với nhiều lượt LLM call). Cân nhắc `gpt-4o-mini` khi test
  nhanh, đổi lại `gpt-4o` cho report thật muốn chất lượng cao.
