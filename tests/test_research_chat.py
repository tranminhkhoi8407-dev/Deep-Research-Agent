"""Conversation/runtime security and lifecycle tests. No external calls."""
import json
import time
from types import SimpleNamespace

import pytest
import httpx
from langchain_core.messages import AIMessage
from fastapi.testclient import TestClient
from backend.main import app
from backend.auth import current_user
from backend import research_chat as chats, opencode_runtime as oc
from backend.research_chat_store import db, update_job, add_message, recover_jobs
REAL_RUN_TURN = chats.run_turn


@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED', 'false')
    monkeypatch.setenv("RESEARCH_CHAT_DATABASE_PATH", str(tmp_path / "chats.db"))
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("OPENCODE_GATEWAY_TOKEN", "test-gateway-token-with-at-least-24-chars")
    monkeypatch.setenv("OPENCODE_UPSTREAM_API_KEY", "offline-test-provider-key")
    monkeypatch.setattr(chats, "run_turn", lambda jid: None)
    app.dependency_overrides[current_user] = lambda: {"id": "owner"}
    monkeypatch.setattr(oc, "status", lambda: {"configured": True, "ready": True, "code": "ready", "models": []})
    yield
    app.dependency_overrides.pop(current_user, None)


def create(client, **extra):
    legacy = extra.get('engine') == 'opencode'
    response = client.post("/api/research/chats", json={"engine": "nexora", **{k:v for k,v in extra.items() if not legacy or k not in {'engine','model','external_data_ack'}}})
    assert response.status_code == 201, response.text
    cid=response.json()["id"]
    if legacy:
        with db() as conn:
            conn.execute("UPDATE research_conversations SET engine='opencode',model=?,external_ack=1 WHERE id=?", (extra['model'],cid))
    return cid


def send(client, cid, key="request-001", **extra):
    return client.post(f"/api/research/chats/{cid}/messages", json={"client_id": key, "text": "Explain MediaPipe please", **extra})


def test_owner_scope_and_no_runtime_credentials(setup):
    with TestClient(app) as client:
        cid = create(client)
        with db() as conn:
            conn.execute("UPDATE research_conversations SET runtime_session='secret-runtime-id' WHERE id=?", (cid,))
        response = client.get(f"/api/research/chats/{cid}")
        assert "secret-runtime-id" not in response.text and "owner_id" not in response.text
        app.dependency_overrides[current_user] = lambda: {"id": "other"}
        assert client.get(f"/api/research/chats/{cid}").status_code == 404
        assert client.patch(f"/api/research/chats/{cid}", json={"archived": True}).status_code == 404
        assert send(client, cid).status_code == 404
        assert client.post(f"/api/research/chats/{cid}/stop").status_code == 404
        assert client.get("/api/research/chats").json()["conversations"] == []


def test_idempotency_conflict_and_one_active_turn(setup):
    with TestClient(app) as client:
        cid = create(client)
        first = send(client, cid)
        assert first.status_code == 202
        assert send(client, cid).json()["id"] == first.json()["id"]
        assert send(client, cid, text="Different text").status_code == 409
        assert send(client, cid, key="request-002").status_code == 409
        detail = client.get(f"/api/research/chats/{cid}").json()
        assert len(detail["jobs"]) == len(detail["messages"]) == 1


def test_history_persists_new_client_archive_restore(setup):
    with TestClient(app) as client:
        cid = create(client)
        first = send(client, cid).json()
        update_job(first["id"], status="completed")
        with db() as conn:
            add_message(conn, cid, "assistant", "Training has 32 rollouts.", first["id"])
        assert client.patch(f"/api/research/chats/{cid}", json={"pinned": True, "title": "FINER"}).status_code == 200
    with TestClient(app) as client:
        detail = client.get(f"/api/research/chats/{cid}").json()
        assert detail["messages"][-1]["body"] == "Training has 32 rollouts."
        assert detail["pinned"] is True
        assert client.patch(f"/api/research/chats/{cid}", json={"archived": True}).status_code == 200
        assert send(client, cid, key="request-002").status_code == 409
        assert len(client.get("/api/research/chats?archived=true").json()["conversations"]) == 1
        assert client.patch(f"/api/research/chats/{cid}", json={"archived": False}).status_code == 200
        assert send(client, cid, key="request-002").status_code == 202


def test_cross_origin_blocked(setup):
    with TestClient(app) as client:
        assert client.post("/api/research/chats", json={}, headers={"Origin": "https://evil.example"}).status_code == 403


def test_sidebar_summaries_activity_and_search_are_owner_scoped(setup):
    with TestClient(app) as client:
        cid = create(client, title='ĐỌC PAPER')
        jid = send(client, cid).json()['id']
        with db() as conn:
            add_message(conn, cid, 'assistant', 'Nội dung hidden needle %_ và UTF-8', jid)
            conn.execute("UPDATE research_conversations SET runtime_session='native-secret' WHERE id=?", (cid,))
            conn.execute("UPDATE research_chat_jobs SET request='secret-request',fingerprint='secret-fingerprint' WHERE id=?", (jid,))
        rows = client.get('/api/research/chats').json()['conversations']
        assert rows[0]['latest_job']['id'] == jid
        assert rows[0]['latest_job']['status'] == 'queued'
        activity = client.get('/api/research/chats/activity')
        assert activity.status_code == 200
        assert activity.json()['activities'][0]['conversation_id'] == cid
        for endpoint in ('', '/activity', '/search?q=hidden'):
            result = client.get('/api/research/chats' + endpoint)
            assert all(secret not in result.text for secret in ('native-secret', 'secret-request', 'secret-fingerprint', 'owner_id', 'runtime_binding'))
        assert client.get('/api/research/chats/search', params={'q': 'đọc'}).json()['conversations'][0]['id'] == cid
        results = client.get('/api/research/chats/search', params={'q': '%_'}).json()['conversations']
        assert len(results) == 1 and 'hidden needle' in results[0]['snippet']
        assert client.get('/api/research/chats/search?q=unmatched').json()['conversations'] == []
        assert client.get('/api/research/chats/search?q=h').json()['conversations'] == []
        assert client.get('/api/research/chats/search', params={'q': 'x' * 121}).status_code == 422
        app.dependency_overrides[current_user] = lambda: {'id': 'other'}
        assert client.get('/api/research/chats/activity').json()['activities'] == []
        assert client.get('/api/research/chats/search?q=hidden').json()['conversations'] == []
        assert client.delete('/api/research/chats/' + cid).status_code == 404


def test_search_covers_older_messages_and_ignores_archived(setup):
    with TestClient(app) as client:
        cid = create(client)
        with db() as conn:
            add_message(conn, cid, 'user', 'ancient unique needle')
            for _ in range(210):
                add_message(conn, cid, 'assistant', 'other')
        assert client.get('/api/research/chats/search?q=ancient').json()['conversations'][0]['id'] == cid
        assert client.patch('/api/research/chats/' + cid, json={'archived': True}).status_code == 200
        assert client.get('/api/research/chats/search?q=ancient').json()['conversations'] == []
        assert client.get('/api/research/chats/activity').json()['activities'] == []


@pytest.mark.parametrize('state', ['queued', 'running', 'awaiting_input'])
def test_delete_never_cancels_active_sessions(setup, state):
    with TestClient(app) as client:
        cid = create(client)
        jid = send(client, cid).json()['id']
        update_job(jid, status=state)
        result = client.delete('/api/research/chats/' + cid)
        assert result.status_code == 409 and result.json()['detail'] == 'conversation_busy'
        assert client.get('/api/research/chats/' + cid).status_code == 200
        with db() as conn:
            assert conn.execute('SELECT cancel_requested FROM research_chat_jobs WHERE id=?', (jid,)).fetchone()[0] == 0


def test_delete_removes_only_owned_history_and_unshared_files(setup, tmp_path):
    from backend.research_chat_store import ident
    with TestClient(app) as client:
        cid, other = create(client), create(client)
        jid = send(client, cid).json()['id']
        update_job(jid, status='completed')
        aid, shared = ident(), ident()
        with db() as conn:
            for attachment in (aid, shared):
                conn.execute("INSERT INTO research_chat_attachments VALUES(?,?,?,?,?,?,?,?,?,?)", (attachment, 'owner', 'note.pdf', 'application/pdf', 'document', 4, b'test', 'text', '', time.time()))
            mid = add_message(conn, cid, 'user', 'files', jid)
            other_mid = add_message(conn, other, 'user', 'shared file')
            conn.execute('INSERT INTO research_message_attachments VALUES(?,?,?)', (mid, aid, 0))
            conn.execute('INSERT INTO research_message_attachments VALUES(?,?,?)', (mid, shared, 1))
            conn.execute('INSERT INTO research_message_attachments VALUES(?,?,?)', (other_mid, shared, 0))
            conn.execute("INSERT INTO research_chat_questions VALUES(?,?,?,?,?,?,?,?)", (ident(), jid, 'q-native', '{}', 'answered', '[]', time.time(), time.time()))
        saved = tmp_path / 'reports' / 'independent-report.md'
        saved.parent.mkdir(exist_ok=True); saved.write_text('Keep saved reports', encoding='utf-8')
        assert client.delete('/api/research/chats/' + cid, headers={'Origin': 'https://evil.example'}).status_code == 403
        assert client.delete('/api/research/chats/' + cid).status_code == 204
        assert client.get('/api/research/chats/' + cid).status_code == 404
        assert client.delete('/api/research/chats/' + cid).status_code == 404
        assert client.get('/api/research/chats/' + other).status_code == 200
        assert saved.read_text(encoding='utf-8') == 'Keep saved reports'
        with db() as conn:
            assert conn.execute('SELECT 1 FROM research_chat_attachments WHERE id=?', (aid,)).fetchone() is None
            assert conn.execute('SELECT 1 FROM research_chat_attachments WHERE id=?', (shared,)).fetchone()
            assert conn.execute('SELECT 1 FROM research_chat_jobs WHERE id=?', (jid,)).fetchone() is None
            assert conn.execute('SELECT 1 FROM research_chat_questions WHERE job_id=?', (jid,)).fetchone() is None
            assert conn.execute('PRAGMA foreign_key_check').fetchall() == []


def test_delete_direct_profile_is_exact_and_cleanup_failure_retains_chat(setup, monkeypatch, tmp_path):
    from backend import opencode_direct as direct, research_chat_lifecycle as lifecycle
    monkeypatch.setattr(direct, 'ROOT', tmp_path)
    with TestClient(app) as client:
        cid, other = create(client), create(client)
        with db() as conn:
            conn.execute("UPDATE research_conversations SET engine='opencode',runtime_binding=? WHERE id=?", (json.dumps({'transport': direct.INTERACTIVE_TRANSPORT}), cid))
        profile = direct.owned_folder({'id': cid, 'owner_id': 'owner'})
        sibling = direct.owned_folder({'id': other, 'owner_id': 'owner'})
        profile.mkdir(parents=True); sibling.mkdir(parents=True)
        (profile / 'session.db').write_bytes(b'synthetic fixture')
        (sibling / 'untouched.db').write_bytes(b'other chat')
        real_purge = lifecycle.purge_profile
        monkeypatch.setattr(lifecycle, 'purge_profile', lambda row: (_ for _ in ()).throw(OSError('secret-host-path')))
        result = client.delete('/api/research/chats/' + cid)
        assert result.status_code == 409 and 'secret-host-path' not in result.text
        assert client.get('/api/research/chats/' + cid).status_code == 200
        monkeypatch.setattr(lifecycle, 'purge_profile', real_purge)
        assert client.delete('/api/research/chats/' + cid).status_code == 204
        assert not profile.exists() and (sibling / 'untouched.db').read_bytes() == b'other chat'


def test_profile_cleanup_rejects_escaping_symlink(setup, monkeypatch, tmp_path):
    from backend import opencode_direct as direct, research_chat_lifecycle as lifecycle
    from fastapi import HTTPException
    monkeypatch.setattr(direct, 'ROOT', tmp_path)
    profile = direct.owned_folder({'id': 'a' * 32, 'owner_id': 'owner'})
    profile.parent.mkdir(parents=True)
    outside = tmp_path / 'do-not-delete'; outside.mkdir(); (outside / 'keep').write_text('safe')
    try:
        profile.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('Host does not allow creating symlinks')
    with pytest.raises(HTTPException):
        lifecycle.purge_profile({'id': 'a' * 32, 'owner_id': 'owner'})
    assert (outside / 'keep').read_text() == 'safe'


def test_manual_title_survives_first_turn(setup):
    with TestClient(app) as client:
        for rename in (False, True):
            cid = create(client, **({} if rename else {'title': 'My chosen title'}))
            if rename:
                assert client.patch('/api/research/chats/' + cid, json={'title': 'My chosen title'}).status_code == 200
            assert send(client, cid).status_code == 202
            assert client.get('/api/research/chats/' + cid).json()['title'] == 'My chosen title'


def test_delete_waits_for_completed_worker_lease_cleanup(setup):
    from backend.research_chat_lifecycle import delete_owned_chat
    from fastapi import HTTPException
    with TestClient(app) as client:
        cid = create(client)
        jid = send(client, cid).json()['id']; update_job(jid, status='completed')
        with db() as conn:
            conn.execute('INSERT INTO research_chat_workers VALUES(?,?,?,?,?,?)', (jid, 0, 0, 0, 0, 'synthetic'))
        with pytest.raises(HTTPException, match='conversation_busy'):
            delete_owned_chat('owner', cid)
        with db() as conn:
            conn.execute('DELETE FROM research_chat_workers WHERE job_id=?', (jid,))
            conn.execute('INSERT INTO opencode_lease(slot,job_id,expires_at,context) VALUES(1,?,?,?)', (jid, time.time()+30, '{}'))
        with pytest.raises(HTTPException, match='conversation_busy'):
            delete_owned_chat('owner', cid)
        with db() as conn:
            conn.execute('DELETE FROM opencode_lease WHERE job_id=?', (jid,))
        assert client.delete('/api/research/chats/' + cid).status_code == 204


@pytest.mark.parametrize('code', [200, 204, 404, 401, 403, 500])
def test_gateway_delete_checks_native_result_before_local_deletion(setup, monkeypatch, code):
    calls = []
    class OfflineRuntime:
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def delete(self, path):
            calls.append(path)
            return SimpleNamespace(status_code=code)
    monkeypatch.setattr(oc, 'client', lambda: OfflineRuntime())
    with TestClient(app) as client:
        cid = create(client, engine='opencode', model='legacy')
        with db() as conn:
            conn.execute("UPDATE research_conversations SET runtime_session='ses_synthetic' WHERE id=?", (cid,))
            conn.execute('INSERT INTO opencode_provider_messages VALUES(?,?,?,?,?,?)', ('owner', 'ses_synthetic', 'call', '{}', '{}', time.time()))
        response = client.delete('/api/research/chats/' + cid)
        assert calls == ['/session/ses_synthetic']
        if code in (200, 204, 404):
            assert response.status_code == 204
            assert client.get('/api/research/chats/' + cid).status_code == 404
            with db() as conn:
                assert conn.execute("SELECT 1 FROM opencode_provider_messages WHERE session_id='ses_synthetic'").fetchone() is None
        else:
            assert response.status_code == 409
            assert client.get('/api/research/chats/' + cid).status_code == 200


def test_gateway_delete_never_targets_shared_or_invalid_native_session(setup, monkeypatch):
    monkeypatch.setattr(oc, 'client', lambda: pytest.fail('Unsafe session must never reach native worker'))
    with TestClient(app) as client:
        cid = create(client, engine='opencode', model='legacy')
        other = create(client)
        with db() as conn:
            conn.execute("UPDATE research_conversations SET runtime_session='ses_shared' WHERE id IN (?,?)", (cid, other))
        assert client.delete('/api/research/chats/' + cid).status_code == 409
        with db() as conn:
            conn.execute("UPDATE research_conversations SET runtime_session='../unsafe' WHERE id=?", (cid,))
        assert client.delete('/api/research/chats/' + cid).status_code == 409


def test_permanent_delete_does_not_reset_hourly_rate_limit(setup):
    from backend.research_chat_store import ident
    with TestClient(app) as client:
        cid = create(client)
        now = time.time()
        with db() as conn:
            for index in range(59):
                conn.execute("INSERT INTO research_chat_jobs(id,conversation_id,client_id,fingerprint,action,status,request,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", (ident(), cid, f'synthetic-{index}', 'fixture', 'chat', 'completed', '{}', now, now))
        jid = send(client, cid).json()['id']; update_job(jid, status='completed')
        assert client.delete('/api/research/chats/' + cid).status_code == 204
        next_cid = create(client)
        assert send(client, next_cid).status_code == 429
        with db() as conn:
            rows = conn.execute("SELECT * FROM research_chat_deleted_usage WHERE kind='turn'").fetchall()
            assert len(rows) == 60 and set(rows[0].keys()) == {'id', 'owner_id', 'kind', 'created_at'}
        app.dependency_overrides[current_user] = lambda: {'id': 'other'}
        assert send(client, create(client)).status_code == 202


def test_permanent_delete_does_not_reset_daily_create_limit(setup):
    from backend.research_chat_store import ident
    with TestClient(app) as client:
        cid = create(client)
        assert client.delete('/api/research/chats/' + cid).status_code == 204
        with db() as conn:
            for _ in range(99):
                conn.execute('INSERT INTO research_chat_deleted_usage VALUES(?,?,?,?)', (ident(), 'owner', 'conversation', time.time()))
        assert client.post('/api/research/chats', json={}).status_code == 429
        with db() as conn:
            conn.execute('UPDATE research_chat_deleted_usage SET created_at=?', (time.time() - 86500,))
        assert client.post('/api/research/chats', json={}).status_code == 201


def test_public_only_guard_consent_and_model_allowlist(setup, monkeypatch):
    monkeypatch.setattr(chats.DocumentStore, "get", lambda *args: {"id": "a" * 64})
    with TestClient(app) as client:
        assert client.post("/api/research/chats", json={"engine": "opencode", "model": "mimo-v2.6-flash-free"}).status_code == 422
        assert client.post("/api/research/chats", json={"engine": "opencode", "model": "paid-model", "external_data_ack": True}).status_code == 422
        response = client.post("/api/research/chats", json={"engine": "opencode", "model": "mimo-v2.6-flash-free", "external_data_ack": True, "settings": {"analysis_mode": "paper", "document_id": "a" * 64}})
        assert response.status_code == 422 and response.json()["detail"] == "opencode_public_sources_only"
        assert create(client, engine="opencode", model="longcat-2.5-preview-free", external_data_ack=True)


def test_doc_owner_guard_before_any_runtime_call(setup, monkeypatch):
    monkeypatch.setattr(chats.DocumentStore, "get", lambda *args: None)
    with TestClient(app) as client:
        assert client.post("/api/research/chats", json={"settings": {"document_id": "a" * 64}}).status_code == 404


def test_stop_persists_cancellation_and_archive_busy(setup):
    with TestClient(app) as client:
        cid = create(client)
        job = send(client, cid).json()
        assert client.patch(f"/api/research/chats/{cid}", json={"archived": True}).status_code == 409
        assert client.post(f"/api/research/chats/{cid}/stop").status_code == 200
        with db() as conn:
            assert conn.execute("SELECT cancel_requested FROM research_chat_jobs WHERE id=?", (job["id"],)).fetchone()[0] == 1


def test_recovery_never_replays_old_model_request(setup):
    with TestClient(app) as client:
        cid = create(client)
        job = send(client, cid).json()
        with db() as conn:
            conn.execute("UPDATE research_chat_jobs SET updated_at=? WHERE id=?", (time.time() - 1000, job["id"]))
        recover_jobs()
        detail = client.get(f"/api/research/chats/{cid}").json()
        assert detail["jobs"][0]["status"] == "interrupted"
        assert send(client, cid).json()["id"] == job["id"]
        assert len(detail["messages"]) == 1


def authorize_lease(client):
    cid = create(client)
    jid = send(client, cid).json()["id"]
    update_job(jid, status="running")
    context = {"owner": "owner", "model": "mimo-v2.6-flash-free", "sessions": ["ses_offline"], "budget": {"max_llm_calls": 1, "max_input_tokens": 10000, "max_output_tokens": 1000}, "evidence": [{"id": "owned-excerpt", "text": "GRPO training uses 32 rollouts.", "title": "Public paper", "locator": "p9"}]}
    with db() as conn:
        conn.execute("INSERT INTO opencode_lease(slot,job_id,expires_at,context,cap) VALUES(1,?,?,?,?)", (jid, time.time() + 60, json.dumps(context), 800))
    return cid, jid


def test_gateway_auth_context_model_and_budget_before_network(setup):
    headers = {"Authorization": "Bearer test-gateway-token-with-at-least-24-chars", "x-opencode-session": "ses_offline"}
    with TestClient(app) as client:
        assert client.post("/internal/opencode/reader", json={}).status_code == 403
        assert client.post("/internal/opencode/reader", json={}, headers=headers).status_code == 409
        _, jid = authorize_lease(client)
        payload = {"model": "paid-model", "messages": [{"role": "user", "content": "Hi"}]}
        assert client.post("/internal/opencode/v1/chat/completions", json=payload, headers=headers).status_code == 429
        with db() as conn:
            assert conn.execute("SELECT calls FROM opencode_lease").fetchone()[0] == 0
            conn.execute("UPDATE opencode_lease SET calls=1")
        payload["model"] = "mimo-v2.6-flash-free"
        assert client.post("/internal/opencode/v1/chat/completions", json=payload, headers=headers).status_code == 429


def test_reader_only_authorized_excerpts_and_cancellation(setup):
    headers = {"Authorization": "Bearer test-gateway-token-with-at-least-24-chars", "x-opencode-session": "ses_offline"}
    with TestClient(app) as client:
        cid, jid = authorize_lease(client)
        assert client.post("/internal/opencode/reader", json={"tool": "read", "ids": ["../other-user"]}, headers=headers).status_code == 404
        response = client.post("/internal/opencode/reader", json={"tool": "read", "ids": ["owned-excerpt"]}, headers=headers)
        assert response.json()["chunks"][0]["text"] == "GRPO training uses 32 rollouts."
        client.post(f"/api/research/chats/{cid}/stop")
        assert client.post("/internal/opencode/reader", json={"tool": "read", "ids": ["owned-excerpt"]}, headers=headers).status_code == 409


def test_runtime_url_never_supplied_by_frontend(setup, monkeypatch):
    monkeypatch.setenv("OPENCODE_SERVER_URL", "http://169.254.169.254")
    with pytest.raises(oc.RuntimeErrorSafe):
        oc.safe_url()


def test_no_private_trial_endpoint_even_admin_whitelists_it(setup, monkeypatch):
    monkeypatch.setenv("OPENCODE_PRIVATE_MODELS", "nemotron-3-ultra-free,muse-spark-1.3-contributor-free,longcat-2.5-preview-free")
    assert not oc.private_allowed("nemotron-3-ultra-free")
    assert not oc.private_allowed("muse-spark-1.3-contributor-free")
    assert oc.private_allowed("longcat-2.5-preview-free")


def test_native_turn_keeps_history_language_and_context_local(setup, monkeypatch):
    from agent.runtime import research_invoker
    calls = []
    def factory(jid):
        def invoke(schema, messages, **kwargs):
            calls.append(kwargs["prepared_payload"])
            assert "Vietnamese" in messages[0].content
            assert 'current_user_request' in messages[0].content
            return {"parsed": {"text": "Phản hồi tiếng Việt có lưu lịch sử."}, "raw": AIMessage(content="", usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120})}
        return invoke
    monkeypatch.setattr(chats, "native_invoke", factory)
    with TestClient(app) as client:
        cid = create(client)
        first = send(client, cid, text="Giải thích bằng tiếng Việt").json()
        REAL_RUN_TURN(first["id"])
        second = send(client, cid, key="request-002", text="Giải thích tiếp bằng tiếng Việt").json()
        REAL_RUN_TURN(second["id"])
        detail = client.get(f"/api/research/chats/{cid}").json()
        assert all(job["status"] == "completed" for job in detail["jobs"])
        assert detail["jobs"][0]["usage"]["llm_calls"] == 1
        assert "Phản hồi tiếng Việt" in calls[1]["history_unverified"]
        assert calls[1]['current_user_request'] == 'Giải thích tiếp bằng tiếng Việt'
        assert research_invoker.get() is None


def test_report_versions_are_distinct_and_partial_is_not_completed(setup, monkeypatch):
    from backend.main import _reports_dir
    from agent import deep_research
    from agent.runtime import research_invoker
    class SyntheticGraph:
        outcomes = iter(["partial", "failed"])
        def stream(self, initial, config, **kwargs):
            assert research_invoker.get() is not None
            outcome = next(self.outcomes)
            yield {"finalize_report": {"report_data": {"language": "vi", "title": "Bản kiểm thử", "outcome": outcome, "evidence": []}, "final_report": "Nội dung tổng hợp để kiểm thử, không phải nghiên cứu thật.", "usage": {"llm_calls": 0}}}
    monkeypatch.setattr(deep_research, "batch_graph", SyntheticGraph())
    with TestClient(app) as client:
        cid = create(client)
        for index in range(2):
            job = send(client, cid, key=f"report-00{index}", action="report", text="Phân tích MediaPipe bằng tiếng Việt").json()
            REAL_RUN_TURN(job["id"])
        detail = client.get(f"/api/research/chats/{cid}").json()
        assert [item["status"] for item in detail["jobs"]] == ["failed", "partial"]
        paths = [_reports_dir("owner") / item["report_id"] for item in detail["jobs"]]
        assert paths[0] != paths[1]
        assert all(path.is_file() and path.with_suffix(".research.json").is_file() for path in paths)
        assert "Chưa tạo được" in detail["messages"][-1]["body"]
        assert research_invoker.get() is None


def test_cancelled_job_never_calls_model(setup, monkeypatch):
    monkeypatch.setattr(chats, "native_invoke", lambda jid: pytest.fail("Must not construct a model for a stopped job"))
    with TestClient(app) as client:
        cid = create(client)
        job = send(client, cid).json()
        client.post(f"/api/research/chats/{cid}/stop")
        REAL_RUN_TURN(job["id"])
        assert client.get(f"/api/research/chats/{cid}").json()["jobs"][0]["status"] == "cancelled"


def test_gateway_clamps_output_measures_usage_and_drops_overrides(setup, monkeypatch):
    forwarded = []
    async def provider(request):
        body = json.loads(request.content)
        forwarded.append(body)
        assert str(request.url) == "https://opencode.ai/inference/openai/v1/chat/completions"
        assert body["max_tokens"] == 800 and "baseURL" not in body and "apiKey" not in body
        return httpx.Response(200, json={"choices": [{"message": {"content": "synthetic"}}], "usage": {"prompt_tokens": 13, "completion_tokens": 7}})
    monkeypatch.setattr(oc, "upstream_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(provider)))
    headers = {"Authorization": "Bearer test-gateway-token-with-at-least-24-chars", "x-opencode-session": "ses_offline"}
    with TestClient(app) as client:
        _, jid = authorize_lease(client)
        body = {"model": "mimo-v2.6-flash-free", "messages": [{"role": "user", "content": "hello"}], "max_tokens": 999999, "baseURL": "http://169.254.169.254", "apiKey": "not-allowed"}
        assert client.post("/internal/opencode/v1/chat/completions", json=body, headers=headers).status_code == 200
        assert client.post("/internal/opencode/v1/chat/completions", json=body, headers=headers).status_code == 429
        assert len(forwarded) == 1
        with db() as conn:
            lease = conn.execute("SELECT * FROM opencode_lease WHERE job_id=?", (jid,)).fetchone()
            assert lease["input_measured"] == 13 and lease["output_measured"] == 7


def test_language_conflict_and_extra_runtime_fields_rejected(setup):
    with TestClient(app) as client:
        assert client.post("/api/research/chats", json={"server_url": "http://evil"}).status_code == 422
        cid = create(client, settings={"report_language": "en"})
        assert send(client, cid, text="Trả lời bằng tiếng Việt").status_code == 422
        assert send(client, cid, runtime_session="arbitrary").status_code == 422
        assert client.patch(f"/api/research/chats/{cid}", json={"title": "   "}).status_code == 422


def test_active_job_model_revocation_is_respected(setup, monkeypatch):
    with TestClient(app) as client:
        cid = create(client, engine="opencode", model="longcat-2.5-preview-free", external_data_ack=True)
        monkeypatch.setenv("OPENCODE_ALLOWED_MODELS", "mimo-v2.6-flash-free")
        assert send(client, cid).status_code == 422


def test_missing_service_access_does_not_reuse_desktop_or_public_auth(setup, monkeypatch):
    for key in ("", "public"):
        monkeypatch.setenv("OPENCODE_UPSTREAM_API_KEY", key)
        with pytest.raises(oc.RuntimeErrorSafe, match="opencode_service_access_required"):
            oc.OpenCodeTurn("job", {"model": "longcat-2.5-preview-free"}, {}, []).__enter__()


def test_gateway_rejects_stale_session_even_with_worker_secret(setup):
    with TestClient(app) as client:
        authorize_lease(client)
        headers = {"Authorization": "Bearer test-gateway-token-with-at-least-24-chars", "x-opencode-session": "ses_other_user"}
        response = client.post("/internal/opencode/v1/chat/completions", json={"model": "mimo-v2.6-flash-free", "messages": []}, headers=headers)
        assert response.status_code == 403
        with db() as conn:
            assert conn.execute("SELECT calls FROM opencode_lease").fetchone()[0] == 0


def test_free_tier_rejection_is_not_an_infinite_sdk_retry(setup, monkeypatch):
    async def provider(request):
        return httpx.Response(403, json={"error": {"type": "FreeTierError", "message": "provider text must not leak"}})
    monkeypatch.setattr(oc, "upstream_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(provider)))
    with TestClient(app) as client:
        authorize_lease(client)
        headers = {"Authorization": "Bearer test-gateway-token-with-at-least-24-chars", "x-opencode-session": "ses_offline"}
        response = client.post("/internal/opencode/v1/chat/completions", json={"model": "mimo-v2.6-flash-free", "messages": []}, headers=headers)
        assert response.status_code == 400 and "provider text" not in response.text
        assert response.json()["error"]["code"] == "opencode_free_tier_restricted"
