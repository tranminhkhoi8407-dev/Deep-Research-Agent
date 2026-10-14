"""Nexora product API: authenticated, evidence-first research and paper analysis.

WebSocket streams node progress, a source-linked structured draft for editorial
review, and the final report with persistent provenance. Legacy interview graphs
remain separate CLI/Studio entry points.
Durable chat routes share that pipeline, with a separately authenticated and
metered OpenCode worker; the browser never connects to its private server.
"""

import asyncio
import hashlib
import json
import os
import re
import uuid
from datetime import date, datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from dotenv import load_dotenv

from agent.deep_research import batch_graph, finalize_report, graph
from agent.documents import DocumentStore, paper_url
from agent.research_contract import LanguageConflict, resolve_language, resolve_research_topic
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
from backend.auth import current_admin, current_user, provider_status, router as auth_router
from backend.paper_library import router as paper_library_router
from backend.collaboration import router as collaboration_router
from backend.notebook_media import router as notebook_media_router
from backend.notifications import router as notifications_router
from backend.discussions import router as discussions_router
from backend.research_documents import router as research_documents_router
from backend.report_export import ExportError, export_report
from backend.sessions import REMEMBERED_SECONDS, RememberSessionMiddleware
from backend.research_chat import router as research_chat_router
from backend.opencode_runtime import router as opencode_worker_router
from backend.accounts import (
    get_user,
    list_audit_events,
    list_users,
    log_admin_action,
    update_user,
    user_counts,
)

load_dotenv()
# Optional dedicated worker credentials generated locally; never the user's
# personal OpenCode desktop credentials, and never exposed to the frontend.
load_dotenv(Path(__file__).resolve().parents[1] / "data/opencode/runtime.env", override=False)
# Explicit local prototype opt-in; no credential copying or session migration.
load_dotenv(Path(__file__).resolve().parents[1] / "data/opencode-direct/runtime.env", override=False)

# In-memory session store (production nên dùng Redis)
active_sessions: dict[str, dict] = {}


class AdminUserUpdate(BaseModel):
    status: Literal["active", "suspended"] | None = None
    license_type: Literal["free", "pro", "team"] | None = None
    license_expires_at: str | None = None


def _reports_dir(user_id: str | None = None) -> Path:
    """Return a user-scoped report directory.

    The local development account keeps using the legacy root so existing
    reports remain visible. OAuth users get isolated, non-identifying folders.
    """
    base = Path(os.getenv("REPORTS_DIR", "reports")).resolve()
    if user_id and user_id != "local:researcher":
        account_key = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
        directory = base / "users" / account_key
    else:
        directory = base
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _safe_report_path(report_id: str, user_id: str | None = None) -> Path:
    """Resolve a report filename without allowing traversal outside reports/."""
    if not report_id or Path(report_id).name != report_id or not report_id.endswith(".md"):
        raise HTTPException(400, "Invalid report id")
    directory = _reports_dir(user_id)
    path = (directory / report_id).resolve()
    if path.parent != directory:
        raise HTTPException(400, "Invalid report id")
    return path


def _report_summary(path: Path, content: str | None = None) -> dict:
    text = content if content is not None else path.read_text(encoding="utf-8")
    title_match = re.search(r"(?m)^#\s+(.+)$", text)
    title = title_match.group(1).strip() if title_match else path.stem
    depth_match = re.search(
        r"(?:chế độ|Method:)\**\s*(quick|standard|deep)", text, re.IGNORECASE
    )
    domain_match = re.search(
        r"(?:Lĩnh vực|Domain):\**\s*([a-z][\w-]*)\s*·\s*([a-z][\w-]*)",
        text,
        re.IGNORECASE,
    )
    source_pattern = re.compile(
        r"(?m)^- \[(A\d+-(?:W|K)\d+)\] \[([^\]]+)\]\((https?://[^)]+)\) "
        r"— ([^,]+), (?:quality|chất lượng): (\w+)"
    )
    sources = [
        {
            "id": match.group(1),
            "title": match.group(2),
            "url": match.group(3),
            "source_type": match.group(4).strip(),
            "quality": match.group(5).lower(),
        }
        for match in source_pattern.finditer(text)
    ]
    stat = path.stat()
    metadata = path.with_suffix(".research.json")
    if metadata.is_file():
        try:
            structured = json.loads(metadata.read_text(encoding="utf-8"))
            if isinstance(structured, dict):
                sources = [{key: source.get(key, "") for key in ("id", "title", "url", "source_type", "quality")} for source in structured.get("sources", []) if isinstance(source, dict) and source.get("used")]
        except (OSError, ValueError, TypeError):
            pass
    return {
        "id": path.name,
        "title": title,
        "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "size_bytes": stat.st_size,
        "source_count": len({source["url"].rstrip("/") for source in sources}),
        "research_depth": depth_match.group(1).lower() if depth_match else "standard",
        "research_domain": domain_match.group(1).lower() if domain_match else "general",
        "research_category": domain_match.group(2).lower() if domain_match else "",
        "language": "vi" if "## Nguồn tham khảo" in text else "en",
        "sources": sources,
    }


def _user_report_stats(user_id: str) -> dict[str, int]:
    paths = list(_reports_dir(user_id).glob("*.md"))
    return {
        "report_count": len(paths),
        "storage_bytes": sum(path.stat().st_size for path in paths if path.is_file()),
    }


def _admin_user_payload(user: dict) -> dict:
    return {**user, **_user_report_stats(user["id"])}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: restore the newest R2 snapshot first so accounts, reports,
    # avatars and libraries survive restarts on ephemeral filesystems.
    from backend import persist
    await asyncio.to_thread(persist.restore_on_startup)
    persist.start_background_uploader()
    print("Nexora Agent API started")
    try:
        yield
    finally:
        persist.stop_background_uploader()
        # Wake native question waits before the executor is shut down.
        from backend.opencode_interactive import shutdown_workers
        await asyncio.shield(asyncio.to_thread(shutdown_workers))
        print("Nexora Agent API stopped")


app = FastAPI(
    title="Nexora Agent API",
    description="Multi-agent research assistant với WebSocket streaming",
    version="0.4.0",
    lifespan=lifespan,
)

app_env = os.getenv("APP_ENV", "development").lower()
session_secret = os.getenv("AUTH_SESSION_SECRET")
if app_env == "production" and not session_secret:
    raise RuntimeError("AUTH_SESSION_SECRET is required when APP_ENV=production")

app.add_middleware(
    RememberSessionMiddleware,
    secret_key=session_secret or "deep-research-local-development-only-secret",
    session_cookie="deep_research_session",
    max_age=REMEMBERED_SECONDS,
    same_site="lax",
    https_only=os.getenv("AUTH_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(paper_library_router)
app.include_router(collaboration_router)
app.include_router(notebook_media_router)
app.include_router(notifications_router)
app.include_router(discussions_router)
app.include_router(research_documents_router)
app.include_router(research_chat_router)
app.include_router(opencode_worker_router)


@app.middleware("http")
async def private_discussion_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(("/api/discussions/", "/api/auth/")):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "deep-research-agent"}


@app.get("/api/reports")
async def list_saved_reports(user: dict = Depends(current_user)):
    """List persistent Markdown reports with source metadata for the web library."""
    reports = []
    for path in _reports_dir(user["id"]).glob("*.md"):
        try:
            reports.append(_report_summary(path))
        except (OSError, UnicodeError):
            continue
    reports.sort(key=lambda report: report["created_at"], reverse=True)
    return {"reports": reports}


@app.get("/api/reports/{report_id}")
async def get_saved_report(report_id: str, user: dict = Depends(current_user)):
    path = _safe_report_path(report_id, user["id"])
    if not path.is_file():
        raise HTTPException(404, "Report not found")
    content = path.read_text(encoding="utf-8")
    metadata = path.with_suffix(".research.json")
    report_data = None
    if metadata.is_file():
        try:
            candidate = json.loads(metadata.read_text(encoding="utf-8"))
            if isinstance(candidate, dict) and candidate.get("schema_version") in {"2.0", "2.1", "3.0", "3.1"}:
                report_data = candidate
        except (OSError, ValueError):
            pass  # The original Markdown remains readable if metadata is damaged.
    return {**_report_summary(path, content), "final_report": content, "report_data": report_data}


@app.get("/api/reports/{report_id}/export")
async def export_saved_report(report_id: str, format: Literal["tex", "pdf", "zip"] = "pdf", user: dict = Depends(current_user)):
    """Account-scoped artifact export. Existing Markdown is only a legacy input."""
    path = _safe_report_path(report_id, user["id"])
    if not path.is_file():
        raise HTTPException(404, "Report not found")
    record = await get_saved_report(report_id, user)
    try:
        artifact = await asyncio.to_thread(export_report, path, record["report_data"], record["final_report"], format)
    except ExportError as error:
        raise HTTPException(503 if error.code in {"compiler_unavailable", "compiler_busy"} else 422,
                            {"code": error.code, "message": str(error)}) from error
    return FileResponse(artifact, media_type={"tex": "application/x-tex", "pdf": "application/pdf", "zip": "application/zip"}[format],
                        filename=path.stem + (".source.zip" if format == "zip" else "." + format), headers={"Cache-Control": "private, no-store"})


@app.delete("/api/reports/{report_id}")
async def delete_saved_report(report_id: str, user: dict = Depends(current_user)):
    path = _safe_report_path(report_id, user["id"])
    if not path.is_file():
        raise HTTPException(404, "Report not found")
    path.unlink()
    path.with_suffix(".research.json").unlink(missing_ok=True)
    for suffix in (".tex", ".pdf", ".export.json", ".source.zip"):
        path.with_suffix(suffix).unlink(missing_ok=True)
    return {"status": "deleted", "id": report_id}


# ============================================================
# Host administration
# ============================================================

@app.get("/api/admin/overview")
async def admin_overview(admin: dict = Depends(current_admin)):
    users = list_users()
    report_stats = [_user_report_stats(user["id"]) for user in users]
    return {
        "users": user_counts(),
        "reports": {
            "total": sum(item["report_count"] for item in report_stats),
            "storage_bytes": sum(item["storage_bytes"] for item in report_stats),
        },
        "active_research_sessions": sum(
            1 for session in active_sessions.values() if session.get("status") in {"started", "running"}
        ),
        "system": {
            "status": "online",
            "environment": app_env,
            "llm_provider": os.getenv("LLM_PROVIDER", "not-configured"),
            "oauth": provider_status(),
            "dev_login": os.getenv("AUTH_DEV_LOGIN", "").lower() in {"1", "true", "yes", "on"}
            or app_env != "production",
        },
        "recent_activity": list_audit_events(8),
        "viewer": {"id": admin["id"], "role": admin["role"]},
    }


@app.get("/api/admin/users")
async def admin_users(_admin: dict = Depends(current_admin)):
    return {"users": [_admin_user_payload(user) for user in list_users()]}


@app.patch("/api/admin/users/{user_id}")
async def admin_update_user(
    user_id: str,
    change: AdminUserUpdate,
    admin: dict = Depends(current_admin),
):
    target = get_user(user_id)
    if not target:
        raise HTTPException(404, "User not found")
    changed_fields = change.model_fields_set
    if not changed_fields:
        raise HTTPException(400, "No account changes supplied")
    if user_id == admin["id"] and change.status == "suspended":
        raise HTTPException(400, "You cannot suspend your own host account")
    if target.get("role") == "admin" and change.status == "suspended" \
            and target.get("status") == "active" and user_counts()["active_admins"] <= 1:
        raise HTTPException(400, "At least one active host is required")
    update_values: dict = {}
    if "status" in changed_fields:
        update_values["status"] = change.status
    if "license_type" in changed_fields:
        update_values["license_type"] = change.license_type
    if "license_expires_at" in changed_fields:
        expires_at = change.license_expires_at.strip() if change.license_expires_at else None
        if expires_at:
            try:
                expires_at = date.fromisoformat(expires_at).isoformat()
            except ValueError as exc:
                raise HTTPException(400, "License expiry must use YYYY-MM-DD") from exc
        update_values["license_expires_at"] = expires_at
    updated = update_user(user_id, **update_values)
    if not updated:
        raise HTTPException(404, "User not found")
    log_admin_action(
        admin["id"],
        "user.updated",
        "user",
        user_id,
        {key: value for key, value in update_values.items()},
    )
    return {"user": _admin_user_payload(updated)}


@app.get("/api/admin/reports")
async def admin_reports(_admin: dict = Depends(current_admin)):
    reports: list[dict] = []
    for user in list_users():
        for path in _reports_dir(user["id"]).glob("*.md"):
            try:
                reports.append(
                    {
                        **_report_summary(path),
                        "owner_id": user["id"],
                        "owner_name": user["name"],
                        "owner_email": user.get("email"),
                        "owner_provider": user["provider"],
                    }
                )
            except (OSError, UnicodeError):
                continue
    reports.sort(key=lambda item: item["created_at"], reverse=True)
    return {"reports": reports}


@app.delete("/api/admin/reports/{owner_id}/{report_id}")
async def admin_delete_report(
    owner_id: str,
    report_id: str,
    admin: dict = Depends(current_admin),
):
    if not get_user(owner_id):
        raise HTTPException(404, "User not found")
    path = _safe_report_path(report_id, owner_id)
    if not path.is_file():
        raise HTTPException(404, "Report not found")
    summary = _report_summary(path)
    path.unlink()
    log_admin_action(
        admin["id"],
        "report.deleted",
        "report",
        report_id,
        {"owner_id": owner_id, "title": summary["title"]},
    )
    return {"status": "deleted", "id": report_id}


@app.get("/api/admin/audit")
async def admin_audit(limit: int = 100, _admin: dict = Depends(current_admin)):
    return {"events": list_audit_events(limit)}


def _research_options(request, owner: str) -> dict:
    try:
        selected = request.report_language or "auto"
        if request.analysis_mode == "paper" and not (request.topic or "").strip() and selected == "auto":
            selected = request.preferred_report_language
        language = resolve_language(request.topic or "", selected)
        topic = resolve_research_topic(request.topic or "", request.analysis_mode, language)
        if request.analysis_mode == "paper" and not (request.paper_input.strip() or request.document_id):
            raise ValueError("Paper analysis needs a URL/DOI/arXiv ID or an uploaded PDF.")
        if request.paper_input:
            paper_url(request.paper_input)
        if request.document_id and not DocumentStore().get(owner, request.document_id):
            raise ValueError("Selected PDF not found in this account.")
    except LanguageConflict as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return {
        "topic": topic,
        "owner_id": owner,
        "report_language": language,
        "analysis_mode": request.analysis_mode,
        "paper_input": request.paper_input,
        "document_id": request.document_id,
        "report_detail": request.report_detail,
        "preferred_report_language": request.preferred_report_language,
        "budget": request.budget.model_dump(exclude_unset=True) if request.budget else None,
    }


@app.post("/api/research", response_model=ResearchResponse)
async def start_research(request: ResearchRequest, user: dict = Depends(current_user)):
    """REST endpoint để bắt đầu research (non-streaming, trả về session_id).

    Client dùng session_id để connect WebSocket hoặc poll kết quả.
    """
    options = _research_options(request, user["id"])
    session_id = str(uuid.uuid4())
    thread = {"configurable": {"thread_id": session_id, "user_id": user["id"]}}

    initial_state = {
        "topic": request.topic,
        "owner_id": user["id"],
        "report_language": request.report_language,
        "research_depth": request.research_depth,
        "research_domain": request.research_domain,
        "research_category": request.research_category,
        "research_notes": request.research_notes,
        "latex_context": request.latex_context,
        "source_preferences": request.source_preferences,
        "max_analysts": request.max_analysts,
        "human_analyst_feedback": "",
        **options,
    }

    active_sessions[session_id] = {
        "thread": thread,
        "initial_state": initial_state,
        "status": "started",
        "created_at": datetime.now(),
        "topic": options["topic"],
        "owner_id": user["id"],
    }

    # Chạy background task
    asyncio.create_task(run_research_background(session_id))

    return ResearchResponse(
        session_id=session_id,
        status="started",
        message=f"Research started for topic: {options['topic']}",
    )


@app.get("/api/research/{session_id}", response_model=ReportResponse)
async def get_research_result(session_id: str, user: dict = Depends(current_user)):
    """Lấy kết quả research (polling cho client không dùng WebSocket)."""
    session = active_sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.get("owner_id") != user["id"]:
        raise HTTPException(404, "Session not found")

    if session["status"] not in {"completed", "partial", "failed"}:
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
        status=session["status"],
        report_data=session.get("report_data"),
    )


@app.get("/api/report/{session_id}")
async def download_report(session_id: str, format: Literal["tex", "pdf", "zip"] = "pdf", user: dict = Depends(current_user)):
    """Download the actual report PDF or its editable LaTeX source."""
    session = active_sessions.get(session_id)
    if not session or session["status"] not in {"completed", "partial", "failed"}:
        raise HTTPException(404, "Report not ready")
    if session.get("owner_id") != user["id"]:
        raise HTTPException(404, "Report not ready")

    return await export_saved_report(Path(session["filepath"]).name, format, user)


async def run_research_background(session_id: str):
    """Chạy research trong background (cho REST endpoint)."""
    session = active_sessions.get(session_id)
    if not session:
        return

    try:
        thread = session["thread"]
        initial_state = session["initial_state"]

        # Chạy graph không interrupt (cho automation)
        result = await asyncio.to_thread(
            batch_graph.invoke,
            {
                **initial_state,
                "human_analyst_feedback": "approve",
                "human_section_feedback": "approve",
            },
            thread,
        )

        # Lưu report
        output_dir = _reports_dir(session.get("owner_id"))
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in session["topic"])[:50].strip()
        filename = f"{timestamp}-{safe_topic or 'report'}-{session_id[:8]}.md".replace(" ", "-")
        filepath = output_dir / filename

        filepath.write_text(result["final_report"], encoding="utf-8")
        if result.get("report_data"):
            filepath.with_suffix(".research.json").write_text(json.dumps(result["report_data"], ensure_ascii=False), encoding="utf-8")

        session["status"] = (result.get("report_data") or {}).get("outcome", "completed")
        session["final_report"] = result["final_report"]
        session["filepath"] = str(filepath)
        session["report_data"] = result.get("report_data")

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
    user = websocket.session.get("user")
    if not isinstance(user, dict) or not user.get("id"):
        await websocket.close(code=4401, reason="Authentication required")
        return
    persisted_user = get_user(str(user["id"]))
    if persisted_user and persisted_user.get("status") == "suspended":
        await websocket.close(code=4403, reason="Account suspended")
        return

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

        topic = (msg.topic or "").strip()
        if msg.analysis_mode != "paper" and len(topic) < 8:
            await websocket.send_text(
                WSError(
                    message="Topic is too short",
                    details="Chủ đề nghiên cứu phải có ít nhất 8 ký tự.",
                ).model_dump_json()
            )
            return

        max_analysts = msg.max_analysts or 3
        if not 1 <= max_analysts <= 10:
            await websocket.send_text(
                WSError(
                    message="Invalid max_analysts",
                    details="Số analyst phải nằm trong khoảng 1 đến 10.",
                ).model_dump_json()
            )
            return

        try:
            options = _research_options(msg, user["id"])
        except HTTPException as error:
            await websocket.send_text(WSError(message=str(error.detail)).model_dump_json())
            return
        topic = options["topic"]
        # Never allow a client to reuse another user's checkpoint/session.
        session_id = str(uuid.uuid4())
        thread = {"configurable": {"thread_id": session_id, "user_id": user["id"]}}

        initial_state = {
            "topic": topic,
            "report_language": msg.report_language or "vi",
            "research_depth": msg.research_depth or "standard",
            "research_domain": msg.research_domain or "general",
            "research_category": msg.research_category or "",
            "research_notes": msg.research_notes or "",
            "latex_context": msg.latex_context or "",
            "source_preferences": msg.source_preferences or [],
            "max_analysts": max_analysts,
            "human_analyst_feedback": "",
            **options,
        }

        active_sessions[session_id] = {
            "thread": thread,
            "initial_state": initial_state,
            "websocket": websocket,
            "status": "running",
            "created_at": datetime.now(),
            "topic": topic,
            "owner_id": user["id"],
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

    # Mỗi lần astream kết thúc tại một interrupt. Sau khi nhận feedback,
    # resume với input=None cho đến interrupt tiếp theo hoặc khi graph xong.
    graph_input = initial_state
    while True:
        async for chunk in graph.astream(graph_input, thread, stream_mode="updates"):
            for node_name, node_output in chunk.items():
                if node_name == "__interrupt__":
                    continue

                await websocket.send_text(
                    WSNodeUpdate(
                        node=node_name,
                        timestamp=datetime.now(),
                        details=_format_node_details(node_name, node_output or {}),
                    ).model_dump_json()
                )

        state = graph.get_state(thread)
        next_nodes = state.next

        if "human_feedback" in next_nodes:
            analysts = state.values.get("analysts", [])
            await _handle_human_feedback_interrupt(websocket, session_id, thread, analysts)
            graph_input = None
            continue

        elif "human_review_section" in next_nodes:
            sections = state.values.get("sections", [])
            await _handle_section_review_interrupt(websocket, session_id, thread, sections)
            graph_input = None
            continue

        break

    # Hoàn tất - lấy final report
    final_state = graph.get_state(thread)
    final_report = final_state.values.get("final_report", "")
    sources = final_state.values.get("sources", [])
    unique_source_urls = {
        str(source.get("url", "")).rstrip("/")
        for source in sources
        if source.get("url")
    }

    # Lưu file
    output_dir = _reports_dir(session.get("owner_id"))
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in initial_state["topic"])[:50].strip()
    filename = f"{timestamp}-{safe_topic or 'report'}-{session_id[:8]}.md".replace(" ", "-")
    filepath = output_dir / filename

    filepath.write_text(final_report, encoding="utf-8")
    report_data = final_state.values.get("report_data")
    if report_data:
        filepath.with_suffix(".research.json").write_text(json.dumps(report_data, ensure_ascii=False), encoding="utf-8")

    session["status"] = (report_data or {}).get("outcome", "completed")
    session["final_report"] = final_report
    session["filepath"] = str(filepath)
    session["report_data"] = report_data

    # Gửi hoàn tất
    await websocket.send_text(
        WSReportComplete(
            final_report=final_report,
            filepath=str(filepath),
            source_count=report_data["counts"]["used"] if report_data else len(unique_source_urls),
            research_depth=initial_state.get("research_depth", "standard"),
            audit_notes=final_state.values.get("audit_notes"),
            report_data=report_data,
            outcome=session["status"],
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
        WSSectionList(
            sections=section_titles,
            report_data=finalize_report(graph.get_state(thread).values)["report_data"],
        ).model_dump_json()
    )

    await websocket.send_text(
        WSFEedbackRequest(
            interrupt_type="human_review_section",
            message=f"Có bản nháp {len(sections)} mục và dẫn chứng. Góp ý được áp dụng trong ngân sách còn lại; 'approve' để xuất báo cáo.",
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
                        node="apply_editorial_feedback",
                        timestamp=datetime.now(),
                        details="Applying editorial feedback within the remaining research budget.",
                    ).model_dump_json()
                )
            break


def _format_node_details(node_name: str, node_output: dict) -> str:
    """Format chi tiết node cho display."""
    if node_name == "understand_brief":
        return f"Report: {node_output.get('report_language', 'auto')} · {node_output.get('brief', {}).get('objective', '')}"
    if node_name == "collect_evidence":
        return f"{len(node_output.get('sources', []))} discovered · {len(node_output.get('evidence', []))} excerpts selected · {node_output.get('usage', {}).get('cache_hits', 0)} cache hits"
    if node_name == "assess_coverage":
        missing = sum(item.get("status") != "answered" for item in node_output.get("coverage", []))
        return f"{missing} questions need more evidence · {node_output.get('stop_reason') or 'read/search follow-up'}"
    if node_name == "draft_report":
        count = sum(len(section.get("claims", [])) for section in node_output.get("report_data", {}).get("sections", []))
        return f"{count} source-matched claims drafted · semantic review pending"
    if node_name == "generate_visuals":
        info = node_output.get("report_data", {}).get("visual_status", {})
        return f"Visuals: {info.get('status', 'not_generated')} · {info.get('attempts', 0)} creation/repair attempts · semantic review pending"
    if node_name == "audit_evidence":
        claims = [claim for section in node_output.get("report_data", {}).get("sections", []) for claim in section.get("claims", [])]
        checked = sum(claim.get("verification") == "model_checked" for claim in claims)
        return f"{checked} claims support-reviewed · {len(claims) - checked} provisional"
    if node_name == "create_analysts":
        analysts = node_output.get("analysts", [])
        return f"Created {len(analysts)} analysts"
    elif node_name == "plan_research":
        return "Research plan and evidence criteria created"
    elif node_name == "conduct_interview":
        return "Interview completed"
    elif node_name == "write_report":
        return "Report body written"
    elif node_name == "write_introduction":
        return "Introduction written"
    elif node_name == "write_conclusion":
        return "Conclusion written"
    elif node_name == "finalize_report":
        return f"Report assembled · {node_output.get('report_data', {}).get('outcome', 'status unavailable')}"
    elif node_name == "audit_report":
        return "Evidence and citation audit completed"
    elif node_name == "save_research_profile":
        return "Research profile saved"
    return "Completed"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
