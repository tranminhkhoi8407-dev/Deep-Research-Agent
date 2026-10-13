"""Authentication helpers and OAuth routes for the web application.

Provider access tokens are used only during the callback and are never persisted.
The browser receives a signed, HTTP-only session cookie containing a small,
normalized user profile.
"""

from __future__ import annotations

import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlencode, urlsplit

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field, StrictBool

from backend.accounts import (
    authenticate_password_account,
    avatar_file_path,
    clear_custom_avatar,
    consume_password_reset_token,
    create_password_reset_token,
    get_user,
    log_admin_action,
    register_password_account,
    register_login,
    resolve_avatar_url,
    list_onboarding_tours,
    save_onboarding_tour,
    set_custom_avatar,
    synchronize_configured_role,
    update_profile,
)
from backend.schemas import ProfileUpdateRequest
from backend.identity import validate_public_name
from backend.sessions import REMEMBERED_SECONDS, SESSION_ONLY_SECONDS


router = APIRouter(prefix="/api/auth", tags=["authentication"])

# Lightweight in-memory brute-force guard for email/password endpoints.
# Production with multiple workers should move this to Redis.
_CREDENTIAL_ATTEMPTS: dict[str, list[float]] = {}
_CREDENTIAL_RATE_LIMIT = 20
_CREDENTIAL_RATE_WINDOW = 600.0


def _credential_client_key(request: Request, email: str) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client = forwarded or (request.client.host if request.client else "unknown")
    return f"{client}|{(email or '').strip().lower()}"


def _check_credential_rate_limit(request: Request, email: str) -> None:
    now = time.time()
    key = _credential_client_key(request, email)
    attempts = [stamp for stamp in _CREDENTIAL_ATTEMPTS.get(key, []) if now - stamp < _CREDENTIAL_RATE_WINDOW]
    if len(attempts) >= _CREDENTIAL_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait a few minutes and try again",
        )
    attempts.append(now)
    _CREDENTIAL_ATTEMPTS[key] = attempts


def _clear_credential_rate_limit(request: Request, email: str) -> None:
    _CREDENTIAL_ATTEMPTS.pop(_credential_client_key(request, email), None)


_AVATAR_ATTEMPTS: dict[str, list[float]] = {}
_AVATAR_RATE_LIMIT = 20
_AVATAR_RATE_WINDOW = 3600.0


def _check_avatar_rate_limit(user_id: str) -> None:
    now = time.time()
    attempts = [stamp for stamp in _AVATAR_ATTEMPTS.get(user_id, []) if now - stamp < _AVATAR_RATE_WINDOW]
    if len(attempts) >= _AVATAR_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many avatar changes. Please try again later",
        )
    attempts.append(now)
    _AVATAR_ATTEMPTS[user_id] = attempts


TOUR_STEP_COUNTS = {"core": 8, "research": 4, "fields": 4, "library": 5, "host": 3}
TourId = Literal["core", "research", "fields", "library", "host"]


class OnboardingUpdate(BaseModel):
    version: Literal[1] = 1
    step_index: int = Field(ge=0, le=30)
    status: Literal["dismissed", "in_progress", "completed"]


class SessionChoice(BaseModel):
    remember: StrictBool


class CredentialLoginRequest(BaseModel):
    # `identifier` accepts a username or an email address. `email` stays as a
    # deprecated alias so older clients keep working.
    identifier: str | None = Field(default=None, min_length=1, max_length=320)
    email: str | None = Field(default=None, min_length=1, max_length=320)
    password: str = Field(min_length=8, max_length=128)

    def resolved_identifier(self) -> str:
        value = (self.identifier if self.identifier is not None else self.email) or ""
        value = value.strip()
        if not value:
            raise ValueError("Please enter your username or email address")
        return value


class CredentialRegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=3, max_length=320)
    username: str | None = Field(default=None, min_length=3, max_length=30)
    password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=256)
    password: str = Field(min_length=8, max_length=128)


def _start_login_session(request: Request, profile: dict[str, Any]) -> None:
    # Only a successfully authenticated login receives a persistent cookie.
    request.session.clear()
    request.session.update({
        "user": profile,
        "remember": True,
        "login_choice_pending": False,
        "expires_at": int(time.time()) + REMEMBERED_SECONDS,
    })


def _upgrade_pending_login_session(request: Request) -> None:
    """Retire the old prompt once, without overriding an explicit opt-out.

    Called only after /me has validated an active, authenticated account. Do
    not renew already remembered sessions on ordinary reads.
    """
    if request.session.get("login_choice_pending") is not True:
        return
    if request.session.get("remember") is not True or type(request.session.get("expires_at")) is not int:
        request.session["remember"] = True
        request.session["expires_at"] = int(time.time()) + REMEMBERED_SECONDS
    request.session["login_choice_pending"] = False


def _session_info(request: Request) -> dict[str, Any]:
    expiry = request.session.get("expires_at")
    return {
        "remembered": request.session.get("remember") is True,
        "choice_pending": request.session.get("login_choice_pending") is True,
        "expires_at": datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat() if type(expiry) is int else None,
        "persistent_days": REMEMBERED_SECONDS // 86400,
        "session_hours": SESSION_ONLY_SECONDS // 3600,
    }


def _check_session_change(request: Request) -> None:
    # Forms cannot send this header. Cross-origin scripts require CORS approval.
    if request.headers.get("X-Nexora-Session-Intent") != "update":
        raise HTTPException(403, detail="Session changes require an explicit request")
    origin = request.headers.get("origin")
    if origin is not None:
        def normalized(value: str) -> tuple[str, str] | None:
            try:
                parsed = urlsplit(value)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
                    return None
                if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                    return None
                return parsed.scheme.lower(), parsed.netloc.lower()
            except ValueError:
                return None
        allowed = [str(request.base_url), _frontend_url(), *os.getenv("CORS_ORIGINS", "").split(",")]
        resolved = normalized(origin)
        if resolved is None or resolved not in {normalized(value.strip()) for value in allowed if value.strip()}:
            raise HTTPException(403, detail="Untrusted session change origin")


def _truthy(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")


def _backend_url() -> str:
    return os.getenv("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")


def dev_login_enabled() -> bool:
    """Allow a clearly labelled local account outside production by default."""
    is_production = os.getenv("APP_ENV", "development").lower() == "production"
    return _truthy("AUTH_DEV_LOGIN", default=not is_production)


def provider_status() -> dict[str, bool]:
    return {
        "password": True,
        "google": bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")),
        "github": bool(os.getenv("GITHUB_CLIENT_ID") and os.getenv("GITHUB_CLIENT_SECRET")),
    }


def _oauth_client(provider: str):
    providers = provider_status()
    if provider not in providers:
        raise HTTPException(status_code=404, detail="Unsupported sign-in provider")
    if not providers[provider]:
        raise HTTPException(status_code=503, detail=f"{provider.title()} OAuth is not configured")

    oauth = OAuth()
    if provider == "google":
        oauth.register(
            name="google",
            client_id=os.environ["GOOGLE_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    else:
        oauth.register(
            name="github",
            client_id=os.environ["GITHUB_CLIENT_ID"],
            client_secret=os.environ["GITHUB_CLIENT_SECRET"],
            access_token_url="https://github.com/login/oauth/access_token",
            authorize_url="https://github.com/login/oauth/authorize",
            api_base_url="https://api.github.com/",
            client_kwargs={"scope": "read:user user:email"},
        )
    return oauth.create_client(provider)


def _normalize_user(provider: str, profile: dict[str, Any], email: str | None = None) -> dict[str, Any]:
    if provider == "google":
        provider_id = str(profile.get("sub", ""))
        name = profile.get("name") or profile.get("email") or "Google user"
        avatar_url = profile.get("picture")
        username = None
        resolved_email = profile.get("email")
    else:
        provider_id = str(profile.get("id", ""))
        username = profile.get("login")
        name = profile.get("name") or username or email or "GitHub user"
        avatar_url = profile.get("avatar_url")
        resolved_email = profile.get("email") or email

    if not provider_id:
        raise HTTPException(status_code=502, detail="The provider did not return a valid user id")

    return {
        "id": f"{provider}:{provider_id}",
        "provider": provider,
        "name": str(name),
        "email": str(resolved_email) if resolved_email else None,
        "avatar_url": str(avatar_url) if avatar_url else None,
        "username": str(username) if username else None,
    }


def _session_profile(user: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "id",
        "provider",
        "name",
        "email",
        "avatar_url",
        "username",
        "public_name",
        "role",
        "status",
        "license_type",
        "license_expires_at",
        "display_name",
        "bio",
        "location",
        "organization",
        "website",
        "research_interests",
        "created_at",
        "last_login_at",
        "login_count",
    )
    profile = {key: user.get(key) for key in keys}
    # An uploaded avatar always wins over the OAuth provider image.
    profile["avatar_url"] = resolve_avatar_url(user)
    return profile


def _auth_redirect(error: str | None = None) -> RedirectResponse:
    query = urlencode({"auth_error": error}) if error else urlencode({"auth": "success"})
    return RedirectResponse(f"{_frontend_url()}/?{query}", status_code=302)


def current_user(request: Request) -> dict[str, Any]:
    user = request.session.get("user")
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Authentication required")
    persisted = get_user(str(user["id"]))
    if persisted is None:
        persisted = register_login(user)
    else:
        persisted = synchronize_configured_role(persisted)
    if persisted.get("status") == "suspended":
        request.session.clear()
        raise HTTPException(status_code=403, detail="This account has been suspended")
    profile = _session_profile(persisted)
    if request.session.get("user") != profile:
        request.session["user"] = profile
    return profile


def current_admin(request: Request) -> dict[str, Any]:
    user = current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Host access required")
    return user


def collaboration_user(request: Request) -> dict[str, Any]:
    """A provider name or old display name does not complete profile setup."""
    user = current_user(request)
    if not user.get("public_name"):
        raise HTTPException(409, detail={
            "code": "profile_name_required",
            "message": "Set your unique name in Edit profile before opening Notebook or Projects",
        })
    return user


@router.get("/providers")
async def auth_providers():
    return {"providers": provider_status(), "dev_login": dev_login_enabled()}


@router.post("/register")
async def register_with_password(payload: CredentialRegisterRequest, request: Request):
    _check_credential_rate_limit(request, payload.email)
    try:
        user = register_password_account(payload.name, payload.email, payload.password, payload.username)
    except ValueError as exc:
        message = str(exc)
        lowered = message.lower()
        status = 409 if ("already exists" in lowered or "already taken" in lowered) else 422
        raise HTTPException(status, detail=message) from None
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="This account has been suspended")
    profile = _session_profile(user)
    _start_login_session(request, profile)
    _clear_credential_rate_limit(request, payload.email)
    log_admin_action(profile["id"], "auth.register", "session", detail={"provider": "password"})
    return {"authenticated": True, "user": profile, "session": _session_info(request)}


@router.post("/login")
async def login_with_password(payload: CredentialLoginRequest, request: Request):
    try:
        identifier = payload.resolved_identifier()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    _check_credential_rate_limit(request, identifier)
    try:
        user = authenticate_password_account(identifier, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if user is None:
        raise HTTPException(status_code=401, detail="Incorrect username/email or password. Use your sign-in username or email, not your display name")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="This account has been suspended")
    profile = _session_profile(user)
    _start_login_session(request, profile)
    _clear_credential_rate_limit(request, identifier)
    log_admin_action(profile["id"], "auth.login", "session", detail={"provider": "password"})
    return {"authenticated": True, "user": profile, "session": _session_info(request)}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    # Always respond generically so callers cannot probe which emails exist.
    _check_credential_rate_limit(request, f"forgot:{payload.email}")
    token = create_password_reset_token(payload.email)
    if token is not None:
        reset_url = f"{_frontend_url()}/?reset_token={token}"
        print(f"[auth] Password reset link (valid 60 minutes): {reset_url}")
        log_admin_action("anonymous", "auth.password_reset_requested", "session")
    return {
        "message": "If an account uses this email, a password reset link has been sent.",
        # Exposed only outside production so local developers can complete the
        # flow without an SMTP server. Production responses omit this field.
        **({"reset_token": token} if token is not None and os.getenv("APP_ENV", "development").lower() != "production" else {}),
    }


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, request: Request):
    _check_credential_rate_limit(request, f"reset:{payload.token[:12]}")
    try:
        user = consume_password_reset_token(payload.token, payload.password)
    except ValueError as exc:
        message = str(exc)
        status = 422 if "Password" in message else 400
        raise HTTPException(status, detail=message) from None
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="This account has been suspended")
    profile = _session_profile(user)
    _start_login_session(request, profile)
    log_admin_action(profile["id"], "auth.password_reset_completed", "session", detail={"provider": "password"})
    return {"authenticated": True, "user": profile, "session": _session_info(request)}


@router.get("/me")
async def auth_me(request: Request):
    user = request.session.get("user")
    if isinstance(user, dict) and user.get("id"):
        persisted = get_user(str(user["id"]))
        if persisted and persisted.get("status") == "suspended":
            request.session.clear()
            return {"authenticated": False, "user": None, "reason": "suspended"}
        if persisted is None:
            persisted = register_login(user)
        else:
            persisted = synchronize_configured_role(persisted)
        profile = _session_profile(persisted)
        if request.session.get("user") != profile:
            request.session["user"] = profile
        _upgrade_pending_login_session(request)
        return {"authenticated": True, "user": profile, "session": _session_info(request)}
    return {"authenticated": False, "user": None}


@router.put("/session")
async def choose_login_persistence(payload: SessionChoice, request: Request):
    _check_session_change(request)
    user = current_user(request)
    previous = request.session.get("remember") is True
    pending = request.session.get("login_choice_pending") is True
    if previous != payload.remember or type(request.session.get("expires_at")) is not int:
        duration = REMEMBERED_SECONDS if payload.remember else SESSION_ONLY_SECONDS
        request.session["expires_at"] = int(time.time()) + duration
    request.session["remember"] = payload.remember
    request.session["login_choice_pending"] = False
    if pending or previous != payload.remember:
        log_admin_action(user["id"], "auth.session_preference", "session", detail={"remember": payload.remember})
    return {"session": _session_info(request)}


@router.get("/profile")
async def profile_detail(request: Request):
    """Return the server-authoritative profile for the signed-in account."""
    current = current_user(request)
    persisted = get_user(str(current["id"]))
    if persisted is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"user": _session_profile(persisted)}


@router.get("/onboarding")
async def onboarding_progress(request: Request):
    user = current_user(request)
    tours = list_onboarding_tours(str(user["id"]))
    if user.get("role") != "admin":
        tours = [tour for tour in tours if tour["tour_id"] != "host"]
    return {"tours": tours}


@router.put("/onboarding/{tour_id}")
async def update_onboarding_progress(tour_id: TourId, payload: OnboardingUpdate, request: Request):
    user = current_user(request)
    if tour_id == "host" and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Host access required")
    step_count = TOUR_STEP_COUNTS[tour_id]
    if payload.step_index > step_count or (payload.status == "completed") != (payload.step_index == step_count):
        raise HTTPException(status_code=422, detail="Invalid tour step")
    result = save_onboarding_tour(str(user["id"]), tour_id, payload.version, payload.step_index, payload.status)
    return {"tour": result}


@router.patch("/profile")
async def profile_update(payload: ProfileUpdateRequest, request: Request):
    """Persist user-editable profile fields and refresh the signed session."""
    current = current_user(request)
    public_name = public_key = None
    if "public_name" in payload.model_fields_set:
        try:
            public_name, public_key = validate_public_name(payload.public_name or "")
        except ValueError as exc:
            raise HTTPException(422, detail={"code": "invalid_profile_name", "message": str(exc)}) from None
    display_name = payload.display_name.strip()
    bio = payload.bio.strip()
    location = payload.location.strip()
    organization = payload.organization.strip()
    website = payload.website.strip()
    if website and not website.lower().startswith(("https://", "http://")):
        raise HTTPException(status_code=422, detail="Website must start with http:// or https://")

    interests: list[str] = []
    seen: set[str] = set()
    for raw_interest in payload.research_interests:
        interest = raw_interest.strip()
        normalized = interest.casefold()
        if not interest or normalized in seen:
            continue
        if len(interest) > 40:
            raise HTTPException(status_code=422, detail="Each research interest must be 40 characters or fewer")
        seen.add(normalized)
        interests.append(interest)

    try:
        # The unique name and all other profile fields commit together. A
        # collision must not save half a profile or modify the signed session.
        updated = update_profile(
            str(current["id"]),
            display_name=public_name or display_name,
            bio=bio,
            location=location,
            organization=organization,
            website=website,
            research_interests=interests,
            public_name=public_name,
            public_name_key=public_key,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, detail={
            "code": "profile_name_taken",
            "message": "This name is already taken; please enter a different name",
        }) from None
    if updated is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = _session_profile(updated)
    request.session["user"] = profile
    return {"user": profile}


@router.get("/avatars/{token}.webp")
async def serve_avatar(token: str):
    """Serve an uploaded avatar by its unguessable token (no login needed)."""
    if not token or len(token) > 64 or any(char not in "0123456789abcdef" for char in token.lower()):
        raise HTTPException(status_code=404, detail="Avatar not found")
    directory = avatar_file_path("__probe__").parent
    path = (directory / f"{token.lower()}.webp").resolve()
    if path.parent != directory or not path.is_file():
        raise HTTPException(status_code=404, detail="Avatar not found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


@router.post("/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...)):
    """Upload a new profile avatar. The image is cropped square server-side."""
    current = current_user(request)
    user_id = str(current["id"])
    _check_avatar_rate_limit(user_id)
    payload = await file.read()
    # UploadFile.read() has no server-side cap; enforce ours before processing.
    if len(payload) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Avatar must be an image up to 5 MB")
    try:
        updated = set_custom_avatar(user_id, payload)
    except ValueError as exc:
        message = str(exc)
        status = 404 if message == "Profile not found" else 422
        raise HTTPException(status, detail=message) from None
    profile = _session_profile(updated)
    request.session["user"] = profile
    log_admin_action(user_id, "auth.avatar_updated", "session")
    return {"user": profile}


@router.delete("/avatar")
async def remove_avatar(request: Request):
    """Remove the uploaded avatar and return to the provider image/initials."""
    current = current_user(request)
    user_id = str(current["id"])
    _check_avatar_rate_limit(user_id)
    updated = clear_custom_avatar(user_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = _session_profile(updated)
    request.session["user"] = profile
    log_admin_action(user_id, "auth.avatar_removed", "session")
    return {"user": profile}


@router.get("/login/{provider}")
async def oauth_login(provider: str, request: Request):
    provider = provider.lower()
    client = _oauth_client(provider)
    redirect_uri = f"{_backend_url()}/api/auth/callback/{provider}"
    # Anonymous OAuth state stays session-only until authentication succeeds.
    # Starting (or failing) another OAuth flow must not demote an existing login.
    request.session.setdefault("remember", False)
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/callback/{provider}", name="oauth_callback")
async def oauth_callback(provider: str, request: Request):
    provider = provider.lower()
    try:
        client = _oauth_client(provider)
        token = await client.authorize_access_token(request)

        if provider == "google":
            profile = token.get("userinfo")
            if not profile:
                profile = await client.parse_id_token(request, token)
            user = _normalize_user("google", dict(profile or {}))
        elif provider == "github":
            profile_response = await client.get("user", token=token)
            profile_response.raise_for_status()
            profile = profile_response.json()
            email = profile.get("email")
            if not email:
                emails_response = await client.get("user/emails", token=token)
                emails_response.raise_for_status()
                emails = emails_response.json()
                preferred = next(
                    (item for item in emails if item.get("primary") and item.get("verified")),
                    next((item for item in emails if item.get("verified")), None),
                )
                email = preferred.get("email") if preferred else None
            user = _normalize_user("github", profile, email)
        else:
            raise HTTPException(status_code=404, detail="Unsupported sign-in provider")

        user = register_login(user)
        if user.get("status") == "suspended":
            return _auth_redirect("Tài khoản này đã bị tạm khóa bởi host.")
        profile = _session_profile(user)
        _start_login_session(request, profile)
        log_admin_action(profile["id"], "auth.login", "session", detail={"provider": provider})
        return _auth_redirect()
    except HTTPException:
        raise
    except OAuthError as exc:
        return _auth_redirect(f"OAuth {provider}: {exc.description or exc.error}")
    except Exception:
        return _auth_redirect(f"Không thể hoàn tất đăng nhập {provider.title()}.")


@router.post("/dev-login")
async def development_login(request: Request):
    if not dev_login_enabled():
        raise HTTPException(status_code=404, detail="Development login is disabled")
    user = register_login({
        "id": "local:researcher",
        "provider": "local",
        "name": "Local Researcher",
        "email": "researcher@localhost",
        "avatar_url": None,
        "username": "local-researcher",
    })
    profile = _session_profile(user)
    _start_login_session(request, profile)
    log_admin_action(profile["id"], "auth.login", "session", detail={"provider": "local"})
    return {"authenticated": True, "user": profile, "session": _session_info(request)}


@router.post("/logout")
async def logout(request: Request):
    user = request.session.get("user")
    if isinstance(user, dict) and user.get("id"):
        log_admin_action(str(user["id"]), "auth.logout", "session")
    request.session.clear()
    return {"authenticated": False}
