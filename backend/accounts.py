"""Small SQLite-backed account registry and administrator audit log."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_UNSET = object()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_path() -> Path:
    path = Path(os.getenv("AUTH_DATABASE_PATH", "data/deep-research.db")).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


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

        CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_log(created_at DESC);
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
    }
    for column, definition in profile_migrations.items():
        if column not in columns:
            connection.execute(f"ALTER TABLE users ADD COLUMN {column} {definition}")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_name_key ON users(public_name_key)")
    return connection


def _admin_emails() -> set[str]:
    return {
        email.strip().lower()
        for email in os.getenv("ADMIN_EMAILS", "").split(",")
        if email.strip()
    }


def _default_role(user: dict[str, Any]) -> str:
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


def get_user(user_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        return _row_to_user(connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


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
