"""FastAPI backend cho Deep Research Agent v4.

WebSocket endpoint stream tiến trình real-time:
- node_complete: mỗi node chạy xong
- analysts_generated: tại interrupt 1 (human_feedback) — gửi danh sách analyst
- feedback_requested: yêu cầu user feedback
- sections_completed: tại interrupt 2 (human_review_section) — gửi các section
- report_complete: report hoàn tất
"""

import asyncio
import json
import uuid
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import ValidationError

from agent.graph import graph
from backend.schemas import (
    WSClientMessage,
    WSNodeUpdate,
    WSAnalystList,
    WSSectionList,
    WSFEedbackRequest,
    WSReportComplete,
    WSError,
    ResearchRequest,
    ResearchResponse,
    ReportResponse,
)

# In-memory session store (production nên dùng Redis)
active_sessions: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("🚀 Deep Research Agent API started")
    yield
    # Shutdown
    print("🛑 Deep Research Agent API stopped")


app = FastAPI(
    title="Deep Research Agent API",
    description="Multi-agent research assistant với WebSocket streaming",
    version="0.4.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Production: restrict to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "deep-research-agent"}


@app.post("/api/research", response_model=ResearchResponse)
async def start_research(request: ResearchRequest):
    """REST endpoint để bắt đầu research (non-streaming, trả về session_id).

    Client dùng session_id để connect WebSocket hoặc poll kết quả.
    """
    session_id = str(uuid.uuid4())
    thread = {"configurable": {"thread_id": session_id, "user_id": request.user_id}}

    initial_state = {
        "topic": request.topic,
        "max_analysts": request.max_analysts,
        "human_analyst_feedback": "",
    }

    active_sessions[session_id] = {
        "thread": thread,
        "initial_state": initial_state,
        "status": "started",
        "created_at": datetime.now(),
        "topic": request.topic,
    }

    # Chạy background task
    asyncio.create_task(run_research_background(session_id))

    return ResearchResponse(
        session_id=session_id,
        status="started",
        message=f"Research started for topic: {request.topic}",
    )


@app.get("/api/research/{session_id}", response_model=ReportResponse)
async def get_research_result(session_id: str):
    """Lấy kết quả research (polling cho client không dùng WebSocket)."""
    session = active_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    if session["status"] != "completed":
        return ReportResponse(
            session_id=session_id,
            topic=session["topic"],
            final_report="",
            created_at=session["created_at"],
            status=session["status"],
        )

    return ReportResponse(
        session_id=session_id,
        topic=session["topic"],
        final_report=session.get("final_report", ""),
        created_at=session["created_at"],
        status="completed",
    )


@app.get("/api/report/{session_id}")
async def download_report(session_id: str):
    """Download report as .md file."""
    session = active_sessions.get(session_id)
    if not session or session["status"] != "completed":
        raise HTTPException(404, "Report not ready")

    return FileResponse(
        path=session.get("filepath"),
        filename=f"report-{session_id[:8]}.md",
        media_type="text/markdown",
    )


async def run_research_background(session_id: str):
    """Chạy research trong background (cho REST endpoint)."""
    session = active_sessions.get(session_id)
    if not session:
        return

    try:
        thread = session["thread"]
        initial_state = session["initial_state"]

        # Chạy graph không interrupt (cho automation)
        result = graph.invoke(
            {**initial_state, "human_analyst_feedback": "approve"},
            thread,
        )

        # Lưu report
        from datetime import datetime
        import os
        output_dir = "reports"
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in session["topic"])[:50].strip()
        filename = f"{timestamp}-{safe_topic or 'report'}.md".replace(" ", "-")
        filepath = os.path.join(output_dir, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result["final_report"])

        session["status"] = "completed"
        session["final_report"] = result["final_report"]
        session["filepath"] = filepath

    except Exception as e:
        session["status"] = "error"
        session["error"] = str(e)
        print(f"Background research error: {e}")


# ============================================================
# WebSocket endpoint — real-time streaming
# ============================================================

@app.websocket("/ws/research")
async def research_websocket(websocket: WebSocket):
    """WebSocket endpoint cho real-time research streaming.

    Flow:
    1. Client connect -> gửi WSResearchStart
    2. Server chạy graph.stream() với stream_mode="updates"
    3. Mỗi node complete -> gửi WSNodeUpdate
    4. Gặp interrupt -> gửi WSAnalystList hoặc WSSectionList + WSFEedbackRequest
    5. Client gửi WSFeedbackSubmit -> server update_state -> resume
    6. Hoàn tất -> gửi WSReportComplete
    """
    await websocket.accept()
    session_id = None

    try:
        # Nhận message đầu tiên: WSResearchStart
        raw = await websocket.receive_text()
        try:
            msg = WSClientMessage.model_validate_json(raw)
        except ValidationError as e:
            await websocket.send_text(
                WSError(message="Invalid message format", details=str(e)).model_dump_json()
            )
            return

        if msg.event != "start_research":
            await websocket.send_text(
                WSError(message="First message must be start_research").model_dump_json()
            )
            return

        session_id = msg.session_id or str(uuid.uuid4())
        thread = {"configurable": {"thread_id": session_id, "user_id": msg.user_id or "default"}}

        initial_state = {
            "topic": msg.topic,
            "max_analysts": msg.max_analysts or 3,
            "human_analyst_feedback": "",
        }

        active_sessions[session_id] = {
            "thread": thread,
            "initial_state": initial_state,
            "websocket": websocket,
            "status": "running",
            "created_at": datetime.now(),
            "topic": msg.topic,
        }

        # Chạy graph với streaming
        await run_research_stream(session_id, initial_state, thread)

    except WebSocketDisconnect:
        print(f"Client disconnected: {session_id}")
    except Exception as e:
        print(f"WebSocket error: {e}")
        if session_id:
            await websocket.send_text(
                WSError(message="Internal error", details=str(e)).model_dump_json()
            )
    finally:
        if session_id and session_id in active_sessions:
            del active_sessions[session_id]


async def run_research_stream(session_id: str, initial_state: dict, thread: dict):
    """Chạy graph với streaming qua WebSocket."""
    session = active_sessions[session_id]
    websocket: WebSocket = session["websocket"]

    # Gửi ack
    await websocket.send_text(
        WSNodeUpdate(
            node="start",
            timestamp=datetime.now(),
            details=f"Starting research: {initial_state['topic']}",
        ).model_dump_json()
    )

    # Stream graph
    # stream_mode="updates" trả về dict {node_name: state_update} sau mỗi node
    async for chunk in graph.astream(initial_state, thread, stream_mode="updates"):
        node_name = list(chunk.keys())[0]
        node_output = chunk[node_name]

        # Gửi update cho client
        await websocket.send_text(
            WSNodeUpdate(
                node=node_name,
                timestamp=datetime.now(),
                details=_format_node_details(node_name, node_output),
            ).model_dump_json()
        )

        # Kiểm tra interrupt
        state = graph.get_state(thread)
        next_nodes = state.next

        if "human_feedback" in next_nodes:
            # Interrupt 1: review analyst list
            analysts = state.values.get("analysts", [])
            await _handle_human_feedback_interrupt(websocket, session_id, thread, analysts)

        elif "human_review_section" in next_nodes:
            # Interrupt 2: review sections
            sections = state.values.get("sections", [])
            await _handle_section_review_interrupt(websocket, session_id, thread, sections)

    # Hoàn tất - lấy final report
    final_state = graph.get_state(thread)
    final_report = final_state.values.get("final_report", "")

    # Lưu file
    from datetime import datetime
    import os
    output_dir = "reports"
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in initial_state["topic"])[:50].strip()
    filename = f"{timestamp}-{safe_topic or 'report'}.md".replace(" ", "-")
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(final_report)

    session["status"] = "completed"
    session["final_report"] = final_report
    session["filepath"] = filepath

    # Gửi hoàn tất
    await websocket.send_text(
        WSReportComplete(
            final_report=final_report,
            filepath=filepath,
        ).model_dump_json()
    )


async def _handle_human_feedback_interrupt(
    websocket: WebSocket, session_id: str, thread: dict, analysts: list
):
    """Xử lý interrupt 1: yêu cầu feedback cho danh sách analyst."""
    analyst_data = [
        {
            "name": a.name,
            "role": a.role,
            "affiliation": a.affiliation,
            "description": a.description,
        }
        for a in analysts
    ]

    await websocket.send_text(
        WSAnalystList(analysts=analyst_data).model_dump_json()
    )

    await websocket.send_text(
        WSFEedbackRequest(
            interrupt_type="human_feedback",
            message=f"Đã sinh {len(analysts)} analyst. Gõ feedback để sửa, hoặc 'approve' để tiếp tục.",
            options=["approve"],
        ).model_dump_json()
    )

    # Chờ feedback từ client
    while True:
        raw = await websocket.receive_text()
        try:
            msg = WSClientMessage.model_validate_json(raw)
        except ValidationError:
            continue

        if msg.event == "feedback_submit":
            feedback = msg.feedback or "approve"

            # Update state tại node human_feedback
            graph.update_state(
                thread,
                {"human_analyst_feedback": feedback},
                as_node="human_feedback",
            )

            # Nếu feedback != approve, graph sẽ quay lại create_analysts
            # Chạy tiếp đến interrupt tiếp theo hoặc hoàn tất
            if feedback.lower() != "approve":
                await websocket.send_text(
                    WSNodeUpdate(
                        node="create_analysts",
                        timestamp=datetime.now(),
                        details=f"Regenerating analysts with feedback: {feedback}",
                    ).model_dump_json()
                )
            break


async def _handle_section_review_interrupt(
    websocket: WebSocket, session_id: str, thread: dict, sections: list
):
    """Xử lý interrupt 2: yêu cầu feedback cho các section."""
    # Gửi danh sách section (chỉ title để ngắn gọn)
    section_titles = []
    for s in sections:
        lines = s.strip().split("\n")
        title = lines[0] if lines else "Untitled"
        section_titles.append(title)

    await websocket.send_text(
        WSSectionList(sections=section_titles).model_dump_json()
    )

    await websocket.send_text(
        WSFEedbackRequest(
            interrupt_type="human_review_section",
            message=f"Đã hoàn thành {len(sections)} section. Gõ feedback để viết lại, hoặc 'approve' để xuất report.",
            options=["approve"],
        ).model_dump_json()
    )

    # Chờ feedback
    while True:
        raw = await websocket.receive_text()
        try:
            msg = WSClientMessage.model_validate_json(raw)
        except ValidationError:
            continue

        if msg.event == "feedback_submit":
            feedback = msg.feedback or "approve"

            graph.update_state(
                thread,
                {"human_section_feedback": feedback},
                as_node="human_review_section",
            )

            if feedback.lower() != "approve":
                await websocket.send_text(
                    WSNodeUpdate(
                        node="write_report",
                        timestamp=datetime.now(),
                        details=f"Rewriting report with feedback: {feedback}",
                    ).model_dump_json()
                )
            break


def _format_node_details(node_name: str, node_output: dict) -> str:
    """Format chi tiết node cho display."""
    if node_name == "create_analysts":
        analysts = node_output.get("analysts", [])
        return f"Created {len(analysts)} analysts"
    elif node_name == "conduct_interview":
        return "Interview completed"
    elif node_name == "write_report":
        return "Report body written"
    elif node_name == "write_introduction":
        return "Introduction written"
    elif node_name == "write_conclusion":
        return "Conclusion written"
    elif node_name == "finalize_report":
        return "Final report assembled"
    elif node_name == "save_research_profile":
        return "Research profile saved"
    return "Completed"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)