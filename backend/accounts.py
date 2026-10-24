"""Small SQLite-backed account registry, local credentials, and audit log."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_UNSET = object()
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,30}$")
_PASSWORD_PROVIDER = "password"
_PASSWORD_RESET_TTL_SECONDS = 3600

# Custom profile avatars: normalized server-side to a small square WebP.
_AVATAR_MAX_BYTES = 5 * 1024 * 1024
_AVATAR_SIZE = 256
_AVATAR_MAX_PIXELS = 16_000_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_path() -> Path:
    path = Path(os.getenv("AUTH_DATABASE_PATH", "data/deep-research.db")).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _normalize_email(email: str) -> str:
    normalized = (email or "").strip().lower()
    if not _EMAIL_RE.fullmatch(normalized):
        raise ValueError("Please enter a valid email address")
    if len(normalized) > 320:
        raise ValueError("Email address is too long")
    return normalized


def _normalize_account_name(name: str) -> str:
    normalized = " ".join((name or "").strip().split())
    if len(normalized) < 2:
        raise ValueError("Please enter your name")
    if len(normalized) > 80:
        raise ValueError("Name must be 80 characters or fewer")
    return normalized


def _normalize_username(username: str) -> str:
    normalized = (username or "").strip()
    if not _USERNAME_RE.fullmatch(normalized):
        raise ValueError("Username must be 3-30 characters: letters, numbers, dot, underscore or hyphen")
    return normalized


def _normalize_identifier(identifier: str) -> tuple[str, str]:
    """Return (kind, value) where kind is 'email' or 'username'."""
    value = (identifier or "").strip()
    if not value or len(value) > 320:
        raise ValueError("Please enter your username or email address")
    if "@" in value:
        return "email", _normalize_email(value)
    return "username", _normalize_username(value)


_COMMON_PASSWORDS = frozenset({
    "password", "password1", "password123", "12345678", "123456789", "1234567890",
    "qwerty", "qwerty123", "abc12345", "11111111", "00000000", "iloveyou",
    "admin123", "welcome1", "letmein1", "monkey123", "dragon123", "123123123",
    "matkhau1", "matkhau123",
})

_PASSWORD_RULES = (
    ("Password must be at least 8 characters", lambda value: len(value) >= 8),
    ("Password must be 128 characters or fewer", lambda value: len(value) <= 128),
)


def password_strength(password: str) -> dict[str, object]:
    """Score a password 0-4 without rejecting it, for UI guidance only."""
    value = password or ""
    score = 0
    checks = {
        "length": len(value) >= 8,
        "variety": sum([
            any(char.islower() for char in value),
            any(char.isupper() for char in value),
            any(char.isdigit() for char in value),
            any(not char.isalnum() for char in value),
        ]) >= 2,
        "long": len(value) >= 12,
        "complex": sum([
            any(char.islower() for char in value),
            any(char.isupper() for char in value),
            any(char.isdigit() for char in value),
            any(not char.isalnum() for char in value),
        ]) >= 3 and len(value) >= 10,
    }
    score = sum(1 for key in ("length", "variety", "long", "complex") if checks[key])
    # Common passwords are never strong, no matter how they score.
    if value.strip().lower() in _COMMON_PASSWORDS:
        score = 0
    return {"score": score, "checks": checks}


def _validate_password(password: str) -> str:
    if not isinstance(password, str):
        raise ValueError("Password must be at least 8 characters")
    for message, predicate in _PASSWORD_RULES:
        if not predicate(password):
            raise ValueError(message)
    if not password.strip() or password.isspace():
        raise ValueError("Password cannot be blank or contain only spaces")
    if len(password.strip()) < 8:
        raise ValueError("Password must be at least 8 characters")
    lowered = password.strip().lower()
    if lowered in _COMMON_PASSWORDS:
        raise ValueError("This password is too common. Please choose a stronger password")
    # Registration requires a minimum of letters + numbers so stored hashes
    # resist trivial guessing. Login verification itself is unaffected.
    has_letter = any(char.isalpha() for char in password)
    has_digit = any(char.isdigit() for char in password)
    if not (has_letter and has_digit):
        raise ValueError("Password must include both letters and numbers")
    return password


def _hash_password(password: str, *, salt: bytes | None = None) -> str:
    secret = _validate_password(password).encode("utf-8")
    resolved_salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(secret, salt=resolved_salt, n=2**14, r=8, p=1, dklen=32)
    return "$".join(
        [
            "scrypt",
            "16384",
            "8",
            "1",
            base64.urlsafe_b64encode(resolved_salt).decode("ascii"),
            base64.urlsafe_b64encode(derived).decode("ascii"),
        ]
    )


def _verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n, r, p, salt_b64, digest_b64 = stored.split("$", 5)
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.urlsafe_b64decode(salt_b64.encode("ascii")),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=32,
        )
        return hmac.compare_digest(
            derived,
            base64.urlsafe_b64decode(digest_b64.encode("ascii")),
        )
    except (ValueError, TypeError):
        return False


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_database_path(), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            avatar_url TEXT,
            username TEXT,
            role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')),
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
            license_type TEXT NOT NULL DEFAULT 'free',
            license_expires_at TEXT,
            created_at TEXT NOT NULL,
            last_login_at TEXT NOT NULL,
            login_count INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id TEXT NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT,
            detail TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS onboarding_tours (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tour_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            step_index INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('dismissed', 'in_progress', 'completed')),
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, tour_id)
        );

        CREATE TABLE IF NOT EXISTS local_credentials (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS password_resets (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_rate_limit_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT NOT NULL,
            attempted_at REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_local_credentials_email ON local_credentials(email);
        CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_key_time
            ON auth_rate_limit_attempts(key_hash, attempted_at);
        CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_time
            ON auth_rate_limit_attempts(attempted_at);
        """
    )
    # Lightweight forward migration for databases created before licenses existed.
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()
    }
    if "license_type" not in columns:
        connection.execute(
            "ALTER TABLE users ADD COLUMN license_type TEXT NOT NULL DEFAULT 'free'"
        )
    if "license_expires_at" not in columns:
        connection.execute("ALTER TABLE users ADD COLUMN license_expires_at TEXT")
    profile_migrations = {
        "public_name": "TEXT",
        "public_name_key": "TEXT",
        "display_name": "TEXT",
        "bio": "TEXT NOT NULL DEFAULT ''",
        "location": "TEXT NOT NULL DEFAULT ''",
        "organization": "TEXT NOT NULL DEFAULT ''",
        "website": "TEXT NOT NULL DEFAULT ''",
        "research_interests": "TEXT NOT NULL DEFAULT '[]'",
        # User-uploaded avatar. OAuth provider avatars keep refreshing the
        # base `avatar_url` column on every login, so custom uploads live in
        # their own column and always win when present.
        "custom_avatar_url": "TEXT",
    }
    for column, definition in profile_migrations.items():
        if column not in columns:
            connection.execute(f"ALTER TABLE users ADD COLUMN {column} {definition}")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_name_key ON users(public_name_key)")
    return connection


def check_auth_rate_limits(key_limits: list[tuple[str, int]], window_seconds: float) -> bool:
    """Atomically count auth attempts in SQLite across workers on this host.

    Keys are HMACed with the session secret before storage so raw IP addresses
    and account identifiers are not written to the rate-limit table.
    """
    secret = (os.getenv("AUTH_SESSION_SECRET") or "deep-research-local-development-only-secret").encode("utf-8")
    keyed_limits = {
        hmac.new(secret, key.encode("utf-8"), hashlib.sha256).hexdigest(): max(1, int(limit))
        for key, limit in key_limits
        if key
    }
    if not keyed_limits:
        return True

    now = time.time()
    cutoff = now - max(1.0, float(window_seconds))
    placeholders = ", ".join("?" for _ in keyed_limits)
    with _connect() as connection:
        # Serialize check-and-insert so two workers cannot both pass the same
        # threshold concurrently.
        # `_connect` may have just applied a forward schema migration.
        connection.commit()
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "DELETE FROM auth_rate_limit_attempts WHERE attempted_at <= ?",
            (cutoff,),
        )
        rows = connection.execute(
            f"""SELECT key_hash, COUNT(*) AS attempt_count
                FROM auth_rate_limit_attempts
                WHERE key_hash IN ({placeholders}) AND attempted_at > ?
                GROUP BY key_hash""",
            (*keyed_limits.keys(), cutoff),
        ).fetchall()
        counts = {str(row["key_hash"]): int(row["attempt_count"]) for row in rows}
        if any(counts.get(key, 0) >= limit for key, limit in keyed_limits.items()):
            # Keep the expired-row cleanup even when this request is blocked.
            connection.commit()
            return False
        connection.executemany(
            "INSERT INTO auth_rate_limit_attempts (key_hash, attempted_at) VALUES (?, ?)",
            ((key, now) for key in keyed_limits),
        )
    return True


def clear_auth_rate_limit(key: str) -> None:
    """Clear one identity bucket after a successful password login."""
    if not key:
        return
    secret = (os.getenv("AUTH_SESSION_SECRET") or "deep-research-local-development-only-secret").encode("utf-8")
    key_hash = hmac.new(secret, key.encode("utf-8"), hashlib.sha256).hexdigest()
    with _connect() as connection:
        connection.execute(
            "DELETE FROM auth_rate_limit_attempts WHERE key_hash = ?",
            (key_hash,),
        )


def _admin_emails() -> set[str]:
    return {
        email.strip().lower()
        for email in os.getenv("ADMIN_EMAILS", "").split(",")
        if email.strip()
    }


def _default_role(user: dict[str, Any]) -> str:
    if str(user.get("provider") or "").lower() == _PASSWORD_PROVIDER:
        return "member"
    email = str(user.get("email") or "").lower()
    if email and email in _admin_emails():
        return "admin"
    return "member"


def _row_to_user(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    user = dict(row)
    raw_interests = user.get("research_interests")
    if isinstance(raw_interests, str):
        try:
            parsed = json.loads(raw_interests)
            user["research_interests"] = parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            user["research_interests"] = []
    return user


def register_login(user: dict[str, Any]) -> dict[str, Any]:
    """Create/update an account and return its server-authoritative profile."""
    now = _now()
    with _connect() as connection:
        existing = connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        role = _default_role(user)
        if existing:
            connection.execute(
                """
                UPDATE users
                SET provider = ?, name = ?, email = ?, avatar_url = ?, username = ?,
                    role = ?, last_login_at = ?, login_count = login_count + 1
                WHERE id = ?
                """,
                (
                    user["provider"], user["name"], user.get("email"), user.get("avatar_url"),
                    user.get("username"), role, now, user["id"],
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO users
                    (id, provider, name, email, avatar_url, username, role, status,
                     created_at, last_login_at, login_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)
                """,
                (
                    user["id"], user["provider"], user["name"], user.get("email"),
                    user.get("avatar_url"), user.get("username"), role, now, now,
                ),
            )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return _row_to_user(row) or user


def _username_taken(connection: sqlite3.Connection, username: str, *, exclude_user_id: str | None = None) -> bool:
    row = connection.execute(
        "SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        (username,),
    ).fetchone()
    if row is None:
        return False
    return exclude_user_id is None or str(row["id"]) != exclude_user_id


def register_password_account(
    name: str, email: str, password: str, username: str | None = None,
) -> dict[str, Any]:
    """Create a first-party password account and return its persisted profile."""
    resolved_name = _normalize_account_name(name)
    resolved_email = _normalize_email(email)
    resolved_username = _normalize_username(username) if username is not None and str(username).strip() else None
    if resolved_username is None:
        # Derive a readable default from the email prefix so every password
        # account can sign in with either a username or an email address.
        prefix = re.sub(r"[^A-Za-z0-9._-]+", "", resolved_email.split("@")[0])[:24] or "researcher"
        if len(prefix) < 3:
            prefix = (prefix + "user")[:30]
        resolved_username = prefix
    password_hash = _hash_password(password)
    now = _now()
    user_id = f"{_PASSWORD_PROVIDER}:{uuid.uuid4().hex}"
    with _connect() as connection:
        if connection.execute(
            "SELECT 1 FROM local_credentials WHERE email = ?",
            (resolved_email,),
        ).fetchone():
            raise ValueError("An account with this email already exists")
        if _username_taken(connection, resolved_username):
            # Make the derived default unique instead of failing registration.
            if username is not None and str(username).strip():
                raise ValueError("This username is already taken")
            suffix = 2
            candidate = resolved_username
            while _username_taken(connection, candidate):
                tail = str(suffix)
                candidate = f"{resolved_username[:30 - len(tail)]}{tail}"
                suffix += 1
                if suffix > 9999:
                    raise ValueError("This username is already taken")
            resolved_username = candidate
        connection.execute(
            """
            INSERT INTO users
                (id, provider, name, email, avatar_url, username, role, status,
                 created_at, last_login_at, login_count)
            VALUES (?, ?, ?, ?, ?, ?, 'member', 'active', ?, ?, 1)
            """,
            (
                user_id,
                _PASSWORD_PROVIDER,
                resolved_name,
                resolved_email,
                None,
                resolved_username,
                now,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO local_credentials (user_id, email, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, resolved_email, password_hash, now, now),
        )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) or {
        "id": user_id,
        "provider": _PASSWORD_PROVIDER,
        "name": resolved_name,
        "email": resolved_email,
        "username": resolved_username,
    }


def authenticate_password_account(identifier: str, password: str) -> dict[str, Any] | None:
    """Return the signed-in profile if username/email + password are valid."""
    kind, value = _normalize_identifier(identifier)
    with _connect() as connection:
        if kind == "email":
            row = connection.execute(
                """
                SELECT users.*
                FROM local_credentials
                JOIN users ON users.id = local_credentials.user_id
                WHERE local_credentials.email = ?
                """,
                (value,),
            ).fetchone()
        else:
            row = connection.execute(
                """
                SELECT users.*
                FROM local_credentials
                JOIN users ON users.id = local_credentials.user_id
                WHERE LOWER(users.username) = LOWER(?)
                """,
                (value,),
            ).fetchone()
    user = _row_to_user(row)
    if not user:
        return None
    with _connect() as connection:
        credential_row = connection.execute(
            "SELECT password_hash FROM local_credentials WHERE user_id = ?",
            (user["id"],),
        ).fetchone()
    if credential_row is None or not _verify_password(password, str(credential_row["password_hash"])):
        return None
    return register_login(
        {
            "id": user["id"],
            "provider": _PASSWORD_PROVIDER,
            "name": user["name"],
            "email": user.get("email"),
            "avatar_url": user.get("avatar_url"),
            "username": user.get("username"),
        }
    )


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_password_reset_token(email: str) -> str | None:
    """Create a single-use reset token for the account owning this email.

    Returns None when no password account uses the email, so callers can
    respond with a generic message that does not reveal account existence.
    """
    try:
        resolved_email = _normalize_email(email)
    except ValueError:
        return None
    now = _now()
    with _connect() as connection:
        row = connection.execute(
            "SELECT user_id FROM local_credentials WHERE email = ?",
            (resolved_email,),
        ).fetchone()
        if row is None:
            return None
        user_id = str(row["user_id"])
        # One active token per account keeps the flow predictable.
        connection.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
        token = secrets.token_urlsafe(32)
        expires = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + _PASSWORD_RESET_TTL_SECONDS,
            tz=timezone.utc,
        ).isoformat()
        connection.execute(
            """
            INSERT INTO password_resets (token_hash, user_id, expires_at, used_at, created_at)
            VALUES (?, ?, ?, NULL, ?)
            """,
            (_hash_reset_token(token), user_id, expires, now),
        )
    return token


def discard_password_reset_token(token: str) -> None:
    """Invalidate a reset token that could not be delivered to its recipient."""
    candidate = (token or "").strip()
    if not candidate:
        return
    with _connect() as connection:
        connection.execute(
            "DELETE FROM password_resets WHERE token_hash = ?",
            (_hash_reset_token(candidate),),
        )


def consume_password_reset_token(token: str, new_password: str) -> dict[str, Any]:
    """Validate a reset token, set the new password, and return the user."""
    candidate = (token or "").strip()
    if not candidate:
        raise ValueError("Invalid or expired reset link")
    password_hash = _hash_password(new_password)
    now = _now()
    with _connect() as connection:
        row = connection.execute(
            "SELECT token_hash, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
            (_hash_reset_token(candidate),),
        ).fetchone()
        if row is None or row["used_at"] is not None:
            raise ValueError("Invalid or expired reset link")
        try:
            expiry = datetime.fromisoformat(str(row["expires_at"]))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
        except ValueError:
            raise ValueError("Invalid or expired reset link") from None
        if expiry <= datetime.now(timezone.utc):
            raise ValueError("Invalid or expired reset link")
        user_id = str(row["user_id"])
        connection.execute(
            "UPDATE local_credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?",
            (password_hash, now, user_id),
        )
        connection.execute(
            "UPDATE password_resets SET used_at = ? WHERE token_hash = ?",
            (now, str(row["token_hash"])),
        )
        user_row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    user = _row_to_user(user_row)
    if user is None:
        raise ValueError("Invalid or expired reset link")
    return register_login(
        {
            "id": user["id"],
            "provider": _PASSWORD_PROVIDER,
            "name": user["name"],
            "email": user.get("email"),
            "avatar_url": user.get("avatar_url"),
            "username": user.get("username"),
        }
    )


def get_user(user_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        return _row_to_user(connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def resolve_avatar_url(user: dict[str, Any] | None) -> str | None:
    """Prefer an uploaded avatar; fall back to the OAuth provider image."""
    if not isinstance(user, dict):
        return None
    custom = user.get("custom_avatar_url")
    if isinstance(custom, str) and custom.strip():
        return custom.strip()
    avatar = user.get("avatar_url")
    return str(avatar) if avatar else None


def _avatars_dir() -> Path:
    path = Path(os.getenv("AVATAR_DIR", "data/avatars")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def avatar_token(user_id: str) -> str:
    """Unguessable, stable public token so avatar files need no auth to view."""
    return hashlib.sha256(f"avatar:{user_id}".encode("utf-8")).hexdigest()[:24]


def avatar_file_path(user_id: str) -> Path:
    return _avatars_dir() / f"{avatar_token(user_id)}.webp"


def normalize_avatar_image(payload: bytes) -> bytes:
    """Validate an upload and normalize it to a square WebP avatar."""
    from PIL import Image, ImageOps

    if not payload or len(payload) > _AVATAR_MAX_BYTES:
        raise ValueError("Avatar must be an image up to 5 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP", "GIF"}:
                    raise ValueError("Avatar must be a PNG, JPEG, WEBP or GIF image")
                if image.width * image.height > _AVATAR_MAX_PIXELS:
                    raise ValueError("Avatar image is too large")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated images are not supported for avatars")
                image.load()
                pixels = ImageOps.exif_transpose(image).convert("RGB")
                side = min(pixels.width, pixels.height)
                left = (pixels.width - side) // 2
                top = (pixels.height - side) // 2
                pixels = pixels.crop((left, top, left + side, top + side))
                pixels = pixels.resize((_AVATAR_SIZE, _AVATAR_SIZE), Image.LANCZOS)
                output = io.BytesIO()
                pixels.save(output, "WEBP", quality=85, method=4)
                return output.getvalue()
    except ValueError:
        raise
    except Exception:
        raise ValueError("Could not read this image file") from None


def set_custom_avatar(user_id: str, payload: bytes) -> dict[str, Any]:
    """Validate, store, and link an uploaded avatar; returns the user row."""
    content = normalize_avatar_image(payload)
    path = avatar_file_path(user_id)
    path.write_bytes(content)
    # Cache-busting query so browsers and CDNs fetch the new file at once.
    version = int(datetime.now(timezone.utc).timestamp())
    avatar_url = f"/api/auth/avatars/{path.name}?v={version}"
    with _connect() as connection:
        cursor = connection.execute(
            "UPDATE users SET custom_avatar_url = ? WHERE id = ?",
            (avatar_url, user_id),
        )
        if cursor.rowcount == 0:
            try:
                path.unlink()
            except OSError:
                pass
            raise ValueError("Profile not found")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    user = _row_to_user(row)
    if user is None:
        raise ValueError("Profile not found")
    return user


def clear_custom_avatar(user_id: str) -> dict[str, Any] | None:
    """Remove an uploaded avatar; the provider image or initials return."""
    try:
        avatar_file_path(user_id).unlink()
    except OSError:
        pass
    with _connect() as connection:
        connection.execute("UPDATE users SET custom_avatar_url = NULL WHERE id = ?", (user_id,))
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row)


def list_onboarding_tours(user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT tour_id, version, step_index, status, updated_at FROM onboarding_tours WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_onboarding_tour(
    user_id: str, tour_id: str, version: int, step_index: int, status: str,
) -> dict[str, Any]:
    """Upsert progress for the signed-in account, never for a client-supplied user id."""
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO onboarding_tours (user_id, tour_id, version, step_index, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, tour_id) DO UPDATE SET
                version = excluded.version,
                step_index = excluded.step_index,
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (user_id, tour_id, version, step_index, status, _now()),
        )
        row = connection.execute(
            "SELECT tour_id, version, step_index, status, updated_at FROM onboarding_tours WHERE user_id = ? AND tour_id = ?",
            (user_id, tour_id),
        ).fetchone()
    return dict(row)


def synchronize_configured_role(user: dict[str, Any]) -> dict[str, Any]:
    """Make ADMIN_EMAILS authoritative for OAuth host access.

    Every account not listed in ADMIN_EMAILS is a regular member, including
    the local development account. This also repairs roles created by older
    development builds that granted Host too broadly.
    """
    expected_role = _default_role(user)
    if user.get("role") != expected_role:
        return update_user(str(user["id"]), role=expected_role) or user
    return user


def list_users() -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM users ORDER BY last_login_at DESC").fetchall()
    return [synchronize_configured_role(dict(row)) for row in rows]


def update_user(
    user_id: str,
    *,
    role: str | None = None,
    status: str | None = None,
    license_type: str | None = None,
    license_expires_at: str | None | object = _UNSET,
) -> dict[str, Any] | None:
    assignments: list[str] = []
    values: list[Any] = []
    if role is not None:
        if role not in {"member", "admin"}:
            raise ValueError("Invalid role")
        assignments.append("role = ?")
        values.append(role)
    if status is not None:
        if status not in {"active", "suspended"}:
            raise ValueError("Invalid status")
        assignments.append("status = ?")
        values.append(status)
    if license_type is not None:
        if license_type not in {"free", "pro", "team"}:
            raise ValueError("Invalid license type")
        assignments.append("license_type = ?")
        values.append(license_type)
    if license_expires_at is not _UNSET:
        assignments.append("license_expires_at = ?")
        values.append(license_expires_at)
    if not assignments:
        return get_user(user_id)
    values.append(user_id)
    with _connect() as connection:
        connection.execute(f"UPDATE users SET {', '.join(assignments)} WHERE id = ?", values)
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row)


def update_profile(
    user_id: str,
    *,
    display_name: str,
    bio: str,
    location: str,
    organization: str,
    website: str,
    research_interests: list[str],
    public_name: str | None = None,
    public_name_key: str | None = None,
) -> dict[str, Any] | None:
    """Update user-owned profile fields without touching provider identity or access."""
    with _connect() as connection:
        connection.execute(
            """
            UPDATE users
            SET display_name = ?, bio = ?, location = ?, organization = ?,
                website = ?, research_interests = ?,
                public_name = COALESCE(?, public_name),
                public_name_key = COALESCE(?, public_name_key)
            WHERE id = ?
            """,
            (
                display_name or None,
                bio,
                location,
                organization,
                website,
                json.dumps(research_interests, ensure_ascii=False),
                public_name,
                public_name_key,
                user_id,
            ),
        )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row)


def user_counts() -> dict[str, int]:
    # Repair legacy role assignments before computing administration metrics.
    list_users()
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) total,
                   SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) active,
                   SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) suspended,
                   SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) admins,
                   SUM(CASE WHEN role = 'admin' AND status = 'active' THEN 1 ELSE 0 END) active_admins
            FROM users
            """
        ).fetchone()
    return {
        key: int(row[key] or 0)
        for key in ("total", "active", "suspended", "admins", "active_admins")
    }


def log_admin_action(
    actor_id: str,
    action: str,
    target_type: str,
    target_id: str | None = None,
    detail: dict[str, Any] | str | None = None,
) -> None:
    serialized = json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else detail
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, detail, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (actor_id, action, target_type, target_id, serialized, _now()),
        )


def list_audit_events(limit: int = 100) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT audit.*, users.name actor_name, users.email actor_email
            FROM admin_audit_log audit
            LEFT JOIN users ON users.id = audit.actor_id
            ORDER BY audit.created_at DESC LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    return [dict(row) for row in rows]
