"""Collaboration authorization, invitations, and durable live-page tests."""

import base64
import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from itsdangerous import TimestampSigner
from pycrdt import Doc, Text, XmlFragment, XmlElement, XmlText

from backend.accounts import register_login
from backend.collaboration import db
from backend.main import app
from backend.collaboration import document_state, page_link_blocks


def notebook_document(client, page_id):
    result = client.get(f"/api/collab/pages/{page_id}/document")
    assert result.status_code == 200, result.text
    document = Doc({"notebook": XmlFragment(), "markdown": Text()})
    document.apply_update(base64.b64decode(result.json()["update"]))
    return document


def initialize_notebook(client, page_id):
    document = Doc({"notebook": XmlFragment([XmlElement("blockGroup", contents=[
        XmlElement("blockContainer", attributes={"id": "original-text"}, contents=[XmlElement("paragraph", contents=[XmlText("Keep this paragraph")])])
    ])])})
    result = client.post(f"/api/collab/pages/{page_id}/initialize-blocks", json={"expected_revision": 0, "update": base64.b64encode(document.get_update()).decode()})
    assert result.status_code == 200, result.text
    return notebook_document(client, page_id)


def send_notebook_update(client, page_id, update):
    with client.websocket_connect(f"/api/collab/pages/{page_id}/live") as socket:
        while socket.receive_json()["type"] != "ready":
            pass
        socket.send_json({"type": "update", "format": "blocks", "id": "test-update", "data": base64.b64encode(update).decode()})
        while True:
            message = socket.receive_json()
            if message["type"] == "ack":
                assert message["id"] == "test-update"
                return


@pytest.mark.parametrize("field", ["mathematics", "physics", "chemistry", "biology", "artificial-intelligence"])
def test_field_root_sibling_and_owned_child_are_different(field):
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        workspace = alice.put(f"/api/collab/field-workspaces/{field}", json={}).json()
        home, project = workspace["home_page_id"], workspace["project_id"]
        initialize_notebook(alice, home)
        create_path = f"/api/collab/projects/{project}/pages"
        sibling = alice.post(create_path, json={"title": "Independent root", "parent_id": None}).json()["page"]
        child = alice.post(create_path, json={"title": "Inside the field home", "parent_id": home}).json()["page"]
        assert sibling["parent_id"] is None and child["parent_id"] == home
        links = page_link_blocks(notebook_document(alice, home))
        assert child["id"] in links and sibling["id"] not in links
        assert "Keep this paragraph" in str(notebook_document(alice, home)["notebook"])
        initialize_notebook(alice, sibling["id"])
        response = alice.patch(f"/api/collab/pages/{child['id']}", json={"parent_id": sibling["id"]})
        assert response.status_code == 200, response.text
        assert child["id"] not in page_link_blocks(notebook_document(alice, home))
        assert child["id"] in page_link_blocks(notebook_document(alice, sibling["id"]))
        alice.patch(f"/api/collab/pages/{child['id']}", json={"parent_id": None})
        assert child["id"] not in page_link_blocks(notebook_document(alice, sibling["id"]))
        roots = alice.put(f"/api/collab/field-workspaces/{field}", json={}).json()["pages"]
        assert all(row["parent_id"] is None for row in roots)


def test_removing_child_page_block_trashes_branch_and_undo_restores_only_that_batch():
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        workspace = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        home, project = workspace["home_page_id"], workspace["project_id"]
        initialize_notebook(alice, home)
        def create(title, parent):
            return alice.post(f"/api/collab/projects/{project}/pages", json={"title": title, "parent_id": parent}).json()["page"]["id"]
        child = create("Để", home)
        grandchild = create("Proof", child)
        old = create("Previously trashed", child)
        alice.post(f"/api/collab/pages/{old}/archive")
        document = notebook_document(alice, home)
        block_id = next(iter(page_link_blocks(document)[child]))
        state = document.get_state()
        group = document["notebook"].children[0]
        for index, node in enumerate(group.children):
            if node.attributes.get("id") == block_id:
                del group.children[index]
                break
        update = document.get_update(state)
        send_notebook_update(alice, home, update)
        assert alice.get(f"/api/collab/pages/{child}").status_code == 404
        assert alice.get(f"/api/collab/pages/{grandchild}").status_code == 404
        active = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()["pages"]
        assert child not in {page["id"] for page in active}
        # Idempotent replay/reconnect must not create a fresh trash batch.
        with db() as conn:
            batch = conn.execute("SELECT archive_batch FROM research_pages WHERE id=?", (child,)).fetchone()[0]
        send_notebook_update(alice, home, update)
        with db() as conn:
            assert conn.execute("SELECT archive_batch FROM research_pages WHERE id=?", (child,)).fetchone()[0] == batch
        # Restoring the same block id models Yjs undo, without resurrecting old trash.
        state = document.get_state()
        group.children.append(XmlElement("blockContainer", attributes={"id": block_id}, contents=[XmlElement("pageLink", attributes={"pageId": child, "title": "Để"})]))
        send_notebook_update(alice, home, document.get_update(state))
        assert alice.get(f"/api/collab/pages/{child}").status_code == 200
        assert alice.get(f"/api/collab/pages/{grandchild}").status_code == 200
        assert alice.get(f"/api/collab/pages/{old}").status_code == 404
        # After undo, deleting again still trashes the actual page.
        state = document.get_state()
        del group.children[len(group.children) - 1]
        send_notebook_update(alice, home, document.get_update(state))
        assert alice.get(f"/api/collab/pages/{child}").status_code == 404


def test_deleting_sibling_reference_and_one_of_two_child_links_keeps_real_pages():
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        workspace = alice.put("/api/collab/field-workspaces/physics", json={}).json()
        home, project = workspace["home_page_id"], workspace["project_id"]
        initialize_notebook(alice, home)
        sibling = alice.post(f"/api/collab/projects/{project}/pages", json={"title": "Root sibling"}).json()["page"]["id"]
        child = alice.post(f"/api/collab/projects/{project}/pages", json={"title": "Child", "parent_id": home}).json()["page"]["id"]
        document = notebook_document(alice, home)
        group = document["notebook"].children[0]
        state = document.get_state()
        group.children.append(XmlElement("blockContainer", attributes={"id": "reference"}, contents=[XmlElement("pageLink", attributes={"pageId": sibling, "title": "Root sibling"})]))
        group.children.append(XmlElement("blockContainer", attributes={"id": "second-child-link"}, contents=[XmlElement("pageLink", attributes={"pageId": child, "title": "Child"})]))
        send_notebook_update(alice, home, document.get_update(state))
        state = document.get_state()
        del group.children[1]  # Original child block; another link still exists.
        del group.children[1]  # Sibling reference, NOT an owned page.
        send_notebook_update(alice, home, document.get_update(state))
        assert alice.get(f"/api/collab/pages/{sibling}").status_code == 200
        assert alice.get(f"/api/collab/pages/{child}").status_code == 200


def test_sidebar_trash_restore_and_legacy_children_keep_editor_links_consistent():
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        workspace = alice.put("/api/collab/field-workspaces/chemistry", json={}).json()
        home, project = workspace["home_page_id"], workspace["project_id"]
        child = alice.post(f"/api/collab/projects/{project}/pages", json={"title": "Legacy child", "parent_id": home}).json()["page"]["id"]
        assert child in page_link_blocks(initialize_notebook(alice, home))
        assert alice.post(f"/api/collab/pages/{child}/archive").status_code == 200
        assert child not in page_link_blocks(notebook_document(alice, home))
        assert alice.post(f"/api/collab/pages/{child}/restore").status_code == 200
        assert child in page_link_blocks(notebook_document(alice, home))
        duplicate = alice.post(f"/api/collab/pages/{child}/duplicate").json()["page"]
        assert duplicate["parent_id"] == home
        assert duplicate["id"] in page_link_blocks(notebook_document(alice, home))


def test_page_only_editor_cannot_trash_children_through_collaborative_update():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); account(bob, "bob")
        name(alice, "Alice"); name(bob, "Bob")
        workspace = alice.put("/api/collab/field-workspaces/biology", json={}).json()
        home, project = workspace["home_page_id"], workspace["project_id"]
        initialize_notebook(alice, home)
        child = alice.post(f"/api/collab/projects/{project}/pages", json={"title": "Private child", "parent_id": home}).json()["page"]["id"]
        invite = alice.post(f"/api/collab/pages/{home}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        document = notebook_document(bob, home)
        state = document.get_state()
        del document["notebook"].children[0].children[1]
        with pytest.raises(WebSocketDisconnect):
            send_notebook_update(bob, home, document.get_update(state))
        assert child in page_link_blocks(notebook_document(alice, home))
        assert alice.get(f"/api/collab/pages/{child}").status_code == 200


def test_old_missing_child_links_are_repaired_once_without_deleting_or_reparenting():
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        workspace = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        home, project = workspace["home_page_id"], workspace["project_id"]
        initialize_notebook(alice, home)
        child = alice.post(f"/api/collab/projects/{project}/pages", json={"title": "Existing Để", "parent_id": home}).json()["page"]["id"]
        root = alice.post(f"/api/collab/projects/{project}/pages", json={"title": "Existing root"}).json()["page"]["id"]
        document = notebook_document(alice, home)
        state = document.get_state()
        del document["notebook"].children[0].children[1]
        # Reproduce the old bug's durable state, before structural synchronization.
        with db() as conn:
            conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (home, "google:alice", document.get_update(state), "2026-10-05T12:00:00+00:00"))
            conn.execute("UPDATE research_pages SET field_links_ready=0 WHERE id=?", (home,))
        repaired = alice.get(f"/api/collab/pages/{home}/document").json()
        links = page_link_blocks(notebook_document(alice, home))
        assert child in links and root not in links
        assert alice.get(f"/api/collab/pages/{child}").json()["page"]["parent_id"] == home
        assert "Keep this paragraph" in str(notebook_document(alice, home)["notebook"])
        assert alice.get(f"/api/collab/pages/{home}/document").json()["revision"] == repaired["revision"]
        alice.patch(f"/api/collab/pages/{child}", json={"title": "Renamed Để", "icon": "🎯"})
        assert "Renamed Để" in str(notebook_document(alice, home)["notebook"])
        reference = next(page for page in alice.get(f"/api/collab/pages/{home}/references").json()["pages"] if page["id"] == child)
        assert reference["title"] == "Renamed Để" and reference["icon"] == "🎯"


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "collaboration.db"))
    monkeypatch.setenv("ADMIN_EMAILS", "")
    monkeypatch.setenv("APP_ENV", "development")


def account(client: TestClient, suffix: str) -> None:
    user = register_login({"id": f"google:{suffix}", "provider": "google", "name": suffix.title(),
                           "email": f"{suffix}@example.com", "avatar_url": None, "username": None})
    payload = base64.b64encode(json.dumps({"user": {"id": user["id"]}, "remember": False}).encode())
    signed = TimestampSigner(os.getenv("AUTH_SESSION_SECRET") or "deep-research-local-development-only-secret").sign(payload).decode()
    client.cookies.set("deep_research_session", signed)


def name(client: TestClient, value: str):
    response = client.put("/api/collab/identity", json={"name": value})
    assert response.status_code == 200, response.text


def test_workspace_tab_picker_is_account_scoped_filters_titles_and_excludes_trash():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); name(alice, "Alice")
        account(bob, "bob"); name(bob, "Bob")
        math = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        physics = alice.put("/api/collab/field-workspaces/physics", json={}).json()
        secret = bob.put("/api/collab/field-workspaces/biology", json={}).json()
        child = alice.post(f"/api/collab/projects/{math['project_id']}/pages", json={"title": "Convergence proof", "parent_id": math["home_page_id"]}).json()["page"]
        rows = alice.get("/api/collab/tab-pages").json()["pages"]
        assert {row["id"] for row in rows} == {math["home_page_id"], physics["home_page_id"], child["id"]}
        assert secret["home_page_id"] not in {row["id"] for row in rows}
        rows = alice.get("/api/collab/tab-pages?query=CONVERGENCE&field=mathematics").json()["pages"]
        assert [row["id"] for row in rows] == [child["id"]]
        assert alice.get("/api/collab/tab-pages?field=unknown").status_code == 422
        alice.post(f"/api/collab/pages/{child['id']}/archive")
        assert alice.get("/api/collab/tab-pages?query=Convergence").json()["pages"] == []


def test_page_analytics_records_real_views_deduplicates_and_respects_history_privacy():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); name(alice, "Alice")
        account(bob, "bob"); name(bob, "Bob")
        workspace = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        path = f"/api/collab/pages/{workspace['home_page_id']}"
        assert bob.post(path + "/view").status_code == 404
        assert bob.put(path + "/view-history", json={"show_history": True}).status_code == 404
        assert alice.post(path + "/view").json() == {"recorded": True, "show_history": False}
        assert alice.post(path + "/view").json()["recorded"] is False
        stats = alice.get(path + "/analytics?days=28")
        assert stats.status_code == 200, stats.text
        result = stats.json()
        assert len(result["series"]) == 28
        assert result["totals"] == {"views": 1, "unique_views": 1}
        assert result["viewers"] == []
        assert sum(row["views"] for row in result["series"]) == 1
        alice.put(path + "/view-history", json={"show_history": True})
        assert alice.get(path + "/analytics").json()["viewers"][0]["person"]["public_name"] == "Alice"
        alice.put(path + "/view-history", json={"show_history": False})
        assert alice.get(path + "/analytics").json()["viewers"] == []
        assert alice.get(path + "/analytics?days=14").status_code == 422
        assert alice.get(path + "/analytics?days=7").status_code == 200


def test_batch_share_invites_are_atomic_and_real_permissions_protect_analytics():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        account(alice, "alice"); name(alice, "Alice")
        account(bob, "bob"); name(bob, "Bob")
        account(carol, "carol"); name(carol, "Carol")
        workspace = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        path = f"/api/collab/pages/{workspace['home_page_id']}"
        invalid = alice.post(path + "/batch-invites", json={"recipients": ["Bob", "missing@example.com"]})
        assert invalid.status_code == 404
        assert alice.get(path + "/sharing").json()["pending_invites"] == []
        invites = alice.post(path + "/batch-invites", json={"recipients": ["Bob", "bob@example.com", "carol@example.com"], "role": "viewer"})
        assert invites.status_code == 201, invites.text
        assert len(invites.json()["invites"]) == 2
        assert bob.get(path).status_code == 404  # Pending invitation isn't an access grant.
        bob_invite = bob.get("/api/collab/invites").json()["invites"][0]
        assert bob.patch(f"/api/collab/invites/{bob_invite['id']}?action=accept").status_code == 200
        assert bob.get(path).status_code == 200
        assert bob.get(path + "/analytics").status_code == 404
        assert bob.get(path + "/activity").json()["can_analyze"] is False
        assert bob.post(path + "/view").status_code == 200
        assert bob.post(path + "/batch-invites", json={"recipients": ["Carol"]}).status_code == 404
        assert bob.get(path + "/sharing").json()["pending_invites"] == []
        sharing = alice.get(path + "/sharing").json()
        bob_id = next(member["id"] for member in sharing["members"] if member["public_name"] == "Bob")
        assert alice.patch(path + f"/shares/{bob_id}", json={"role": "editor"}).status_code == 200
        assert bob.get(path + "/analytics").status_code == 200
        assert alice.delete(path + f"/shares/{bob_id}").status_code == 200
        assert bob.get(path + "/activity").status_code == 404
        assert bob.get(path + "/analytics").status_code == 404


def test_page_updates_store_real_title_change_and_author_without_private_emails():
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        workspace = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        path = f"/api/collab/pages/{workspace['home_page_id']}"
        title = alice.get(path).json()["page"]["title"]
        alice.patch(path, json={"title": "Research journal"})
        activity = alice.get(path + "/activity").json()
        update = next(item for item in activity["updates"] if item["action"] == "page.updated")
        assert update["changes"]["title"] == {"before": title, "after": "Research journal"}
        assert update["actor"]["public_name"] == "Alice"
        assert "email" not in update["actor"]
        assert activity["created_by"]["id"] == activity["edited_by"]["id"]


def test_block_activity_tracks_own_content_authenticated_author_and_access():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); account(bob, "bob")
        name(alice, "Alice"); name(bob, "Bob")
        home = alice.put("/api/collab/field-workspaces/mathematics", json={}).json()
        path = f"/api/collab/pages/{home['home_page_id']}"
        child_text = XmlText("Nested")
        second_text = XmlText("Beta")
        seed = Doc({"notebook": XmlFragment([XmlElement("blockGroup", contents=[
            XmlElement("blockContainer", attributes={"id": "block-a"}, contents=[
                XmlElement("paragraph", contents=[XmlText("Alpha")]),
                XmlElement("blockGroup", contents=[XmlElement("blockContainer", attributes={"id": "nested"}, contents=[XmlElement("paragraph", contents=[child_text])])]),
            ]),
            XmlElement("blockContainer", attributes={"id": "block-b"}, contents=[XmlElement("paragraph", contents=[second_text])]),
        ])])})
        payload = {"expected_revision": 0, "update": base64.b64encode(seed.get_update()).decode()}
        assert alice.post(path + "/initialize-blocks", json=payload).status_code == 200
        initial = alice.get(path + "/blocks/block-a/activity").json()
        assert initial["edited_by"]["public_name"] == "Alice"
        assert bob.get(path + "/blocks/block-a/activity").status_code == 404
        assert alice.get(path + "/blocks/missing/activity").status_code == 404
        assert alice.get(path + "/blocks/invalid.id/activity").status_code == 422
        state = seed.get_state()
        second_text += " changed"
        child_text += " changed"
        update = seed.get_update(state)
        with db() as conn:
            bob_id = conn.execute("SELECT id FROM users WHERE public_name = 'Bob'").fetchone()[0]
            conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (home["home_page_id"], bob_id, update, "2026-10-05T11:12:00+00:00"))
            # A duplicate delivery by a different actor isn't a fresh edit.
            conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (home["home_page_id"], initial["edited_by"]["id"], update, "2026-10-05T11:13:00+00:00"))
        for block in ["block-b", "nested"]:
            activity = alice.get(path + f"/blocks/{block}/activity").json()
            assert activity["edited_by"]["public_name"] == "Bob"
            assert activity["edited_at"] == "2026-10-05T11:12:00+00:00"
            assert "email" not in activity["edited_by"]
        untouched = alice.get(path + "/blocks/block-a/activity").json()
        assert untouched["edited_by"] == initial["edited_by"]
        assert untouched["edited_at"] == initial["edited_at"]


def test_five_field_homes_are_idempotent_private_and_independent():
    fields = ["mathematics", "physics", "chemistry", "biology", "artificial-intelligence"]
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); account(bob, "bob")
        name(alice, "Alice"); name(bob, "Bob")
        homes = []
        for field in fields:
            path = f"/api/collab/field-workspaces/{field}"
            first = alice.put(path, json={"language": "vi"}).json()
            second = alice.put(path, json={"language": "en"}).json()
            assert first["home_page_id"] == second["home_page_id"]
            assert len(second["pages"]) == 1
            assert second["pages"][0]["title"] == first["pages"][0]["title"]
            own = bob.put(path, json={}).json()
            assert own["project_id"] != first["project_id"]
            home = first["home_page_id"]
            assert bob.get(f"/api/collab/pages/{home}").status_code == 404
            assert alice.post(f"/api/collab/pages/{home}/archive").status_code == 409
            assert alice.patch(f"/api/collab/projects/{first['project_id']}", json={"status": "archived"}).status_code == 409
            homes.append(home)
        assert len(set(homes)) == 5
        assert alice.put("/api/collab/field-workspaces/unknown", json={}).status_code == 422


def test_field_workspace_concurrent_open_creates_only_one_home():
    with TestClient(app) as alice:
        account(alice, "alice"); name(alice, "Alice")
        def open_home(_):
            result = alice.put("/api/collab/field-workspaces/physics", json={})
            assert result.status_code == 200, result.text
            return result.json()["home_page_id"]
        with ThreadPoolExecutor(max_workers=6) as pool:
            assert len(set(pool.map(open_home, range(12)))) == 1


def test_nested_field_pages_move_archive_restore_and_preferences():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); account(bob, "bob")
        name(alice, "Alice"); name(bob, "Bob")
        workspace_path = "/api/collab/field-workspaces/mathematics"
        workspace = alice.put(workspace_path, json={}).json()
        project, home = workspace["project_id"], workspace["home_page_id"]
        def create(title, parent):
            response = alice.post(f"/api/collab/projects/{project}/pages", json={"title": title, "parent_id": parent})
            assert response.status_code == 201, response.text
            return response.json()["page"]["id"]
        chapter = create("Chapter", home)
        theorem = create("Theorem", chapter)
        proof = create("Proof", theorem)
        old = create("Old approach", theorem)
        path = f"/api/collab/pages/{chapter}"
        assert alice.patch(path, json={"parent_id": proof}).status_code == 422
        assert alice.patch(f"/api/collab/pages/{home}", json={"parent_id": chapter}).status_code == 422
        assert alice.patch(path, json={"title": "  "}).status_code == 422
        assert alice.post(f"/api/collab/projects/{project}/pages", json={"title": "  "}).status_code == 422
        assert alice.patch(path, json={"icon": "📖", "cover": "forest", "full_width": True}).status_code == 200
        assert alice.patch(path, json={"cover": "https://example.com/image"}).status_code == 422
        assert alice.put(path + "/preference", json={"favorite": True, "opened": True}).status_code == 200
        assert bob.put(path + "/preference", json={"favorite": True}).status_code == 404
        current = next(p for p in alice.put(workspace_path, json={}).json()["pages"] if p["id"] == chapter)
        assert current["favorite"] and current["opened_at"] and current["icon"] == "📖" and current["full_width"]
        # A single-page invite must not expose the subtree.
        invite_result = alice.post(path + "/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite_result['id']}?action=accept")
        assert bob.get(path).status_code == 200
        assert bob.get(f"/api/collab/pages/{theorem}").status_code == 404
        assert bob.get(path + "/references").json()["pages"] == []
        assert bob.post(path + "/archive").status_code in (403, 404)
        # An older archived child remains archived after the branch is restored.
        assert alice.post(f"/api/collab/pages/{old}/archive").status_code == 200
        assert alice.post(path + "/archive").status_code == 200
        assert alice.get(f"/api/collab/pages/{proof}").status_code == 404
        assert alice.post(f"/api/collab/pages/{proof}/restore").status_code == 409
        assert alice.post(path + "/restore").status_code == 200
        assert alice.get(f"/api/collab/pages/{proof}").status_code == 200
        assert alice.get(f"/api/collab/pages/{old}").status_code == 404
        assert alice.patch(f"/api/collab/pages/{theorem}", json={"parent_id": home}).status_code == 200
        assert alice.get(f"/api/collab/pages/{proof}").json()["page"]["parent_id"] == theorem


def test_duplicate_field_page_copies_authoritative_content_but_not_shares():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); account(bob, "bob")
        name(alice, "Alice"); name(bob, "Bob")
        workspace = alice.put("/api/collab/field-workspaces/biology", json={}).json()
        page = alice.post(f"/api/collab/projects/{workspace['project_id']}/pages", json={"title": "Study", "parent_id": workspace['home_page_id']}).json()["page"]
        path = f"/api/collab/pages/{page['id']}"
        document = Doc({"markdown": Text("## Preserved findings")})
        with db() as conn:
            conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (page["id"], "google:alice", document.get_update(), "2026-10-04"))
        invitation = alice.post(path + "/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invitation['id']}?action=accept")
        assert bob.post(path + "/duplicate").status_code in (403, 404)
        copied = alice.post(path + "/duplicate").json()["page"]
        assert copied["parent_id"] == page["parent_id"]
        copied_path = f"/api/collab/pages/{copied['id']}"
        assert alice.get(copied_path + "/document").json()["legacy_markdown"] == "## Preserved findings"
        assert alice.get(copied_path).json()["shares"] == []
        assert bob.get(copied_path).status_code == 404


def test_notebook_first_use_migrations_are_safe_under_concurrent_requests():
    # Several UI requests start together; only one may add each new column.
    register_login({"id": "google:migration", "provider": "google", "name": "Migration"})
    def check_schema(_):
        with db() as connection:
            pages = {row["name"] for row in connection.execute("PRAGMA table_info(research_pages)")}
            versions = {row["name"] for row in connection.execute("PRAGMA table_info(page_versions)")}
            return {"editor_format", "position"} <= pages and "blocks_json" in versions
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(check_schema, range(16)))


def test_block_conversion_is_atomic_preserves_legacy_and_rejects_stale_editor():
    with TestClient(app) as alice:
        account(alice, "alice")
        name(alice, "Alice")
        project = alice.post("/api/collab/projects", json={"name": "Notebook", "field": "mathematics"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Theorem"}).json()["page"]
        legacy = Doc({"markdown": Text("## Original theorem")})
        with db() as conn:
            conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (page["id"], "google:alice", legacy.get_update(), "2026-10-01"))
        seed = Doc({"notebook": XmlFragment([XmlElement("blockGroup", contents=[XmlElement("blockContainer", contents=[XmlElement("paragraph", contents=[XmlText("Original theorem")])])])])})
        path = f"/api/collab/pages/{page['id']}"
        state = alice.get(path + "/document").json()
        assert state["legacy_markdown"] == "## Original theorem"
        payload = {"expected_revision": state["revision"] - 1, "update": base64.b64encode(seed.get_update()).decode()}
        assert alice.post(path + "/initialize-blocks", json=payload).status_code == 409
        payload["expected_revision"] = state["revision"]
        assert alice.post(path + "/initialize-blocks", json=payload).status_code == 200
        assert alice.post(path + "/initialize-blocks", json=payload).json()["status"] == "already_initialized"
        state = alice.get(path + "/document").json()
        assert state["format"] == "blocks"
        assert state["legacy_markdown"] == "## Original theorem"
        versions = alice.get(path).json()["versions"]
        assert len(versions) == 1
        assert alice.get(path + f"/versions/{versions[0]['id']}").json()["version"]["markdown"] == "## Original theorem"
        with alice.websocket_connect(path + "/live") as socket:
            while socket.receive_json()["type"] != "ready":
                pass
            socket.send_json({"type": "update", "id": "old-editor", "data": base64.b64encode(legacy.get_update()).decode()})
            assert "reload" in socket.receive_json()["message"].lower()
        malformed = {"expected_revision": 0, "update": "AAAA"}
        assert alice.post(path + "/initialize-blocks", json=malformed).status_code == 422


def test_notebook_search_backlinks_order_and_projection_are_permission_scoped():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice"); account(bob, "bob")
        name(alice, "Alice"); name(bob, "Bob")
        project = alice.post("/api/collab/projects", json={"name": "Private notebook", "field": "biology"}).json()["project"]
        a, b = [alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": title}).json()["page"] for title in ["Hypothesis", "Data"]]
        alice.post(f"/api/collab/projects/{project['id']}/evidence", json={"title": "A study", "url": "https://doi.org/10.1000/example"})
        def project_text(page, markdown, revision=0):
            return alice.put(f"/api/collab/pages/{page['id']}/projection", json={"revision": revision, "markdown": markdown, "blocks": []})
        assert project_text(a, f"A mitochondria study [data](#/collab/page/{b['id']})").status_code == 200
        assert project_text(b, "Controls for mitochondria").status_code == 200
        assert project_text(a, "Stale document", 99).status_code == 409
        assert len(alice.get("/api/collab/search-pages?query=mitochondria&field=biology").json()["pages"]) == 2
        assert not alice.get("/api/collab/search-pages?query=mitochondria&field=physics").json()["pages"]
        assert not bob.get("/api/collab/search-pages?query=mitochondria").json()["pages"]
        invite = alice.post(f"/api/collab/pages/{b['id']}/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        found = bob.get("/api/collab/search-pages?query=mitochondria").json()["pages"]
        assert [page["id"] for page in found] == [b["id"]]
        references = bob.get(f"/api/collab/pages/{b['id']}/references").json()
        assert references == {"pages": [], "evidence": [], "backlinks": []}
        assert alice.get(f"/api/collab/pages/{b['id']}/references").json()["backlinks"] == [{"id": a["id"], "title": "Hypothesis"}]
        assert bob.put(f"/api/collab/pages/{b['id']}/projection", json={"revision": 0, "markdown": "overwrite", "blocks": []}).status_code == 404
        path = f"/api/collab/projects/{project['id']}/page-order"
        assert alice.put(path, json={"page_ids": [b["id"], a["id"]]}).status_code == 200
        assert [page["id"] for page in alice.get(f"/api/collab/projects/{project['id']}").json()["pages"]] == [b["id"], a["id"]]
        assert alice.put(path, json={"page_ids": [a["id"], a["id"]]}).status_code == 409
        assert bob.put(path, json={"page_ids": [b["id"], a["id"]]}).status_code == 404
        alice.post(f"/api/collab/pages/{a['id']}/archive")
        assert len(alice.get("/api/collab/search-pages?query=mitochondria").json()["pages"]) == 1
        alice.post(f"/api/collab/pages/{a['id']}/restore")
        assert len(alice.get("/api/collab/search-pages?query=mitochondria").json()["pages"]) == 2
        blocks = [{"id": "test-block", "type": "paragraph", "content": [{"type": "text", "text": "Proof", "styles": {}}]}]
        version = alice.post(f"/api/collab/pages/{a['id']}/versions", json={"markdown": "Proof", "blocks": blocks}).json()
        assert alice.get(f"/api/collab/pages/{a['id']}/versions/{version['id']}").json()["version"]["blocks"] == blocks


def test_database_handles_close_and_failed_operations_roll_back():
    user = register_login({"id": "google:transaction", "provider": "google", "name": "Transaction"})
    with db() as connection:
        connection.execute("UPDATE users SET public_name = ? WHERE id = ?", ("Before", user["id"]))
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")
    with pytest.raises(ValueError):
        with db() as connection:
            connection.execute("UPDATE users SET public_name = ? WHERE id = ?", ("After", user["id"]))
            raise ValueError("abort transaction")
    with db() as connection:
        assert connection.execute("SELECT public_name FROM users WHERE id = ?", (user["id"],)).fetchone()[0] == "Before"


def test_live_socket_rejects_foreign_and_missing_production_origins(monkeypatch):
    with TestClient(app) as alice:
        account(alice, "alice")
        name(alice, "Alice")
        project = alice.post("/api/collab/projects", json={"name": "Origin checks", "field": "physics"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Safe page"}).json()["page"]
        path = f"/api/collab/pages/{page['id']}/live"
        monkeypatch.setenv("CORS_ORIGINS", "https://research.example")
        with pytest.raises(WebSocketDisconnect) as rejected:
            with alice.websocket_connect(path, headers={"Origin": "https://untrusted.example"}):
                pass
        assert rejected.value.code == 4403
        monkeypatch.setenv("APP_ENV", "production")
        with pytest.raises(WebSocketDisconnect) as missing:
            with alice.websocket_connect(path):
                pass
        assert missing.value.code == 4403
        with alice.websocket_connect(path, headers={"Origin": "https://research.example"}) as allowed:
            assert allowed.receive_json()["type"] == "ready"


def test_unique_usernames_do_not_expose_email_and_friendship_grants_no_access():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice")
        account(bob, "bob")
        name(alice, "Minh Khoi")
        collision = bob.put("/api/collab/identity", json={"name": "minh khoi"})
        assert collision.status_code == 409
        assert bob.put("/api/collab/identity", json={"name": "@bob"}).status_code == 422
        name(bob, "Bob")
        found = bob.get("/api/collab/people?query=MINH").json()["people"]
        assert len(found) == 1
        assert found[0]["public_name"] == "Minh Khoi"
        assert "email" not in found[0]

        request = alice.post("/api/collab/connections", json={"username": "Bob"})
        assert request.status_code == 201
        connection_id = request.json()["id"]
        assert bob.patch(f"/api/collab/connections/{connection_id}?action=accept").status_code == 200

        project = alice.post("/api/collab/projects", json={"name": "Private AI study", "field": "artificial-intelligence"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Private draft"}).json()["page"]
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404
        assert bob.get(f"/api/collab/pages/{page['id']}").status_code == 404


def test_group_project_permissions_and_page_only_guest_invite():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        account(alice, "alice")
        account(bob, "bob")
        account(carol, "carol")
        name(alice, "Alice")
        name(bob, "Bob")
        name(carol, "Carol")
        group = alice.post("/api/collab/groups", json={"name": "AI Lab"}).json()["group"]
        project = alice.post(f"/api/collab/projects?group_id={group['id']}", json={"name": "RAG audit", "field": "artificial-intelligence", "visibility": "group"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Evidence"}).json()["page"]
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404

        group_invite = alice.post(f"/api/collab/groups/{group['id']}/invites", json={"username": "Bob"}).json()["invite"]
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404
        assert bob.patch(f"/api/collab/invites/{group_invite['id']}?action=accept").status_code == 200
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 200
        assert bob.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Bob page"}).status_code == 201

        guest_invite = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Carol", "role": "editor"}).json()["invite"]
        assert carol.get(f"/api/collab/pages/{page['id']}").status_code == 404
        assert carol.get("/api/collab/shared-pages").json()["pages"] == []
        assert carol.patch(f"/api/collab/invites/{guest_invite['id']}?action=accept").status_code == 200
        assert carol.get(f"/api/collab/projects/{project['id']}").status_code == 404
        assert carol.get(f"/api/collab/pages/{page['id']}").status_code == 200
        assert carol.post(f"/api/collab/pages/{page['id']}/comments", json={"body": "Check the baseline."}).status_code == 201
        assert carol.patch(f"/api/collab/pages/{page['id']}", json={"title": "Changed"}).status_code == 200
        assert carol.patch(f"/api/collab/pages/{page['id']}", json={"parent_id": None}).status_code == 404
        assert carol.post(f"/api/collab/pages/{page['id']}/archive").status_code == 404
        assert alice.delete(f"/api/collab/pages/{page['id']}/shares/google:carol").status_code == 200
        assert carol.get(f"/api/collab/pages/{page['id']}").status_code == 404
        assert alice.delete(f"/api/collab/groups/{group['id']}/members/google:bob").status_code == 200
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404
        reinvite = alice.post(f"/api/collab/groups/{group['id']}/invites", json={"username": "Bob"})
        assert reinvite.status_code == 201, reinvite.text


def test_pending_invitation_cannot_survive_sender_demotion_and_can_be_cancelled():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        for client, username in [(alice, "Alice"), (bob, "Bob"), (carol, "Carol")]:
            account(client, username.lower())
            name(client, username)
        group = alice.post("/api/collab/groups", json={"name": "Shared lab"}).json()["group"]
        invitation = alice.post(f"/api/collab/groups/{group['id']}/invites", json={"username": "Bob"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invitation['id']}?action=accept")
        alice.patch(f"/api/collab/groups/{group['id']}/members/google:bob", json={"role": "admin"})
        project = alice.post(f"/api/collab/projects?group_id={group['id']}", json={"name": "Study", "field": "biology"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Protocol review"}).json()["page"]
        pending = [bob.post(f"/api/collab/{target}/invites", json={"username": "Carol", "role": role}).json()["invite"]
                   for target, role in [(f"groups/{group['id']}", "member"), (f"pages/{page['id']}", "editor")]]
        assert len(carol.get("/api/collab/invites").json()["invites"]) == 2
        assert carol.delete(f"/api/collab/invites/{pending[0]['id']}").status_code == 403
        alice.patch(f"/api/collab/groups/{group['id']}/members/google:bob", json={"role": "member"})
        assert carol.get("/api/collab/invites").json()["invites"] == []
        for item in pending:
            assert carol.patch(f"/api/collab/invites/{item['id']}?action=accept").status_code == 403
            assert alice.delete(f"/api/collab/invites/{item['id']}").status_code == 200
        fresh = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Carol", "role": "viewer"}).json()["invite"]
        assert alice.get(f"/api/collab/pages/{page['id']}").json()["pending_invites"][0]["recipient"]["public_name"] == "Carol"
        assert carol.patch(f"/api/collab/invites/{fresh['id']}?action=accept").status_code == 200
        shared = carol.get("/api/collab/shared-pages").json()["pages"]
        assert shared[0]["id"] == page["id"] and shared[0]["field"] == "biology"
        assert carol.post(f"/api/collab/pages/{page['id']}/comments", json={"body": "Viewer cannot comment"}).status_code == 404
        alice.patch(f"/api/collab/pages/{page['id']}/shares/google:carol", json={"role": "commenter"})
        assert carol.post(f"/api/collab/pages/{page['id']}/comments", json={"body": "Review question"}).status_code == 201


def test_two_concurrent_writers_converge_and_ack_is_durable():
    with TestClient(app) as alice, TestClient(app) as bob:
        for client, username in [(alice, "Alice"), (bob, "Bob")]:
            account(client, username.lower())
            name(client, username)
        project = alice.post("/api/collab/projects", json={"name": "Concurrent writing", "field": "mathematics"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Proof"}).json()["page"]
        invite = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        left, right = Doc(), Doc()
        left["markdown"], right["markdown"] = Text("Alice"), Text("Bob")
        path = f"/api/collab/pages/{page['id']}/live"
        with alice.websocket_connect(path) as a, bob.websocket_connect(path) as b:
            assert a.receive_json()["type"] == b.receive_json()["type"] == "ready"
            a.send_json({"type": "update", "id": "alice-edit", "data": base64.b64encode(left.get_update()).decode()})
            b.send_json({"type": "update", "id": "bob-edit", "data": base64.b64encode(right.get_update()).decode()})
            for socket, doc, expected_id in [(a, left, "alice-edit"), (b, right, "bob-edit")]:
                updates, acknowledged = 0, False
                while updates < 2 or not acknowledged:
                    message = socket.receive_json()
                    if message["type"] == "ack":
                        assert message["id"] == expected_id
                        acknowledged = True
                    if message["type"] == "update":
                        doc.apply_update(base64.b64decode(message["data"]))
                        updates += 1
            assert str(left["markdown"]) == str(right["markdown"])
            assert "Alice" in str(left["markdown"]) and "Bob" in str(left["markdown"])
            assert alice.patch(f"/api/collab/pages/{page['id']}/shares/google:bob", json={"role": "viewer"}).status_code == 200
            message = b.receive_json()
            assert message["type"] == "permission" and message["access"] == 1
            b.send_json({"type": "update", "data": base64.b64encode(right.get_update()).decode()})
            assert b.receive_json()["type"] == "error"
        reopened = Doc()
        reopened["markdown"] = Text()
        with alice.websocket_connect(path) as reader:
            for _ in range(2):
                message = reader.receive_json()
                reopened.apply_update(base64.b64decode(message["data"]))
            assert reader.receive_json()["type"] == "ready"
        assert str(reopened["markdown"]) == str(left["markdown"])


def test_restricted_project_requires_invite_and_page_tree_rejects_cycles():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice")
        account(bob, "bob")
        name(alice, "Alice")
        name(bob, "Bob")
        group = alice.post("/api/collab/groups", json={"name": "Math Lab"}).json()["group"]
        invitation = alice.post(f"/api/collab/groups/{group['id']}/invites", json={"username": "Bob"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invitation['id']}?action=accept")
        project = alice.post(f"/api/collab/projects?group_id={group['id']}", json={"name": "Theorem study", "field": "mathematics", "visibility": "restricted"}).json()["project"]
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404
        invite = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 200

        parent = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Definitions"}).json()["page"]
        child = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Lemma", "parent_id": parent["id"]}).json()["page"]
        assert alice.patch(f"/api/collab/pages/{parent['id']}", json={"parent_id": child["id"]}).status_code == 422
        assert bob.post(f"/api/collab/pages/{child['id']}/versions", json={"label": "Reviewed", "markdown": "# Lemma"}).status_code == 201
        assert alice.get(f"/api/collab/pages/{child['id']}").json()["versions"][0]["label"] == "Reviewed"


def test_live_page_updates_survive_reconnect_and_viewer_cannot_write():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice")
        account(bob, "bob")
        name(alice, "Alice")
        name(bob, "Bob")
        project = alice.post("/api/collab/projects", json={"name": "Writing", "field": "physics"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Draft"}).json()["page"]
        invite = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Bob", "role": "viewer"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        path = f"/api/collab/pages/{page['id']}/live"
        document = Doc()
        document["markdown"] = Text("A durable paragraph")
        update = document.get_update()
        with alice.websocket_connect(path) as writer:
            assert writer.receive_json()["type"] == "ready"
            writer.send_json({"type": "update", "data": base64.b64encode(b"invalid-update").decode()})
            assert writer.receive_json()["message"] == "Invalid collaborative update"
            writer.send_json({"type": "update", "data": base64.b64encode(update).decode()})
            received = writer.receive_json()
            assert received["type"] == "update"
            assert base64.b64decode(received["data"]) == update
        with bob.websocket_connect(path) as reader:
            assert reader.receive_json()["type"] == "update"
            assert reader.receive_json()["type"] == "ready"
            reader.send_json({"type": "update", "data": base64.b64encode(b"forbidden").decode()})
            assert reader.receive_json()["type"] == "error"


def test_group_revocation_archive_restore_and_self_assignment():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        for client, username in [(alice, "Alice"), (bob, "Bob"), (carol, "Carol")]:
            account(client, username.lower())
            name(client, username)
        group = alice.post("/api/collab/groups", json={"name": "Physics Lab"}).json()["group"]
        project = alice.post(f"/api/collab/projects?group_id={group['id']}", json={"name": "Optics", "field": "physics", "visibility": "restricted"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Experiment"}).json()["page"]
        invite = alice.post(f"/api/collab/groups/{group['id']}/invites", json={"username": "Bob"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        invite = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        invite = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        assert bob.get(f"/api/collab/pages/{page['id']}").status_code == 200
        task = alice.post(f"/api/collab/projects/{project['id']}/tasks", json={"title": "Check laser", "assignee_username": "Alice"})
        assert task.status_code == 201, task.text
        assert alice.get(f"/api/collab/projects/{project['id']}").json()["tasks"][0]["assignee"]["public_name"] == "Alice"

        assert alice.delete(f"/api/collab/groups/{group['id']}/members/google:bob").status_code == 200
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 404
        assert bob.get(f"/api/collab/pages/{page['id']}").status_code == 404

        guest = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Carol", "role": "viewer"}).json()["invite"]
        carol.patch(f"/api/collab/invites/{guest['id']}?action=accept")
        assert carol.get(f"/api/collab/pages/{page['id']}").status_code == 200
        assert alice.post(f"/api/collab/groups/{group['id']}/archive").status_code == 200
        assert alice.get(f"/api/collab/projects/{project['id']}").status_code == 404
        assert carol.get(f"/api/collab/pages/{page['id']}").status_code == 404
        assert len(alice.get("/api/collab/groups/archived").json()["groups"]) == 1
        assert alice.post(f"/api/collab/groups/{group['id']}/restore").status_code == 200
        assert carol.get(f"/api/collab/pages/{page['id']}").status_code == 200


def test_live_update_is_relayed_to_another_open_session():
    with TestClient(app) as alice, TestClient(app) as bob:
        account(alice, "alice")
        account(bob, "bob")
        name(alice, "Alice")
        name(bob, "Bob")
        project = alice.post("/api/collab/projects", json={"name": "Shared draft", "field": "mathematics"}).json()["project"]
        page = alice.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Proof"}).json()["page"]
        invite = alice.post(f"/api/collab/pages/{page['id']}/invites", json={"username": "Bob", "role": "editor"}).json()["invite"]
        bob.patch(f"/api/collab/invites/{invite['id']}?action=accept")
        document = Doc()
        document["markdown"] = Text("Proof by induction")
        update = document.get_update()
        path = f"/api/collab/pages/{page['id']}/live"
        with alice.websocket_connect(path) as writer, bob.websocket_connect(path) as reader:
            assert writer.receive_json()["type"] == "ready"
            assert reader.receive_json()["type"] == "ready"
            writer.send_json({"type": "update", "data": base64.b64encode(update).decode()})
            assert writer.receive_json()["type"] == "update"
            forwarded = reader.receive_json()
            assert forwarded["type"] == "update"
            assert base64.b64decode(forwarded["data"]) == update
