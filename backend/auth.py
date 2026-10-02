"""Authentication helpers and OAuth routes for the web application.

Provider access tokens are used only during the callback and are never persisted.
The browser receives a signed, HTTP-only session cookie containing a small,
normalized user profile.
"""

from __future__ import annotations

import os
import sqlite3
from typing import Any, Literal
from urllib.parse import urlencode

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend.accounts import (
    get_user,
    log_admin_action,
    register_login,
    list_onboarding_tours,
    save_onboarding_tour,
    synchronize_configured_role,
    update_profile,
)
from backend.schemas import ProfileUpdateRequest
from backend.identity import validate_public_name


router = APIRouter(prefix="/api/auth", tags=["authentication"])

TOUR_STEP_COUNTS = {"core": 8, "research": 4, "fields": 4, "library": 5, "host": 3}
TourId = Literal["core", "research", "fields", "library", "host"]


class OnboardingUpdate(BaseModel):
    version: Literal[1] = 1
    step_index: int = Field(ge=0, le=30)
    status: Literal["dismissed", "in_progress", "completed"]


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
    return {key: user.get(key) for key in keys}


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
        request.session["user"] = profile
        return {"authenticated": True, "user": profile}
    return {"authenticated": False, "user": None}


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


@router.get("/login/{provider}")
async def oauth_login(provider: str, request: Request, remember: bool = False):
    provider = provider.lower()
    client = _oauth_client(provider)
    redirect_uri = f"{_backend_url()}/api/auth/callback/{provider}"
    request.session["remember"] = remember
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/callback/{provider}", name="oauth_callback")
async def oauth_callback(provider: str, request: Request):
    provider = provider.lower()
    try:
        remember = request.session.get("remember") is True
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
        request.session.clear()
        request.session["user"] = profile
        request.session["remember"] = remember
        log_admin_action(profile["id"], "auth.login", "session", detail={"provider": provider})
        return _auth_redirect()
    except HTTPException:
        raise
    except OAuthError as exc:
        return _auth_redirect(f"OAuth {provider}: {exc.description or exc.error}")
    except Exception:
        return _auth_redirect(f"Không thể hoàn tất đăng nhập {provider.title()}.")


@router.post("/dev-login")
async def development_login(request: Request, remember: bool = False):
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
    request.session.clear()
    request.session["user"] = profile
    request.session["remember"] = remember
    log_admin_action(profile["id"], "auth.login", "session", detail={"provider": "local"})
    return {"authenticated": True, "user": profile}


@router.post("/logout")
async def logout(request: Request):
    user = request.session.get("user")
    if isinstance(user, dict) and user.get("id"):
        log_admin_action(str(user["id"]), "auth.logout", "session")
    request.session.clear()
    return {"authenticated": False}
