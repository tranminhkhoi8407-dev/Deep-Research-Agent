"""Protocol check with a real, pinned OpenCode process.

Uses isolated databases, synthetic provider responses and ephemeral loopback
ports. Offline by default; live calls require an explicit smoke-test flag.
Never reads desktop credentials or sends user documents.
Run: python scripts/check_opencode_runtime.py --binary <opencode executable>
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--route", choices=["configured", "console"], default="configured")
    parser.add_argument("--console-model", choices=["longcat-2.5-preview-free", "mimo-v2.6-flash-free"], default="longcat-2.5-preview-free", help="Explicit Free model for the Console route; never a paid fallback")
    parser.add_argument("--live-configured-smoke", "--live-public-smoke", dest="live_public_smoke", action="store_true", help="Opt-in: bounded genuine model calls, generic public/fixture prompts only")
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    if subprocess.check_output([binary, "--version"], text=True).strip() != "1.19.0":
        raise RuntimeError("Pinned OpenCode 1.19.0 is required")
    folder = ROOT / "tmp/research-visuals-qa"
    folder.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="worker-protocol-", dir=folder))
    backend_port, worker_port = port(), port()
    os.environ.update(RESEARCH_CHAT_DATABASE_PATH=str(work / "chats.db"), REPORTS_DIR=str(work / "reports"),
                      OPENCODE_DIRECT_ENABLED='false',
                      AUTH_DATABASE_PATH=str(work / "auth.db"), RESEARCH_DATA_DIR=str(work / "documents"),
                      OPENCODE_SERVER_URL=f"http://127.0.0.1:{worker_port}", OPENCODE_SERVER_PASSWORD=secrets.token_urlsafe(32),
                      OPENCODE_GATEWAY_TOKEN=secrets.token_urlsafe(32), OPENCODE_GATEWAY_URL=f"http://127.0.0.1:{backend_port}/internal/opencode/v1",
                      OPENCODE_READER_URL=f"http://127.0.0.1:{backend_port}/internal/opencode/reader")
    import httpx
    import uvicorn
    from backend.main import app
    from backend.auth import current_user
    from backend import research_chat as chats, opencode_runtime as oc, opencode_native as native
    from backend.research_chat_store import db, ident
    from langchain_core.messages import HumanMessage, SystemMessage
    from scripts.configure_opencode import worker_profile

    app.dependency_overrides[current_user] = lambda: {"id": "offline-owner"}
    excerpts = [{"id": "PUBLIC-K1-C1", "text": "Training uses 32 rollouts. Inference uses 30 candidates.", "title": "Synthetic public paper", "url": "https://example.org/paper", "locator": "p9"}]
    chats.saved_evidence = lambda cid, owner: excerpts
    forwarded = []
    tool_reads = []

    async def synthetic_provider(request):
        assert str(request.url) == "https://opencode.ai/inference/openai/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["max_tokens"] <= 1800
        tools = [item["function"]["name"] for item in payload.get("tools", [])]
        assert not set(tools) - {"nexora_evidence_search", "nexora_evidence_read", "StructuredOutput"}, tools
        forwarded.append({"model": payload["model"], "cap": payload["max_tokens"], "tools": tools})
        tool_response = [message for message in payload["messages"] if message.get("role") == "tool"]
        if "StructuredOutput" in tools:
            delta = {"tool_calls": [{"index": 0, "id": "offline-structured", "type": "function", "function": {"name": "StructuredOutput", "arguments": json.dumps({"text": "Phản hồi structured mô phỏng"})}}]}
        elif len(forwarded) == 1:
            delta = {"tool_calls": [{"index": 0, "id": "offline-search", "type": "function", "function": {"name": "nexora_evidence_search", "arguments": json.dumps({"query": "rollouts"})}}]}
        elif len(forwarded) == 2:
            assert tool_response and "PUBLIC-K1-C1" in str(tool_response[-1])
            tool_reads.append("search")
            delta = {"tool_calls": [{"index": 0, "id": "offline-read", "type": "function", "function": {"name": "nexora_evidence_read", "arguments": json.dumps({"ids": ["PUBLIC-K1-C1"]})}}]}
        else:
            if len(forwarded) == 3:
                assert tool_response and "32 rollouts" in str(tool_response[-1])
                tool_reads.append("read")
            delta = {"content": "Đây là phản hồi mô phỏng: 32 rollouts huấn luyện khác 30 candidates suy luận. [PUBLIC-K1-C1]"}
        event = {"id": "offline-completion", "object": "chat.completion.chunk", "created": int(time.time()), "model": payload["model"], "choices": [{"index": 0, "delta": {"role": "assistant", **delta}, "finish_reason": None}]}
        finish = {**event, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if "tool_calls" in delta else "stop"}], "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140}}
        body = "data: " + json.dumps(event, ensure_ascii=False) + "\n\ndata: " + json.dumps(finish) + "\n\ndata: [DONE]\n\n"
        return httpx.Response(200, content=body.encode(), headers={"Content-Type": "text/event-stream"})

    if not args.live_public_smoke:
        if args.route == "console":
            oc.upstream_client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(synthetic_provider))
            os.environ["OPENCODE_UPSTREAM_API_KEY"] = "offline-synthetic-provider-key"
        else:
            from pydantic import BaseModel, Field
            from langchain_core.messages import AIMessage, ToolMessage
            class SyntheticModel(BaseModel):
                model: str = "synthetic-configured-model"
                max_output_tokens: int | None = None
                max_retries: int = 0
                timeout: float = 60
                tools: list = Field(default_factory=list)
                @property
                def _llm_type(self): return "chat-google-generative-ai"
                def bind_tools(self, tools, **kwargs):
                    return self.model_copy(update={"tools": tools, **kwargs})
                async def ainvoke(self, messages):
                    names = [item["function"]["name"] for item in self.tools]
                    assert not set(names) - native.TOOL_NAMES
                    assert self.max_output_tokens <= 1800 and self.max_retries == 0
                    forwarded.append({"model": self.model, "cap": self.max_output_tokens, "tools": names})
                    replies = [msg for msg in messages if isinstance(msg, ToolMessage)]
                    call = None
                    if "StructuredOutput" in names:
                        call = {"id": "fixture-structured", "name": "StructuredOutput", "args": {"text": "Phản hồi structured mô phỏng"}}
                    elif len(forwarded) == 1:
                        call = {"id": "fixture-search", "name": "nexora_evidence_search", "args": {"query": "rollouts"}}
                    elif len(forwarded) == 2:
                        assert replies and "PUBLIC-K1-C1" in replies[-1].content
                        assert any(getattr(msg, "additional_kwargs", {}).get("fixture_signature") for msg in messages)
                        tool_reads.append("search")
                        call = {"id": "fixture-read", "name": "nexora_evidence_read", "args": {"ids": ["PUBLIC-K1-C1"]}}
                    elif len(forwarded) == 3:
                        assert replies and "32 rollouts" in replies[-1].content
                        tool_reads.append("read")
                    return AIMessage(content="" if call else "Phản hồi mô phỏng: 32 rollouts khác 30 candidates.", tool_calls=[call] if call else [], additional_kwargs={"fixture_signature": "scoped-provider-metadata"}, usage_metadata={"input_tokens": 100, "output_tokens": 40, "total_tokens": 140})
            native.configured_llm = lambda: SyntheticModel()
            os.environ.pop("OPENCODE_UPSTREAM_API_KEY", None)
            oc.upstream_client = lambda: (_ for _ in ()).throw(AssertionError("Configured route called Console"))
    else:
        chats.saved_evidence = lambda cid, owner: []

    @app.post("/offline/structured/{cid}")
    def structured_check(cid: str):
        jid = ident()
        with db() as conn:
            row = dict(conn.execute("SELECT * FROM research_conversations WHERE id=?", (cid,)).fetchone())
            conn.execute("INSERT INTO research_chat_jobs(id,conversation_id,client_id,fingerprint,action,status,request,created_at,updated_at) VALUES(?,?,?,'test','chat','running','{}',?,?)", (jid, cid, jid, time.time(), time.time()))
        budget = {"max_llm_calls": 2, "max_input_tokens": 20000, "max_output_tokens": 3600, "max_seconds": 60}
        with oc.OpenCodeTurn(jid, row, budget, excerpts) as runtime:
            value = runtime.invoke(chats.ChatReply, [SystemMessage(content="Reply using the exact text schema"), HumanMessage(content="hello")], prepared_payload={"message": "hello"}, quote_registry={}, output_limit=1800, state={"evidence": excerpts})
            assert value["parsed"]["text"] == "Phản hồi structured mô phỏng", value
        from backend.research_chat_store import update_job
        update_job(jid, status="completed")
        return {"structured_output": True}

    @app.post("/offline/live-tools/{cid}")
    def live_tools_check(cid: str):
        jid = ident()
        with db() as conn:
            row = dict(conn.execute("SELECT * FROM research_conversations WHERE id=?", (cid,)).fetchone())
            conn.execute("INSERT INTO research_chat_jobs(id,conversation_id,client_id,fingerprint,action,status,request,created_at,updated_at) VALUES(?,?,?,'test','chat','running','{}',?,?)", (jid, cid, jid, time.time(), time.time()))
        budget = {"max_llm_calls": 4, "max_input_tokens": 20000, "max_output_tokens": 2400, "max_seconds": 80}
        with oc.OpenCodeTurn(jid, row, budget, excerpts) as runtime:
            _, raw = runtime.prompt(
                "This is a harmless public fixture connectivity test, not real research. Before answering, you MUST use nexora_evidence_read for the exact excerpt ID in the request. Do not use search; its ID is already known. Then answer in Vietnamese in ONE short sentence. Do not invent experiments.",
                "Read PUBLIC-K1-C1 with nexora_evidence_read, then explain training rollouts vs inference candidates in one sentence.",
                cap=600, evidence=excerpts)
            with db() as conn:
                stored = conn.execute("SELECT payload FROM opencode_provider_messages WHERE owner_id=? AND session_id=?", (row["owner_id"], runtime.session)).fetchall()
                assert any(any(call["name"] == "nexora_evidence_read" for call in json.loads(item["payload"])["tool_calls"]) for item in stored), "Real model did not request the reader"
                calls_before = conn.execute("SELECT calls FROM opencode_lease WHERE job_id=?", (jid,)).fetchone()[0]
                assert calls_before >= 2, "Reader result was not replayed into a subsequent provider call"
            assert "32" in raw.content and "30" in raw.content, "Fixture response must retain both conditions"
            value, _ = runtime.prompt(
                "Return the required JSON text schema. Explain the fixture's training and inference counts in Vietnamese in one sentence. This is a synthetic fixture, not a paper benchmark.",
                "Use the authorized excerpt already read. Write the text field.",
                wire=chats.ChatReply.model_json_schema(), cap=600, evidence=excerpts)
            assert isinstance(value["info"].get("structured"), dict)
            assert value["info"]["structured"].get("text")
        from backend.research_chat_store import update_job
        update_job(jid, status="completed")
        with db() as conn:
            usage = json.loads(conn.execute("SELECT usage FROM research_chat_jobs WHERE id=?", (jid,)).fetchone()[0])
        return {"reader_and_replayed_metadata": True, "structured_output": True, "usage": usage}
    profile = work / "opencode.json"
    profile.write_text(json.dumps(worker_profile()), encoding="utf-8")
    env = os.environ.copy()
    for name in ("config", "cache", "state", "data", "workspace"):
        (work / name).mkdir()
    env.update(XDG_CONFIG_HOME=str(work / "config"), XDG_CACHE_HOME=str(work / "cache"), XDG_STATE_HOME=str(work / "state"),
               XDG_DATA_HOME=str(work / "data"), OPENCODE_DB=str(work / "data/opencode.db"), OPENCODE_CONFIG_DIR=str(work / "config"), OPENCODE_CONFIG=str(profile),
               OPENCODE_DISABLE_PROJECT_CONFIG="true", OPENCODE_DISABLE_AUTOUPDATE="true", OPENCODE_DISABLE_MODELS_FETCH="true", OPENCODE_PURE="true")
    for key in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENCODE_API_KEY", "OPENCODE_UPSTREAM_API_KEY"):
        env.pop(key, None)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=backend_port, log_level="error", access_log=False))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    process = None
    log = (work / "worker.log").open("wb")

    def start_worker():
        worker = subprocess.Popen([binary, "serve", "--pure", "--hostname", "127.0.0.1", "--port", str(worker_port)], cwd=work / "workspace", env=env, stdout=log, stderr=subprocess.STDOUT,
                                  creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        limit = time.time() + 50
        while time.time() < limit:
            try:
                state = oc.status()
                if state["ready"]:
                    return worker
                if state["code"] != "opencode_unreachable":
                    worker.terminate(); worker.wait(timeout=15)
                    raise RuntimeError("Worker preflight failed: " + state["code"])
            except httpx.RequestError:
                pass
            if worker.poll() is not None:
                raise RuntimeError("Own test worker exited; inspect private test log")
            time.sleep(.3)
        worker.terminate()
        raise RuntimeError("Own test worker did not become ready")

    def await_job(client, cid, jid):
        limit = time.time() + 65
        while time.time() < limit:
            detail = client.get(f"/api/research/chats/{cid}").json()
            job = next(item for item in detail["jobs"] if item["id"] == jid)
            if job["status"] not in {"queued", "running"}:
                assert job["status"] == "completed", job
                assert "32 rollouts" in detail["messages"][-1]["body"]
                return job
            time.sleep(.2)
        raise RuntimeError("Test job timed out")

    try:
        process = start_worker()
        with httpx.Client(base_url=f"http://127.0.0.1:{backend_port}", timeout=15, trust_env=False) as client:
            selected = native.MODEL_ID if args.route == "configured" else args.console_model
            # Seed historical gateway sessions: new OpenCode chats are Muse-only.
            def historical_chat():
                from backend.research_chat_store import db
                created = client.post('/api/research/chats', json={'engine':'nexora'})
                assert created.status_code == 201, created.text
                cid = created.json()['id']
                binding = native.current_binding() if selected == native.MODEL_ID else {}
                with db() as conn:
                    conn.execute("UPDATE research_conversations SET engine='opencode',model=?,external_ack=1,runtime_binding=? WHERE id=?", (selected,json.dumps(binding),cid))
                return created
            response = historical_chat()
            assert response.status_code == 201, response.text
            cid = response.json()["id"]
            if args.live_public_smoke:
                result = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "public-live-smoke", "text": "Trả lời bằng tiếng Việt đúng một câu chào. Không dùng công cụ. Đây là kiểm thử kết nối với dữ liệu công khai, không có tài liệu người dùng."}).json()
                limit = time.time() + 95
                while time.time() < limit:
                    detail = client.get(f"/api/research/chats/{cid}").json()
                    job = next(item for item in detail["jobs"] if item["id"] == result["id"])
                    if job["status"] not in {"queued", "running"}:
                        print(json.dumps({"live_public_smoke": job["status"], "model": selected, "error_code": job["error_code"], "usage": job["usage"], "user_documents_sent": False, "runtime": "actual OpenCode 1.19.0, not an API client impersonating OpenCode"}))
                        if job["status"] != "completed":
                            raise RuntimeError("Provider smoke did not complete: " + str(job["error_code"]))
                        if args.route == "configured":
                            with httpx.Client(base_url=client.base_url, timeout=90, trust_env=False) as bounded:
                                response = bounded.post(f"/offline/live-tools/{cid}")
                                assert response.status_code == 200, "Real tool/signature check failed; inspect sanitized test diagnostics"
                                print(json.dumps({"live_tools": response.json()}))
                            with db() as conn:
                                prior_session = conn.execute("SELECT runtime_session FROM research_conversations WHERE id=?", (cid,)).fetchone()[0]
                            process.terminate(); process.wait(timeout=15)
                            process = start_worker()
                            followup = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "live-after-restart", "text": "Trả lời bằng tiếng Việt một câu ngắn: hai số trong trích đoạn minh họa vừa đọc áp dụng cho hai giai đoạn nào? Không gọi công cụ."}).json()
                            limit_restart = time.time() + 80
                            while time.time() < limit_restart:
                                resumed = client.get(f"/api/research/chats/{cid}").json()
                                resumed_job = next(item for item in resumed["jobs"] if item["id"] == followup["id"])
                                if resumed_job["status"] not in {"queued", "running"}:
                                    assert resumed_job["status"] == "completed", resumed_job["error_code"]
                                    with db() as conn:
                                        assert conn.execute("SELECT runtime_session FROM research_conversations WHERE id=?", (cid,)).fetchone()[0] == prior_session
                                    print(json.dumps({"live_restart": "passed", "same_model": native.current_binding(), "usage": resumed_job["usage"], "user_documents_sent": False}))
                                    break
                                time.sleep(.2)
                            else:
                                raise RuntimeError("Live follow-up did not finish within its deadline")
                        return
                    time.sleep(.2)
                raise RuntimeError("Bounded live provider smoke timed out")
            first = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "offline-first", "text": "Giải thích huấn luyện bằng tiếng Việt"}).json()
            usage = await_job(client, cid, first["id"])["usage"]
            assert usage["calls"] == 3 and usage["output_measured"] == 120, usage
            assert tool_reads == ["search", "read"]
            with db() as conn:
                session = conn.execute("SELECT runtime_session FROM research_conversations WHERE id=?", (cid,)).fetchone()[0]
            second = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "offline-second", "text": "Giải thích tiếp phần candidates"}).json()
            await_job(client, cid, second["id"])
            # A browser retry with the same key must not incur another call.
            before = len(forwarded)
            assert client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "offline-second", "text": "Giải thích tiếp phần candidates"}).json()["id"] == second["id"]
            assert len(forwarded) == before
            process.terminate(); process.wait(timeout=15)
            process = start_worker()
            third = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "offline-third", "text": "Giải thích tiếp sau restart"}).json()
            await_job(client, cid, third["id"])
            with db() as conn:
                assert conn.execute("SELECT runtime_session FROM research_conversations WHERE id=?", (cid,)).fetchone()[0] == session
            assert "runtime_session" not in client.get(f"/api/research/chats/{cid}").text
            assert client.post(f"/offline/structured/{cid}").json()["structured_output"]
            other = historical_chat().json()["id"]
            other_job = client.post(f"/api/research/chats/{other}/messages", json={"client_id": "offline-other", "text": "Một cuộc trò chuyện khác"}).json()
            await_job(client, other, other_job["id"])
            with db() as conn:
                assert conn.execute("SELECT runtime_session FROM research_conversations WHERE id=?", (other,)).fetchone()[0] != session
            assert client.post("/internal/opencode/reader", json={"tool": "read", "ids": ["PUBLIC-K1-C1"]}).status_code == 403
            print(json.dumps({"result": "passed", "route": args.route, "real_worker_version": "1.19.0", "provider_calls_synthetic": len(forwarded), "live_model_calls": 0, "scoped_mcp_tools": tool_reads, "same_session_after_worker_restart": True, "idempotent_retry": True, "structured_output": True, "separate_conversation_sessions": True}))
    finally:
        if process and process.poll() is None:
            process.terminate(); process.wait(timeout=15)
        server.should_exit = True
        thread.join(timeout=10)
        log.close()


if __name__ == "__main__":
    main()
