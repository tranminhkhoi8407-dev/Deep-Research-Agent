"""Durable research conversations and meetings. Every request rechecks scope access.

Chat uses bounded HTTP polling, not a process-local socket relay. This keeps writes
idempotent across workers and never grants channel access from a page-only share.
"""
from __future__ import annotations

import ipaddress
import re
import sqlite3
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from pycrdt import Doc, Text

from backend.auth import collaboration_user as current_user
from backend.collaboration import db, event, group_detail, group_role, ident, now, page_detail, project_access, project_detail, public_user
from backend.notifications import is_blocked, notify, rate_limit

router = APIRouter(prefix="/api/discussions", tags=["research discussions"])
Scope = Literal["group", "project"]


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS discussion_messages (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            scope_kind TEXT NOT NULL CHECK(scope_kind IN ('group','project')), scope_id TEXT NOT NULL,
            author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
            parent_id TEXT REFERENCES discussion_messages(id), client_id TEXT NOT NULL,
            context_kind TEXT, context_id TEXT, version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
            pinned_at TEXT, pinned_by TEXT REFERENCES users(id),
            UNIQUE(scope_kind,scope_id,author_id,client_id)
        );
        CREATE INDEX IF NOT EXISTS idx_discussion_scope ON discussion_messages(scope_kind,scope_id,parent_id,seq);
        CREATE TABLE IF NOT EXISTS discussion_preferences (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
            last_read_seq INTEGER NOT NULL DEFAULT 0, muted INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id,scope_kind,scope_id)
        );
        CREATE TABLE IF NOT EXISTS discussion_actions (
            message_id TEXT NOT NULL REFERENCES discussion_messages(id), kind TEXT NOT NULL,
            target_id TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
            PRIMARY KEY(message_id,kind)
        );
        CREATE TABLE IF NOT EXISTS research_meetings (
            id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
            created_by TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
            starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone_label TEXT NOT NULL,
            meeting_url TEXT NOT NULL DEFAULT '', agenda TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'scheduled', version INTEGER NOT NULL DEFAULT 1,
            client_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(scope_kind,scope_id,created_by,client_id)
        );
        CREATE INDEX IF NOT EXISTS idx_meetings_scope ON research_meetings(scope_kind,scope_id,starts_at);
        CREATE TABLE IF NOT EXISTS meeting_attendees (
            meeting_id TEXT NOT NULL REFERENCES research_meetings(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            response TEXT NOT NULL CHECK(response IN ('yes','maybe','no')), updated_at TEXT NOT NULL,
            PRIMARY KEY(meeting_id,user_id)
        );
    """)


def scope_access(conn: sqlite3.Connection, kind: Scope, scope_id: str, user_id: str, minimum: int = 1):
    if kind == "group":
        row = group_detail(conn, scope_id, user_id)
        role = group_role(conn, scope_id, user_id)
        access = 4 if role in {"owner", "admin"} else 2
    else:
        row = project_detail(conn, scope_id, user_id)
        access = project_access(conn, row, user_id)
    if access < minimum:
        raise HTTPException(403, "Commenter access required" if minimum == 2 else "Editor or manager access required")
    if minimum >= 2 and kind == "project" and row["status"] == "archived":
        raise HTTPException(409, "Archived projects are read-only")
    return row, access


def participants(conn: sqlite3.Connection, kind: Scope, scope_id: str) -> list[str]:
    if kind == "group":
        candidates = [r[0] for r in conn.execute("SELECT user_id FROM group_members WHERE group_id=?", (scope_id,))]
    else:
        project = conn.execute("SELECT * FROM research_projects WHERE id=?", (scope_id,)).fetchone()
        candidates = {project["owner_id"]}
        candidates.update(r[0] for r in conn.execute("SELECT user_id FROM project_members WHERE project_id=?", (scope_id,)))
        if project["group_id"]:
            candidates.update(r[0] for r in conn.execute("SELECT user_id FROM group_members WHERE group_id=?", (project["group_id"],)))
        candidates = [uid for uid in candidates if project_access(conn, project, uid)]
    return [uid for uid in sorted(candidates) if conn.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (uid,)).fetchone()]


def context(conn: sqlite3.Connection, kind: Scope, scope_id: str, context_kind: str | None, context_id: str | None, user_id: str):
    if not context_kind and not context_id:
        return None
    if kind != "project" or not context_id or context_kind not in {"page", "evidence"}:
        raise HTTPException(422, "Only project pages or shared evidence can be attached")
    if context_kind == "page":
        row = page_detail(conn, context_id, user_id)
        if row["project_id"] != scope_id:
            raise HTTPException(422, "Page must belong to this project")
        return {"kind": "page", "id": context_id, "title": row["title"], "href": f"#/collab/page/{context_id}"}
    row = conn.execute("SELECT * FROM project_evidence WHERE id=? AND project_id=?", (context_id, scope_id)).fetchone()
    if not row:
        raise HTTPException(404, "Shared evidence not found")
    return {"kind": "evidence", "id": context_id, "title": row["title"], "href": f"#/collab/project/{scope_id}?view=evidence"}


def message_detail(conn: sqlite3.Connection, message_id: str, user_id: str, minimum: int = 1):
    row = conn.execute("SELECT * FROM discussion_messages WHERE id=?", (message_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Message not found")
    _, access = scope_access(conn, row["scope_kind"], row["scope_id"], user_id, minimum)
    return row, access


def message_payload(conn: sqlite3.Connection, row: sqlite3.Row, user_id: str) -> dict:
    hidden = bool(row["deleted_at"]) or is_blocked(conn, row["author_id"], user_id)
    attachment = None
    if not hidden:
        try:
            attachment = context(conn, row["scope_kind"], row["scope_id"], row["context_kind"], row["context_id"], user_id)
        except HTTPException:
            pass  # An archived or removed attachment cannot disclose its old title.
    return {"id": row["id"], "seq": row["seq"], "body": "" if hidden else row["body"],
            "author": None if hidden else public_user(conn, row["author_id"]), "parent_id": row["parent_id"],
            "created_at": row["created_at"], "updated_at": row["updated_at"], "version": row["version"],
            "deleted": hidden, "pinned": bool(row["pinned_at"]) and not hidden, "context": attachment,
            "reply_count": conn.execute("SELECT COUNT(*) FROM discussion_messages WHERE parent_id=? AND deleted_at IS NULL", (row["id"],)).fetchone()[0]}


def channel_href(kind: Scope, scope_id: str, view: str = "discussion") -> str:
    return f"#/collab/{kind}/{scope_id}?view={view}"


def deliver(conn, kind: Scope, scope_id: str, recipient: str, actor: str, event_kind: str, subject: str):
    preference = conn.execute("SELECT muted FROM discussion_preferences WHERE user_id=? AND scope_kind=? AND scope_id=?", (recipient, kind, scope_id)).fetchone()
    if not preference or not preference["muted"]:
        notify(conn, recipient, actor, event_kind, subject, event_key=f"{event_kind}:{subject}")


class MessageInput(BaseModel):
    body: str = Field(min_length=1, max_length=6000)
    client_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    parent_id: str | None = None
    mention_ids: list[str] = Field(default_factory=list, max_length=12)
    context_kind: Literal["page", "evidence"] | None = None
    context_id: str | None = None

    @field_validator("body")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Message cannot be empty")
        return value.strip()


class MessageEdit(BaseModel):
    body: str = Field(min_length=1, max_length=6000)
    expected_version: int = Field(ge=1)
    nonempty = field_validator("body")(MessageInput.nonempty.__func__)


class VersionInput(BaseModel):
    expected_version: int = Field(ge=1)


class PinInput(BaseModel):
    pinned: bool


class PreferenceInput(BaseModel):
    through: int | None = Field(default=None, ge=0)
    muted: bool | None = None


class ConversionInput(BaseModel):
    kind: Literal["task", "note"]
    title: str = Field(min_length=1, max_length=120)


@router.get("/spaces/{kind}/{scope_id}")
def space(kind: Scope, scope_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        row, access = scope_access(conn, kind, scope_id, user["id"])
        pref = conn.execute("SELECT * FROM discussion_preferences WHERE user_id=? AND scope_kind=? AND scope_id=?", (user["id"], kind, scope_id)).fetchone()
        read = pref["last_read_seq"] if pref else 0
        unread = conn.execute("""SELECT COUNT(*) FROM discussion_messages m WHERE scope_kind=? AND scope_id=? AND seq>? AND author_id!=? AND deleted_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=m.author_id) OR (blocked_id=? AND blocker_id=m.author_id))""", (kind, scope_id, read, user["id"], user["id"], user["id"])).fetchone()[0]
        pinned = conn.execute("SELECT * FROM discussion_messages WHERE scope_kind=? AND scope_id=? AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at DESC LIMIT 20", (kind, scope_id)).fetchall()
        writable = kind != "project" or row["status"] != "archived"
        return {"title": row["name"], "access": access, "can_write": access >= 2 and writable, "can_rsvp": writable,
                "members": [public_user(conn, uid) for uid in participants(conn, kind, scope_id) if not is_blocked(conn, uid, user["id"])],
                "muted": bool(pref and pref["muted"]), "unread_count": unread,
                "pinned": [message_payload(conn, msg, user["id"]) for msg in pinned if not is_blocked(conn, msg["author_id"], user["id"])]}


@router.get("/spaces/{kind}/{scope_id}/messages")
def messages(kind: Scope, scope_id: str, parent_id: str | None = None, before: int | None = Query(default=None, ge=1),
             q: str = Query(default="", max_length=120), include: str = Query(default="", max_length=6600),
             limit: int = Query(default=40, ge=1, le=100), user: dict = Depends(current_user)):
    with db() as conn:
        scope_access(conn, kind, scope_id, user["id"])
        if parent_id:
            root, _ = message_detail(conn, parent_id, user["id"])
            if root["scope_kind"] != kind or root["scope_id"] != scope_id or root["parent_id"]:
                raise HTTPException(422, "Thread must belong to this channel")
        clauses, args = ["scope_kind=?", "scope_id=?"], [kind, scope_id]
        if q.strip():
            conn.create_function("casefold", 1, lambda value: value.casefold())
            clauses.append("deleted_at IS NULL AND instr(casefold(body),casefold(?))>0 AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=m.author_id) OR (blocked_id=? AND blocker_id=m.author_id))")
            args.extend([q.strip(), user["id"], user["id"]])
            if parent_id:
                clauses.append("parent_id=?"); args.append(parent_id)
        else:
            clauses.append("parent_id IS ?"); args.append(parent_id)
        if before:
            clauses.append("seq<?"); args.append(before)
        rows = conn.execute(f"SELECT * FROM discussion_messages m WHERE {' AND '.join(clauses)} ORDER BY seq DESC LIMIT ?", (*args, limit + 1)).fetchall()
        cached_ids = sorted(set(include.split(","))) if include else []
        if len(cached_ids) > 200 or any(not re.fullmatch(r"[a-f0-9]{32}", mid) for mid in cached_ids):
            raise HTTPException(422, "Choose up to 200 valid message IDs")
        # Revalidate already-loaded history as well as the newest page. Otherwise
        # old deleted/blocked bodies could linger in a polling client's cache.
        refreshed = []
        if cached_ids:
            cached = conn.execute(f"SELECT * FROM discussion_messages WHERE scope_kind=? AND scope_id=? AND id IN ({','.join('?' for _ in cached_ids)})", (kind, scope_id, *cached_ids)).fetchall()
            refreshed = [message_payload(conn, row, user["id"]) for row in cached]
            if q.strip():
                refreshed = [msg for msg in refreshed if not msg["deleted"] and q.strip().casefold() in msg["body"].casefold()]
        through = conn.execute("SELECT COALESCE(MAX(seq),0) FROM discussion_messages WHERE scope_kind=? AND scope_id=?", (kind, scope_id)).fetchone()[0]
        return {"messages": [message_payload(conn, row, user["id"]) for row in reversed(rows[:limit])],
                "refreshed": refreshed, "next_cursor": rows[limit - 1]["seq"] if len(rows) > limit else None, "through": through}


@router.post("/spaces/{kind}/{scope_id}/messages", status_code=201)
def send(kind: Scope, scope_id: str, payload: MessageInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        scope_access(conn, kind, scope_id, user["id"], 2)
        existing = conn.execute("SELECT * FROM discussion_messages WHERE scope_kind=? AND scope_id=? AND author_id=? AND client_id=?", (kind, scope_id, user["id"], payload.client_id)).fetchone()
        if existing:
            if existing["body"] != payload.body or existing["parent_id"] != payload.parent_id or existing["context_kind"] != payload.context_kind or existing["context_id"] != payload.context_id:
                raise HTTPException(409, "This request ID was already used for different content")
            return {"message": message_payload(conn, existing, user["id"])}
        parent = None
        if payload.parent_id:
            parent, _ = message_detail(conn, payload.parent_id, user["id"])
            if parent["parent_id"] or parent["scope_kind"] != kind or parent["scope_id"] != scope_id or parent["deleted_at"] or is_blocked(conn, parent["author_id"], user["id"]):
                raise HTTPException(422, "Choose an available root message in this channel")
        context(conn, kind, scope_id, payload.context_kind, payload.context_id, user["id"])
        people = set(participants(conn, kind, scope_id))
        mentions = set(payload.mention_ids)
        if not mentions.issubset(people) or any(is_blocked(conn, uid, user["id"]) for uid in mentions):
            raise HTTPException(422, "Mentions must be accessible channel members")
        rate_limit(conn, user["id"], "chat.send")
        message_id, timestamp = ident(), now()
        conn.execute("""INSERT INTO discussion_messages(id,scope_kind,scope_id,author_id,body,parent_id,client_id,context_kind,context_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (message_id, kind, scope_id, user["id"], payload.body, payload.parent_id, payload.client_id, payload.context_kind, payload.context_id, timestamp, timestamp))
        for recipient in mentions:
            deliver(conn, kind, scope_id, recipient, user["id"], "chat.mention", message_id)
        if parent and parent["author_id"] in people and parent["author_id"] not in mentions:
            deliver(conn, kind, scope_id, parent["author_id"], user["id"], "chat.reply", message_id)
        return {"message": message_payload(conn, conn.execute("SELECT * FROM discussion_messages WHERE id=?", (message_id,)).fetchone(), user["id"])}


@router.patch("/messages/{message_id}")
def edit_message(message_id: str, payload: MessageEdit, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row, _ = message_detail(conn, message_id, user["id"], 2)
        if row["author_id"] != user["id"] or row["deleted_at"]:
            raise HTTPException(403, "Only the author can edit an available message")
        if row["version"] != payload.expected_version:
            raise HTTPException(409, "Message changed; refresh before editing")
        rate_limit(conn, user["id"], "chat.edit")
        conn.execute("UPDATE discussion_messages SET body=?,version=version+1,updated_at=? WHERE id=?", (payload.body, now(), message_id))
        return {"message": message_payload(conn, conn.execute("SELECT * FROM discussion_messages WHERE id=?", (message_id,)).fetchone(), user["id"])}


@router.get("/messages/{message_id}")
def read_message(message_id: str, user: dict = Depends(current_user)):
    with db() as conn:
        row, _ = message_detail(conn, message_id, user["id"])
        return {"message": message_payload(conn, row, user["id"])}


@router.delete("/messages/{message_id}")
def delete_message(message_id: str, payload: VersionInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row, access = message_detail(conn, message_id, user["id"], 2)
        if row["author_id"] != user["id"] and access < 4:
            raise HTTPException(403, "Only the author or manager can remove a message")
        if row["version"] != payload.expected_version:
            raise HTTPException(409, "Message changed; refresh before deleting")
        rate_limit(conn, user["id"], "chat.delete")
        conn.execute("UPDATE discussion_messages SET body='',deleted_at=?,updated_at=?,version=version+1,pinned_at=NULL,pinned_by=NULL WHERE id=?", (now(), now(), message_id))
    return {"status": "deleted"}


@router.put("/messages/{message_id}/pin")
def pin_message(message_id: str, payload: PinInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row, _ = message_detail(conn, message_id, user["id"], 3)
        if row["deleted_at"] or is_blocked(conn, row["author_id"], user["id"]):
            raise HTTPException(404, "Message unavailable")
        rate_limit(conn, user["id"], "chat.pin")
        if payload.pinned and not row["pinned_at"] and conn.execute("SELECT COUNT(*) FROM discussion_messages WHERE scope_kind=? AND scope_id=? AND pinned_at IS NOT NULL", (row["scope_kind"], row["scope_id"])).fetchone()[0] >= 20:
            raise HTTPException(409, "Unpin another message first (maximum 20)")
        conn.execute("UPDATE discussion_messages SET pinned_at=?,pinned_by=? WHERE id=?", (now() if payload.pinned else None, user["id"] if payload.pinned else None, message_id))
    return {"status": "pinned" if payload.pinned else "unpinned"}


@router.put("/spaces/{kind}/{scope_id}/preferences")
def preferences(kind: Scope, scope_id: str, payload: PreferenceInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        scope_access(conn, kind, scope_id, user["id"])
        latest = conn.execute("SELECT COALESCE(MAX(seq),0) FROM discussion_messages WHERE scope_kind=? AND scope_id=?", (kind, scope_id)).fetchone()[0]
        if payload.through is not None and payload.through > latest:
            raise HTTPException(422, "Read cursor cannot exceed this channel's history")
        conn.execute("INSERT OR IGNORE INTO discussion_preferences(user_id,scope_kind,scope_id) VALUES (?,?,?)", (user["id"], kind, scope_id))
        if payload.through is not None:
            conn.execute("UPDATE discussion_preferences SET last_read_seq=MAX(last_read_seq,?) WHERE user_id=? AND scope_kind=? AND scope_id=?", (payload.through, user["id"], kind, scope_id))
        if payload.muted is not None:
            conn.execute("UPDATE discussion_preferences SET muted=? WHERE user_id=? AND scope_kind=? AND scope_id=?", (int(payload.muted), user["id"], kind, scope_id))
    return {"status": "saved"}


@router.post("/messages/{message_id}/convert")
def convert(message_id: str, payload: ConversionInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        msg, _ = message_detail(conn, message_id, user["id"], 3)
        if msg["scope_kind"] != "project" or msg["deleted_at"] or is_blocked(conn, msg["author_id"], user["id"]):
            raise HTTPException(422, "Only available project messages can become tasks or notes")
        if not payload.title.strip():
            raise HTTPException(422, "A title is required")
        previous = conn.execute("SELECT target_id FROM discussion_actions WHERE message_id=? AND kind=?", (message_id, payload.kind)).fetchone()
        target_id, timestamp = previous[0] if previous else ident(), now()
        if previous and payload.kind == "note":
            try:
                page_detail(conn, target_id, user["id"])
            except HTTPException:
                raise HTTPException(409, "The converted note is unavailable; restore it instead of duplicating it") from None
        if previous and payload.kind == "task" and not conn.execute("SELECT 1 FROM project_tasks WHERE id=? AND project_id=?", (target_id, msg["scope_id"])).fetchone():
            raise HTTPException(409, "The converted task was removed; create a new task explicitly")
        if not previous:
            rate_limit(conn, user["id"], "chat.convert")
            if payload.kind == "task":
                conn.execute("INSERT INTO project_tasks(id,project_id,title,created_by,created_at) VALUES (?,?,?,?,?)", (target_id, msg["scope_id"], payload.title.strip(), user["id"], timestamp))
                event(conn, msg["scope_id"], user["id"], "task.created", target_id, {"message_id": message_id})
            else:
                position = conn.execute("SELECT COALESCE(MAX(position),-1)+1 FROM research_pages WHERE project_id=? AND parent_id IS NULL", (msg["scope_id"],)).fetchone()[0]
                conn.execute("INSERT INTO research_pages(id,project_id,title,created_by,updated_by,created_at,updated_at,position) VALUES (?,?,?,?,?,?,?,?)", (target_id, msg["scope_id"], payload.title.strip(), user["id"], user["id"], timestamp, timestamp, position))
                author = public_user(conn, msg["author_id"])["display_name"]
                # Blockquotes preserve literal chat content as a quotation, not instructions.
                body = f"# {payload.title.strip()}\n\nFrom project discussion · {author} · {msg['created_at']}\n\n" + "\n".join("> " + line for line in msg["body"].splitlines())
                document = Doc(); document["markdown"] = Text(body)
                conn.execute("INSERT INTO page_updates(page_id,author_id,update_blob,created_at) VALUES (?,?,?,?)", (target_id, user["id"], document.get_update(), timestamp))
                event(conn, msg["scope_id"], user["id"], "page.created", target_id, {"message_id": message_id})
            conn.execute("INSERT INTO discussion_actions VALUES (?,?,?,?,?)", (message_id, payload.kind, target_id, user["id"], timestamp))
            conn.execute("UPDATE research_projects SET updated_at=? WHERE id=?", (timestamp, msg["scope_id"]))
        return {"id": target_id, "kind": payload.kind, "existing": bool(previous), "href": f"#/collab/page/{target_id}" if payload.kind == "note" else f"#/collab/project/{msg['scope_id']}?view=tasks"}


class MeetingInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    starts_at: datetime
    ends_at: datetime
    timezone_label: str = Field(default="UTC", min_length=1, max_length=80)
    meeting_url: str = Field(default="", max_length=1500)
    agenda: str = Field(default="", max_length=4000)
    notes: str = Field(default="", max_length=12000)
    client_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")

    @field_validator("title")
    @classmethod
    def title_required(cls, value):
        if not value.strip():
            raise ValueError("Meeting title is required")
        return value.strip()

    @field_validator("meeting_url")
    @classmethod
    def safe_link(cls, value):
        value = value.strip()
        if not value:
            return value
        try:
            parsed = urlsplit(value)
            host = (parsed.hostname or "").rstrip(".")
            if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port not in {None, 443} or host == "localhost" or host.endswith((".localhost", ".local")) or any(ch.isspace() for ch in value) or "\\" in value:
                raise ValueError("Use a public HTTPS meeting link without credentials")
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?", host) or "." not in host or host.replace(".", "").isdigit():
                    raise ValueError("Invalid public hostname") from None
            else:
                if not address.is_global:
                    raise ValueError("Local meeting URLs are not allowed")
        except ValueError:
            raise ValueError("Use a valid public HTTPS meeting link") from None
        return value

    @model_validator(mode="after")
    def valid_time(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("Meeting times must include a timezone offset")
        duration = (self.ends_at - self.starts_at).total_seconds()
        if duration <= 0 or duration > 8 * 3600:
            raise ValueError("Meeting duration must be between 1 second and 8 hours")
        return self


class MeetingEdit(MeetingInput):
    expected_version: int = Field(ge=1)
    status: Literal["scheduled", "cancelled"] = "scheduled"


class RSVP(BaseModel):
    response: Literal["yes", "maybe", "no"]


def meeting_detail(conn, meeting_id: str, user_id: str, minimum=1):
    row = conn.execute("SELECT * FROM research_meetings WHERE id=?", (meeting_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Meeting not found")
    _, access = scope_access(conn, row["scope_kind"], row["scope_id"], user_id, minimum)
    return row, access


def meeting_payload(conn, row, user_id):
    result = dict(row)
    allowed = set(participants(conn, row["scope_kind"], row["scope_id"]))
    result["organizer"] = public_user(conn, row["created_by"])
    result["attendees"] = [{"person": public_user(conn, r["user_id"]), "response": r["response"]} for r in conn.execute("SELECT * FROM meeting_attendees WHERE meeting_id=?", (row["id"],)) if r["user_id"] in allowed and not is_blocked(conn, r["user_id"], user_id)]
    result["my_response"] = next((a["response"] for a in result["attendees"] if a["person"]["id"] == user_id), None)
    return result


@router.get("/spaces/{kind}/{scope_id}/meetings")
def meetings(kind: Scope, scope_id: str, before: str | None = None, user: dict = Depends(current_user)):
    with db() as conn:
        scope_access(conn, kind, scope_id, user["id"])
        # Stable creation cursor, independent of schedule edits. IDs are random.
        cursor = conn.execute("SELECT created_at,id FROM research_meetings WHERE id=? AND scope_kind=? AND scope_id=?", (before, kind, scope_id)).fetchone() if before else None
        if before and not cursor:
            raise HTTPException(422, "Invalid meeting cursor")
        rows = conn.execute("SELECT * FROM research_meetings WHERE scope_kind=? AND scope_id=? AND (? IS NULL OR (created_at,id)<(?,?)) ORDER BY created_at DESC,id DESC LIMIT 31", (kind, scope_id, before, cursor["created_at"] if cursor else None, before)).fetchall()
        return {"meetings": [meeting_payload(conn, r, user["id"]) for r in rows[:30]], "next_cursor": rows[29]["id"] if len(rows) > 30 else None}


@router.post("/spaces/{kind}/{scope_id}/meetings", status_code=201)
def schedule(kind: Scope, scope_id: str, payload: MeetingInput, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        scope_access(conn, kind, scope_id, user["id"], 2)
        existing = conn.execute("SELECT * FROM research_meetings WHERE scope_kind=? AND scope_id=? AND created_by=? AND client_id=?", (kind, scope_id, user["id"], payload.client_id)).fetchone()
        if existing:
            original = (existing["title"], existing["starts_at"], existing["ends_at"], existing["timezone_label"], existing["meeting_url"], existing["agenda"], existing["notes"])
            proposed = (payload.title, payload.starts_at.astimezone(timezone.utc).isoformat(), payload.ends_at.astimezone(timezone.utc).isoformat(), payload.timezone_label, payload.meeting_url, payload.agenda, payload.notes)
            if original != proposed:
                raise HTTPException(409, "This request ID was already used for a different meeting")
            return {"meeting": meeting_payload(conn, existing, user["id"])}
        rate_limit(conn, user["id"], "meeting.create")
        meeting_id, timestamp = ident(), now()
        conn.execute("""INSERT INTO research_meetings(id,scope_kind,scope_id,created_by,title,starts_at,ends_at,timezone_label,meeting_url,agenda,notes,client_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (meeting_id, kind, scope_id, user["id"], payload.title, payload.starts_at.astimezone(timezone.utc).isoformat(), payload.ends_at.astimezone(timezone.utc).isoformat(), payload.timezone_label, payload.meeting_url, payload.agenda, payload.notes, payload.client_id, timestamp, timestamp))
        conn.execute("INSERT INTO meeting_attendees VALUES (?,?,?,?)", (meeting_id, user["id"], "yes", timestamp))
        for recipient in participants(conn, kind, scope_id):
            deliver(conn, kind, scope_id, recipient, user["id"], "meeting.scheduled", meeting_id)
        return {"meeting": meeting_payload(conn, conn.execute("SELECT * FROM research_meetings WHERE id=?", (meeting_id,)).fetchone(), user["id"])}


@router.patch("/meetings/{meeting_id}")
def update_meeting(meeting_id: str, payload: MeetingEdit, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row, access = meeting_detail(conn, meeting_id, user["id"], 2)
        if row["created_by"] != user["id"] and access < 4:
            raise HTTPException(403, "Only the organizer or manager can edit a meeting")
        if row["version"] != payload.expected_version:
            raise HTTPException(409, "Meeting changed; refresh before saving")
        rate_limit(conn, user["id"], "meeting.edit")
        conn.execute("UPDATE research_meetings SET title=?,starts_at=?,ends_at=?,timezone_label=?,meeting_url=?,agenda=?,notes=?,status=?,updated_at=?,version=version+1 WHERE id=?", (payload.title, payload.starts_at.astimezone(timezone.utc).isoformat(), payload.ends_at.astimezone(timezone.utc).isoformat(), payload.timezone_label, payload.meeting_url, payload.agenda, payload.notes, payload.status, now(), meeting_id))
        for recipient in participants(conn, row["scope_kind"], row["scope_id"]):
            # Version-scoped occurrence: subsequent edits must not collide with scheduling.
            pref = conn.execute("SELECT muted FROM discussion_preferences WHERE user_id=? AND scope_kind=? AND scope_id=?", (recipient, row["scope_kind"], row["scope_id"])).fetchone()
            if not pref or not pref["muted"]:
                notify(conn, recipient, user["id"], "meeting.updated", meeting_id, event_key=f"meeting.updated:{meeting_id}:{row['version'] + 1}")
        return {"meeting": meeting_payload(conn, conn.execute("SELECT * FROM research_meetings WHERE id=?", (meeting_id,)).fetchone(), user["id"])}


@router.put("/meetings/{meeting_id}/rsvp")
def rsvp(meeting_id: str, payload: RSVP, user: dict = Depends(current_user)):
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row, _ = meeting_detail(conn, meeting_id, user["id"])
        scope_row, _ = scope_access(conn, row["scope_kind"], row["scope_id"], user["id"])
        if row["scope_kind"] == "project" and scope_row["status"] == "archived":
            raise HTTPException(409, "Archived projects are read-only")
        if row["status"] != "scheduled":
            raise HTTPException(409, "This meeting has been cancelled")
        rate_limit(conn, user["id"], "meeting.rsvp")
        conn.execute("INSERT INTO meeting_attendees VALUES (?,?,?,?) ON CONFLICT(meeting_id,user_id) DO UPDATE SET response=excluded.response,updated_at=excluded.updated_at", (meeting_id, user["id"], payload.response, now()))
    return {"status": "saved"}
