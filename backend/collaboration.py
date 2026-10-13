"""Account-scoped research projects, invitations, and persistent live pages.

The websocket carries Yjs document updates as opaque bytes. SQLite is the
durable update log, so reconnecting clients can reconstruct exactly the same
document without trusting a browser's last plain-text snapshot.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import re
import sqlite3
import time
import threading
import uuid
from collections import deque, OrderedDict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, Literal

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator
from pycrdt import Doc, Text, XmlFragment, XmlElement

from backend.accounts import _connect, _database_path, get_user
from backend.auth import current_user as authenticated_user, collaboration_user as current_user
from backend.identity import public_name_key, validate_public_name
from backend.notifications import initialize as initialize_social, is_blocked, block_user, notify, rate_limit


router = APIRouter(prefix="/api/collab", tags=["collaboration"])
FIELDS = {"mathematics", "physics", "chemistry", "biology", "artificial-intelligence"}
GROUP_ROLES = {"owner": 4, "admin": 3, "member": 2}
ACCESS = {"viewer": 1, "commenter": 2, "editor": 3, "manager": 4}
_SCHEMA_READY: set[str] = set()
_SCHEMA_LOCK = threading.RLock()
_BLOCK_ACTIVITY_CACHE: OrderedDict[tuple, tuple[str, str]] = OrderedDict()
_BLOCK_ACTIVITY_LOCK = threading.RLock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ident() -> str:
    return uuid.uuid4().hex


def _open_database() -> sqlite3.Connection:
    # The UI starts several requests together. Serialize first-use migrations;
    # otherwise two threads can both try to add the same column.
    with _SCHEMA_LOCK:
        return _open_database_unlocked()


def _open_database_unlocked() -> sqlite3.Connection:
    database_key = str(_database_path())
    if database_key in _SCHEMA_READY:
        conn = sqlite3.connect(database_key, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn
    conn = _connect()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY, pair_key TEXT NOT NULL UNIQUE,
            requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','blocked')),
            blocked_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_groups (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
            archived_at TEXT
        );
        CREATE TABLE IF NOT EXISTS group_members (
            group_id TEXT NOT NULL REFERENCES research_groups(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
            joined_at TEXT NOT NULL, PRIMARY KEY(group_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS research_projects (
            id TEXT PRIMARY KEY, group_id TEXT REFERENCES research_groups(id) ON DELETE CASCADE,
            owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '', field TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'planning'
                CHECK(status IN ('planning','active','review','complete','archived')),
            visibility TEXT NOT NULL DEFAULT 'group'
                CHECK(visibility IN ('group','restricted')),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_members (
            project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('viewer','commenter','editor')),
            joined_at TEXT NOT NULL, PRIMARY KEY(project_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS research_pages (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            parent_id TEXT REFERENCES research_pages(id) ON DELETE SET NULL,
            title TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
            updated_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
        );
        CREATE TABLE IF NOT EXISTS page_shares (
            page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('viewer','commenter','editor')),
            created_at TEXT NOT NULL, PRIMARY KEY(page_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS collaboration_invites (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('group','project','page')),
            target_id TEXT NOT NULL, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sender_id TEXT NOT NULL REFERENCES users(id),
            role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','accepted','declined')),
            created_at TEXT NOT NULL, responded_at TEXT,
            UNIQUE(kind,target_id,recipient_id)
        );
        CREATE TABLE IF NOT EXISTS page_updates (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            author_id TEXT NOT NULL REFERENCES users(id),
            update_blob BLOB NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS page_versions (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            author_id TEXT NOT NULL REFERENCES users(id),
            label TEXT NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS page_presence (
            page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_seen TEXT NOT NULL, PRIMARY KEY(page_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS page_comments (
            id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            author_id TEXT NOT NULL REFERENCES users(id),
            body TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_tasks (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo'
                CHECK(status IN ('todo','doing','done')),
            assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_evidence (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            title TEXT NOT NULL, url TEXT NOT NULL, doi TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collaboration_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT REFERENCES research_projects(id) ON DELETE CASCADE,
            actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
            subject_id TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_page_updates_page_seq ON page_updates(page_id,seq);
        CREATE INDEX IF NOT EXISTS idx_projects_group ON research_projects(group_id);
        CREATE INDEX IF NOT EXISTS idx_pages_project ON research_pages(project_id);
        CREATE INDEX IF NOT EXISTS idx_invites_recipient ON collaboration_invites(recipient_id,status);
    """)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    if "public_name" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN public_name TEXT")
    if "public_name_key" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN public_name_key TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_name_key ON users(public_name_key)")
    page_columns = {row["name"] for row in conn.execute("PRAGMA table_info(research_pages)")}
    for column, declaration in (("position", "INTEGER NOT NULL DEFAULT 0"), ("editor_format", "TEXT NOT NULL DEFAULT 'markdown'"),
                                ("icon", "TEXT NOT NULL DEFAULT ''"), ("cover", "TEXT NOT NULL DEFAULT 'none'"),
                                ("full_width", "INTEGER NOT NULL DEFAULT 0"), ("archive_batch", "TEXT"),
                                ("field_links_ready", "INTEGER NOT NULL DEFAULT 0")):
        if column not in page_columns:
            conn.execute(f"ALTER TABLE research_pages ADD COLUMN {column} {declaration}")
    version_columns = {row["name"] for row in conn.execute("PRAGMA table_info(page_versions)")}
    if "blocks_json" not in version_columns:
        conn.execute("ALTER TABLE page_versions ADD COLUMN blocks_json TEXT")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS page_projections (
            page_id TEXT PRIMARY KEY REFERENCES research_pages(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL, markdown TEXT NOT NULL, blocks_json TEXT NOT NULL,
            indexed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS field_workspaces (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            field TEXT NOT NULL,
            project_id TEXT NOT NULL UNIQUE REFERENCES research_projects(id) ON DELETE CASCADE,
            home_page_id TEXT NOT NULL UNIQUE REFERENCES research_pages(id),
            PRIMARY KEY(user_id,field)
        );
        CREATE TABLE IF NOT EXISTS notebook_preferences (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            favorite INTEGER NOT NULL DEFAULT 0, opened_at TEXT,
            PRIMARY KEY(user_id,page_id)
        );
        CREATE TABLE IF NOT EXISTS page_link_trash (
            page_id TEXT PRIMARY KEY REFERENCES research_pages(id) ON DELETE CASCADE,
            parent_id TEXT NOT NULL REFERENCES research_pages(id),
            block_ids TEXT NOT NULL, archive_batch TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            viewed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_page_views_page_time ON page_views(page_id,viewed_at);
        CREATE INDEX IF NOT EXISTS idx_page_views_user_time ON page_views(page_id,user_id,viewed_at);
        CREATE TABLE IF NOT EXISTS page_view_preferences (
            page_id TEXT NOT NULL REFERENCES research_pages(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            show_history INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(page_id,user_id)
        );
    """)
    event_columns = {row["name"] for row in conn.execute("PRAGMA table_info(collaboration_events)")}
    if "details_json" not in event_columns:
        conn.execute("ALTER TABLE collaboration_events ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'")
    initialize_social(conn)
    from backend.discussions import initialize as initialize_discussions
    initialize_discussions(conn)
    from backend.notebook_media import initialize as initialize_notebook_media
    initialize_notebook_media(conn)
    conn.commit()
    _SCHEMA_READY.add(database_key)
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """Commit/rollback each operation and release its SQLite handle promptly."""
    conn = _open_database()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def clean_public_name(value: str) -> tuple[str, str]:
    try:
        return validate_public_name(value)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


def public_user(conn: sqlite3.Connection, user_id: str) -> dict:
    row = conn.execute(
        "SELECT id, public_name, COALESCE(NULLIF(public_name,''),NULLIF(display_name,''),name) display_name, "
        "COALESCE(NULLIF(custom_avatar_url,''),avatar_url) avatar_url "
        "FROM users WHERE id = ? AND status = 'active'", (user_id,),
    ).fetchone()
    return dict(row) if row else {"id": user_id, "public_name": None, "display_name": "Former member", "avatar_url": None}


def require_name(conn: sqlite3.Connection, user_id: str) -> None:
    row = conn.execute("SELECT public_name FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or not row["public_name"]:
        raise HTTPException(409, "Set your unique name in Edit profile before using collaboration")


def find_person(conn: sqlite3.Connection, name: str, actor_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT id FROM users WHERE public_name_key = ? AND status = 'active'", (public_name_key(name),)).fetchone()
    if not row:
        raise HTTPException(404, "Username not found")
    if row["id"] == actor_id:
        raise HTTPException(400, "You cannot invite yourself")
    return row


def pair(a: str, b: str) -> str:
    return "|".join(sorted((a, b)))


def not_blocked(conn: sqlite3.Connection, a: str, b: str) -> None:
    if is_blocked(conn, a, b):
        raise HTTPException(403, "This account cannot be invited")


def group_role(conn: sqlite3.Connection, group_id: str, user_id: str) -> str | None:
    row = conn.execute("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, user_id)).fetchone()
    return row["role"] if row else None


def group_detail(conn: sqlite3.Connection, group_id: str, user_id: str, minimum: str = "member") -> sqlite3.Row:
    row = conn.execute("SELECT * FROM research_groups WHERE id = ? AND archived_at IS NULL", (group_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Group not found")
    role = group_role(conn, group_id, user_id)
    if not role or GROUP_ROLES[role] < GROUP_ROLES[minimum]:
        raise HTTPException(403, "Group access required")
    return row


def project_access(conn: sqlite3.Connection, project: sqlite3.Row, user_id: str) -> int:
    if project["group_id"]:
        group = conn.execute("SELECT archived_at FROM research_groups WHERE id = ?", (project["group_id"],)).fetchone()
        if not group or group["archived_at"] or not group_role(conn, project["group_id"], user_id):
            return 0
    if project["owner_id"] == user_id:
        return 4
    if project["group_id"]:
        role = group_role(conn, project["group_id"], user_id)
        if role in {"owner", "admin"}:
            return 4
    else:
        role = None
    direct = conn.execute("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", (project["id"], user_id)).fetchone()
    if direct:
        return ACCESS[direct["role"]]
    if role == "member" and project["visibility"] == "group":
        return 3
    return 0


def project_detail(conn: sqlite3.Connection, project_id: str, user_id: str, minimum: int = 1) -> sqlite3.Row:
    project = conn.execute("SELECT * FROM research_projects WHERE id = ?", (project_id,)).fetchone()
    if not project or project_access(conn, project, user_id) < minimum:
        raise HTTPException(404, "Project not found or access denied")
    return project


def page_access(conn: sqlite3.Connection, page: sqlite3.Row, user_id: str) -> int:
    project = conn.execute("SELECT * FROM research_projects WHERE id = ?", (page["project_id"],)).fetchone()
    if not project:
        return 0
    if project["group_id"]:
        group = conn.execute("SELECT archived_at FROM research_groups WHERE id = ?", (project["group_id"],)).fetchone()
        if not group or group["archived_at"]:
            return 0
    grant = project_access(conn, project, user_id) if project else 0
    shared = conn.execute("SELECT role FROM page_shares WHERE page_id = ? AND user_id = ?", (page["id"], user_id)).fetchone()
    return max(grant, ACCESS[shared["role"]] if shared else 0)


def page_detail(conn: sqlite3.Connection, page_id: str, user_id: str, minimum: int = 1) -> sqlite3.Row:
    page = conn.execute("SELECT * FROM research_pages WHERE id = ? AND archived_at IS NULL", (page_id,)).fetchone()
    if not page or page_access(conn, page, user_id) < minimum:
        raise HTTPException(404, "Page not found or access denied")
    return page


def event(conn: sqlite3.Connection, project_id: str, actor: str, action: str, subject: str | None = None, details: dict | None = None) -> None:
    conn.execute("INSERT INTO collaboration_events (project_id,actor_id,action,subject_id,created_at,details_json) VALUES (?,?,?,?,?,?)", (project_id, actor, action, subject, now(), json.dumps(details or {}, ensure_ascii=False)))


class PublicNameInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class NameInput(BaseModel):
    username: str = Field(min_length=1, max_length=80)


class GroupInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=1000)

    @field_validator("name", "description", mode="before")
    @classmethod
    def strip_whitespace(cls, value):
        return value.strip() if isinstance(value, str) else value


class ProjectInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str = Field(default="", max_length=2000)
    field: str
    category: str = Field(default="", max_length=80)
    visibility: Literal["group", "restricted"] = "group"


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    status: Literal["planning", "active", "review", "complete", "archived"] | None = None
    visibility: Literal["group", "restricted"] | None = None


class PageInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None
    # Turn-into-Page replaces its existing block rather than appending a second link.
    link_in_parent: bool = True


class PagePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: str | None = None
    icon: str | None = Field(default=None, max_length=16)
    cover: Literal["none", "indigo", "ocean", "amber", "forest", "aurora"] | None = None
    full_width: bool | None = None


class NotebookPreference(BaseModel):
    favorite: bool | None = None
    opened: bool = False


class FieldWorkspaceInput(BaseModel):
    language: Literal["vi", "en"] = "en"


class PageOrderInput(BaseModel):
    parent_id: str | None = None
    page_ids: list[str] = Field(min_length=1, max_length=1000)


class BlockDocumentInput(BaseModel):
    expected_revision: int = Field(ge=0)
    update: str = Field(max_length=700_000)


class ProjectionInput(BaseModel):
    revision: int = Field(ge=0)
    markdown: str = Field(max_length=250_000)
    blocks: list[dict] = Field(max_length=3000)


class InviteInput(BaseModel):
    username: str
    role: Literal["member", "viewer", "commenter", "editor"] = "member"


class TaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    assignee_username: str | None = None


class EvidenceInput(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=8, max_length=2000)
    doi: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)


class CommentInput(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class VersionInput(BaseModel):
    label: str = Field(default="Snapshot", max_length=100)
    markdown: str = Field(max_length=250_000)
    blocks: list[dict] | None = Field(default=None, max_length=3000)


class RoleInput(BaseModel):
    role: Literal["admin", "member", "viewer", "commenter", "editor"]


@router.put("/identity")
def set_identity(payload: PublicNameInput, user: dict = Depends(authenticated_user)):
    name, key = clean_public_name(payload.name)
    with db() as conn:
        require_user = conn.execute("SELECT id FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not require_user:
            raise HTTPException(404, "Account not found")
        try:
            conn.execute("UPDATE users SET public_name = ?, public_name_key = ? WHERE id = ?", (name, key, user["id"]))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "This username is already taken; choose another") from None
    return {"public_name": name}


@router.get("/people")
def search_people(query: str = "", user: dict = Depends(current_user)):
    query = public_name_key(query)
    if len(query) < 2:
        return {"people": []}
    with db() as conn:
        rate_limit(conn, user["id"], "search")
        rows = conn.execute(
            """SELECT id FROM users WHERE public_name_key LIKE ? ESCAPE '\\' AND id != ? AND status = 'active'
            AND NOT EXISTS (SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=users.id) OR (blocked_id=? AND blocker_id=users.id))
            ORDER BY public_name_key LIMIT 12""",
            ("%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", user["id"], user["id"], user["id"]),
        ).fetchall()
        return {"people": [public_user(conn, row["id"]) for row in rows]}


@router.get("/connections")
def list_connections(user: dict = Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM connections WHERE requester_id = ? OR target_id = ? ORDER BY updated_at DESC", (user["id"], user["id"]),
        ).fetchall()
        return {"connections": [
            {"id": row["id"], "status": row["status"], "direction": "outgoing" if row["requester_id"] == user["id"] else "incoming",
             "person": public_user(conn, row["target_id"] if row["requester_id"] == user["id"] else row["requester_id"]), "created_at": row["created_at"], "updated_at": row["updated_at"]}
            for row in rows if row["status"] in {"pending", "accepted"} and not is_blocked(conn, row["requester_id"], row["target_id"])
            and conn.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (row["target_id"] if row["requester_id"] == user["id"] else row["requester_id"],)).fetchone()
        ]}


@router.get("/blocks")
def list_blocks(user: dict = Depends(current_user)):
    with db() as conn:
        return {"blocks": [{"person": public_user(conn, row["blocked_id"]), "created_at": row["created_at"]}
                           for row in conn.execute("SELECT * FROM user_blocks WHERE blocker_id=? ORDER BY created_at DESC", (user["id"],))]}


@router.post("/people/{person_id}/block")
def create_block(person_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        block_user(conn, user["id"], person_id)
    return {"status": "blocked"}


@router.delete("/people/{person_id}/block")
def delete_block(person_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        # Only delete the authenticated user's own direction. Never disclose the reverse block.
        conn.execute("DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?", (user["id"], person_id))
    return {"status": "unblocked"}


@router.post("/connections", status_code=201)
def request_connection(payload: NameInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        require_name(conn, user["id"])
        target = find_person(conn, payload.username, user["id"])
        not_blocked(conn, user["id"], target["id"])
        key = pair(user["id"], target["id"])
        row = conn.execute("SELECT * FROM connections WHERE pair_key = ?", (key,)).fetchone()
        if row and row["status"] in {"pending", "accepted"}:
            return {"id": row["id"], "status": row["status"], "direction": "outgoing" if row["requester_id"] == user["id"] else "incoming"}
        if row and row["target_id"] == target["id"] and row["updated_at"] > (datetime.now(timezone.utc) - timedelta(days=1)).isoformat():
            raise HTTPException(429, "Please wait before sending another request to this person")
        rate_limit(conn, user["id"], "friend.request", target["id"])
        sent_at = now()
        if row:
            conn.execute("UPDATE connections SET requester_id = ?, target_id = ?, status = 'pending', blocked_by = NULL, created_at = ?, updated_at = ? WHERE id = ?", (user["id"], target["id"], sent_at, sent_at, row["id"]))
            connection_id = row["id"]
        else:
            connection_id = ident()
            conn.execute("INSERT INTO connections VALUES (?,?,?,?,?,?,?,?)", (connection_id, key, user["id"], target["id"], "pending", None, sent_at, sent_at))
        notify(conn, target["id"], user["id"], "friend.request", connection_id,
               event_key=f"friend.request:{connection_id}:{sent_at}", created_at=sent_at)
    return {"id": connection_id, "status": "pending"}


@router.patch("/connections/{connection_id}")
def respond_connection(connection_id: str, action: Literal["accept", "decline", "block"], user: dict = Depends(current_user), expected_created_at: str | None = None):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM connections WHERE id = ?", (connection_id,)).fetchone()
        if not row or user["id"] not in {row["requester_id"], row["target_id"]}:
            raise HTTPException(404, "Connection not found")
        if expected_created_at is not None and row["created_at"] != expected_created_at:
            raise HTTPException(409, "This request has changed; refresh your inbox")
        if action == "block":
            block_user(conn, user["id"], row["target_id"] if row["requester_id"] == user["id"] else row["requester_id"])
            return {"status": "blocked"}
        other_id = row["target_id"] if row["requester_id"] == user["id"] else row["requester_id"]
        if not conn.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (other_id,)).fetchone():
            raise HTTPException(404, "Account unavailable")
        not_blocked(conn, row["requester_id"], row["target_id"])
        if row["target_id"] != user["id"] or row["status"] not in {"pending", "accepted" if action == "accept" else "declined"}:
            raise HTTPException(403, "Only the recipient can respond to a pending request")
        if row["status"] != "pending":
            return {"status": row["status"]}
        status = {"accept": "accepted", "decline": "declined", "block": "blocked"}[action]
        conn.execute("UPDATE connections SET status = ?, blocked_by = ?, updated_at = ? WHERE id = ?", (status, user["id"] if action == "block" else None, now(), connection_id))
        conn.execute("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND kind='friend.request' AND subject_id=?", (now(), user["id"], connection_id))
        if action == "accept":
            notify(conn, row["requester_id"], user["id"], "friend.accepted", connection_id,
                   event_key=f"friend.accepted:{connection_id}:{row['created_at']}")
    return {"status": status}


@router.delete("/connections/{connection_id}")
def remove_connection(connection_id: str, user: dict = Depends(current_user), expected_status: Literal["pending", "accepted"] | None = None, expected_created_at: str | None = None):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM connections WHERE id = ?", (connection_id,)).fetchone()
        if not row or user["id"] not in {row["requester_id"], row["target_id"]}:
            raise HTTPException(404, "Connection not found")
        if (expected_status is not None and row["status"] != expected_status) or (expected_created_at is not None and row["created_at"] != expected_created_at):
            raise HTTPException(409, "The relationship has changed; refresh before removing it")
        if is_blocked(conn, row["requester_id"], row["target_id"]):
            raise HTTPException(403, "Use your blocked list to remove your own block")
        if row["status"] == "pending" and row["requester_id"] != user["id"]:
            raise HTTPException(403, "Only the sender can cancel a pending request")
        conn.execute("DELETE FROM connections WHERE id = ?", (connection_id,))
        conn.execute("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE kind LIKE 'friend.%' AND subject_id=?", (now(), connection_id))
    return {"status": "removed"}


def pending_invites(conn: sqlite3.Connection, kind: str, target_id: str) -> list[dict]:
    rows = conn.execute("SELECT id, role, recipient_id FROM collaboration_invites WHERE kind = ? AND target_id = ? AND status = 'pending' ORDER BY created_at", (kind, target_id)).fetchall()
    return [{"id": row["id"], "role": row["role"], "recipient": public_user(conn, row["recipient_id"])} for row in rows]


def group_payload(conn: sqlite3.Connection, row: sqlite3.Row, actor: str) -> dict:
    members = conn.execute("SELECT user_id, role, joined_at FROM group_members WHERE group_id = ? ORDER BY joined_at", (row["id"],)).fetchall()
    return {**dict(row), "my_role": group_role(conn, row["id"], actor), "pending_invites": pending_invites(conn, "group", row["id"]) if group_role(conn, row["id"], actor) in {"owner", "admin"} else [], "members": [
        {**public_user(conn, member["user_id"]), "role": member["role"], "joined_at": member["joined_at"]}
        for member in members
    ]}


def project_payload(conn: sqlite3.Connection, row: sqlite3.Row, actor: str) -> dict:
    return {**dict(row), "my_access": project_access(conn, row, actor),
            "member_count": conn.execute("SELECT COUNT(*) FROM project_members WHERE project_id = ?", (row["id"],)).fetchone()[0]}


@router.get("/groups")
def list_groups(user: dict = Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT g.* FROM research_groups g JOIN group_members m ON m.group_id = g.id "
            "WHERE m.user_id = ? AND g.archived_at IS NULL ORDER BY g.created_at DESC", (user["id"],),
        ).fetchall()
        return {"groups": [group_payload(conn, row, user["id"]) for row in rows]}


@router.get("/groups/archived")
def list_archived_groups(user: dict = Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM research_groups WHERE created_by = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC",
            (user["id"],),
        ).fetchall()
        return {"groups": [{"id": row["id"], "name": row["name"], "archived_at": row["archived_at"]} for row in rows]}


@router.post("/groups", status_code=201)
def create_group(payload: GroupInput, user: dict = Depends(current_user)):
    group_id, timestamp = ident(), now()
    with db() as conn:
        require_name(conn, user["id"])
        conn.execute("INSERT INTO research_groups VALUES (?,?,?,?,?,NULL)", (group_id, payload.name.strip(), payload.description.strip(), user["id"], timestamp))
        conn.execute("INSERT INTO group_members VALUES (?,?,?,?)", (group_id, user["id"], "owner", timestamp))
        return {"group": group_payload(conn, conn.execute("SELECT * FROM research_groups WHERE id = ?", (group_id,)).fetchone(), user["id"])}


@router.get("/groups/{group_id}")
def get_group(group_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        row = group_detail(conn, group_id, user["id"])
        projects = conn.execute("SELECT * FROM research_projects WHERE group_id = ? ORDER BY updated_at DESC", (group_id,)).fetchall()
        return {"group": group_payload(conn, row, user["id"]), "projects": [project_payload(conn, item, user["id"]) for item in projects if project_access(conn, item, user["id"]) > 0]}


@router.patch("/groups/{group_id}")
def edit_group(group_id: str, payload: GroupInput, user: dict = Depends(current_user)):
    with db() as conn:
        group_detail(conn, group_id, user["id"], "admin")
        conn.execute("UPDATE research_groups SET name = ?, description = ? WHERE id = ?", (payload.name.strip(), payload.description.strip(), group_id))
        row = conn.execute("SELECT * FROM research_groups WHERE id = ?", (group_id,)).fetchone()
        return {"group": group_payload(conn, row, user["id"])}


@router.patch("/groups/{group_id}/members/{member_id}")
def set_group_member_role(group_id: str, member_id: str, payload: RoleInput, user: dict = Depends(current_user)):
    if payload.role not in {"admin", "member"}:
        raise HTTPException(422, "Only admin or member roles can be assigned")
    with db() as conn:
        group_detail(conn, group_id, user["id"], "owner")
        if not group_role(conn, group_id, member_id) or member_id == user["id"]:
            raise HTTPException(404, "Member not found or cannot modify yourself")
        conn.execute("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?", (payload.role, group_id, member_id))
    return {"status": "updated"}


@router.delete("/groups/{group_id}/members/{member_id}")
def remove_group_member(group_id: str, member_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        group_detail(conn, group_id, user["id"])
        actor_role, target_role = group_role(conn, group_id, user["id"]), group_role(conn, group_id, member_id)
        if not target_role:
            raise HTTPException(404, "Member not found")
        if member_id != user["id"] and GROUP_ROLES[actor_role] <= GROUP_ROLES[target_role]:
            raise HTTPException(403, "Cannot remove this member")
        if target_role == "owner":
            raise HTTPException(409, "Transfer ownership before leaving")
        # Revocation includes explicit grants within this group, not just the
        # inherited group role. Direct grants outside this group are untouched.
        conn.execute("DELETE FROM project_members WHERE user_id = ? AND project_id IN (SELECT id FROM research_projects WHERE group_id = ?)", (member_id, group_id))
        conn.execute("DELETE FROM page_shares WHERE user_id = ? AND page_id IN (SELECT p.id FROM research_pages p JOIN research_projects r ON r.id = p.project_id WHERE r.group_id = ?)", (member_id, group_id))
        conn.execute("DELETE FROM collaboration_invites WHERE recipient_id = ? AND ((kind = 'group' AND target_id = ?) OR (kind = 'project' AND target_id IN (SELECT id FROM research_projects WHERE group_id = ?)) OR (kind = 'page' AND target_id IN (SELECT p.id FROM research_pages p JOIN research_projects r ON r.id = p.project_id WHERE r.group_id = ?)))", (member_id, group_id, group_id, group_id))
        conn.execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, member_id))
    return {"status": "removed"}


@router.post("/groups/{group_id}/transfer")
def transfer_group(group_id: str, payload: NameInput, user: dict = Depends(current_user)):
    with db() as conn:
        group_detail(conn, group_id, user["id"], "owner")
        target = find_person(conn, payload.username, user["id"])
        if not group_role(conn, group_id, target["id"]):
            raise HTTPException(409, "New owner must already belong to the group")
        conn.execute("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?", (group_id, user["id"]))
        conn.execute("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?", (group_id, target["id"]))
        conn.execute("UPDATE research_groups SET created_by = ? WHERE id = ?", (target["id"], group_id))
    return {"status": "transferred"}


@router.post("/groups/{group_id}/archive")
def archive_group(group_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        group_detail(conn, group_id, user["id"], "owner")
        conn.execute("UPDATE research_groups SET archived_at = ? WHERE id = ?", (now(), group_id))
    return {"status": "archived"}


@router.post("/groups/{group_id}/restore")
def restore_group(group_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT created_by FROM research_groups WHERE id = ?", (group_id,)).fetchone()
        if not row or row["created_by"] != user["id"]:
            raise HTTPException(404, "Group not found")
        conn.execute("UPDATE research_groups SET archived_at = NULL WHERE id = ?", (group_id,))
    return {"status": "restored"}


def invite(conn: sqlite3.Connection, kind: str, target_id: str, recipient_id: str, sender_id: str, role: str) -> dict:
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    not_blocked(conn, sender_id, recipient_id)
    previous = conn.execute("SELECT id, status FROM collaboration_invites WHERE kind = ? AND target_id = ? AND recipient_id = ?", (kind, target_id, recipient_id)).fetchone()
    if previous and previous["status"] in {"pending", "accepted"}:
        raise HTTPException(409, "Already invited or already has access")
    rate_limit(conn, sender_id, "invite", recipient_id)
    invitation_id = previous["id"] if previous else ident()
    if previous:
        conn.execute("UPDATE collaboration_invites SET sender_id = ?, role = ?, status = 'pending', created_at = ?, responded_at = NULL WHERE id = ?", (sender_id, role, now(), invitation_id))
    else:
        conn.execute("INSERT INTO collaboration_invites VALUES (?,?,?,?,? ,?, 'pending', ?, NULL)", (invitation_id, kind, target_id, recipient_id, sender_id, role, now()))
    sent_at = conn.execute("SELECT created_at FROM collaboration_invites WHERE id=?", (invitation_id,)).fetchone()[0]
    notify(conn, recipient_id, sender_id, "invite.received", invitation_id, {"kind": kind, "role": role},
           event_key=f"invite.received:{invitation_id}:{sent_at}", created_at=sent_at)
    return {"id": invitation_id, "kind": kind, "status": "pending"}


@router.post("/groups/{group_id}/invites", status_code=201)
def invite_group(group_id: str, payload: InviteInput, user: dict = Depends(current_user)):
    with db() as conn:
        group_detail(conn, group_id, user["id"], "admin")
        target = find_person(conn, payload.username, user["id"])
        if group_role(conn, group_id, target["id"]):
            raise HTTPException(409, "Already a group member")
        return {"invite": invite(conn, "group", group_id, target["id"], user["id"], "member")}


def invitation_authorized(conn: sqlite3.Connection, invitation: sqlite3.Row) -> bool:
    """Invites cannot outlive their sender's authority to share the target."""
    sender = conn.execute("SELECT status FROM users WHERE id = ?", (invitation["sender_id"],)).fetchone()
    if not sender or sender["status"] != "active":
        return False
    try:
        if invitation["kind"] == "group":
            group_detail(conn, invitation["target_id"], invitation["sender_id"], "admin")
        elif invitation["kind"] == "project":
            project_detail(conn, invitation["target_id"], invitation["sender_id"], 4)
        else:
            page = page_detail(conn, invitation["target_id"], invitation["sender_id"])
            project_detail(conn, page["project_id"], invitation["sender_id"], 4)
    except HTTPException:
        return False
    return True


@router.get("/invites")
def list_invites(user: dict = Depends(current_user)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM collaboration_invites WHERE recipient_id = ? AND status = 'pending' ORDER BY created_at DESC", (user["id"],)).fetchall()
        output = []
        for row in rows:
            if is_blocked(conn, row["sender_id"], user["id"]) or not invitation_authorized(conn, row):
                continue
            table = {"group": "research_groups", "project": "research_projects", "page": "research_pages"}[row["kind"]]
            title_field = "name" if row["kind"] != "page" else "title"
            target = conn.execute(f"SELECT {title_field} title FROM {table} WHERE id = ?", (row["target_id"],)).fetchone()
            if target:
                output.append({**dict(row), "target_title": target["title"], "sender": public_user(conn, row["sender_id"])})
        return {"invites": output}


@router.delete("/invites/{invitation_id}")
def cancel_invite(invitation_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT * FROM collaboration_invites WHERE id = ? AND status = 'pending'", (invitation_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Invitation not found")
        if row["kind"] == "group":
            group_detail(conn, row["target_id"], user["id"], "admin")
        elif row["kind"] == "project":
            project_detail(conn, row["target_id"], user["id"], 4)
        else:
            page = page_detail(conn, row["target_id"], user["id"])
            project_detail(conn, page["project_id"], user["id"], 4)
        conn.execute("DELETE FROM collaboration_invites WHERE id = ?", (invitation_id,))
        conn.execute("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE kind LIKE 'invite.%' AND subject_id=?", (now(), invitation_id))
    return {"status": "cancelled"}


@router.patch("/invites/{invitation_id}")
def respond_invite(invitation_id: str, action: Literal["accept", "decline"], user: dict = Depends(current_user), expected_created_at: str | None = None):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM collaboration_invites WHERE id = ? AND recipient_id = ? AND status = 'pending'", (invitation_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Invitation not found")
        if expected_created_at is not None and row["created_at"] != expected_created_at:
            raise HTTPException(409, "This invitation has changed; refresh your inbox")
        if action == "accept":
            not_blocked(conn, row["sender_id"], user["id"])
            if not invitation_authorized(conn, row):
                raise HTTPException(403, "The sender can no longer share this item; request a new invitation")
            if row["kind"] == "group":
                existing = conn.execute("SELECT id FROM research_groups WHERE id = ? AND archived_at IS NULL", (row["target_id"],)).fetchone()
                if not existing:
                    raise HTTPException(404, "Group no longer exists")
                conn.execute("INSERT OR IGNORE INTO group_members VALUES (?,?,?,?)", (row["target_id"], user["id"], "member", now()))
            elif row["kind"] == "project":
                project = conn.execute("SELECT * FROM research_projects WHERE id = ?", (row["target_id"],)).fetchone()
                if not project:
                    raise HTTPException(404, "Project no longer exists")
                if project["group_id"] and not group_role(conn, project["group_id"], user["id"]):
                    raise HTTPException(403, "Join the group before accepting a project invitation")
                conn.execute("INSERT OR REPLACE INTO project_members VALUES (?,?,?,?)", (row["target_id"], user["id"], row["role"], now()))
            else:
                page = conn.execute("SELECT id FROM research_pages WHERE id = ? AND archived_at IS NULL", (row["target_id"],)).fetchone()
                if not page:
                    raise HTTPException(404, "Page no longer exists")
                conn.execute("INSERT OR REPLACE INTO page_shares VALUES (?,?,?,?)", (row["target_id"], user["id"], row["role"], now()))
        conn.execute("UPDATE collaboration_invites SET status = ?, responded_at = ? WHERE id = ?", ("accepted" if action == "accept" else "declined", now(), invitation_id))
        conn.execute("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND kind='invite.received' AND subject_id=?", (now(), user["id"], invitation_id))
        if action == "accept":
            notify(conn, row["sender_id"], user["id"], "invite.accepted", invitation_id,
                   event_key=f"invite.accepted:{invitation_id}:{row['created_at']}")
    return {"status": "accepted" if action == "accept" else "declined", "kind": row["kind"], "target_id": row["target_id"]}


@router.get("/projects")
def list_projects(field: str | None = None, user: dict = Depends(current_user)):
    with db() as conn:
        rows = conn.execute("SELECT * FROM research_projects WHERE field = ? OR ? IS NULL ORDER BY updated_at DESC", (field, field)).fetchall()
        return {"projects": [project_payload(conn, row, user["id"]) for row in rows if project_access(conn, row, user["id"]) > 0]}


@router.put("/field-workspaces/{field}")
def open_field_workspace(field: str, payload: FieldWorkspaceInput, user: dict = Depends(current_user)):
    """Idempotent personal notebook. Never adopt or expose an existing shared project."""
    labels = {
        "mathematics": ("Toán học", "Mathematics", "∑", "indigo"),
        "physics": ("Vật lý", "Physics", "⚛", "ocean"),
        "chemistry": ("Hóa học", "Chemistry", "⚗", "amber"),
        "biology": ("Sinh học", "Biology", "🧬", "forest"),
        "artificial-intelligence": ("Trí tuệ nhân tạo", "Artificial intelligence", "✦", "aurora"),
    }
    if field not in labels:
        raise HTTPException(422, "Unknown research field")
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT * FROM field_workspaces WHERE user_id = ? AND field = ?", (user["id"], field)).fetchone()
        if not existing:
            project_id, page_id, timestamp = ident(), ident(), now()
            label = labels[field][0 if payload.language == "vi" else 1]
            conn.execute("INSERT INTO research_projects VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (project_id, None, user["id"], label, "Personal field notebook", field, "", "active", "restricted", timestamp, timestamp))
            conn.execute("INSERT INTO research_pages (id,project_id,title,created_by,updated_by,created_at,updated_at,icon,cover) VALUES (?,?,?,?,?,?,?,?,?)",
                         (page_id, project_id, label, user["id"], user["id"], timestamp, timestamp, labels[field][2], labels[field][3]))
            conn.execute("INSERT INTO field_workspaces VALUES (?,?,?,?)", (user["id"], field, project_id, page_id))
            event(conn, project_id, user["id"], "field.workspace_created", page_id)
            existing = conn.execute("SELECT * FROM field_workspaces WHERE user_id = ? AND field = ?", (user["id"], field)).fetchone()
        project_id = existing["project_id"]
        pages = conn.execute("SELECT p.*,COALESCE(n.favorite,0) favorite,n.opened_at FROM research_pages p LEFT JOIN notebook_preferences n ON n.page_id=p.id AND n.user_id=? WHERE p.project_id=? ORDER BY p.position,p.created_at,p.id", (user["id"], project_id)).fetchall()
        return {"project_id": project_id, "home_page_id": existing["home_page_id"], "field": field,
                "pages": [dict(page) for page in pages if not page["archived_at"]],
                "archived_pages": [dict(page) for page in pages if page["archived_at"]]}


@router.put("/pages/{page_id}/preference")
def notebook_preference(page_id: str, payload: NotebookPreference, user: dict = Depends(current_user)):
    with db() as conn:
        page_detail(conn, page_id, user["id"])
        conn.execute("INSERT OR IGNORE INTO notebook_preferences (user_id,page_id) VALUES (?,?)", (user["id"], page_id))
        if payload.favorite is not None:
            conn.execute("UPDATE notebook_preferences SET favorite=? WHERE user_id=? AND page_id=?", (payload.favorite, user["id"], page_id))
        if payload.opened:
            conn.execute("UPDATE notebook_preferences SET opened_at=? WHERE user_id=? AND page_id=?", (now(), user["id"], page_id))
    return {"status": "updated"}


@router.post("/projects", status_code=201)
def create_project(payload: ProjectInput, group_id: str | None = None, user: dict = Depends(current_user)):
    if payload.field not in FIELDS:
        raise HTTPException(422, "Unknown research field")
    project_id, timestamp = ident(), now()
    with db() as conn:
        require_name(conn, user["id"])
        if group_id:
            group_detail(conn, group_id, user["id"])
        conn.execute(
            "INSERT INTO research_projects VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (project_id, group_id, user["id"], payload.name.strip(), payload.description.strip(), payload.field,
             payload.category.strip(), "planning", payload.visibility if group_id else "restricted", timestamp, timestamp),
        )
        event(conn, project_id, user["id"], "project.created", project_id)
        row = conn.execute("SELECT * FROM research_projects WHERE id = ?", (project_id,)).fetchone()
        return {"project": project_payload(conn, row, user["id"])}


@router.get("/projects/{project_id}")
def get_project(project_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        project = project_detail(conn, project_id, user["id"])
        access = project_access(conn, project, user["id"])
        pages = conn.execute("SELECT p.*,COALESCE(n.favorite,0) favorite,n.opened_at FROM research_pages p LEFT JOIN notebook_preferences n ON n.page_id=p.id AND n.user_id=? WHERE p.project_id=? AND p.archived_at IS NULL ORDER BY p.position,p.created_at,p.id", (user["id"], project_id)).fetchall()
        # Compute direct grants in one query, rather than rechecking the entire
        # project/group permission chain once for every sidebar page.
        page_grants = {row["page_id"]: ACCESS[row["role"]] for row in conn.execute(
            "SELECT s.page_id,s.role FROM page_shares s JOIN research_pages p ON p.id=s.page_id WHERE p.project_id=? AND s.user_id=?", (project_id, user["id"]))}
        field_home = conn.execute("SELECT home_page_id FROM field_workspaces WHERE project_id=?", (project_id,)).fetchone()
        archived_pages = conn.execute("SELECT id, title, archived_at FROM research_pages WHERE project_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC", (project_id,)).fetchall() if access >= 4 else []
        tasks = conn.execute("SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at DESC", (project_id,)).fetchall()
        evidence = conn.execute("SELECT * FROM project_evidence WHERE project_id = ? ORDER BY created_at DESC", (project_id,)).fetchall()
        members = conn.execute("SELECT user_id, role FROM project_members WHERE project_id = ?", (project_id,)).fetchall()
        assignable_ids = {project["owner_id"]}
        assignable_ids.update(member["user_id"] for member in members)
        if project["group_id"]:
            assignable_ids.update(item["user_id"] for item in conn.execute("SELECT user_id FROM group_members WHERE group_id = ?", (project["group_id"],)))
        return {"project": project_payload(conn, project, user["id"]), "owner": public_user(conn, project["owner_id"]), "home_page_id": field_home["home_page_id"] if field_home else None,
                "pages": [{**dict(page), "my_access": max(access, page_grants.get(page["id"], 0))} for page in pages], "archived_pages": [dict(page) for page in archived_pages],
                "tasks": [{**dict(task), "assignee": public_user(conn, task["assignee_id"]) if task["assignee_id"] else None} for task in tasks],
                "evidence": [dict(item) for item in evidence],
                "members": [{**public_user(conn, member["user_id"]), "role": member["role"]} for member in members],
                "pending_invites": pending_invites(conn, "project", project_id) if access >= 4 else [],
                "assignable": [public_user(conn, member_id) for member_id in assignable_ids if project_access(conn, project, member_id) > 0]}


@router.patch("/projects/{project_id}")
def edit_project(project_id: str, payload: ProjectPatch, user: dict = Depends(current_user)):
    with db() as conn:
        project = project_detail(conn, project_id, user["id"], 4)
        updates = payload.model_dump(exclude_unset=True, exclude_none=True)
        if updates.get("status") == "archived" and conn.execute("SELECT 1 FROM field_workspaces WHERE project_id=?", (project_id,)).fetchone():
            raise HTTPException(409, "The personal field workspace cannot be archived; archive individual pages instead")
        if updates:
            fields = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(f"UPDATE research_projects SET {fields}, updated_at = ? WHERE id = ?", (*[value.strip() if isinstance(value, str) else value for value in updates.values()], now(), project_id))
            event(conn, project_id, user["id"], "project.updated", project_id)
        project = conn.execute("SELECT * FROM research_projects WHERE id = ?", (project_id,)).fetchone()
        return {"project": project_payload(conn, project, user["id"])}


@router.post("/projects/{project_id}/invites", status_code=201)
def invite_project(project_id: str, payload: InviteInput, user: dict = Depends(current_user)):
    if payload.role not in {"viewer", "commenter", "editor"}:
        raise HTTPException(422, "Choose a project permission")
    with db() as conn:
        project = project_detail(conn, project_id, user["id"], 4)
        target = find_person(conn, payload.username, user["id"])
        if project["group_id"] and not group_role(conn, project["group_id"], target["id"]):
            raise HTTPException(409, "Invite this user to the group first")
        return {"invite": invite(conn, "project", project_id, target["id"], user["id"], payload.role)}


@router.delete("/projects/{project_id}/members/{member_id}")
def remove_project_member(project_id: str, member_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        project_detail(conn, project_id, user["id"], 4)
        conn.execute("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", (project_id, member_id))
        conn.execute("DELETE FROM collaboration_invites WHERE kind = 'project' AND target_id = ? AND recipient_id = ?", (project_id, member_id))
    return {"status": "removed"}


@router.patch("/projects/{project_id}/members/{member_id}")
def edit_project_member(project_id: str, member_id: str, payload: RoleInput, user: dict = Depends(current_user)):
    if payload.role not in {"viewer", "commenter", "editor"}:
        raise HTTPException(422, "Choose a project permission")
    with db() as conn:
        project_detail(conn, project_id, user["id"], 4)
        updated = conn.execute("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?", (payload.role, project_id, member_id))
        if not updated.rowcount:
            raise HTTPException(404, "Direct project member not found")
    return {"status": "updated"}


@router.post("/projects/{project_id}/pages", status_code=201)
def create_page(project_id: str, payload: PageInput, user: dict = Depends(current_user)):
    page_id, timestamp = ident(), now()
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        project_detail(conn, project_id, user["id"], 3)
        if not payload.title.strip():
            raise HTTPException(422, "Page title cannot be empty")
        if payload.parent_id:
            parent = page_detail(conn, payload.parent_id, user["id"], 3)
            if parent["project_id"] != project_id:
                raise HTTPException(422, "Parent page must belong to the same project")
        position = conn.execute("SELECT COALESCE(MAX(position),-1)+1 FROM research_pages WHERE project_id = ? AND parent_id IS ?", (project_id, payload.parent_id)).fetchone()[0]
        conn.execute("INSERT INTO research_pages (id,project_id,parent_id,title,created_by,updated_by,created_at,updated_at,position) VALUES (?,?,?,?,?,?,?,?,?)", (page_id, project_id, payload.parent_id, payload.title.strip(), user["id"], user["id"], timestamp, timestamp, position))
        conn.execute("UPDATE research_projects SET updated_at = ? WHERE id = ?", (timestamp, project_id))
        if payload.parent_id and payload.link_in_parent:
            add_field_child_link(conn, payload.parent_id, page_id, user["id"])
        event(conn, project_id, user["id"], "page.created", page_id)
        return {"page": dict(conn.execute("SELECT * FROM research_pages WHERE id = ?", (page_id,)).fetchone())}


@router.put("/projects/{project_id}/page-order")
def reorder_pages(project_id: str, payload: PageOrderInput, user: dict = Depends(current_user)):
    with db() as conn:
        project_detail(conn, project_id, user["id"], 3)
        if payload.parent_id:
            parent = page_detail(conn, payload.parent_id, user["id"])
            if parent["project_id"] != project_id:
                raise HTTPException(422, "Parent must belong to this project")
        siblings = {row["id"] for row in conn.execute("SELECT id FROM research_pages WHERE project_id = ? AND parent_id IS ? AND archived_at IS NULL", (project_id, payload.parent_id))}
        if len(payload.page_ids) != len(set(payload.page_ids)) or set(payload.page_ids) != siblings:
            raise HTTPException(409, "Page tree changed; refresh and reorder all siblings")
        for position, page_id in enumerate(payload.page_ids):
            conn.execute("UPDATE research_pages SET position = ? WHERE id = ?", (position, page_id))
        event(conn, project_id, user["id"], "pages.reordered")
    return {"status": "updated"}


def document_state(conn: sqlite3.Connection, page_id: str) -> tuple[Doc, int]:
    document = Doc({"markdown": Text(), "notebook": XmlFragment()})
    revision = 0
    for row in conn.execute("SELECT seq,update_blob FROM page_updates WHERE page_id = ? ORDER BY seq", (page_id,)):
        document.apply_update(row["update_blob"])
        revision = row["seq"]
    return document, revision


def is_field_project(conn: sqlite3.Connection, project_id: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM field_workspaces WHERE project_id=?", (project_id,)).fetchone())


def page_link_blocks(document: Doc) -> dict[str, set[str]]:
    """Read actual CRDT Page blocks, never the untrusted Markdown/index cache."""
    links: dict[str, set[str]] = {}
    pending = list(document["notebook"].children)
    while pending:
        element = pending.pop()
        if not isinstance(element, XmlElement):
            continue
        if element.tag == "blockContainer":
            for child in element.children:
                if isinstance(child, XmlElement) and child.tag == "pageLink":
                    target = child.attributes.get("pageId") or ""
                    block_id = element.attributes.get("id") or ""
                    if re.fullmatch(r"[a-f0-9]{32}", target) and block_id:
                        links.setdefault(target, set()).add(block_id)
        pending.extend(element.children)
    return links


def append_page_link(document: Doc, child: sqlite3.Row) -> None:
    fragment = document["notebook"]
    group = next((node for node in fragment.children if isinstance(node, XmlElement) and node.tag == "blockGroup"), None)
    if group is None:
        group = fragment.children.append(XmlElement("blockGroup"))
    group.children.append(XmlElement("blockContainer", attributes={"id": ident()}, contents=[
        XmlElement("pageLink", attributes={"pageId": child["id"], "title": child["title"],
                                          "textColor": "default", "backgroundColor": "default"})
    ]))


def persist_document_delta(conn: sqlite3.Connection, page_id: str, document: Doc, state: bytes, actor: str) -> None:
    update = document.get_update(state)
    if update != b"\x00\x00":
        conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)",
                     (page_id, actor, update, now()))
        conn.execute("UPDATE research_pages SET updated_by=?,updated_at=? WHERE id=?", (actor, now(), page_id))
        conn.execute("DELETE FROM page_projections WHERE page_id=?", (page_id,))


def add_field_child_link(conn: sqlite3.Connection, parent_id: str, child_id: str, actor: str) -> None:
    parent = conn.execute("SELECT * FROM research_pages WHERE id=?", (parent_id,)).fetchone()
    if not parent or parent["editor_format"] != "blocks" or not is_field_project(conn, parent["project_id"]):
        return  # Legacy parents receive their children during block initialization.
    document, _ = document_state(conn, parent_id)
    if child_id not in page_link_blocks(document):
        state = document.get_state()
        append_page_link(document, conn.execute("SELECT * FROM research_pages WHERE id=?", (child_id,)).fetchone())
        persist_document_delta(conn, parent_id, document, state, actor)


def remove_field_child_link(conn: sqlite3.Connection, parent_id: str | None, child_id: str, actor: str) -> None:
    if not parent_id:
        return
    parent = conn.execute("SELECT * FROM research_pages WHERE id=?", (parent_id,)).fetchone()
    if not parent or parent["editor_format"] != "blocks" or not is_field_project(conn, parent["project_id"]):
        return
    document, _ = document_state(conn, parent_id)
    state = document.get_state()
    def remove(node):
        for index in reversed(range(len(node.children))):
            element = node.children[index]
            if not isinstance(element, XmlElement):
                continue
            if element.tag == "blockContainer" and any(isinstance(child, XmlElement) and child.tag == "pageLink" and child.attributes.get("pageId") == child_id for child in element.children):
                del node.children[index]
            else:
                remove(element)
    remove(document["notebook"])
    persist_document_delta(conn, parent_id, document, state, actor)


def rename_field_child_link(conn: sqlite3.Connection, parent_id: str | None, child_id: str, title: str, actor: str) -> None:
    if not parent_id:
        return
    parent = conn.execute("SELECT * FROM research_pages WHERE id=?", (parent_id,)).fetchone()
    if not parent or parent["editor_format"] != "blocks" or not is_field_project(conn, parent["project_id"]):
        return
    document, _ = document_state(conn, parent_id)
    state = document.get_state()
    pending = list(document["notebook"].children)
    while pending:
        node = pending.pop()
        if not isinstance(node, XmlElement):
            continue
        if node.tag == "pageLink" and node.attributes.get("pageId") == child_id:
            node.attributes["title"] = title
        pending.extend(node.children)
    persist_document_delta(conn, parent_id, document, state, actor)


def archive_page_branch(conn: sqlite3.Connection, page: sqlite3.Row, actor: str) -> str:
    batch = ident()
    # A restore must not revive descendants trashed before this operation.
    conn.execute("""WITH RECURSIVE subtree(id) AS (
        SELECT id FROM research_pages WHERE id=?
        UNION SELECT p.id FROM research_pages p JOIN subtree s ON p.parent_id=s.id
        WHERE p.project_id=? AND p.archived_at IS NULL
    ) UPDATE research_pages SET archived_at=?,archive_batch=? WHERE id IN (SELECT id FROM subtree)""",
                 (page["id"], page["project_id"], now(), batch))
    event(conn, page["project_id"], actor, "page.archived", page["id"])
    return batch


def sync_field_page_links(conn: sqlite3.Connection, page: sqlite3.Row, before: dict[str, set[str]], document: Doc, actor: str) -> None:
    """Removing an owned child block trashes that page; removing a reference does not.

    Executed atomically with the accepted CRDT update. Undo restores ONLY the
    batch deleted by that very block, not unrelated trash or moved/sibling pages.
    Multiple links to the same child keep it alive until the last is removed.
    """
    if not is_field_project(conn, page["project_id"]):
        return
    after = page_link_blocks(document)
    removed = []
    restored = []
    for target in before.keys() - after.keys():
        child = conn.execute("SELECT * FROM research_pages WHERE id=? AND parent_id=? AND project_id=? AND archived_at IS NULL", (target, page["id"], page["project_id"])).fetchone()
        if child:
            removed.append(child)
    for target in after.keys() - before.keys():
        trash = conn.execute("SELECT t.*,p.archived_at,p.archive_batch current_batch,p.project_id,p.parent_id current_parent FROM page_link_trash t JOIN research_pages p ON p.id=t.page_id WHERE t.page_id=? AND t.parent_id=?", (target, page["id"])).fetchone()
        if trash and trash["archived_at"] and trash["current_parent"] == page["id"] and trash["current_batch"] == trash["archive_batch"] and after[target].intersection(json.loads(trash["block_ids"])):
            restored.append(trash)
    if removed or restored:
        # Deleting a page is more powerful than editing its text. Page-only
        # editors cannot use document updates to bypass project trash permissions.
        project_detail(conn, page["project_id"], actor, 4)
    for child in removed:
        batch = archive_page_branch(conn, child, actor)
        conn.execute("INSERT OR REPLACE INTO page_link_trash VALUES (?,?,?,?)", (child["id"], page["id"], json.dumps(sorted(before[child["id"]])), batch))
    for trash in restored:
        conn.execute("UPDATE research_pages SET archived_at=NULL,archive_batch=NULL WHERE project_id=? AND archive_batch=?", (page["project_id"], trash["archive_batch"]))
        conn.execute("DELETE FROM page_link_trash WHERE page_id=?", (trash["page_id"],))
        event(conn, page["project_id"], actor, "page.restored", trash["page_id"])


def block_signature(document: Doc, block_id: str) -> str | None:
    """Read a block's own content, not descendants or another block's edits."""
    pending = list(document["notebook"].children)
    while pending:
        element = pending.pop()
        if not isinstance(element, XmlElement):
            continue
        if element.tag == "blockContainer" and element.attributes.get("id") == block_id:
            attributes = json.dumps(dict(element.attributes), sort_keys=True)
            content = "".join(str(child) for child in element.children
                              if not isinstance(child, XmlElement) or child.tag != "blockGroup")
            return attributes + content
        pending.extend(element.children)
    return None


@router.get("/pages/{page_id}/blocks/{block_id}/activity")
def get_block_activity(page_id: str, block_id: str, user: dict = Depends(current_user)):
    """Attribute accepted changes to authenticated actors in the durable log.

    Browser-provided projection JSON and the current viewer are not evidence of
    authorship. Repeated/idempotent updates do not change the last-edit record.
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", block_id):
        raise HTTPException(422, "Invalid block identifier")
    with db() as conn:
        page_detail(conn, page_id, user["id"])
        revision = conn.execute("SELECT COALESCE(MAX(seq),0) FROM page_updates WHERE page_id = ?", (page_id,)).fetchone()[0]
        cache_key = (str(_database_path()), page_id, revision, block_id)
        with _BLOCK_ACTIVITY_LOCK:
            cached = _BLOCK_ACTIVITY_CACHE.get(cache_key)
            if cached:
                _BLOCK_ACTIVITY_CACHE.move_to_end(cache_key)
                return {"block_id": block_id, "revision": revision, "edited_by": public_user(conn, cached[0]), "edited_at": cached[1]}
        document = Doc({"markdown": Text(), "notebook": XmlFragment()})
        previous = None
        last_edit = None
        revision = 0
        for row in conn.execute("SELECT seq,author_id,update_blob,created_at FROM page_updates WHERE page_id = ? ORDER BY seq", (page_id,)):
            document.apply_update(row["update_blob"])
            signature = block_signature(document, block_id)
            if signature is not None and signature != previous:
                last_edit = (row["author_id"], row["created_at"])
            previous = signature
            revision = row["seq"]
        if previous is None:
            raise HTTPException(404, "Block not found")
        if last_edit:
            with _BLOCK_ACTIVITY_LOCK:
                _BLOCK_ACTIVITY_CACHE[(str(_database_path()), page_id, revision, block_id)] = last_edit
                while len(_BLOCK_ACTIVITY_CACHE) > 256:
                    _BLOCK_ACTIVITY_CACHE.popitem(last=False)
        return {"block_id": block_id, "revision": revision,
                "edited_by": public_user(conn, last_edit[0]) if last_edit else None,
                "edited_at": last_edit[1] if last_edit else None}


@router.get("/pages/{page_id}/document")
def get_document(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = page_detail(conn, page_id, user["id"])
        document, revision = document_state(conn, page_id)
        # One-time, non-destructive repair for notebooks created before child
        # pages had structural blocks. Never infer deletion from absent old links.
        if page["editor_format"] == "blocks" and not page["field_links_ready"] and is_field_project(conn, page["project_id"]):
            state = document.get_state()
            links = page_link_blocks(document)
            for child in conn.execute("SELECT * FROM research_pages WHERE parent_id=? AND archived_at IS NULL ORDER BY position,created_at", (page_id,)):
                if child["id"] not in links:
                    append_page_link(document, child)
            persist_document_delta(conn, page_id, document, state, page["updated_by"])
            conn.execute("UPDATE research_pages SET field_links_ready=1 WHERE id=?", (page_id,))
            revision = conn.execute("SELECT COALESCE(MAX(seq),0) FROM page_updates WHERE page_id=?", (page_id,)).fetchone()[0]
        return {"format": page["editor_format"], "revision": revision,
                "update": base64.b64encode(document.get_update()).decode("ascii"),
                "legacy_markdown": str(document["markdown"])}


@router.post("/pages/{page_id}/initialize-blocks")
def initialize_blocks(page_id: str, payload: BlockDocumentInput, user: dict = Depends(current_user)):
    """One compare-and-swap bootstrap, never rebuild a live CRDT from JSON."""
    try:
        update = base64.b64decode(payload.update, validate=True)
        proposed = Doc({"notebook": XmlFragment()})
        proposed.apply_update(update)
        if not len(proposed["notebook"].children):
            raise ValueError("Empty notebook")
    except (ValueError, RuntimeError, binascii.Error):
        raise HTTPException(422, "Invalid block document") from None
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = page_detail(conn, page_id, user["id"], 3)
        document, revision = document_state(conn, page_id)
        if page["editor_format"] == "blocks":
            return {"status": "already_initialized"}
        if revision != payload.expected_revision:
            raise HTTPException(409, "Document changed; reopen it before conversion")
        if len(document["notebook"].children):
            raise HTTPException(409, "Block document already exists")
        from backend.notebook_media import authorize_document_images
        authorize_document_images(conn, page_id, user['id'], proposed)
        legacy = str(document["markdown"])
        if legacy:
            conn.execute("INSERT INTO page_versions (id,page_id,author_id,label,markdown,created_at) VALUES (?,?,?,?,?,?)", (ident(), page_id, user["id"], "Original Markdown before block conversion", legacy, now()))
        if is_field_project(conn, page["project_id"]):
            links = page_link_blocks(proposed)
            for child in conn.execute("SELECT * FROM research_pages WHERE parent_id=? AND archived_at IS NULL ORDER BY position,created_at", (page_id,)):
                if child["id"] not in links:
                    append_page_link(proposed, child)
            update = proposed.get_update()
            conn.execute("UPDATE research_pages SET field_links_ready=1 WHERE id=?", (page_id,))
        conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (page_id, user["id"], update, now()))
        conn.execute("UPDATE research_pages SET editor_format = 'blocks',updated_by = ?,updated_at = ? WHERE id = ?", (user["id"], now(), page_id))
        event(conn, page["project_id"], user["id"], "page.blocks_enabled", page_id)
    return {"status": "initialized"}


@router.put("/pages/{page_id}/projection")
def index_page(page_id: str, payload: ProjectionInput, user: dict = Depends(current_user)):
    """A revision-tagged search/export cache, NOT the authoritative document."""
    encoded = json.dumps(payload.blocks, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > 500_000:
        raise HTTPException(413, "Document export exceeds 500 KB")
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page_detail(conn, page_id, user["id"], 3)
        revision = conn.execute("SELECT COALESCE(MAX(seq),0) FROM page_updates WHERE page_id = ?", (page_id,)).fetchone()[0]
        if revision != payload.revision:
            raise HTTPException(409, "A newer edit is available; refresh the projection")
        conn.execute("INSERT INTO page_projections VALUES (?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET revision=excluded.revision,markdown=excluded.markdown,blocks_json=excluded.blocks_json,indexed_at=excluded.indexed_at", (page_id, revision, payload.markdown, encoded, now()))
    return {"revision": revision}


@router.get("/search-pages")
def search_pages(query: str = "", field: str | None = None, project_id: str | None = None, user: dict = Depends(current_user)):
    query = query.strip().casefold()
    if len(query) < 2:
        return {"pages": []}
    if len(query) > 200:
        raise HTTPException(422, "Search must be under 200 characters")
    with db() as conn:
        rows = conn.execute("SELECT p.*,r.field,r.name project_name,c.markdown FROM research_pages p JOIN research_projects r ON r.id=p.project_id LEFT JOIN page_projections c ON c.page_id=p.id WHERE p.archived_at IS NULL AND (? IS NULL OR r.field=?) AND (? IS NULL OR r.id=?) ORDER BY p.updated_at DESC", (field, field, project_id, project_id)).fetchall()
        results = []
        for row in rows:
            if not page_access(conn, row, user["id"]):
                continue
            content = row["markdown"]
            if content is None and row["editor_format"] == "markdown":
                content = str(document_state(conn, row["id"])[0]["markdown"])
            content = content or ""
            offset = content.casefold().find(query)
            if query not in row["title"].casefold() and offset < 0:
                continue
            results.append({"id": row["id"], "title": row["title"], "project_name": row["project_name"], "field": row["field"], "snippet": content[max(0, offset-60):max(0, offset-60)+200]})
            if len(results) >= 50:
                break
        return {"pages": results}


@router.get("/tab-pages")
def tab_pages(query: str = "", field: str | None = None, user: dict = Depends(current_user)):
    """Only the caller's own field notebooks: no cross-project title discovery."""
    if len(query) > 200 or (field is not None and field not in FIELDS):
        raise HTTPException(422, "Invalid page search")
    query = query.strip().casefold()
    with db() as conn:
        rows = conn.execute(
            "SELECT p.*,w.field,n.opened_at,c.markdown FROM research_pages p "
            "JOIN field_workspaces w ON w.project_id=p.project_id AND w.user_id=? "
            "LEFT JOIN notebook_preferences n ON n.page_id=p.id AND n.user_id=? "
            "LEFT JOIN page_projections c ON c.page_id=p.id "
            "WHERE p.archived_at IS NULL AND (? IS NULL OR w.field=?) "
            "ORDER BY COALESCE(n.opened_at,p.updated_at) DESC,p.id",
            (user["id"], user["id"], field, field),
        ).fetchall()
        results = []
        for row in rows:
            if not page_access(conn, row, user["id"]):
                continue
            if query and query not in row["title"].casefold():
                continue
            # A projection is an index, not a source of permission or edit history.
            results.append({"id": row["id"], "title": row["title"], "field": row["field"],
                            "icon": row["icon"], "parent_id": row["parent_id"],
                            "updated_at": row["updated_at"], "opened_at": row["opened_at"],
                            "snippet": (row["markdown"] or "")[:500]})
            if len(results) >= 100:
                break
        return {"pages": results}


class ViewHistoryInput(BaseModel):
    show_history: bool


@router.post("/pages/{page_id}/view")
def record_page_view(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page_detail(conn, page_id, user["id"])
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        recent = conn.execute("SELECT 1 FROM page_views WHERE page_id=? AND user_id=? AND viewed_at>=? LIMIT 1", (page_id, user["id"], cutoff)).fetchone()
        if not recent:
            conn.execute("INSERT INTO page_views (page_id,user_id,viewed_at) VALUES (?,?,?)", (page_id, user["id"], now()))
        pref = conn.execute("SELECT show_history FROM page_view_preferences WHERE page_id=? AND user_id=?", (page_id, user["id"])).fetchone()
        return {"recorded": not bool(recent), "show_history": bool(pref and pref["show_history"])}


@router.put("/pages/{page_id}/view-history")
def view_history_preference(page_id: str, payload: ViewHistoryInput, user: dict = Depends(current_user)):
    with db() as conn:
        page_detail(conn, page_id, user["id"])
        conn.execute("INSERT INTO page_view_preferences VALUES (?,?,?) ON CONFLICT(page_id,user_id) DO UPDATE SET show_history=excluded.show_history", (page_id, user["id"], payload.show_history))
    return {"show_history": payload.show_history}


@router.get("/pages/{page_id}/activity")
def page_activity(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        rows = conn.execute("SELECT * FROM collaboration_events WHERE subject_id=? AND action LIKE 'page.%' ORDER BY id DESC LIMIT 100", (page_id,)).fetchall()
        updates = [{"id": f"event-{row['id']}", "action": row["action"], "at": row["created_at"],
                    "actor": public_user(conn, row["actor_id"]), "changes": json.loads(row["details_json"])} for row in rows]
        # Coalesce the durable CRDT log by author/minute instead of presenting each keystroke.
        edits = conn.execute("SELECT MAX(seq) seq,author_id,MAX(created_at) at FROM page_updates WHERE page_id=? GROUP BY author_id,SUBSTR(created_at,1,16) ORDER BY at DESC LIMIT 100", (page_id,)).fetchall()
        updates.extend({"id": f"edit-{row['seq']}", "action": "page.content", "at": row["at"], "actor": public_user(conn, row["author_id"]), "changes": {}} for row in edits)
        updates.sort(key=lambda item: item["at"], reverse=True)
        return {"created_by": public_user(conn, page["created_by"]), "created_at": page["created_at"],
                "edited_by": public_user(conn, page["updated_by"]), "edited_at": page["updated_at"],
                "can_analyze": page_access(conn, page, user["id"]) >= 3, "updates": updates[:100]}


@router.get("/pages/{page_id}/analytics")
def page_analytics(page_id: str, days: int = 28, user: dict = Depends(current_user)):
    if days not in {7, 28, 90}:
        raise HTTPException(422, "Choose 7, 28 or 90 days")
    with db() as conn:
        page = page_detail(conn, page_id, user["id"], 3)
        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=days-1)
        after = start.isoformat()
        before = (today + timedelta(days=1)).isoformat()
        counts = conn.execute("SELECT SUBSTR(viewed_at,1,10) day,COUNT(*) views,COUNT(DISTINCT user_id) unique_views FROM page_views WHERE page_id=? AND viewed_at>=? AND viewed_at<? GROUP BY day", (page_id, after, before)).fetchall()
        by_day = {row["day"]: dict(row) for row in counts}
        series = [by_day.get((start + timedelta(days=i)).isoformat(), {"day": (start + timedelta(days=i)).isoformat(), "views": 0, "unique_views": 0}) for i in range(days)]
        totals = conn.execute("SELECT COUNT(*) views,COUNT(DISTINCT user_id) unique_views FROM page_views WHERE page_id=? AND viewed_at>=? AND viewed_at<?", (page_id, after, before)).fetchone()
        viewers = conn.execute("SELECT v.user_id,MAX(v.viewed_at) last_viewed_at FROM page_views v JOIN page_view_preferences p ON p.page_id=v.page_id AND p.user_id=v.user_id AND p.show_history=1 WHERE v.page_id=? AND v.viewed_at>=? AND v.viewed_at<? GROUP BY v.user_id ORDER BY last_viewed_at DESC LIMIT 50", (page_id, after, before)).fetchall()
        pref = conn.execute("SELECT show_history FROM page_view_preferences WHERE page_id=? AND user_id=?", (page_id, user["id"])).fetchone()
        return {"days": days, "timezone": "UTC", "totals": dict(totals), "series": series,
                "viewers": [{"person": public_user(conn, row["user_id"]), "last_viewed_at": row["last_viewed_at"]} for row in viewers],
                "show_history": bool(pref and pref["show_history"]),
                "created_by": public_user(conn, page["created_by"]), "created_at": page["created_at"],
                "edited_by": public_user(conn, page["updated_by"]), "edited_at": page["updated_at"]}


@router.get("/pages/{page_id}/sharing")
def page_sharing(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        project = conn.execute("SELECT * FROM research_projects WHERE id=?", (page["project_id"],)).fetchone()
        manage = project_access(conn, project, user["id"]) >= 4
        members = {project["owner_id"]: {**public_user(conn, project["owner_id"]), "role": "manager", "inherited": True}}
        if manage:
            ids = {row["user_id"] for row in conn.execute("SELECT user_id FROM project_members WHERE project_id=?", (project["id"],))}
            if project["group_id"]:
                ids.update(row["user_id"] for row in conn.execute("SELECT user_id FROM group_members WHERE group_id=?", (project["group_id"],)))
            for member_id in ids:
                level = project_access(conn, project, member_id)
                if level:
                    members[member_id] = {**public_user(conn, member_id), "role": next(role for role, value in ACCESS.items() if value == level), "inherited": True}
            for share in conn.execute("SELECT * FROM page_shares WHERE page_id=?", (page_id,)):
                # Display inherited access separately: lowering a direct grant cannot revoke project access.
                if share["user_id"] not in members:
                    members[share["user_id"]] = {**public_user(conn, share["user_id"]), "role": share["role"], "inherited": False}
        elif user["id"] not in members:
            members[user["id"]] = {**public_user(conn, user["id"]), "role": next(role for role, value in ACCESS.items() if value == page_access(conn, page, user["id"])), "inherited": bool(project_access(conn, project, user["id"]))}
        return {"can_manage": manage, "members": list(members.values()), "pending_invites": pending_invites(conn, "page", page_id) if manage else [],
                "general_access": "invited", "project_access": bool(project["group_id"] or conn.execute("SELECT 1 FROM project_members WHERE project_id=?", (project["id"],)).fetchone())}


class BatchPageInvite(BaseModel):
    recipients: list[str] = Field(min_length=1, max_length=20)
    role: Literal["viewer", "commenter", "editor"] = "viewer"


@router.post("/pages/{page_id}/batch-invites", status_code=201)
def invite_page_batch(page_id: str, payload: BatchPageInvite, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = page_detail(conn, page_id, user["id"])
        project_detail(conn, page["project_id"], user["id"], 4)
        targets = set()
        for value in payload.recipients:
            value = value.strip()
            if not value or len(value) > 254:
                raise HTTPException(422, "Enter a valid account name or registered email")
            if "@" in value:
                rows = conn.execute("SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND status='active'", (value,)).fetchall()
                if len(rows) != 1:
                    raise HTTPException(404, "An account was not found. Use a unique name or an email already registered in this app.")
                target_id = rows[0]["id"]
            else:
                target_id = find_person(conn, value, user["id"])["id"]
            if target_id == user["id"]:
                raise HTTPException(400, "You cannot invite yourself")
            not_blocked(conn, user["id"], target_id)
            if page_access(conn, page, target_id):
                raise HTTPException(409, "An account already has access. Change its existing permission instead.")
            targets.add(target_id)
        invitations = [invite(conn, "page", page_id, target, user["id"], payload.role) for target in sorted(targets)]
        return {"invites": invitations}


@router.get("/pages/{page_id}/references")
def page_references(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        # Page-only guests must not discover sibling titles or project evidence.
        project = conn.execute("SELECT * FROM research_projects WHERE id=?", (page["project_id"],)).fetchone()
        pages = conn.execute("SELECT p.id,p.title,p.parent_id,p.position,p.created_at,p.icon,p.updated_at,COALESCE(n.favorite,0) favorite FROM research_pages p LEFT JOIN notebook_preferences n ON n.page_id=p.id AND n.user_id=? WHERE p.project_id=? AND p.archived_at IS NULL ORDER BY p.position,p.created_at", (user["id"], page["project_id"])).fetchall() if project_access(conn, project, user["id"]) else []
        evidence = conn.execute("SELECT * FROM project_evidence WHERE project_id=?", (page["project_id"],)).fetchall() if project_access(conn, project, user["id"]) else []
        backlinks = []
        for item in conn.execute("SELECT p.*,c.markdown FROM research_pages p JOIN page_projections c ON c.page_id=p.id WHERE p.id!=? AND p.archived_at IS NULL", (page_id,)):
            if f"#/collab/page/{page_id}" in item["markdown"] and page_access(conn, item, user["id"]):
                backlinks.append({"id": item["id"], "title": item["title"]})
        return {"pages": [dict(item) for item in pages], "evidence": [dict(item) for item in evidence], "backlinks": backlinks}


@router.get("/shared-pages")
def list_shared_pages(user: dict = Depends(current_user)):
    with db() as conn:
        rows = conn.execute(
            "SELECT p.*, s.role share_role, r.name project_name, r.field FROM research_pages p "
            "JOIN page_shares s ON s.page_id = p.id JOIN research_projects r ON r.id = p.project_id "
            "WHERE s.user_id = ? AND p.archived_at IS NULL ORDER BY p.updated_at DESC", (user["id"],),
        ).fetchall()
        return {"pages": [dict(row) for row in rows if page_access(conn, row, user["id"]) > 0]}


@router.get("/pages/{page_id}")
def get_page(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        project = conn.execute("SELECT * FROM research_projects WHERE id = ?", (page["project_id"],)).fetchone()
        comments = conn.execute("SELECT * FROM page_comments WHERE page_id = ? ORDER BY created_at", (page_id,)).fetchall()
        versions = conn.execute("SELECT id,label,author_id,created_at FROM page_versions WHERE page_id = ? ORDER BY created_at DESC LIMIT 30", (page_id,)).fetchall()
        shares = conn.execute("SELECT * FROM page_shares WHERE page_id = ?", (page_id,)).fetchall()
        preference = conn.execute("SELECT favorite,opened_at FROM notebook_preferences WHERE page_id=? AND user_id=?", (page_id, user["id"])).fetchone()
        return {"page": {**dict(page), "favorite": bool(preference["favorite"]) if preference else False, "opened_at": preference["opened_at"] if preference else None,
                         "my_access": page_access(conn, page, user["id"]), "can_manage": project_access(conn, project, user["id"]) >= 4},
                "last_editor": public_user(conn, page["updated_by"]),
                "project": {"id": project["id"], "name": project["name"], "field": project["field"], "group_id": project["group_id"], "my_access": project_access(conn, project, user["id"])},
                "comments": [{**dict(comment), "author": public_user(conn, comment["author_id"])} for comment in comments],
                "versions": [{**dict(version), "author": public_user(conn, version["author_id"])} for version in versions],
                "pending_invites": pending_invites(conn, "page", page_id) if project_access(conn, project, user["id"]) >= 4 else [],
                "shares": [{**public_user(conn, share["user_id"]), "role": share["role"]} for share in shares]}


@router.patch("/pages/{page_id}")
def edit_page(page_id: str, payload: PagePatch, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = page_detail(conn, page_id, user["id"], 3)
        title = payload.title.strip() if payload.title is not None else page["title"]
        if not title:
            raise HTTPException(422, "Page title cannot be empty")
        parent_id = payload.parent_id if "parent_id" in payload.model_fields_set else page["parent_id"]
        if parent_id and conn.execute("SELECT 1 FROM field_workspaces WHERE home_page_id=?", (page_id,)).fetchone():
            raise HTTPException(422, "The field home must stay at the root")
        if "parent_id" in payload.model_fields_set:
            project_detail(conn, page["project_id"], user["id"], 3)
        if parent_id:
            if parent_id == page_id:
                raise HTTPException(422, "A page cannot be its own parent")
            parent = page_detail(conn, parent_id, user["id"], 1)
            if parent["project_id"] != page["project_id"]:
                raise HTTPException(422, "Parent page must belong to the same project")
            seen = {page_id}
            cursor = parent
            while cursor:
                if cursor["id"] in seen:
                    raise HTTPException(422, "Page nesting cycle is not allowed")
                seen.add(cursor["id"])
                cursor = conn.execute("SELECT * FROM research_pages WHERE id = ?", (cursor["parent_id"],)).fetchone() if cursor["parent_id"] else None
        timestamp = now()
        conn.execute("UPDATE research_pages SET title = ?, parent_id = ?, updated_by = ?, updated_at = ? WHERE id = ?", (title, parent_id, user["id"], timestamp, page_id))
        if parent_id != page["parent_id"]:
            conn.execute("UPDATE research_pages SET position=(SELECT COALESCE(MAX(position),-1)+1 FROM research_pages WHERE project_id=? AND parent_id IS ?) WHERE id=?", (page["project_id"], parent_id, page_id))
            conn.execute("DELETE FROM page_link_trash WHERE page_id=?", (page_id,))
            remove_field_child_link(conn, page["parent_id"], page_id, user["id"])
            if parent_id:
                add_field_child_link(conn, parent_id, page_id, user["id"])
        for key in ("icon", "cover", "full_width"):
            value = getattr(payload, key)
            if value is not None:
                conn.execute(f"UPDATE research_pages SET {key}=? WHERE id=?", (value, page_id))
        if title != page["title"]:
            rename_field_child_link(conn, parent_id, page_id, title, user["id"])
        changes = {key: {"before": page[key], "after": value} for key, value in
                   (("title", title), ("parent_id", parent_id), ("icon", payload.icon),
                    ("cover", payload.cover), ("full_width", payload.full_width))
                   if (value is not None or key == "parent_id") and value != page[key]}
        event(conn, page["project_id"], user["id"], "page.updated", page_id, changes)
        return {"page": dict(conn.execute("SELECT * FROM research_pages WHERE id = ?", (page_id,)).fetchone())}


@router.post("/pages/{page_id}/archive")
def archive_page(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = page_detail(conn, page_id, user["id"])
        project_detail(conn, page["project_id"], user["id"], 4)
        if conn.execute("SELECT 1 FROM field_workspaces WHERE home_page_id=?", (page_id,)).fetchone():
            raise HTTPException(409, "The field home cannot be archived")
        archive_page_branch(conn, page, user["id"])
        conn.execute("DELETE FROM page_link_trash WHERE page_id=?", (page_id,))
        remove_field_child_link(conn, page["parent_id"], page_id, user["id"])
    return {"status": "archived"}


@router.post("/pages/{page_id}/restore")
def restore_page(page_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = conn.execute("SELECT * FROM research_pages WHERE id = ?", (page_id,)).fetchone()
        if not page:
            raise HTTPException(404, "Page not found")
        project_detail(conn, page["project_id"], user["id"], 4)
        if page["parent_id"] and conn.execute("SELECT 1 FROM research_pages WHERE id=? AND archived_at IS NOT NULL", (page["parent_id"],)).fetchone():
            raise HTTPException(409, "Restore the parent page first")
        if page["archive_batch"]:
            conn.execute("UPDATE research_pages SET archived_at=NULL,archive_batch=NULL WHERE project_id=? AND archive_batch=?", (page["project_id"], page["archive_batch"]))
        else:
            conn.execute("UPDATE research_pages SET archived_at = NULL WHERE id = ?", (page_id,))
        conn.execute("DELETE FROM page_link_trash WHERE page_id=?", (page_id,))
        if page["parent_id"]:
            add_field_child_link(conn, page["parent_id"], page_id, user["id"])
        event(conn, page["project_id"], user["id"], "page.restored", page_id)
    return {"status": "restored"}


@router.post("/pages/{page_id}/duplicate", status_code=201)
def duplicate_page(page_id: str, user: dict = Depends(current_user)):
    """Copy this page's CRDT, not its shares, comments, history, or descendants."""
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        page = page_detail(conn, page_id, user["id"], 3)
        project_detail(conn, page["project_id"], user["id"], 3)
        new_id, timestamp = ident(), now()
        document, revision = document_state(conn, page_id)
        position = conn.execute("SELECT COALESCE(MAX(position),-1)+1 FROM research_pages WHERE project_id=? AND parent_id IS ?", (page["project_id"], page["parent_id"])).fetchone()[0]
        conn.execute("INSERT INTO research_pages (id,project_id,parent_id,title,created_by,updated_by,created_at,updated_at,position,editor_format,icon,cover,full_width) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (new_id, page["project_id"], page["parent_id"], page["title"][:113] + " (copy)", user["id"], user["id"], timestamp, timestamp, position, page["editor_format"], page["icon"], page["cover"], page["full_width"]))
        from backend.notebook_media import authorize_document_images
        authorize_document_images(conn, new_id, user['id'], document)
        copied_revision = conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (new_id, user["id"], document.get_update(), timestamp)).lastrowid
        if page["parent_id"]:
            add_field_child_link(conn, page["parent_id"], new_id, user["id"])
        projection = conn.execute("SELECT * FROM page_projections WHERE page_id=? AND revision=?", (page_id, revision)).fetchone()
        if projection:
            conn.execute("INSERT INTO page_projections VALUES (?,?,?,?,?)", (new_id, copied_revision, projection["markdown"], projection["blocks_json"], timestamp))
        event(conn, page["project_id"], user["id"], "page.duplicated", new_id)
        return {"page": dict(conn.execute("SELECT * FROM research_pages WHERE id=?", (new_id,)).fetchone())}


@router.post("/pages/{page_id}/invites", status_code=201)
def invite_page(page_id: str, payload: InviteInput, user: dict = Depends(current_user)):
    if payload.role not in {"viewer", "commenter", "editor"}:
        raise HTTPException(422, "Choose a page permission")
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        project_detail(conn, page["project_id"], user["id"], 4)
        target = find_person(conn, payload.username, user["id"])
        if conn.execute("SELECT 1 FROM page_shares WHERE page_id = ? AND user_id = ?", (page_id, target["id"])).fetchone():
            raise HTTPException(409, "Already shared with this person")
        return {"invite": invite(conn, "page", page_id, target["id"], user["id"], payload.role)}


@router.delete("/pages/{page_id}/shares/{member_id}")
def remove_page_share(page_id: str, member_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        if member_id != user["id"]:
            project_detail(conn, page["project_id"], user["id"], 4)
        conn.execute("DELETE FROM page_shares WHERE page_id = ? AND user_id = ?", (page_id, member_id))
        conn.execute("DELETE FROM collaboration_invites WHERE kind = 'page' AND target_id = ? AND recipient_id = ?", (page_id, member_id))
    return {"status": "removed"}


@router.patch("/pages/{page_id}/shares/{member_id}")
def edit_page_share(page_id: str, member_id: str, payload: RoleInput, user: dict = Depends(current_user)):
    if payload.role not in {"viewer", "commenter", "editor"}:
        raise HTTPException(422, "Choose a page permission")
    with db() as conn:
        page = page_detail(conn, page_id, user["id"])
        project_detail(conn, page["project_id"], user["id"], 4)
        updated = conn.execute("UPDATE page_shares SET role = ? WHERE page_id = ? AND user_id = ?", (payload.role, page_id, member_id))
        if not updated.rowcount:
            raise HTTPException(404, "Direct page share not found")
    return {"status": "updated"}


@router.post("/pages/{page_id}/comments", status_code=201)
def add_comment(page_id: str, payload: CommentInput, user: dict = Depends(current_user)):
    comment_id = ident()
    with db() as conn:
        page = page_detail(conn, page_id, user["id"], 2)
        conn.execute("INSERT INTO page_comments VALUES (?,?,?,?,?)", (comment_id, page_id, user["id"], payload.body.strip(), now()))
        event(conn, page["project_id"], user["id"], "comment.created", page_id)
        comment = conn.execute("SELECT * FROM page_comments WHERE id = ?", (comment_id,)).fetchone()
        return {"comment": {**dict(comment), "author": public_user(conn, user["id"])}}


@router.delete("/comments/{comment_id}")
def remove_comment(comment_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        comment = conn.execute("SELECT * FROM page_comments WHERE id = ?", (comment_id,)).fetchone()
        if not comment:
            raise HTTPException(404, "Comment not found")
        page = page_detail(conn, comment["page_id"], user["id"])
        if comment["author_id"] != user["id"] and project_access(conn, conn.execute("SELECT * FROM research_projects WHERE id = ?", (page["project_id"],)).fetchone(), user["id"]) < 4:
            raise HTTPException(403, "Cannot remove another person's comment")
        conn.execute("DELETE FROM page_comments WHERE id = ?", (comment_id,))
    return {"status": "removed"}


@router.post("/pages/{page_id}/versions", status_code=201)
def save_version(page_id: str, payload: VersionInput, user: dict = Depends(current_user)):
    version_id = ident()
    with db() as conn:
        page = page_detail(conn, page_id, user["id"], 3)
        blocks_json = json.dumps(payload.blocks, ensure_ascii=False) if payload.blocks is not None else None
        if blocks_json and len(blocks_json.encode("utf-8")) > 500_000:
            raise HTTPException(413, "Snapshot exceeds 500 KB")
        conn.execute("INSERT INTO page_versions (id,page_id,author_id,label,markdown,created_at,blocks_json) VALUES (?,?,?,?,?,?,?)", (version_id, page_id, user["id"], payload.label.strip() or "Snapshot", payload.markdown, now(), blocks_json))
        event(conn, page["project_id"], user["id"], "version.created", page_id)
    return {"id": version_id}


@router.get("/pages/{page_id}/versions/{version_id}")
def get_version(page_id: str, version_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        page_detail(conn, page_id, user["id"])
        version = conn.execute("SELECT * FROM page_versions WHERE page_id = ? AND id = ?", (page_id, version_id)).fetchone()
        if not version:
            raise HTTPException(404, "Version not found")
        return {"version": {**dict(version), "blocks": json.loads(version["blocks_json"]) if version["blocks_json"] else None}}


@router.post("/projects/{project_id}/tasks", status_code=201)
def add_task(project_id: str, payload: TaskInput, user: dict = Depends(current_user)):
    task_id = ident()
    with db() as conn:
        project = project_detail(conn, project_id, user["id"], 3)
        assignee_row = conn.execute("SELECT id FROM users WHERE public_name_key = ? AND status = 'active'", (public_name_key(payload.assignee_username),)).fetchone() if payload.assignee_username else None
        if payload.assignee_username and not assignee_row:
            raise HTTPException(404, "Assignee username not found")
        assignee = assignee_row["id"] if assignee_row else None
        if assignee and project_access(conn, project, assignee) < 1:
            raise HTTPException(422, "Assignee must have access to the project")
        conn.execute("INSERT INTO project_tasks VALUES (?,?,?,?,?,?,?)", (task_id, project_id, payload.title.strip(), "todo", assignee, user["id"], now()))
        event(conn, project_id, user["id"], "task.created", task_id)
        if assignee:
            notify(conn, assignee, user["id"], "task.assigned", task_id, event_key=f"task.assigned:{task_id}")
        return {"task": dict(conn.execute("SELECT * FROM project_tasks WHERE id = ?", (task_id,)).fetchone())}


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, status: Literal["todo", "doing", "done"], user: dict = Depends(current_user)):
    with db() as conn:
        task = conn.execute("SELECT * FROM project_tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(404, "Task not found")
        project_detail(conn, task["project_id"], user["id"], 3)
        conn.execute("UPDATE project_tasks SET status = ? WHERE id = ?", (status, task_id))
        event(conn, task["project_id"], user["id"], "task.updated", task_id)
    return {"status": status}


@router.delete("/tasks/{task_id}")
def remove_task(task_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        task = conn.execute("SELECT * FROM project_tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(404, "Task not found")
        project_detail(conn, task["project_id"], user["id"], 3)
        conn.execute("DELETE FROM project_tasks WHERE id = ?", (task_id,))
    return {"status": "removed"}


@router.post("/projects/{project_id}/evidence", status_code=201)
def add_evidence(project_id: str, payload: EvidenceInput, user: dict = Depends(current_user)):
    if not payload.url.lower().startswith(("https://", "http://")):
        raise HTTPException(422, "Evidence URL must use http or https")
    evidence_id = ident()
    with db() as conn:
        project_detail(conn, project_id, user["id"], 3)
        conn.execute("INSERT INTO project_evidence VALUES (?,?,?,?,?,?,?,?)", (evidence_id, project_id, payload.title.strip(), payload.url.strip(), payload.doi.strip(), payload.note.strip(), user["id"], now()))
        event(conn, project_id, user["id"], "evidence.added", evidence_id)
        return {"evidence": dict(conn.execute("SELECT * FROM project_evidence WHERE id = ?", (evidence_id,)).fetchone())}


@router.delete("/evidence/{evidence_id}")
def remove_evidence(evidence_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        item = conn.execute("SELECT * FROM project_evidence WHERE id = ?", (evidence_id,)).fetchone()
        if not item:
            raise HTTPException(404, "Evidence not found")
        project_detail(conn, item["project_id"], user["id"], 3)
        conn.execute("DELETE FROM project_evidence WHERE id = ?", (evidence_id,))
    return {"status": "removed"}


@router.get("/projects/{project_id}/activity")
def project_activity(project_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        project_detail(conn, project_id, user["id"])
        rows = conn.execute("SELECT * FROM collaboration_events WHERE project_id = ? ORDER BY id DESC LIMIT 60", (project_id,)).fetchall()
        return {"events": [{**dict(row), "actor": public_user(conn, row["actor_id"])} for row in rows]}


@router.websocket("/pages/{page_id}/live")
async def live_page(websocket: WebSocket, page_id: str):
    """Durable, multi-worker Yjs relay with per-message authorization checks."""
    origin = websocket.headers.get("origin")
    allowed_origins = {item.strip().rstrip("/") for item in os.getenv("CORS_ORIGINS", os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")).split(",")}
    if (not origin and os.getenv("APP_ENV", "development").lower() == "production") or (origin and origin.rstrip("/") not in allowed_origins):
        await websocket.close(code=4403)
        return
    session_user = websocket.session.get("user") if "session" in websocket.scope else None
    user_id = str(session_user.get("id")) if isinstance(session_user, dict) and session_user.get("id") else ""
    persisted = get_user(user_id) if user_id else None
    if not persisted or persisted.get("status") != "active":
        await websocket.close(code=4401)
        return
    if not persisted.get("public_name"):
        await websocket.close(code=4403)
        return
    try:
        with db() as conn:
            page_detail(conn, page_id, user_id)
    except HTTPException:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    cursor = 0
    last_presence_check = 0.0
    last_presence_ids: tuple[str, ...] = ()
    ready_sent = False
    last_access = None
    tree_revision = None
    recent_updates: deque[float] = deque()
    try:
        while True:
            with db() as conn:
                active_user = conn.execute("SELECT status, public_name FROM users WHERE id = ?", (user_id,)).fetchone()
                if not active_user or active_user["status"] != "active" or not active_user["public_name"]:
                    await websocket.close(code=4403)
                    return
                try:
                    page = page_detail(conn, page_id, user_id)
                except HTTPException:
                    await websocket.close(code=4403)
                    return
                access = page_access(conn, page, user_id)
                rows = conn.execute("SELECT seq, update_blob FROM page_updates WHERE page_id = ? AND seq > ? ORDER BY seq LIMIT 100", (page_id, cursor)).fetchall()
                latest_tree = conn.execute("SELECT COALESCE(MAX(id),0) FROM collaboration_events WHERE project_id=? AND action IN ('page.created','page.duplicated','page.updated','page.archived','page.restored')", (page["project_id"],)).fetchone()[0]
                if asyncio.get_running_loop().time() - last_presence_check > 2:
                    active_after = (datetime.now(timezone.utc) - timedelta(seconds=25)).isoformat()
                    presence = conn.execute("SELECT user_id FROM page_presence WHERE page_id = ? AND last_seen >= ? ORDER BY user_id", (page_id, active_after)).fetchall()
                    presence_ids = tuple(item["user_id"] for item in presence)
                    last_presence_check = asyncio.get_running_loop().time()
                else:
                    presence_ids = last_presence_ids
            for row in rows:
                await websocket.send_json({"type": "update", "seq": row["seq"], "data": base64.b64encode(row["update_blob"]).decode("ascii")})
                cursor = row["seq"]
            if tree_revision is not None and tree_revision != latest_tree and ready_sent:
                await websocket.send_json({"type": "tree"})
            tree_revision = latest_tree
            if not rows and not ready_sent:
                await websocket.send_json({"type": "ready", "access": access, "revision": cursor, "format": page["editor_format"]})
                ready_sent = True
                last_access = access
            if ready_sent and access != last_access:
                await websocket.send_json({"type": "permission", "access": access})
                last_access = access
            if presence_ids != last_presence_ids:
                with db() as conn:
                    people = [public_user(conn, item) for item in presence_ids]
                await websocket.send_json({"type": "presence", "people": people})
                last_presence_ids = presence_ids
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=0.35 if not rows else 0.01)
            except asyncio.TimeoutError:
                continue
            try:
                envelope = json.loads(message)
            except json.JSONDecodeError:
                continue
            if not isinstance(envelope, dict):
                continue
            if envelope.get("type") == "presence":
                with db() as conn:
                    conn.execute("INSERT INTO page_presence VALUES (?,?,?) ON CONFLICT(page_id,user_id) DO UPDATE SET last_seen = excluded.last_seen", (page_id, user_id, now()))
                continue
            if envelope.get("type") != "update":
                continue
            if access < 3:
                await websocket.send_json({"type": "error", "message": "Editor access required"})
                continue
            if page["editor_format"] == "blocks" and envelope.get("format") != "blocks":
                await websocket.send_json({"type": "error", "message": "This page now uses blocks; reload your editor before editing"})
                continue
            sent_at = time.monotonic()
            while recent_updates and sent_at - recent_updates[0] > 5:
                recent_updates.popleft()
            if len(recent_updates) >= 60:
                await websocket.send_json({"type": "error", "message": "Too many updates; slow down briefly"})
                continue
            recent_updates.append(sent_at)
            encoded = envelope.get("data", "")
            if not isinstance(encoded, str) or len(encoded) > 700_000:
                await websocket.send_json({"type": "error", "message": "Update too large"})
                continue
            try:
                update = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                continue
            if not update:
                continue
            # Do not persist malformed bytes: one poisoned CRDT update would
            # otherwise break every future reader of this page.
            try:
                Doc().apply_update(update)
            except (ValueError, RuntimeError):
                await websocket.send_json({"type": "error", "message": "Invalid collaborative update"})
                continue
            with db() as conn:
                conn.execute("BEGIN IMMEDIATE")
                latest_page = page_detail(conn, page_id, user_id, 3)
                if latest_page["editor_format"] == "blocks" and envelope.get("format") != "blocks":
                    raise HTTPException(409, "Reload block editor")
                if latest_page["editor_format"] == "blocks":
                    document, _ = document_state(conn, page_id)
                    before = page_link_blocks(document)
                    document.apply_update(update)
                    from backend.notebook_media import authorize_document_images
                    try:
                        authorize_document_images(conn, page_id, user_id, document)
                    except HTTPException:
                        await websocket.send_json({'type': 'error', 'id': envelope.get('id'), 'message': 'Image source access required; this update was not saved'})
                        continue
                    if is_field_project(conn, latest_page['project_id']):
                        sync_field_page_links(conn, latest_page, before, document, user_id)
                saved = conn.execute("INSERT INTO page_updates (page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (page_id, user_id, update, now()))
                conn.execute("UPDATE research_pages SET updated_by = ?, updated_at = ? WHERE id = ?", (user_id, now(), page_id))
            message_id = envelope.get("id")
            if isinstance(message_id, str) and len(message_id) <= 80:
                await websocket.send_json({"type": "ack", "id": message_id, "revision": saved.lastrowid})
    except HTTPException:
        # Access may change between polling and the transactional write check.
        await websocket.close(code=4403)
    except (WebSocketDisconnect, RuntimeError):
        return
