"""Login persistence tests: isolated accounts, no external OAuth requests."""
import base64
import json
import time
from http.cookies import SimpleCookie
from types import SimpleNamespace

import pytest
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

import backend.auth as auth
import backend.sessions as sessions
from backend.accounts import update_user
from backend.main import app, session_secret

INTENT = {"X-Nexora-Session-Intent": "update"}


@pytest.fixture(autouse=True)
def isolated_accounts(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "accounts.db"))
    monkeypatch.setenv("AUTH_DEV_LOGIN", "true")
    monkeypatch.setenv("ADMIN_EMAILS", "")
    monkeypatch.setenv("FRONTEND_URL", "http://127.0.0.1:5173")
    monkeypatch.setenv("CORS_ORIGINS", "http://127.0.0.1:5173")


def cookie_age(response):
    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    return cookie["deep_research_session"]["max-age"]


def choose(client, remember, **kwargs):
    return client.put("/api/auth/session", json={"remember": remember}, headers=INTENT, **kwargs)


def set_signed_session(client, payload):
    signer = TimestampSigner(session_secret or "deep-research-local-development-only-secret")
    cookie = signer.sign(base64.b64encode(json.dumps(payload).encode())).decode()
    client.cookies.clear()
    client.cookies.set("deep_research_session", cookie)


@pytest.mark.parametrize("query", ["", "?remember=true", "?remember=false"])
def test_successful_login_is_automatically_remembered_without_a_choice(query):
    with TestClient(app) as client:
        response = client.post(f"/api/auth/dev-login{query}")
        assert 2591990 <= int(cookie_age(response)) <= 2592000
        session = response.json()["session"]
        assert not session["choice_pending"] and session["remembered"]
        assert session["persistent_days"] == 30 and session["session_hours"] == 12
        assert client.get("/api/auth/me").json()["session"] == session


def test_remembered_cookie_restores_login_in_a_new_browser_session():
    with TestClient(app) as client:
        login = client.post("/api/auth/dev-login").json()
        cookie = client.cookies.get("deep_research_session")
    with TestClient(app) as reopened:
        reopened.cookies.set("deep_research_session", cookie)
        me = reopened.get("/api/auth/me")
        assert me.json() == {"authenticated": True, "user": login["user"], "session": login["session"]}
        assert "set-cookie" not in me.headers


def test_disable_keeps_current_session_logout_clears_it_and_new_login_remembers():
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        accepted = choose(client, True)
        assert accepted.status_code == 200
        assert 2591990 <= int(cookie_age(accepted)) <= 2592000
        assert accepted.json()["session"]["remembered"] is True
        assert accepted.json()["session"]["choice_pending"] is False
        assert "httponly" in accepted.headers["set-cookie"].lower()
        me = client.get("/api/auth/me")
        assert "set-cookie" not in me.headers, "Read requests must not roll back a concurrent choice"
        disabled = choose(client, False)
        assert cookie_age(disabled) == ""
        assert disabled.json()["session"]["remembered"] is False
        assert client.get("/api/auth/me").json()["authenticated"] is True
        response = client.post("/api/auth/logout")
        assert "1970" in response.headers["set-cookie"]
        assert client.get("/api/auth/me").json()["authenticated"] is False
        assert choose(client, True).status_code == 401
        next_login = client.post("/api/auth/dev-login")
        assert next_login.json()["session"]["choice_pending"] is False
        assert next_login.json()["session"]["remembered"] is True
        assert 2591990 <= int(cookie_age(next_login)) <= 2592000


def test_explicitly_disabled_session_stays_disabled_on_reload_and_can_be_enabled():
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        disabled = choose(client, False).json()["session"]
        me = client.get("/api/auth/me")
        assert me.json()["session"] == disabled
        assert not disabled["remembered"] and not disabled["choice_pending"]
        assert "set-cookie" not in me.headers
        enabled = choose(client, True)
        assert enabled.json()["session"]["remembered"]
        assert 2591990 <= int(cookie_age(enabled)) <= 2592000


def test_choices_are_idempotent_and_reading_does_not_slide_deadline(monkeypatch):
    now = int(time.time())
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: now))
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        first = choose(client, True).json()["session"]
        monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: now + 600))
        monkeypatch.setattr(sessions, "time", SimpleNamespace(time=lambda: now + 600))
        again = choose(client, True)
        assert again.json()["session"] == first
        assert int(cookie_age(again)) == sessions.REMEMBERED_SECONDS - 600
        assert client.get("/api/auth/me").json()["session"] == first


@pytest.mark.parametrize("remember", [False, True])
def test_server_expiry_enforced_even_when_browser_restores_cookie(monkeypatch, remember):
    now = int(time.time())
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: now))
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        choose(client, remember)
        duration = sessions.REMEMBERED_SECONDS if remember else sessions.SESSION_ONLY_SECONDS
        monkeypatch.setattr(sessions, "time", SimpleNamespace(time=lambda: now + duration))
        me = client.get("/api/auth/me")
        assert me.json()["authenticated"] is False
        assert "1970" in me.headers["set-cookie"]
        assert client.get("/api/reports").status_code == 401


def test_preference_requires_authentication_and_explicit_header():
    with TestClient(app) as client:
        assert choose(client, True).status_code == 401
        client.post("/api/auth/dev-login")
        response = client.put("/api/auth/session", json={"remember": False})
        assert response.status_code == 403
        assert client.get("/api/auth/me").json()["session"]["remembered"]


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://127.0.0.1:5173.evil.example", "http://[", "http://127.0.0.1:5173/evil", "http://fake@127.0.0.1:5173"])
def test_cross_origin_preference_rejected(origin):
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        response = client.put("/api/auth/session", json={"remember": False}, headers={**INTENT, "Origin": origin})
        assert response.status_code == 403
        assert client.get("/api/auth/me").json()["session"]["remembered"]


def test_configured_frontend_origin_allowed_and_sensitive_responses_not_cached():
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        response = client.put("/api/auth/session", json={"remember": True}, headers={**INTENT, "Origin": "http://127.0.0.1:5173"})
        assert response.status_code == 200
        for result in [response, client.get("/api/auth/me")]:
            assert result.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("value", [None, "true", "false", 1, 0, {}])
def test_only_boolean_choice_accepted(value):
    with TestClient(app) as client:
        client.post("/api/auth/dev-login")
        assert choose(client, value).status_code == 422
        session = client.get("/api/auth/me").json()["session"]
        assert session["choice_pending"] is False and session["remembered"] is True


@pytest.mark.parametrize("provider", ["google", "github"])
def test_oauth_callback_automatically_remembers_only_after_success(monkeypatch, provider):
    class FakeOAuth:
        async def authorize_redirect(self, request, redirect_uri):
            request.session["mock_state"] = provider
            return RedirectResponse("https://oauth.example.invalid/authorize")

        async def authorize_access_token(self, request):
            assert request.session.get("mock_state") == provider
            return {"userinfo": {"sub": "fixture-google", "name": "QA Google", "email": "qa@example.invalid"}}

        async def get(self, path, token):
            assert path == "user"
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"id": 123, "login": "qa-github", "email": "qa@example.invalid"})

    monkeypatch.setattr(auth, "_oauth_client", lambda _: FakeOAuth())
    with TestClient(app) as client:
        start = client.get(f"/api/auth/login/{provider}?remember=true", follow_redirects=False)
        assert cookie_age(start) == ""
        callback = client.get(f"/api/auth/callback/{provider}?remember=true", follow_redirects=False)
        assert "auth=success" in callback.headers["location"]
        assert 2591990 <= int(cookie_age(callback)) <= 2592000
        me = client.get("/api/auth/me").json()
        assert me["user"]["provider"] == provider
        assert not me["session"]["choice_pending"] and me["session"]["remembered"]


@pytest.mark.parametrize("signed_in", [False, True])
def test_failed_oauth_does_not_create_or_demote_a_remembered_login(monkeypatch, signed_in):
    class FailedOAuth:
        async def authorize_redirect(self, request, redirect_uri):
            request.session["mock_state"] = "failed-flow"
            return RedirectResponse("https://oauth.example.invalid/authorize")

        async def authorize_access_token(self, request):
            request.session.pop("mock_state", None)
            raise auth.OAuthError(error="access_denied")

    monkeypatch.setattr(auth, "_oauth_client", lambda _: FailedOAuth())
    with TestClient(app) as client:
        original = client.post("/api/auth/dev-login").json()["session"] if signed_in else None
        start = client.get("/api/auth/login/google", follow_redirects=False)
        callback = client.get("/api/auth/callback/google", follow_redirects=False)
        assert "auth_error=" in callback.headers["location"]
        me = client.get("/api/auth/me").json()
        if signed_in:
            assert int(cookie_age(start)) > 0 and int(cookie_age(callback)) > 0
            assert me["authenticated"] and me["session"] == original
        else:
            assert cookie_age(start) == cookie_age(callback) == ""
            assert not me["authenticated"]


def test_old_pending_session_is_upgraded_once_without_prompt_or_sliding_expiry(monkeypatch):
    now = int(time.time())
    monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: now))
    with TestClient(app) as client:
        profile = client.post("/api/auth/dev-login").json()["user"]
        set_signed_session(client, {"user": profile, "remember": False, "login_choice_pending": True,
                                    "expires_at": now + sessions.SESSION_ONLY_SECONDS})
        upgraded = client.get("/api/auth/me")
        assert int(cookie_age(upgraded)) == sessions.REMEMBERED_SECONDS
        metadata = upgraded.json()["session"]
        assert metadata["remembered"] and not metadata["choice_pending"]
        monkeypatch.setattr(auth, "time", SimpleNamespace(time=lambda: now + 600))
        monkeypatch.setattr(sessions, "time", SimpleNamespace(time=lambda: now + 600))
        again = client.get("/api/auth/me")
        assert again.json()["session"] == metadata
        assert "set-cookie" not in again.headers


@pytest.mark.parametrize("state", ["expired", "anonymous", "suspended"])
def test_pending_migration_never_revives_expired_anonymous_or_suspended_sessions(state):
    with TestClient(app) as client:
        profile = client.post("/api/auth/dev-login").json()["user"]
        payload = {"remember": False, "login_choice_pending": True, "expires_at": int(time.time()) + 1000}
        if state != "anonymous":
            payload["user"] = profile
        if state == "expired":
            payload["expires_at"] = int(time.time()) - 1
        if state == "suspended":
            update_user(profile["id"], status="suspended")
        set_signed_session(client, payload)
        me = client.get("/api/auth/me")
        assert not me.json()["authenticated"]
        if "set-cookie" in me.headers:
            assert "max-age=" not in me.headers["set-cookie"].lower()


@pytest.mark.parametrize("remember", [False, True])
def test_previous_completed_choice_is_preserved_without_resetting_deadline(remember):
    with TestClient(app) as client:
        profile = client.post("/api/auth/dev-login").json()["user"]
        deadline = int(time.time()) + 2000
        set_signed_session(client, {"user": profile, "remember": remember, "login_choice_pending": False,
                                    "expires_at": deadline})
        me = client.get("/api/auth/me")
        metadata = me.json()["session"]
        assert metadata["remembered"] is remember and not metadata["choice_pending"]
        assert metadata["expires_at"] == auth.datetime.fromtimestamp(deadline, tz=auth.timezone.utc).isoformat()
        assert "set-cookie" not in me.headers


@pytest.mark.parametrize("payload", [[], "not-an-object", {"expires_at": "wrong"}, {"expires_at": True}])
def test_signed_malformed_session_fails_closed(payload):
    signer = TimestampSigner(session_secret or "deep-research-local-development-only-secret")
    cookie = signer.sign(base64.b64encode(json.dumps(payload).encode())).decode()
    with TestClient(app) as client:
        client.cookies.set("deep_research_session", cookie)
        response = client.get("/api/auth/me")
        assert response.status_code == 200
        assert response.json()["authenticated"] is False


def test_legacy_session_does_not_force_existing_users_to_answer_again():
    with TestClient(app) as client:
        profile = client.post("/api/auth/dev-login").json()["user"]
        signer = TimestampSigner(session_secret or "deep-research-local-development-only-secret")
        cookie = signer.sign(base64.b64encode(json.dumps({"user": profile, "remember": True}).encode())).decode()
        client.cookies.clear()
        client.cookies.set("deep_research_session", cookie)
        me = client.get("/api/auth/me").json()
        assert me["authenticated"]
        assert me["session"]["remembered"] and not me["session"]["choice_pending"]
