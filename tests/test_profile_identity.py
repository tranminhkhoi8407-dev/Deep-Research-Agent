"""Profile-owned names, duplicate safety, and the notebook setup gate."""

import base64
import json
import os

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from starlette.websockets import WebSocketDisconnect

from backend.accounts import _connect, register_login
from backend.main import app


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "profile.db"))
    monkeypatch.setenv("ADMIN_EMAILS", "")
    monkeypatch.setenv("APP_ENV", "development")


def sign_in(client, suffix):
    user = register_login({"id": f"google:{suffix}", "provider": "google", "name": "Provider name",
                           "email": f"{suffix}@example.com", "avatar_url": None, "username": None})
    payload = base64.b64encode(json.dumps({"user": {"id": user["id"]}}).encode())
    secret = os.getenv("AUTH_SESSION_SECRET") or "deep-research-local-development-only-secret"
    client.cookies.set("deep_research_session", TimestampSigner(secret).sign(payload).decode())
    return user


def test_profile_name_opens_notebook_and_refreshes_signed_profile():
    with TestClient(app) as client:
        sign_in(client, "alice")
        assert client.get("/api/auth/me").json()["user"]["public_name"] is None
        for endpoint in ("projects", "groups", "connections", "people", "invites", "search-pages?query=test"):
            response = client.get(f"/api/collab/{endpoint}")
            assert response.status_code == 409
            assert response.json()["detail"]["code"] == "profile_name_required"
        # A provider name, or the old free-form display field, is not consent to
        # reserve a unique name. Only confirming it in profile setup unlocks this.
        assert client.patch("/api/auth/profile", json={"display_name": "123"}).status_code == 200
        assert client.post("/api/collab/projects", json={"name": "My research", "field": "mathematics"}).status_code == 409
        response = client.patch("/api/auth/profile", json={"public_name": "  Trần   Minh Khôi  "})
        assert response.status_code == 200
        user = response.json()["user"]
        assert user["public_name"] == user["display_name"] == "Trần Minh Khôi"
        assert user["name"] == "Provider name"
        assert client.get("/api/auth/me").json()["user"]["public_name"] == user["public_name"]
        assert client.get("/api/auth/profile").json()["user"]["public_name"] == user["public_name"]
        assert client.get("/api/collab/projects").status_code == 200
        assert client.post("/api/collab/projects", json={"name": "My research", "field": "mathematics"}).status_code == 201


def test_profile_collision_rolls_back_all_fields_and_session():
    with TestClient(app) as alice, TestClient(app) as bob:
        sign_in(alice, "alice"); sign_in(bob, "bob")
        assert alice.patch("/api/auth/profile", json={"public_name": "Minh Khoi"}).status_code == 200
        assert bob.patch("/api/auth/profile", json={"public_name": "Bobby", "bio": "Original bio"}).status_code == 200
        for duplicate in ("MINH KHOI", "  minh   khoi  ", "Ｍｉｎｈ Ｋｈｏｉ"):
            response = bob.patch("/api/auth/profile", json={"public_name": duplicate, "bio": "Must not persist", "location": "Changed"})
            assert response.status_code == 409
            assert response.json()["detail"]["code"] == "profile_name_taken"
            persisted = bob.get("/api/auth/profile").json()["user"]
            assert persisted["public_name"] == "Bobby"
            assert persisted["display_name"] == "Bobby"
            assert persisted["bio"] == "Original bio"
            assert persisted["location"] == ""
            assert bob.get("/api/auth/me").json()["user"]["public_name"] == "Bobby"


@pytest.mark.parametrize("invalid", ["", None, "ab", "@Someone", "Name!", "-Name", "Name-", "x" * 31])
def test_profile_rejects_invalid_names_without_clearing_existing_identity(invalid):
    with TestClient(app) as client:
        sign_in(client, "alice")
        client.patch("/api/auth/profile", json={"public_name": "Alice"})
        response = client.patch("/api/auth/profile", json={"public_name": invalid, "bio": "Not saved"})
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_profile_name"
        user = client.get("/api/auth/me").json()["user"]
        assert user["public_name"] == "Alice" and user["bio"] == ""


def test_name_change_preserves_invites_permissions_and_legacy_clients():
    with TestClient(app) as alice, TestClient(app) as bob:
        sign_in(alice, "alice"); sign_in(bob, "bob")
        alice.patch("/api/auth/profile", json={"public_name": "Alice"})
        bob.patch("/api/auth/profile", json={"public_name": "Bobby"})
        project = alice.post("/api/collab/projects", json={"name": "Collaboration", "field": "physics"}).json()["project"]
        invite = alice.post(f"/api/collab/projects/{project['id']}/invites", json={"username": "Bobby", "role": "editor"}).json()["invite"]
        assert bob.patch("/api/auth/profile", json={"public_name": "Bob Renamed"}).status_code == 200
        assert bob.patch(f"/api/collab/invites/{invite['id']}?action=accept").status_code == 200
        assert bob.get(f"/api/collab/projects/{project['id']}").status_code == 200
        # A legacy profile update may not silently clear the user's saved name.
        assert bob.patch("/api/auth/profile", json={"bio": "New bio"}).status_code == 200
        assert bob.get("/api/auth/me").json()["user"]["public_name"] == "Bob Renamed"
        assert bob.patch("/api/auth/profile", json={"public_name": "bob renamed"}).status_code == 200
        found = alice.get("/api/collab/people?query=bob").json()["people"][0]
        assert found["public_name"] == found["display_name"] == "bob renamed"


def test_unnamed_account_cannot_open_a_shared_live_editor():
    with TestClient(app) as client:
        user = sign_in(client, "alice")
        client.patch("/api/auth/profile", json={"public_name": "Alice"})
        project = client.post("/api/collab/projects", json={"name": "Notebook", "field": "biology"}).json()["project"]
        page = client.post(f"/api/collab/projects/{project['id']}/pages", json={"title": "Research"}).json()["page"]
        with _connect() as connection:
            connection.execute("UPDATE users SET public_name = NULL, public_name_key = NULL WHERE id = ?", (user["id"],))
        assert client.get(f"/api/collab/pages/{page['id']}").status_code == 409
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect(f"/api/collab/pages/{page['id']}/live"):
                pass
        assert rejected.value.code == 4403
