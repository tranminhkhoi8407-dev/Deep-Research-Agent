# Deep Research Agent

Trợ lý nghiên cứu đa tác nhân: cho 1 chủ đề, hệ thống tự sinh N "analyst" với
góc nhìn khác nhau, mỗi analyst chạy song song phỏng vấn 1 "expert" ảo (search
+ tổng hợp), rồi gộp lại thành 1 báo cáo markdown hoàn chỉnh.

Xây trên [research-assistant.ipynb](https://github.com/langchain-ai/langchain-academy)
(module-4, LangChain Academy) — nhưng đóng gói thành 1 CLI dùng được hàng
ngày thay vì chạy 1 lần trong notebook.

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
├── reports/            # Output .md sinh ra khi chạy (gitignored)
├── main.py             # CLI entry point
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

pip install -r requirements.txt

cp .env.example .env
# Điền OPENAI_API_KEY và TAVILY_API_KEY thật vào .env
```

Cần 2 API key:
- **OpenAI** — model mặc định là `gpt-4o` (đổi ở đầu `agent/nodes.py` nếu muốn
  dùng `gpt-4o-mini` cho rẻ hơn khi research nhiều topic).
- **Tavily** — [tavily.com](https://tavily.com), free tier đủ dùng để research
  hàng ngày.

## Chạy

```bash
python main.py "So sánh RAG vs fine-tuning cho chatbot domain-specific tiếng Việt" --max-analysts 3
```

Report sẽ được ghi vào `reports/<timestamp>-<topic>.md`. Mỗi lần chạy tốn
khoảng N×(2-4) lượt LLM call (N = số analyst) cộng với N×2 lượt search —
với `max-analysts 3` là khoảng 15-20 LLM call, vài chục giây đến vài phút
tuỳ topic.

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

## Kiến trúc v1 (hiện tại)

```
topic + max_analysts
   → create_analysts (LLM sinh N Analyst persona)
   → human_feedback (no-op node — v1 luôn "approve" ngay, xem v2 bên dưới)
   → initiate_all_interviews (Send × N)
         → N × conduct_interview (sub-graph, mỗi cái: hỏi ⇄ đáp,
                                    search song song web + wikipedia/arxiv)
               → mỗi interview trả về 1 "section"
   → sections (gộp đủ N section nhờ operator.add)
       ├→ write_report ─┐
       ├→ write_introduction ─┼→ finalize_report → final_report
       └→ write_conclusion ─┘
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
