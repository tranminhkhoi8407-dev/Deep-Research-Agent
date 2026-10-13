"""Durable conversations: permissions, privacy, retries, history and meeting conflicts."""
import base64
import json
import os
from contextlib import ExitStack
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from backend.accounts import register_login
from backend.collaboration import db, document_state
from backend.main import app


@pytest.fixture(autouse=True)
def database(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "chat.db"))
    monkeypatch.setenv("ADMIN_EMAILS", "")
    monkeypatch.setenv("APP_ENV", "development")


@pytest.fixture
def people():
    with ExitStack() as stack:
        result = []
        for name in ["Alice", "Bob", "Carol", "Dora"]:
            client = stack.enter_context(TestClient(app))
            user = register_login({"id": f"google:{name}", "provider": "google", "name": name, "email": f"{name}@example.com", "avatar_url": None, "username": None})
            cookie = base64.b64encode(json.dumps({"user": {"id": user["id"]}, "remember": False}).encode())
            client.cookies.set("deep_research_session", TimestampSigner(os.getenv("AUTH_SESSION_SECRET") or "deep-research-local-development-only-secret").sign(cookie).decode())
            assert client.put("/api/collab/identity", json={"name": name}).status_code == 200
            result.append((client, user["id"]))
        yield result


def invite(owner, member, kind, scope, username, role="editor"):
    response = owner.post(f"/api/collab/{kind}s/{scope}/invites", json={"username": username, "role": role})
    assert response.status_code == 201, response.text
    assert member.patch(f"/api/collab/invites/{response.json()['invite']['id']}?action=accept").status_code == 200


def project(owner, **kwargs):
    group = kwargs.pop("group_id", None)
    response = owner.post("/api/collab/projects" + (f"?group_id={group}" if group else ""), json={"name": "Paper project", "field": "artificial-intelligence", **kwargs})
    assert response.status_code == 201, response.text
    return response.json()["project"]["id"]


def send(client, scope, body="Research question", **kwargs):
    import uuid
    return client.post(scope + "/messages", json={"body": body, "client_id": uuid.uuid4().hex, **kwargs})


def meeting(**kwargs):
    return {"title": "Paper review", "starts_at": "2026-10-15T14:00:00+07:00", "ends_at": "2026-10-15T15:00:00+07:00", "timezone_label": "Asia/Bangkok", "meeting_url": "https://meet.google.com/abc-defg-hij", "agenda": "Methods and evidence", "notes": "", "client_id": "meeting-0001", **kwargs}


def test_group_projects_filter_restricted_and_chat_is_not_a_page_grant(people):
    (alice, _), (bob, _), (carol, _), _ = people
    group = alice.post("/api/collab/groups", json={"name": "AI Lab"}).json()["group"]["id"]
    invite(alice, bob, "group", group, "Bob")
    shared = project(alice, group_id=group, visibility="group")
    secret = project(alice, group_id=group, visibility="restricted", name="Secret results")
    assert {p["id"] for p in bob.get(f"/api/collab/groups/{group}").json()["projects"]} == {shared}
    assert bob.get(f"/api/discussions/spaces/project/{secret}").status_code in {403, 404}
    page = alice.post(f"/api/collab/projects/{shared}/pages", json={"title": "Shared page only"}).json()["page"]["id"]
    invite(alice, carol, "page", page, "Carol")
    for path in [f"/api/discussions/spaces/group/{group}", f"/api/discussions/spaces/project/{shared}"]:
        assert carol.get(path).status_code in {403, 404}
        assert send(carol, path).status_code in {403, 404}
    assert bob.get(f"/api/discussions/spaces/group/{group}").json()["can_write"]


def test_viewer_commenter_and_editor_actions(people):
    (alice, _), (bob, _), (carol, _), (dora, _) = people
    pid = project(alice)
    for client, name, role in [(bob, "Bob", "viewer"), (carol, "Carol", "commenter"), (dora, "Dora", "editor")]:
        invite(alice, client, "project", pid, name, role)
    scope = f"/api/discussions/spaces/project/{pid}"
    assert not bob.get(scope).json()["can_write"]
    assert send(bob, scope).status_code == 403
    msg = send(carol, scope).json()["message"]
    assert carol.put(f"/api/discussions/messages/{msg['id']}/pin", json={"pinned": True}).status_code == 403
    assert dora.put(f"/api/discussions/messages/{msg['id']}/pin", json={"pinned": True}).status_code == 200
    assert dora.patch(f"/api/discussions/messages/{msg['id']}", json={"body": "Other author", "expected_version": 1}).status_code == 403
    assert alice.request("DELETE", f"/api/discussions/messages/{msg['id']}", json={"expected_version": 1}).status_code == 200
    assert bob.get(f"/api/discussions/messages/{msg['id']}").json()["message"]["body"] == ""


def test_mentions_replies_mute_blocks_and_permission_redaction(people):
    (alice, aid), (bob, bid), (carol, cid), _ = people
    pid = project(alice)
    invite(alice, bob, "project", pid, "Bob")
    scope = f"/api/discussions/spaces/project/{pid}"
    assert send(alice, scope, mention_ids=[cid]).status_code == 422
    before = bob.get("/api/notifications/count").json()["unread_count"]
    assert send(alice, scope).status_code == 201
    assert bob.get("/api/notifications/count").json()["unread_count"] == before
    root = send(alice, scope, "@Bob evidence", mention_ids=[bid]).json()["message"]
    notifications = bob.get("/api/notifications").json()["notifications"]
    notice = next(n for n in notifications if n["kind"] == "chat.mention")
    assert notice["state"] == "available" and notice["href"].endswith("?view=discussion")
    assert "body" not in notice and "email" not in notice["actor"]
    reply = send(bob, scope, "Reply", parent_id=root["id"]).json()["message"]
    assert any(n["kind"] == "chat.reply" for n in alice.get("/api/notifications").json()["notifications"])
    assert alice.put(scope + "/preferences", json={"muted": True}).status_code == 200
    count = alice.get("/api/notifications/count").json()["unread_count"]
    send(bob, scope, parent_id=root["id"], mention_ids=[aid])
    assert alice.get("/api/notifications/count").json()["unread_count"] == count
    with db() as conn:
        conn.execute("INSERT INTO user_blocks VALUES (?,?,?)", (aid, bid, "2026-10-12T00:00:00Z"))
    assert alice.get(f"/api/discussions/messages/{reply['id']}").json()["message"]["deleted"]
    assert send(bob, scope, mention_ids=[aid]).status_code == 422
    assert alice.get(scope + "/messages?q=Reply").json()["messages"] == []
    with db() as conn:
        conn.execute("DELETE FROM project_members WHERE project_id=? AND user_id=?", (pid, bid))
    revoked = next(n for n in bob.get("/api/notifications").json()["notifications"] if n["id"] == notice["id"])
    assert revoked["state"] == "unavailable" and revoked["actor"] is None and revoked["title"] == "" and revoked["href"] is None
    assert bob.get(scope + "/messages").status_code in {403, 404}


def test_idempotent_retry_and_atomic_concurrent_send(people):
    (alice, _), *_ = people
    pid = project(alice); scope = f"/api/discussions/spaces/project/{pid}"
    payload = {"body": "Same request", "client_id": "retry-client-001"}
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(pool.map(lambda _: alice.post(scope + "/messages", json=payload), range(3)))
    assert all(r.status_code == 201 for r in responses)
    assert len({r.json()["message"]["id"] for r in responses}) == 1
    assert len(alice.get(scope + "/messages").json()["messages"]) == 1
    assert alice.post(scope + "/messages", json={**payload, "body": "Different request"}).status_code == 409


def test_threads_history_versions_and_monotonic_read_cursor(people):
    (alice, _), (bob, _), *_ = people
    pid = project(alice); other = project(alice, name="Other project")
    invite(alice, bob, "project", pid, "Bob")
    scope = f"/api/discussions/spaces/project/{pid}"
    roots = [send(alice, scope, f"Question {n}").json()["message"] for n in range(5)]
    first = bob.get(scope + "/messages?limit=2").json()
    second = bob.get(scope + f"/messages?limit=2&before={first['next_cursor']}").json()
    assert not {m["id"] for m in first["messages"]} & {m["id"] for m in second["messages"]}
    root = roots[0]
    reply = send(bob, scope, "Thread answer", parent_id=root["id"]).json()["message"]
    assert send(bob, scope, parent_id=reply["id"]).status_code == 422
    assert send(alice, f"/api/discussions/spaces/project/{other}", parent_id=root["id"]).status_code == 422
    assert len(bob.get(scope + f"/messages?parent_id={root['id']}").json()["messages"]) == 1
    assert alice.patch(f"/api/discussions/messages/{root['id']}", json={"body": "Edited root", "expected_version": 1}).status_code == 200
    assert alice.patch(f"/api/discussions/messages/{root['id']}", json={"body": "Stale", "expected_version": 1}).status_code == 409
    assert bob.put(scope + "/preferences", json={"through": first["through"]}).status_code == 200
    assert bob.put(scope + "/preferences", json={"through": 0}).status_code == 200
    assert bob.put(scope + "/preferences", json={"through": 999999}).status_code == 422
    assert bob.get(scope).json()["unread_count"] == 0
    assert alice.request("DELETE", f"/api/discussions/messages/{root['id']}", json={"expected_version": 2}).status_code == 200
    assert bob.get(scope + f"/messages?parent_id={root['id']}").json()["messages"][0]["body"] == "Thread answer"


def test_context_and_note_task_conversion_are_scoped_durable_and_idempotent(people):
    (alice, aid), (bob, _), *_ = people
    pid = project(alice); other = project(alice, name="Other project")
    page = alice.post(f"/api/collab/projects/{other}/pages", json={"title": "Private context"}).json()["page"]["id"]
    scope = f"/api/discussions/spaces/project/{pid}"
    assert send(alice, scope, context_kind="page", context_id=page).status_code == 422
    message = send(alice, scope, "Decision: compare baselines\nKeep original evidence.").json()["message"]
    for kind in ["task", "note"]:
        endpoint = f"/api/discussions/messages/{message['id']}/convert"
        initial = alice.post(endpoint, json={"kind": kind, "title": "Compare baselines"})
        assert initial.status_code == 200, initial.text
        repeated = alice.post(endpoint, json={"kind": kind, "title": "Changed title"}).json()
        assert repeated["existing"] and repeated["id"] == initial.json()["id"]
        if kind == "note":
            with db() as conn:
                state, _ = document_state(conn, repeated["id"])
                assert "Decision: compare baselines" in str(state.get("markdown", type=__import__('pycrdt').Text))
    detail = alice.get(f"/api/collab/projects/{pid}").json()
    assert len(detail["tasks"]) == 1 and len(detail["pages"]) == 1
    assert detail["tasks"][0]["assignee_id"] is None
    assert alice.post(f"/api/collab/pages/{detail['pages'][0]['id']}/archive").status_code == 200
    assert alice.post(f"/api/discussions/messages/{message['id']}/convert", json={"kind": "note", "title": "Do not duplicate"}).status_code == 409
    assert alice.get(scope).status_code == 200
    group = alice.post("/api/collab/groups", json={"name": "Group chat"}).json()["group"]["id"]
    group_msg = send(alice, f"/api/discussions/spaces/group/{group}").json()["message"]
    assert alice.post(f"/api/discussions/messages/{group_msg['id']}/convert", json={"kind": "task", "title": "Wrong scope"}).status_code in {403, 422}


@pytest.mark.parametrize("changes", [{"meeting_url": "javascript:alert(1)"}, {"meeting_url": "http://meet.example.com"}, {"meeting_url": "https://127.0.0.1"}, {"meeting_url": "https://localhost."}, {"meeting_url": "https://name:secret@meet.example.com"}, {"meeting_url": "https://2130706433"}, {"meeting_url": "https://[::1]"}, {"starts_at": "2026-10-15T14:00:00"}, {"ends_at": "2026-10-15T13:00:00+07:00"}, {"ends_at": "2026-10-16T15:00:00+07:00"}, {"title": "  "}])
def test_meetings_validate_time_and_public_links(people, changes):
    (alice, _), *_ = people
    pid = project(alice)
    assert alice.post(f"/api/discussions/spaces/project/{pid}/meetings", json=meeting(**changes)).status_code == 422


def test_meeting_schedule_rsvp_conflicts_and_archive_revocation(people):
    (alice, _), (bob, bid), (carol, _), *_ = people
    group = alice.post("/api/collab/groups", json={"name": "Research team"}).json()["group"]["id"]
    invite(alice, bob, "group", group, "Bob")
    scope = f"/api/discussions/spaces/group/{group}"
    response = alice.post(scope + "/meetings", json=meeting()); assert response.status_code == 201, response.text
    item = response.json()["meeting"]
    assert item["starts_at"] == "2026-10-15T07:00:00+00:00"
    assert alice.post(scope + "/meetings", json=meeting()).json()["meeting"]["id"] == item["id"]
    assert alice.post(scope + "/meetings", json=meeting(title="Different meeting")).status_code == 409
    assert bob.put(f"/api/discussions/meetings/{item['id']}/rsvp", json={"response": "maybe"}).status_code == 200
    assert carol.put(f"/api/discussions/meetings/{item['id']}/rsvp", json={"response": "yes"}).status_code == 403
    assert bob.patch(f"/api/discussions/meetings/{item['id']}", json=meeting(expected_version=1)).status_code == 403
    assert alice.patch(f"/api/discussions/meetings/{item['id']}", json=meeting(notes="Decision: rerun ablation", expected_version=1)).status_code == 200
    assert alice.patch(f"/api/discussions/meetings/{item['id']}", json=meeting(expected_version=1)).status_code == 409
    assert alice.patch(f"/api/discussions/meetings/{item['id']}", json=meeting(expected_version=2, status="cancelled", notes="Decision: rerun ablation")).status_code == 200
    assert bob.put(f"/api/discussions/meetings/{item['id']}/rsvp", json={"response": "yes"}).status_code == 409
    assert alice.post(f"/api/collab/groups/{group}/archive").status_code == 200
    assert bob.get(scope + "/meetings").status_code == 404
    notifications = bob.get("/api/notifications").json()["notifications"]
    notices = [n for n in notifications if n["kind"].startswith("meeting.")]
    assert notices and all(n["state"] == "unavailable" and not n["title"] and not n["actor"] for n in notices)
    assert alice.post(f"/api/collab/groups/{group}/restore").status_code == 200
    assert bob.get(scope + "/meetings").json()["meetings"][0]["notes"] == "Decision: rerun ablation"


def test_group_departure_revokes_persons_existing_project_grant(people):
    (alice, _), (bob, bid), *_ = people
    group = alice.post("/api/collab/groups", json={"name": "Lab"}).json()["group"]["id"]
    invite(alice, bob, "group", group, "Bob")
    pid = project(alice, group_id=group, visibility="restricted")
    invite(alice, bob, "project", pid, "Bob")
    scope = f"/api/discussions/spaces/project/{pid}"
    message = send(bob, scope).json()["message"]
    assert alice.delete(f"/api/collab/groups/{group}/members/{bid}").status_code == 200
    for endpoint in [scope, scope + "/messages", scope + "/meetings", f"/api/discussions/messages/{message['id']}"]:
        assert bob.get(endpoint).status_code in {403, 404}
    assert send(bob, scope).status_code in {403, 404}


def test_cached_history_search_and_removed_context_never_keep_old_content(people):
    (alice, aid), (bob, bid), *_ = people
    pid = project(alice)
    invite(alice, bob, "project", pid, "Bob")
    scope = f"/api/discussions/spaces/project/{pid}"
    page = alice.post(f"/api/collab/projects/{pid}/pages", json={"title": "Attached page"}).json()["page"]["id"]
    message = send(bob, scope, "ĐÁNH GIÁ bằng chứng", context_kind="page", context_id=page).json()["message"]
    assert alice.get(scope + "/messages?q=đánh giá").json()["messages"][0]["id"] == message["id"]
    assert alice.post(f"/api/collab/pages/{page}/archive").status_code == 200
    cached = alice.get(scope + f"/messages?include={message['id']}")
    assert cached.headers["Cache-Control"] == "private, no-store"
    assert cached.json()["refreshed"][0]["context"] is None
    assert bob.patch(f"/api/discussions/messages/{message['id']}", json={"body": "No matching words", "expected_version": 1}).status_code == 200
    assert alice.get(scope + f"/messages?q=đánh giá&include={message['id']}").json()["refreshed"] == []
    with db() as conn:
        conn.execute("INSERT INTO user_blocks VALUES (?,?,?)", (aid, bid, "2026-10-12T00:00:00Z"))
    cached = alice.get(scope + f"/messages?include={message['id']}").json()["refreshed"][0]
    assert cached["body"] == "" and cached["author"] is None and not cached["context"]
    other = project(alice, name="Different channel")
    assert alice.get(f"/api/discussions/spaces/project/{other}/messages?include={message['id']}").json()["refreshed"] == []
    assert alice.get(scope + "/messages?include=not-valid").status_code == 422


def test_archived_project_allows_history_but_not_mutations_even_for_viewers(people):
    (alice, _), (bob, _), *_ = people
    pid = project(alice); invite(alice, bob, "project", pid, "Bob", "viewer")
    scope = f"/api/discussions/spaces/project/{pid}"
    message = send(alice, scope).json()["message"]
    scheduled = alice.post(scope + "/meetings", json=meeting()).json()["meeting"]
    assert bob.put(f"/api/discussions/meetings/{scheduled['id']}/rsvp", json={"response": "yes"}).status_code == 200
    assert alice.patch(f"/api/collab/projects/{pid}", json={"status": "archived"}).status_code == 200
    assert alice.get(scope + "/messages").status_code == 200
    assert not bob.get(scope).json()["can_rsvp"]
    assert send(alice, scope).status_code == 409
    assert alice.put(f"/api/discussions/messages/{message['id']}/pin", json={"pinned": True}).status_code == 409
    assert bob.put(f"/api/discussions/meetings/{scheduled['id']}/rsvp", json={"response": "yes"}).status_code == 409


def test_meeting_history_has_stable_creation_cursor_and_current_permissions(people):
    (alice, aid), (bob, _), *_ = people
    pid = project(alice); scope = f"/api/discussions/spaces/project/{pid}"
    from backend.collaboration import ident
    with db() as conn:
        for index in range(35):
            mid = ident()
            conn.execute("""INSERT INTO research_meetings(id,scope_kind,scope_id,created_by,title,starts_at,ends_at,timezone_label,client_id,created_at,updated_at)
                VALUES (?,'project',?,?,?,'2026-10-15T00:00:00Z','2026-10-15T01:00:00Z','UTC',?,?,?)""", (mid, pid, aid, f"Review {index}", mid, f"2026-10-12T00:00:{index:02d}Z", "2026-10-12T00:00:00Z"))
    first = alice.get(scope + "/meetings").json()
    assert len(first["meetings"]) == 30 and first["meetings"][0]["title"] == "Review 34"
    second = alice.get(scope + f"/meetings?before={first['next_cursor']}").json()
    assert len(second["meetings"]) == 5 and second["next_cursor"] is None
    assert not {m["id"] for m in first["meetings"]} & {m["id"] for m in second["meetings"]}
    assert alice.get(scope + "/meetings?before=bad").status_code == 422
    assert bob.get(scope + "/meetings").status_code in {403, 404}
