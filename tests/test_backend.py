"""API contract tests that never call an external model or search service."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import backend.auth as backend_auth
import backend.main as backend_main
from backend.accounts import (
    list_audit_events,
    register_login,
    synchronize_configured_role,
)
from backend.auth import current_admin
from backend.main import app


@pytest.fixture(autouse=True)
def isolated_auth_database(monkeypatch, tmp_path) -> None:
    """Keep account and audit state isolated from the developer's local database."""
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("ADMIN_EMAILS", "")
    yield
    app.dependency_overrides.clear()


def _development_login(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("AUTH_DEV_LOGIN", "true")
    response = client.post("/api/auth/dev-login")
    assert response.status_code == 200
    assert response.json()["authenticated"] is True


def _configure_host_override(monkeypatch) -> dict:
    monkeypatch.setenv("ADMIN_EMAILS", "host@example.com")
    host = register_login(
        {
            "id": "google:test-host",
            "provider": "google",
            "name": "Test Host",
            "email": "host@example.com",
            "avatar_url": None,
            "username": None,
        }
    )
    app.dependency_overrides[current_admin] = lambda: host
    return host


def test_health_endpoint() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "deep-research-agent",
    }


def test_auth_session_lifecycle(monkeypatch) -> None:
    with TestClient(app) as client:
        anonymous = client.get("/api/auth/me")
        protected = client.get("/api/reports")
        _development_login(client, monkeypatch)
        signed_in = client.get("/api/auth/me")
        admin_denied = client.get("/api/admin/overview")
        logout = client.post("/api/auth/logout")
        signed_out = client.get("/api/auth/me")

    assert anonymous.json() == {"authenticated": False, "user": None}
    assert protected.status_code == 401
    assert signed_in.json()["user"]["provider"] == "local"
    assert signed_in.json()["user"]["role"] == "member"
    assert signed_in.json()["user"]["license_type"] == "free"
    assert signed_in.json()["user"]["license_expires_at"] is None
    assert admin_denied.status_code == 403
    assert logout.json() == {"authenticated": False}
    assert signed_out.json() == {"authenticated": False, "user": None}


def test_login_cookie_is_session_only_unless_user_opts_in(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_DEV_LOGIN", "true")

    with TestClient(app) as client:
        session_response = client.post("/api/auth/dev-login")
        session_cookie = session_response.headers["set-cookie"]

        remembered_response = client.post("/api/auth/dev-login?remember=true")
        remembered_cookie = remembered_response.headers["set-cookie"]

    assert "max-age=" not in session_cookie.lower()
    assert "max-age=2592000" in remembered_cookie.lower()
    assert "httponly" in session_cookie.lower()


def test_profile_update_persists_and_refreshes_session(monkeypatch) -> None:
    with TestClient(app) as client:
        _development_login(client, monkeypatch)
        updated = client.patch(
            "/api/auth/profile",
            json={
                "display_name": "  Researcher One  ",
                "bio": "Evidence-first AI research.",
                "location": "Ho Chi Minh City",
                "organization": "Research Lab",
                "website": "https://example.com/profile",
                "research_interests": ["RAG", " rag ", "Computer vision"],
            },
        )
        profile = client.get("/api/auth/profile")
        session = client.get("/api/auth/me")
        invalid = client.patch(
            "/api/auth/profile",
            json={"website": "example.com", "research_interests": []},
        )

    assert updated.status_code == 200
    assert updated.json()["user"]["display_name"] == "Researcher One"
    assert updated.json()["user"]["research_interests"] == ["RAG", "Computer vision"]
    assert profile.json()["user"]["bio"] == "Evidence-first AI research."
    assert session.json()["user"]["display_name"] == "Researcher One"
    assert invalid.status_code == 422


def test_onboarding_is_authenticated_account_scoped_and_validated(monkeypatch) -> None:
    with TestClient(app) as first:
        assert first.get("/api/auth/onboarding").status_code == 401
        _development_login(first, monkeypatch)
        assert first.get("/api/auth/onboarding").json() == {"tours": []}
        saved = first.put(
            "/api/auth/onboarding/core",
            json={"version": 1, "step_index": 3, "status": "in_progress"},
        )
        assert saved.status_code == 200
        assert saved.json()["tour"]["step_index"] == 3
        assert first.get("/api/auth/onboarding").json()["tours"][0]["tour_id"] == "core"
        assert first.put("/api/auth/onboarding/core", json={"step_index": 9, "status": "completed"}).status_code == 422
        assert first.put("/api/auth/onboarding/core", json={"step_index": 2, "status": "completed"}).status_code == 422
        assert first.put("/api/auth/onboarding/core", json={"version": 2, "step_index": 0, "status": "in_progress"}).status_code == 422
        assert first.put("/api/auth/onboarding/core", json={"step_index": 8, "status": "completed"}).status_code == 200
        assert first.put("/api/auth/onboarding/unknown", json={"step_index": 0, "status": "completed"}).status_code == 422
        assert first.put("/api/auth/onboarding/host", json={"step_index": 0, "status": "completed"}).status_code == 403

    other = register_login({
        "id": "google:other-onboarding-user", "provider": "google", "name": "Other",
        "email": "other@example.com", "avatar_url": None, "username": None,
    })
    from backend.accounts import list_onboarding_tours
    assert list_onboarding_tours(other["id"]) == []


def test_host_onboarding_disappears_when_host_access_is_revoked(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_EMAILS", "host@example.com")
    host = register_login({
        "id": "google:onboarding-host", "provider": "google", "name": "Host",
        "email": "host@example.com", "avatar_url": None, "username": None,
    })
    monkeypatch.setattr(backend_auth, "current_user", lambda request: host)
    with TestClient(app) as client:
        saved = client.put("/api/auth/onboarding/host", json={"step_index": 3, "status": "completed"})
        assert saved.status_code == 200
        assert len(client.get("/api/auth/onboarding").json()["tours"]) == 1

        monkeypatch.setattr(backend_auth, "current_user", lambda request: {**host, "role": "member"})
        assert client.get("/api/auth/onboarding").json()["tours"] == []
        assert client.put("/api/auth/onboarding/host", json={"step_index": 0, "status": "in_progress"}).status_code == 403


def test_auth_provider_status(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setenv("GITHUB_CLIENT_ID", "github-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "github-secret")
    monkeypatch.setenv("AUTH_DEV_LOGIN", "true")

    with TestClient(app) as client:
        response = client.get("/api/auth/providers")

    assert response.json() == {
        "providers": {"google": False, "github": True},
        "dev_login": True,
    }


def test_host_role_strictly_follows_configured_email(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    member = register_login(
        {
            "id": "google:configured-host",
            "provider": "google",
            "name": "Configured Host",
            "email": "host@example.com",
            "avatar_url": None,
            "username": None,
        }
    )
    assert member["role"] == "member"

    monkeypatch.setenv("ADMIN_EMAILS", "HOST@example.com")
    synchronized = synchronize_configured_role(member)

    assert synchronized["role"] == "admin"

    monkeypatch.setenv("ADMIN_EMAILS", "another-host@example.com")
    synchronized = synchronize_configured_role(synchronized)

    assert synchronized["role"] == "member"


def test_host_can_manage_members_and_audit_changes(monkeypatch) -> None:
    host = _configure_host_override(monkeypatch)
    with TestClient(app) as client:
        member = register_login(
            {
                "id": "google:test-member",
                "provider": "google",
                "name": "Test Member",
                "email": "member@example.com",
                "avatar_url": None,
                "username": None,
            }
        )

        overview = client.get("/api/admin/overview")
        users = client.get("/api/admin/users")
        suspended = client.patch(
            f"/api/admin/users/{member['id']}",
            json={"status": "suspended"},
        )
        restored = client.patch(
            f"/api/admin/users/{member['id']}",
            json={"status": "active"},
        )
        licensed = client.patch(
            f"/api/admin/users/{member['id']}",
            json={"license_type": "pro", "license_expires_at": "2027-03-04"},
        )
        self_lockout = client.patch(
            f"/api/admin/users/{host['id']}",
            json={"status": "suspended"},
        )

    assert overview.status_code == 200
    assert overview.json()["users"]["total"] == 2
    assert users.status_code == 200
    assert {item["id"] for item in users.json()["users"]} == {
        "google:test-host",
        "google:test-member",
    }
    assert suspended.json()["user"]["status"] == "suspended"
    assert restored.json()["user"]["role"] == "member"
    assert licensed.json()["user"]["license_type"] == "pro"
    assert licensed.json()["user"]["license_expires_at"] == "2027-03-04"
    assert self_lockout.status_code == 400
    assert any(event["action"] == "user.updated" for event in list_audit_events())


def test_host_rejects_invalid_license_expiry(monkeypatch) -> None:
    host = _configure_host_override(monkeypatch)
    with TestClient(app) as client:
        response = client.patch(
            f"/api/admin/users/{host['id']}",
            json={"license_type": "team", "license_expires_at": "04/03/2027"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "License expiry must use YYYY-MM-DD"


def test_host_can_list_and_delete_another_users_report(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path / "reports"))
    _configure_host_override(monkeypatch)
    with TestClient(app) as client:
        member = register_login(
            {
                "id": "github:report-owner",
                "provider": "github",
                "name": "Report Owner",
                "email": "owner@example.com",
                "avatar_url": None,
                "username": "report-owner",
            }
        )
        report_dir = backend_main._reports_dir(member["id"])
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / "owned-report.md"
        report_path.write_text("# Owned report\n", encoding="utf-8")

        listing = client.get("/api/admin/reports")
        deleted = client.delete(
            f"/api/admin/reports/{member['id']}/owned-report.md"
        )

    assert listing.status_code == 200
    assert listing.json()["reports"][0]["owner_id"] == member["id"]
    assert deleted.json() == {"status": "deleted", "id": "owned-report.md"}
    assert not report_path.exists()


def test_persistent_report_library(monkeypatch, tmp_path) -> None:
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    report = reports_dir / "sample.md"
    report.write_text(
        "# Sample report\n\n> **Method:** deep mode · 1 analyst · 1 unique sources.\n\n"
        "## Sources\n\n- [A1-W1] [Official source](https://example.gov/data) "
        "— web, quality: high\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("REPORTS_DIR", str(reports_dir))

    with TestClient(app) as client:
        _development_login(client, monkeypatch)
        listing = client.get("/api/reports")
        detail = client.get("/api/reports/sample.md")
        traversal = client.get("/api/reports/..%2Fsecret.md")
        deleted = client.delete("/api/reports/sample.md")

    assert listing.status_code == 200
    assert listing.json()["reports"][0]["source_count"] == 1
    assert listing.json()["reports"][0]["research_depth"] == "deep"
    assert detail.json()["final_report"].startswith("# Sample report")
    assert traversal.status_code in {400, 404}
    assert deleted.json() == {"status": "deleted", "id": "sample.md"}
    assert not report.exists()


def test_report_library_extracts_research_domain_metadata(monkeypatch, tmp_path) -> None:
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    report = reports_dir / "ai-safety.md"
    report.write_text(
        "# AI safety evaluation\n\n"
        "> **Method:** deep mode · 2 analysts · 0 unique sources.\n"
        "> **Domain:** artificial-intelligence · safety-evaluation.\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("REPORTS_DIR", str(reports_dir))

    with TestClient(app) as client:
        _development_login(client, monkeypatch)
        listing = client.get("/api/reports")

    assert listing.status_code == 200
    summary = listing.json()["reports"][0]
    assert summary["research_domain"] == "artificial-intelligence"
    assert summary["research_category"] == "safety-evaluation"


def test_oauth_report_directories_are_isolated(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path / "reports"))

    google_directory = backend_main._reports_dir("google:123")
    github_directory = backend_main._reports_dir("github:123")
    local_directory = backend_main._reports_dir("local:researcher")

    assert google_directory != github_directory
    assert google_directory.parent.name == "users"
    assert github_directory.parent.name == "users"
    assert local_directory == (tmp_path / "reports").resolve()
    assert "google" not in google_directory.name
    assert "123" not in google_directory.name


def test_websocket_requires_start_message(monkeypatch) -> None:
    with TestClient(app) as client:
        _development_login(client, monkeypatch)
        with client.websocket_connect("/ws/research") as websocket:
            websocket.send_json({"event": "feedback_submit", "feedback": "approve"})
            message = websocket.receive_json()

    assert message["event"] == "error"
    assert message["message"] == "First message must be start_research"


def test_websocket_rejects_short_topic_without_starting_research(monkeypatch) -> None:
    with TestClient(app) as client:
        _development_login(client, monkeypatch)
        with client.websocket_connect("/ws/research") as websocket:
            websocket.send_json(
                {
                    "event": "start_research",
                    "topic": "RAG",
                    "max_analysts": 1,
                }
            )
            message = websocket.receive_json()

    assert message["event"] == "error"
    assert message["message"] == "Topic is too short"


def test_websocket_rejects_invalid_analyst_count(monkeypatch) -> None:
    with TestClient(app) as client:
        _development_login(client, monkeypatch)
        with client.websocket_connect("/ws/research") as websocket:
            websocket.send_json(
                {
                    "event": "start_research",
                    "topic": "Một chủ đề nghiên cứu hợp lệ",
                    "max_analysts": 99,
                }
            )
            message = websocket.receive_json()

    assert message["event"] == "error"
    assert message["message"] == "Invalid max_analysts"


def test_stream_can_timestamp_and_finish_without_datetime_scope_error(
    monkeypatch, tmp_path
) -> None:
    """Regression: local imports must not shadow the module-level datetime."""

    class FakeWebSocket:
        def __init__(self) -> None:
            self.messages: list[str] = []

        async def send_text(self, message: str) -> None:
            self.messages.append(message)

    class FakeGraph:
        async def astream(self, _graph_input, _thread, stream_mode):
            assert stream_mode == "updates"
            if False:
                yield None

        def get_state(self, _thread):
            return SimpleNamespace(next=(), values={"final_report": "# Test report"})

    websocket = FakeWebSocket()
    session_id = "datetime-regression"
    backend_main.active_sessions[session_id] = {"websocket": websocket}
    monkeypatch.setattr(backend_main, "graph", FakeGraph())
    monkeypatch.chdir(tmp_path)

    try:
        asyncio.run(
            backend_main.run_research_stream(
                session_id,
                {"topic": "A valid test topic", "report_language": "en"},
                {"configurable": {"thread_id": session_id}},
            )
        )
    finally:
        backend_main.active_sessions.pop(session_id, None)

    events = [json.loads(message)["event"] for message in websocket.messages]
    assert events == ["node_complete", "report_complete"]
