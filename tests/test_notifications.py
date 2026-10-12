"""Real authenticated requests: inbox privacy, friendship races and block ownership."""
import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from backend.accounts import register_login, _database_path
from backend.collaboration import db, _SCHEMA_READY
from backend.main import app
from backend.notifications import notify


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "social.db"))
    monkeypatch.setenv("ADMIN_EMAILS", "")
    monkeypatch.setenv("APP_ENV", "development")


def login(client, suffix):
    user = register_login({"id": f"google:{suffix}", "provider": "google", "name": suffix.title(), "email": f"{suffix}@example.com", "avatar_url": None, "username": None})
    payload = base64.b64encode(json.dumps({"user": {"id": user["id"]}, "remember": False}).encode())
    signed = TimestampSigner(os.getenv("AUTH_SESSION_SECRET") or "deep-research-local-development-only-secret").sign(payload).decode()
    client.cookies.set("deep_research_session", signed)
    assert client.put("/api/collab/identity", json={"name": suffix.title()}).status_code == 200


def request(client, target):
    return client.post("/api/collab/connections", json={"username": target})


def inbox(client):
    result = client.get("/api/notifications")
    assert result.status_code == 200, result.text
    return result.json()


def test_friend_request_is_idempotent_reading_and_archiving_do_not_accept():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        first = request(alice, "Bob").json()
        assert request(alice, "Bob").json()["id"] == first["id"]
        received = inbox(bob)
        assert received["unread_count"] == 1 and len(received["notifications"]) == 1
        item = received["notifications"][0]
        assert item["state"] == "pending" and item["action_id"] == first["id"]
        assert "email" not in item["actor"]
        assert alice.patch(f"/api/notifications/{item['id']}", json={"action": "read"}).status_code == 404
        assert bob.patch(f"/api/notifications/{item['id']}", json={"action": "read"}).status_code == 200
        assert inbox(bob)["unread_count"] == 0
        assert bob.get("/api/collab/connections").json()["connections"][0]["status"] == "pending"
        assert bob.patch(f"/api/notifications/{item['id']}", json={"action": "unread"}).status_code == 200
        assert bob.patch(f"/api/notifications/{item['id']}", json={"action": "archive"}).status_code == 200
        assert inbox(bob)["notifications"] == []
        assert bob.get("/api/collab/connections").json()["connections"][0]["status"] == "pending"


def test_accept_updates_both_inboxes_once_and_unfriend_does_not_revoke_sharing():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        connection = request(alice, "Bob").json()["id"]
        item = inbox(bob)["notifications"][0]
        assert alice.post(f"/api/notifications/{item['id']}/respond", json={"action": "accept"}).status_code == 404
        assert bob.post(f"/api/notifications/{item['id']}/respond", json={"action": "accept"}).status_code == 200
        assert bob.patch(f"/api/collab/connections/{connection}?action=accept").status_code == 200
        assert inbox(bob)["notifications"][0]["state"] == "accepted"
        assert inbox(bob)["unread_count"] == 0
        assert len(inbox(alice)["notifications"]) == 1
        project = alice.post("/api/collab/projects", json={"name": "Private project", "field": "mathematics"}).json()["project"]
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404
        invite = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        assert bob.patch(f"/api/collab/invites/{invite['id']}?action=accept").status_code == 200
        assert bob.delete(f"/api/collab/connections/{connection}").status_code == 200
        assert bob.get("/api/collab/connections").json()["connections"] == []
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 200
        assert not any(n["href"] == "#/collab/people" for n in inbox(alice)["notifications"])


def test_cancel_only_sender_and_cooldown_survives_deletion():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        login(alice, "alice"); login(bob, "bob"); login(carol, "carol")
        connection = request(alice, "Bob").json()["id"]
        notification = inbox(bob)["notifications"][0]["id"]
        assert bob.delete(f"/api/collab/connections/{connection}").status_code == 403
        assert carol.delete(f"/api/collab/connections/{connection}").status_code == 404
        assert alice.delete(f"/api/collab/connections/{connection}").status_code == 200
        assert inbox(bob)["notifications"][0]["state"] == "unavailable"
        assert bob.post(f"/api/notifications/{notification}/respond", json={"action": "accept"}).status_code == 409
        assert request(alice, "Bob").status_code == 429


def test_decline_cooldown_and_no_decline_notification():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        connection = request(alice, "Bob").json()["id"]
        assert bob.patch(f"/api/collab/connections/{connection}?action=decline").status_code == 200
        assert inbox(alice)["notifications"] == []
        assert request(alice, "Bob").status_code == 429
        past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        with db() as conn:
            conn.execute("UPDATE connections SET updated_at=? WHERE id=?", (past, connection))
            conn.execute("UPDATE social_action_log SET created_at=?", (past,))
        old_item = inbox(bob)["notifications"][0]["id"]
        assert request(alice, "Bob").status_code == 201
        items = inbox(bob)["notifications"]
        assert len(items) == 2 and items[0]["state"] == "pending" and items[1]["state"] == "expired"
        assert bob.post(f"/api/notifications/{old_item}/respond", json={"action": "accept"}).status_code == 409


def test_reciprocal_blocks_cannot_overwrite_or_remove_other_direction():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        connection = request(alice, "Bob").json()["id"]
        assert alice.post("/api/collab/people/google:bob/block").status_code == 200
        # Regression: the blocked party previously could replace blocked_by.
        assert bob.patch(f"/api/collab/connections/{connection}?action=block").status_code == 200
        assert bob.delete(f"/api/collab/connections/{connection}").status_code == 403
        assert bob.delete("/api/collab/people/google:alice/block").status_code == 200
        assert request(bob, "Alice").status_code == 403
        assert alice.get("/api/collab/blocks").json()["blocks"][0]["person"]["id"] == "google:bob"
        assert bob.get("/api/collab/blocks").json()["blocks"] == []
        assert alice.get("/api/collab/people?query=Bob").json()["people"] == []
        assert bob.get("/api/collab/people?query=Alice").json()["people"] == []
        assert inbox(bob)["notifications"][0]["actor"] is None
        assert alice.delete("/api/collab/people/google:bob/block").status_code == 200
        assert alice.get("/api/collab/connections").json()["connections"] == []
        assert bob.get("/api/collab/connections").json()["connections"] == []
        assert len(bob.get("/api/collab/people?query=Alice").json()["people"]) == 1


def test_block_cancels_pending_invites_without_revoking_existing_project_permissions():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        project = alice.post("/api/collab/projects", json={"name": "Shared study", "field": "mathematics"}).json()["project"]
        invitation = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invitation['id']}?action=accept")
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Read me"}).json()["page"]
        pending = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        assert bob.post("/api/collab/people/google:alice/block").status_code == 200
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 200
        assert bob.get("/api/collab/invites").json()["invites"] == []
        assert alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Bob", "role": "viewer"}).status_code == 403
        bob.delete("/api/collab/people/google:alice/block")
        assert bob.get("/api/collab/invites").json()["invites"] == []
        assert bob.patch(f"/api/collab/invites/{pending['id']}?action=accept").status_code == 404


def test_simultaneous_opposite_and_duplicate_requests_create_one_pending_occurrence():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda i: request(alice, "Bob") if i % 2 == 0 else request(bob, "Alice"), range(16)))
        assert all(result.status_code == 201 for result in results)
        assert len({result.json()["id"] for result in results}) == 1
        rows = alice.get("/api/collab/connections").json()["connections"]
        assert len(rows) == 1 and rows[0]["status"] == "pending"
        assert len(inbox(alice)["notifications"]) + len(inbox(bob)["notifications"]) == 1


def test_invitation_role_live_permissions_cancel_and_occurrence_guard():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        project = alice.post("/api/collab/projects", json={"name": "Sensitive title", "field": "mathematics"}).json()["project"]
        invitation = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        item = inbox(bob)["notifications"][0]
        assert item["title"] == "Sensitive title" and item["role"] == "viewer"
        assert bob.post(f"/api/notifications/{item['id']}/respond", json={"action": "decline"}).status_code == 200
        alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "editor"})
        assert inbox(bob)["notifications"][0]["role"] == "editor"
        assert bob.post(f"/api/notifications/{item['id']}/respond", json={"action": "accept"}).status_code == 409
        latest = inbox(bob)["notifications"][0]
        assert bob.post(f"/api/notifications/{latest['id']}/respond", json={"action": "accept"}).status_code == 200
        assert inbox(bob)["notifications"][0]["href"] == f"#/collab/project/{project['id']}"
        assert inbox(alice)["notifications"][0]["kind"] == "invite.accepted"
        alice.delete(f"/api/collab/projects/{project['id']}/members/google:bob")
        assert all(not item["title"] and not item["href"] and not item["action_id"] for item in inbox(bob)["notifications"])


def test_notification_preferences_mute_delivery_not_requests_or_other_categories():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        assert bob.put("/api/notifications/preferences", json={"friends": False, "collaboration": True, "tasks": False}).status_code == 200
        assert request(alice, "Bob").status_code == 201
        assert inbox(bob)["notifications"] == []
        assert len(bob.get("/api/collab/connections").json()["connections"]) == 1
        project = alice.post("/api/collab/projects", json={"name": "Read together", "field": "mathematics"}).json()["project"]
        alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "viewer"})
        assert inbox(bob)["notifications"][0]["category"] == "collaboration"
        assert bob.get("/api/notifications/preferences").json()["friends"] is False
        assert alice.get("/api/notifications/preferences").json()["friends"] is True


def test_pagination_read_all_cutoff_dedupe_and_transaction_rollback():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        with db() as conn:
            for index in range(45):
                notify(conn, "google:bob", "google:alice", "friend.accepted", str(index), event_key=f"test:{index}")
            notify(conn, "google:bob", "google:alice", "friend.accepted", "44", event_key="test:44")
        first = bob.get("/api/notifications?limit=20").json()
        second = bob.get(f"/api/notifications?limit=20&before={first['next_cursor']}").json()
        assert len(first["notifications"]) == len(second["notifications"]) == 20
        assert not set(item["id"] for item in first["notifications"]) & set(item["id"] for item in second["notifications"])
        with db() as conn:
            notify(conn, "google:bob", "google:alice", "friend.accepted", "new", event_key="new")
        bob.post("/api/notifications/read-all", json={"through": first["through"]})
        assert inbox(bob)["unread_count"] == 1
        assert bob.get("/api/notifications?unread=true").json()["notifications"][0]["kind"] == "friend.accepted"
        assert inbox(alice)["notifications"] == []
        with pytest.raises(RuntimeError):
            with db() as conn:
                notify(conn, "google:bob", "google:alice", "friend.accepted", "rollback", event_key="rollback")
                raise RuntimeError("domain operation failed")
        assert inbox(bob)["unread_count"] == 1


def test_limits_auth_self_actions_and_safe_search():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as anonymous:
        login(alice, "alice"); login(bob, "bob")
        assert anonymous.get("/api/notifications").status_code == 401
        assert anonymous.post("/api/collab/people/google:bob/block").status_code == 401
        assert request(alice, "Alice").status_code == 400
        assert alice.post("/api/collab/people/google:alice/block").status_code == 400
        assert alice.get("/api/collab/people?query=%25%25").json()["people"] == []
        current = datetime.now(timezone.utc).isoformat()
        with db() as conn:
            conn.executemany("INSERT INTO social_action_log(actor_id,action,created_at) VALUES (?,?,?)", [("google:alice", "friend.request", current)] * 30)
        assert request(alice, "Bob").status_code == 429
        assert inbox(bob)["notifications"] == []
        assert alice.get("/api/collab/connections").json()["connections"] == []


def test_task_notifications_recheck_access_and_hide_deleted_task_title():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        project = alice.post("/api/collab/projects", json={"name": "Task study", "field": "mathematics"}).json()["project"]
        invitation = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invitation['id']}?action=accept")
        task = alice.post(f"/api/collab/projects/{project['id']}/tasks", json={"title": "Check private result", "assignee_username": "Bob"}).json()["task"]
        latest = inbox(bob)["notifications"][0]
        assert latest["kind"] == "task.assigned" and latest["title"] == task["title"]
        alice.delete(f"/api/collab/projects/{project['id']}/members/google:bob")
        assert all(not item["title"] and item["href"] is None for item in inbox(bob)["notifications"])


def test_legacy_migration_preserves_block_once_and_seeds_pending_once():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        login(alice, "alice"); login(bob, "bob"); login(carol, "carol")
        first = request(alice, "Bob").json()["id"]
        second = request(alice, "Carol").json()["id"]
        with db() as conn:
            conn.execute("DELETE FROM notifications")
            conn.execute("DELETE FROM social_migrations")
            conn.execute("UPDATE connections SET status='blocked', blocked_by='google:alice' WHERE id=?", (first,))
        _SCHEMA_READY.discard(str(_database_path()))
        assert len(alice.get("/api/collab/blocks").json()["blocks"]) == 1
        assert inbox(bob)["notifications"] == []
        assert len(inbox(carol)["notifications"]) == 1
        assert inbox(carol)["notifications"][0]["action_id"] == second
        alice.delete("/api/collab/people/google:bob/block")
        _SCHEMA_READY.discard(str(_database_path()))
        assert alice.get("/api/collab/blocks").json()["blocks"] == []
        assert len(inbox(carol)["notifications"]) == 1


def test_simultaneous_collaboration_invites_never_create_duplicate_notifications():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        group = alice.post("/api/collab/groups", json={"name": "Shared Lab"}).json()["group"]
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: alice.post(f"/api/collab/groups/{group['id']}/invites", json={"username": "Bob"}), range(12)))
        assert sum(result.status_code == 201 for result in results) == 1
        assert all(result.status_code in {201, 409} for result in results)
        assert len(inbox(bob)["notifications"]) == 1


def test_read_state_is_account_scoped_and_persisted_across_clients():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as bob_second_device:
        login(alice, "alice"); login(bob, "bob"); login(bob_second_device, "bob")
        request(alice, "Bob")
        item = inbox(bob)["notifications"][0]
        bob_second_device.patch(f"/api/notifications/{item['id']}", json={"action": "read"})
        assert inbox(bob)["unread_count"] == 0
        assert inbox(bob)["notifications"][0]["state"] == "pending"


def test_suspended_requester_cannot_be_accepted_or_disclosed():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        connection = request(alice, "Bob").json()["id"]
        with db() as conn:
            conn.execute("UPDATE users SET status='suspended' WHERE id='google:alice'")
        assert bob.get("/api/collab/connections").json()["connections"] == []
        assert inbox(bob)["notifications"][0]["actor"] is None
        assert bob.patch(f"/api/collab/connections/{connection}?action=accept").status_code == 404


def test_stale_cancel_cannot_silently_unfriend_after_acceptance():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice"); login(bob, "bob")
        connection = request(alice, "Bob").json()["id"]
        assert bob.patch(f"/api/collab/connections/{connection}?action=accept").status_code == 200
        assert alice.delete(f"/api/collab/connections/{connection}?expected_status=pending").status_code == 409
        assert alice.get("/api/collab/connections").json()["connections"][0]["status"] == "accepted"
        assert alice.delete(f"/api/collab/connections/{connection}?expected_status=accepted").status_code == 200
