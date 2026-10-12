"""Recipient-scoped in-app notifications and independently owned user blocks.

Producers use the caller's transaction: an invitation and its notification are
committed together. Delivery is the persisted inbox, not a best-effort socket.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.auth import current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
CATEGORIES = {"friends", "collaboration", "tasks"}


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS user_blocks (
            blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL, PRIMARY KEY(blocker_id, blocked_id),
            CHECK(blocker_id != blocked_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_blocks_target ON user_blocks(blocked_id);
        CREATE TABLE IF NOT EXISTS notifications (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            event_key TEXT NOT NULL, kind TEXT NOT NULL, category TEXT NOT NULL,
            subject_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL, read_at TEXT, archived_at TEXT,
            UNIQUE(recipient_id, event_key)
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(recipient_id, archived_at, seq);
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_id, read_at, archived_at);
        CREATE TABLE IF NOT EXISTS notification_preferences (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY(user_id, category)
        );
        CREATE TABLE IF NOT EXISTS social_action_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_social_action_rate ON social_action_log(actor_id, action, created_at);
        CREATE TABLE IF NOT EXISTS social_migrations (name TEXT PRIMARY KEY);
    """)
    if not conn.execute("SELECT 1 FROM social_migrations WHERE name='inbox-v1'").fetchone():
        # Preserve legacy ownership once. Never re-import a block after unblocking.
        conn.execute("""INSERT OR IGNORE INTO user_blocks
            SELECT blocked_by, CASE WHEN requester_id=blocked_by THEN target_id ELSE requester_id END, updated_at
            FROM connections WHERE status='blocked' AND blocked_by IN (requester_id,target_id)""")
        conn.execute("UPDATE connections SET status='declined', blocked_by=NULL WHERE status='blocked'")
        conn.execute("UPDATE connections SET created_at=updated_at WHERE status='pending'")
        conn.execute("""UPDATE collaboration_invites SET status='declined', responded_at=? WHERE status='pending'
            AND EXISTS (SELECT 1 FROM user_blocks WHERE (blocker_id=sender_id AND blocked_id=recipient_id)
                         OR (blocker_id=recipient_id AND blocked_id=sender_id))""", (timestamp(),))
        for row in conn.execute("SELECT * FROM connections WHERE status='pending'").fetchall():
            notify(conn, row["target_id"], row["requester_id"], "friend.request", row["id"],
                   event_key=f"friend.request:{row['id']}:{row['updated_at']}", created_at=row["updated_at"])
        for row in conn.execute("SELECT * FROM collaboration_invites WHERE status='pending'").fetchall():
            notify(conn, row["recipient_id"], row["sender_id"], "invite.received", row["id"],
                   {"kind": row["kind"], "role": row["role"]},
                   event_key=f"invite.received:{row['id']}:{row['created_at']}", created_at=row["created_at"])
        conn.execute("INSERT INTO social_migrations VALUES ('inbox-v1')")


def is_blocked(conn: sqlite3.Connection, a: str, b: str) -> bool:
    return bool(conn.execute("""SELECT 1 FROM user_blocks
        WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)""", (a, b, b, a)).fetchone())


def notify(conn: sqlite3.Connection, recipient: str, actor: str | None, kind: str,
           subject: str, metadata: dict | None = None, *, event_key: str, created_at: str | None = None) -> None:
    if actor == recipient or (actor and is_blocked(conn, actor, recipient)):
        return
    category = "friends" if kind.startswith("friend.") else "tasks" if kind.startswith("task.") else "collaboration"
    pref = conn.execute("SELECT enabled FROM notification_preferences WHERE user_id=? AND category=?", (recipient, category)).fetchone()
    if pref and not pref["enabled"]:
        return
    conn.execute("""INSERT OR IGNORE INTO notifications
        (recipient_id,actor_id,event_key,kind,category,subject_id,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)""", (recipient, actor, event_key, kind, category, subject,
                                     json.dumps(metadata or {}, ensure_ascii=False), created_at or timestamp()))


def rate_limit(conn: sqlite3.Connection, actor: str, action: str, target: str | None = None) -> None:
    current = datetime.now(timezone.utc)
    conn.execute("DELETE FROM social_action_log WHERE created_at < ?", ((current - timedelta(days=8)).isoformat(),))
    minute = (current - timedelta(minutes=1)).isoformat()
    count = conn.execute("SELECT COUNT(*) FROM social_action_log WHERE actor_id=? AND action=? AND created_at>=?",
                         (actor, action, minute)).fetchone()[0]
    if count >= (60 if action == "search" else 10):
        raise HTTPException(429, "Too many requests; please wait before trying again")
    if action == "friend.request":
        day = (current - timedelta(days=1)).isoformat()
        if conn.execute("SELECT COUNT(*) FROM social_action_log WHERE actor_id=? AND action=? AND created_at>=?", (actor, action, day)).fetchone()[0] >= 30:
            raise HTTPException(429, "Daily connection request limit reached")
        last = conn.execute("SELECT created_at FROM social_action_log WHERE actor_id=? AND target_id=? AND action=? ORDER BY id DESC LIMIT 1", (actor, target, action)).fetchone()
        if last and last["created_at"] > (current - timedelta(minutes=10)).isoformat():
            raise HTTPException(429, "Please wait before sending another request to this person")
    if action == "invite" and conn.execute("SELECT COUNT(*) FROM social_action_log WHERE actor_id=? AND action=? AND created_at>=?", (actor, action, (current - timedelta(days=1)).isoformat())).fetchone()[0] >= 100:
        raise HTTPException(429, "Daily invitation limit reached")
    conn.execute("INSERT INTO social_action_log(actor_id,target_id,action,created_at) VALUES (?,?,?,?)", (actor, target, action, current.isoformat()))


def block_user(conn: sqlite3.Connection, actor: str, target: str) -> None:
    if actor == target:
        raise HTTPException(400, "You cannot block yourself")
    if not conn.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (target,)).fetchone():
        raise HTTPException(404, "Account unavailable")
    conn.execute("INSERT OR IGNORE INTO user_blocks VALUES (?,?,?)", (actor, target, timestamp()))
    # Remove the social relationship only. Explicit group/project/page grants stay.
    conn.execute("UPDATE connections SET status='declined', blocked_by=NULL, updated_at=? WHERE (requester_id=? AND target_id=?) OR (requester_id=? AND target_id=?)",
                 (timestamp(), actor, target, target, actor))
    conn.execute("UPDATE collaboration_invites SET status='declined', responded_at=? WHERE status='pending' AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))",
                 (timestamp(), actor, target, target, actor))
    conn.execute("UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE (recipient_id=? AND actor_id=?) OR (recipient_id=? AND actor_id=?)",
                 (timestamp(), actor, target, target, actor))


def serialize(conn: sqlite3.Connection, row: sqlite3.Row, user_id: str) -> dict:
    # Resolve current state and permission, never trust titles/URLs saved at send time.
    from backend.collaboration import public_user, invitation_authorized, project_detail, page_detail
    result = {"id": row["seq"], "kind": row["kind"], "category": row["category"],
              "created_at": row["created_at"], "read_at": row["read_at"], "state": "unavailable",
              "actor": None, "title": "", "role": None, "target_kind": None, "href": None, "action_id": None}
    actor = row["actor_id"]
    if actor and not conn.execute("SELECT 1 FROM users WHERE id=? AND status='active'", (actor,)).fetchone():
        return result
    if actor and is_blocked(conn, actor, user_id):
        return result
    result["actor"] = public_user(conn, actor) if actor else None
    if row["kind"].startswith("friend."):
        relationship = conn.execute("SELECT * FROM connections WHERE id=? AND (requester_id=? OR target_id=?)", (row["subject_id"], user_id, user_id)).fetchone()
        if relationship and row["kind"] == "friend.request" and relationship["target_id"] == user_id and relationship["requester_id"] == actor:
            result["state"] = relationship["status"]
            # An older occurrence must not offer an action for a newly resent request.
            if relationship["status"] == "pending" and relationship["created_at"] == row["created_at"]:
                result["action_id"] = relationship["id"]
            elif relationship["status"] == "pending":
                result["state"] = "expired"
        elif relationship and relationship["status"] == "accepted":
            result["state"] = "accepted"
        if result["state"] == "accepted":
            result["href"] = "#/collab/people"
    elif row["kind"].startswith("invite."):
        invitation = conn.execute("SELECT * FROM collaboration_invites WHERE id=? AND (recipient_id=? OR sender_id=?)", (row["subject_id"], user_id, user_id)).fetchone()
        if not invitation:
            return result
        result["state"] = invitation["status"]
        kind, target_id = invitation["kind"], invitation["target_id"]
        try:
            if row["kind"] == "invite.received" and invitation["recipient_id"] == user_id and invitation["status"] == "pending":
                # The sender's authority and this notification's occurrence must still match.
                if not invitation_authorized(conn, invitation) or invitation["created_at"] != row["created_at"]:
                    result["state"] = "expired"
                    return result
                table, column = {"group": ("research_groups", "name"), "project": ("research_projects", "name"), "page": ("research_pages", "title")}[kind]
                target = conn.execute(f"SELECT {column} title FROM {table} WHERE id=?", (target_id,)).fetchone()
                if not target:
                    return result
                result["title"], result["action_id"] = target["title"], invitation["id"]
            else:
                if kind == "page":
                    target = page_detail(conn, target_id, user_id)
                    result["title"] = target["title"]
                elif kind == "project":
                    target = project_detail(conn, target_id, user_id)
                    result["title"] = target["name"]
                else:
                    from backend.collaboration import group_detail
                    target = group_detail(conn, target_id, user_id)
                    result["title"] = target["name"]
                if invitation["status"] == "accepted":
                    result["href"] = f"#/collab/{kind}/{target_id}"
            result["role"], result["target_kind"] = invitation["role"], kind
        except HTTPException:
            result.update(state="unavailable", title="", href=None, action_id=None)
    elif row["kind"] == "task.assigned":
        task = conn.execute("SELECT * FROM project_tasks WHERE id=? AND assignee_id=?", (row["subject_id"], user_id)).fetchone()
        if task:
            try:
                project_detail(conn, task["project_id"], user_id)
                result.update(state="available", title=task["title"], href=f"#/collab/project/{task['project_id']}")
            except HTTPException:
                pass
    return result


class NotificationChange(BaseModel):
    action: Literal["read", "unread", "archive"]


class ReadAll(BaseModel):
    through: int = Field(ge=0)


class Preferences(BaseModel):
    friends: bool = True
    collaboration: bool = True
    tasks: bool = True


class Respond(BaseModel):
    action: Literal["accept", "decline"]


@router.get("")
def inbox(before: int | None = Query(default=None, ge=1), unread: bool = False,
          category: Literal["friends", "collaboration", "tasks"] | None = None,
          limit: int = Query(default=30, ge=1, le=100), user: dict = Depends(current_user)):
    from backend.collaboration import db
    with db() as conn:
        clauses, params = ["recipient_id=?", "archived_at IS NULL"], [user["id"]]
        if before is not None:
            clauses.append("seq<?"); params.append(before)
        if unread:
            clauses.append("read_at IS NULL")
        if category:
            clauses.append("category=?"); params.append(category)
        rows = conn.execute(f"SELECT * FROM notifications WHERE {' AND '.join(clauses)} ORDER BY seq DESC LIMIT ?", (*params, limit + 1)).fetchall()
        count = conn.execute("SELECT COUNT(*) FROM notifications WHERE recipient_id=? AND read_at IS NULL AND archived_at IS NULL", (user["id"],)).fetchone()[0]
        cutoff = conn.execute("SELECT COALESCE(MAX(seq),0) FROM notifications WHERE recipient_id=?", (user["id"],)).fetchone()[0]
        return {"notifications": [serialize(conn, row, user["id"]) for row in rows[:limit]],
                "unread_count": count, "through": cutoff, "next_cursor": rows[limit - 1]["seq"] if len(rows) > limit else None}


@router.get("/count")
def unread_count(user: dict = Depends(current_user)):
    from backend.collaboration import db
    with db() as conn:
        return {"unread_count": conn.execute("SELECT COUNT(*) FROM notifications WHERE recipient_id=? AND read_at IS NULL AND archived_at IS NULL", (user["id"],)).fetchone()[0]}


@router.post("/read-all")
def mark_all_read(payload: ReadAll, user: dict = Depends(current_user)):
    from backend.collaboration import db
    with db() as conn:
        conn.execute("UPDATE notifications SET read_at=? WHERE recipient_id=? AND seq<=? AND read_at IS NULL AND archived_at IS NULL", (timestamp(), user["id"], payload.through))
    return {"status": "read"}


@router.get("/preferences")
def get_preferences(user: dict = Depends(current_user)):
    from backend.collaboration import db
    with db() as conn:
        saved = {row["category"]: bool(row["enabled"]) for row in conn.execute("SELECT * FROM notification_preferences WHERE user_id=?", (user["id"],))}
        return {category: saved.get(category, True) for category in sorted(CATEGORIES)}


@router.put("/preferences")
def save_preferences(payload: Preferences, user: dict = Depends(current_user)):
    from backend.collaboration import db
    with db() as conn:
        for category, enabled in payload.model_dump().items():
            conn.execute("INSERT INTO notification_preferences VALUES (?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET enabled=excluded.enabled", (user["id"], category, int(enabled)))
    return payload.model_dump()


@router.patch("/{notification_id}")
def change_notification(notification_id: int, payload: NotificationChange, user: dict = Depends(current_user)):
    from backend.collaboration import db
    with db() as conn:
        row = conn.execute("SELECT seq FROM notifications WHERE seq=? AND recipient_id=? AND archived_at IS NULL", (notification_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Notification not found")
        if payload.action == "archive":
            conn.execute("UPDATE notifications SET archived_at=?, read_at=COALESCE(read_at,?) WHERE seq=?", (timestamp(), timestamp(), notification_id))
        else:
            conn.execute("UPDATE notifications SET read_at=? WHERE seq=?", (timestamp() if payload.action == "read" else None, notification_id))
    return {"status": payload.action}


@router.post("/{notification_id}/respond")
def respond_notification(notification_id: int, payload: Respond, user: dict = Depends(current_user)):
    from backend.collaboration import db, respond_connection, respond_invite
    with db() as conn:
        row = conn.execute("SELECT * FROM notifications WHERE seq=? AND recipient_id=? AND archived_at IS NULL", (notification_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Notification not found")
        current = serialize(conn, row, user["id"])
        if current["state"] != "pending" or not current["action_id"]:
            raise HTTPException(409, "This invitation is no longer actionable; refresh your inbox")
        kind, subject_id, sent_at = row["kind"], row["subject_id"], row["created_at"]
    # The producer endpoint rechecks the occurrence under its write transaction;
    # a cancel/resend between the two reads cannot accept a different invitation.
    if kind == "friend.request":
        return respond_connection(subject_id, payload.action, user, expected_created_at=sent_at)
    if kind == "invite.received":
        return respond_invite(subject_id, payload.action, user, expected_created_at=sent_at)
    raise HTTPException(409, "This notification has no invitation action")
