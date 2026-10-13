"""Configured-provider bridge regressions; no paid/network calls."""
import asyncio
import json
import time
from typing import ClassVar
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, ToolMessage
from pydantic import BaseModel, Field
from backend import opencode_native as native, opencode_runtime as oc, research_chat as chats
from backend.auth import current_user
from backend.main import app
from backend.research_chat_store import db, update_job


class FakeModel(BaseModel):
    model: str = "same-configured-model"
    max_output_tokens: int | None = None
    max_retries: int = 0
    timeout: float = 60
    tools: list = Field(default_factory=list)
    tool_choice: object = None
    calls: ClassVar[list] = []
    replies: ClassVar[list] = []
    hang: ClassVar[bool] = False
    was_cancelled: ClassVar[bool] = False
    @property
    def _llm_type(self):
        return "chat-google-generative-ai"
    def bind_tools(self, tools, **kwargs):
        return self.model_copy(update={"tools": tools, **kwargs})
    async def ainvoke(self, messages):
        self.calls.append((self, messages))
        if self.hang:
            try:
                await asyncio.sleep(20)
            except asyncio.CancelledError:
                type(self).was_cancelled = True
                raise
        value = self.replies.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED', 'false')
    monkeypatch.setenv("RESEARCH_CHAT_DATABASE_PATH", str(tmp_path / "chats.db"))
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("OPENCODE_GATEWAY_TOKEN", "offline-token-at-least-24-characters")
    monkeypatch.delenv("OPENCODE_UPSTREAM_API_KEY", raising=False)
    monkeypatch.setattr(chats, "run_turn", lambda *args: None)
    monkeypatch.setattr(oc, "status", lambda: {"ready": True})
    model = FakeModel()
    monkeypatch.setattr(native, "configured_llm", lambda: model)
    FakeModel.calls, FakeModel.replies = [], []
    FakeModel.hang = FakeModel.was_cancelled = False
    app.dependency_overrides[current_user] = lambda: {"id": "owner"}
    with TestClient(app) as client:
        # Historical configured-provider session: new OpenCode chats are Muse-only.
        result = client.post("/api/research/chats", json={"engine": "nexora"})
        assert result.status_code == 201, result.text
        cid = result.json()["id"]
        with db() as conn:
            conn.execute("UPDATE research_conversations SET engine='opencode',model=?,external_ack=1,runtime_binding=? WHERE id=?", (native.MODEL_ID,json.dumps(native.current_binding()),cid))
        job = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "offline-001", "text": "Giải thích bằng tiếng Việt"}).json()["id"]
        update_job(job, status="running")
        context = {"owner": "owner", "model": native.MODEL_ID, "binding": native.current_binding(), "sessions": ["ses_native"], "evidence": [], "budget": {"max_llm_calls": 3, "max_input_tokens": 10000, "max_output_tokens": 3000}}
        with db() as conn:
            conn.execute("INSERT INTO opencode_lease(slot,job_id,expires_at,context,cap) VALUES(1,?,?,?,800)", (job, time.time() + 60, json.dumps(context)))
        yield client, cid, job, context, model
    app.dependency_overrides.pop(current_user, None)


def message(text="Hello", **extra):
    return AIMessage(content=text, usage_metadata={"input_tokens": 123, "output_tokens": 20, "total_tokens": 143}, **extra)


def tool(name="nexora_evidence_read"):
    return {"type": "function", "function": {"name": name, "parameters": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "string"}}}}}}


def complete(setup, payload):
    _, _, job, context, _ = setup
    return asyncio.run(native.completion(payload, context, "ses_native", job, 800, time.time() + 5))


def test_same_model_is_pinned_without_keys_in_browser(setup):
    client, cid, _, _, _ = setup
    response = client.get(f"/api/research/chats/{cid}")
    assert response.json()["model_label"] == "Nexora · gemini · same-configured-model"
    assert "runtime_binding" not in response.text and "api_key" not in response.text
    with db() as conn:
        assert json.loads(conn.execute("SELECT runtime_binding FROM research_conversations WHERE id=?", (cid,)).fetchone()[0]) == {"provider": "gemini", "model": "same-configured-model"}


def test_one_call_cap_no_retries_no_mutation(setup):
    FakeModel.replies = [message("Xin chào")]
    result = complete(setup, {"messages": [{"role": "user", "content": "Hi"}], "temperature": 2})
    clone, _ = FakeModel.calls[0]
    assert clone.model == setup[-1].model and clone.max_output_tokens == 800 and clone.max_retries == 0
    assert setup[-1].max_output_tokens is None
    assert result["usage"]["prompt_tokens"] == 123 and len(FakeModel.calls) == 1


def test_durable_metadata_replay_and_no_thought_leak(setup):
    calls = [{"id": "call_fixture", "name": "nexora_evidence_read", "args": {"ids": ["C1"]}, "type": "tool_call"}]
    private = [{"type": "reasoning", "reasoning": "private thought"}, {"type": "text", "text": "Read source"}]
    FakeModel.replies = [message(private, tool_calls=calls, additional_kwargs={"private_signature": "sig-fixture"})]
    assistant = complete(setup, {"messages": [{"role": "user", "content": "Hi"}], "tools": [tool()]})["choices"][0]["message"]
    assert "private thought" not in json.dumps(assistant)
    FakeModel.replies = [message("Training differs from inference")]
    complete(setup, {"messages": [{"role": "user", "content": "Hi"}, assistant, {"role": "tool", "tool_call_id": "call_fixture", "content": "Training uses 32 rollouts."}], "tools": [tool()]})
    replayed = FakeModel.calls[-1][1]
    assert replayed[1].additional_kwargs["private_signature"] == "sig-fixture"
    assert replayed[1].content == private and isinstance(replayed[-1], ToolMessage)
    assert replayed[-1].name == "nexora_evidence_read"


@pytest.mark.parametrize("alter", ["owner", "session", "binding", "arguments"])
def test_metadata_never_crosses_scope_or_modified_arguments(setup, alter):
    _, _, _, context, _ = setup
    calls = [{"id": "call_fixture", "name": "nexora_evidence_read", "args": {"ids": ["C1"]}, "type": "tool_call"}]
    native.store_tool_response(message(tool_calls=calls), context, "ses_native")
    rows = [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": None, "tool_calls": [{"id": "call_fixture", "type": "function", "function": {"name": "nexora_evidence_read", "arguments": '{"ids":["C1"]}'}}]}, {"role": "tool", "tool_call_id": "call_fixture", "content": "OK"}]
    session = "ses_native"
    if alter == "owner": context = {**context, "owner": "other"}
    if alter == "session": session = "ses_other"
    if alter == "binding": context = {**context, "binding": {"provider": "gemini", "model": "another-model"}}
    if alter == "arguments": rows[1]["tool_calls"][0]["function"]["arguments"] = '{"ids":["OTHER"]}'
    with pytest.raises(native.NativeAdapterError): native.convert_messages(rows, context, session)
    assert not FakeModel.calls


@pytest.mark.parametrize("rows", [
    [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "http://169.254.169.254"}}]}],
    [{"role": "tool", "tool_call_id": "orphan", "content": "Hi"}],
    [{"role": "assistant", "content": "Prefill"}],
    [{"role": "unknown", "content": "Hi"}],
    [{"role": "assistant", "content": None, "tool_calls": ["malformed"]}],
])
def test_bad_input_rejected_before_model(setup, rows):
    with pytest.raises(native.NativeAdapterError): complete(setup, {"messages": rows})
    assert not FakeModel.calls


def test_disallowed_tools(setup):
    with pytest.raises(native.NativeAdapterError, match="opencode_invalid_tools"):
        complete(setup, {"messages": [{"role": "user", "content": "Hi"}], "tools": [tool("bash")]})
    assert not FakeModel.calls


def test_changed_model_stops_existing_chat_before_job(setup, monkeypatch):
    client, cid, job, _, _ = setup
    update_job(job, status="completed")
    monkeypatch.setattr(native, "configured_llm", lambda: FakeModel(model="new-model"))
    response = client.post(f"/api/research/chats/{cid}/messages", json={"client_id": "offline-002", "text": "Follow up"})
    assert response.status_code == 503 and response.json()["detail"] == "opencode_configured_model_changed"
    assert len(client.get(f"/api/research/chats/{cid}").json()["jobs"]) == 1
    assert not FakeModel.calls


def test_cancel_stops_async_model_and_never_retries(setup):
    _, _, job, context, _ = setup
    FakeModel.hang = True
    async def run():
        task = asyncio.create_task(native.completion({"messages": [{"role": "user", "content": "Hi"}]}, context, "ses_native", job, 800, time.time() + 5))
        await asyncio.sleep(.1)
        with db() as conn: conn.execute("UPDATE research_chat_jobs SET cancel_requested=1 WHERE id=?", (job,))
        with pytest.raises(native.NativeAdapterError, match="cancelled"): await task
    asyncio.run(run())
    assert len(FakeModel.calls) == 1 and FakeModel.was_cancelled


def test_provider_error_no_secret_no_fallback(setup):
    FakeModel.replies = [RuntimeError("provider failed SECRET-API-KEY")]
    with pytest.raises(native.NativeAdapterError) as error:
        complete(setup, {"messages": [{"role": "user", "content": "Hi"}]})
    assert "SECRET" not in str(error.value) and len(FakeModel.calls) == 1


def test_native_gateway_never_uses_console_without_console_key(setup, monkeypatch):
    client, _, _, _, _ = setup
    monkeypatch.setattr(oc, "upstream_client", lambda: pytest.fail("Must not call Console"))
    FakeModel.replies = [message("Xin chào")]
    headers = {"Authorization": "Bearer offline-token-at-least-24-characters", "x-opencode-session": "ses_native"}
    response = client.post("/internal/opencode/v1/chat/completions", headers=headers, json={"model": native.MODEL_ID, "messages": [{"role": "user", "content": "Hi"}], "stream": True, "max_tokens": 999999, "baseURL": "http://evil"})
    assert response.status_code == 200 and 'data: [DONE]' in response.text and "Xin chào" in response.text
    assert FakeModel.calls[0][0].max_output_tokens == 800
    with db() as conn:
        assert tuple(conn.execute("SELECT input_measured,output_measured FROM opencode_lease").fetchone()) == (123, 20)


def test_legacy_db_migration_keeps_session(tmp_path, monkeypatch):
    import sqlite3
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE research_conversations(id TEXT PRIMARY KEY,owner_id TEXT,engine TEXT,model TEXT,title TEXT,settings TEXT,external_ack INTEGER,pinned INTEGER,archived INTEGER,runtime_session TEXT,created_at REAL,updated_at REAL)")
        conn.execute("INSERT INTO research_conversations VALUES('kept','owner','opencode','longcat-2.5-preview-free','Old session','{}',1,0,0,'ses_keep',1,1)")
    monkeypatch.setenv("RESEARCH_CHAT_DATABASE_PATH", str(path))
    with db() as conn:
        row = conn.execute("SELECT * FROM research_conversations WHERE id='kept'").fetchone()
        assert row["runtime_session"] == "ses_keep" and row["runtime_binding"] == "{}"


def test_same_model_name_cannot_hide_endpoint_change():
    first = FakeModel().model_copy(update={"base_url": "https://example.org/a?key=PRIVATE-A"})
    second = FakeModel().model_copy(update={"base_url": "https://different.example/b?key=PRIVATE-B"})
    assert native.binding_for(first) != native.binding_for(second)
    assert "PRIVATE" not in json.dumps(native.binding_for(first))


def test_disabled_configured_provider_cannot_be_reenabled_by_allowlist(setup, monkeypatch):
    monkeypatch.setenv("OPENCODE_ENABLE_CONFIGURED_PROVIDER", "false")
    monkeypatch.setenv("OPENCODE_ALLOWED_MODELS", "nexora-configured,mimo-v2.6-flash-free")
    assert native.MODEL_ID not in oc.allowed_models()
    client, _, _, _, _ = setup
    headers = {"Authorization": "Bearer offline-token-at-least-24-characters", "x-opencode-session": "ses_native"}
    response = client.post("/internal/opencode/v1/chat/completions", headers=headers, json={"model": native.MODEL_ID, "messages": [{"role": "user", "content": "Hi"}]})
    assert response.status_code == 400 and not FakeModel.calls


@pytest.mark.parametrize("name", ["Brief", "CoverageReview", "ReportDraft", "VisualDraft", "ReportAudit"])
def test_real_gemini_sdk_binds_all_report_contracts_without_network(name):
    from agent import research_contract
    from agent.model_output import transport_schema
    from langchain_google_genai import ChatGoogleGenerativeAI
    schema = getattr(research_contract, name)
    parameters = oc.inline_schema(transport_schema(schema, quote_refs=True, quote_ids=["Q1"]))
    llm = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", google_api_key="offline-no-network")
    result = llm.bind_tools([{"type": "function", "function": {"name": "StructuredOutput", "parameters": parameters}}])
    assert result.kwargs["tools"]
