"""Explicit permanent deletion, restricted to one inactive owned conversation."""
import json
import os
import re
import shutil
import stat
import time

from fastapi import HTTPException
from backend.research_chat_store import db, conversation
from backend import opencode_direct as direct, opencode_runtime as oc


def purge_profile(row):
    target = direct.owned_folder(row)
    base = direct.ROOT / 'data/opencode-direct/conversations'
    # Validate both the lexical owner path and all resolved parents BEFORE any
    # recursive deletion. Reject junctions/symlinks, including inside a profile.
    if target.parent.parent != base or not re.fullmatch('[a-f0-9]{32}', target.parent.name):
        raise HTTPException(409, 'conversation_cleanup_failed')
    for path in (direct.ROOT, direct.ROOT / 'data', base.parent, base, target.parent, target):
        if path.exists() or path.is_symlink():
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
                raise HTTPException(409, 'conversation_cleanup_failed')
    resolved = target.resolve()
    if resolved.parent.parent != base.resolve() or resolved == base.resolve():
        raise HTTPException(409, 'conversation_cleanup_failed')
    if not target.exists():
        return
    if not target.is_dir():
        raise HTTPException(409, 'conversation_cleanup_failed')
    for parent, directories, files in os.walk(target, followlinks=False):
        for name in directories + files:
            info = (target.__class__(parent) / name).lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
                raise HTTPException(409, 'conversation_cleanup_failed')
    shutil.rmtree(resolved)


def delete_owned_chat(owner, cid):
    # A write transaction prevents a racing Send from starting after the busy
    # check. Native workers must have fully exited, not merely stopped replying.
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conversation(conn, owner, cid)
        if not row:
            raise HTTPException(404, 'Conversation not found')
        if conn.execute("SELECT 1 FROM research_chat_jobs WHERE conversation_id=? AND status IN ('queued','running','awaiting_input')", (cid,)).fetchone() or conn.execute('SELECT 1 FROM research_chat_workers w JOIN research_chat_jobs j ON j.id=w.job_id WHERE j.conversation_id=?', (cid,)).fetchone() or conn.execute('SELECT 1 FROM opencode_lease l JOIN research_chat_jobs j ON j.id=l.job_id WHERE j.conversation_id=?', (cid,)).fetchone():
            raise HTTPException(409, 'conversation_busy')
        binding = json.loads(row['runtime_binding'])
        session = row['runtime_session']
        try:
            if binding.get('transport') in (direct.TRANSPORT, direct.INTERACTIVE_TRANSPORT):
                purge_profile(dict(row))
            elif row['engine'] == 'opencode' and session:
                if not re.fullmatch(r'ses_[A-Za-z0-9]+', session) or conn.execute('SELECT 1 FROM research_conversations WHERE runtime_session=? AND id<>?', (session, cid)).fetchone():
                    raise HTTPException(409, 'conversation_cleanup_failed')
                with oc.client() as runtime:
                    response = runtime.delete('/session/' + session)
                    if response.status_code not in (200, 204, 404):
                        raise HTTPException(409, 'conversation_cleanup_failed')
        except HTTPException:
            raise
        except Exception:
            # Keep the conversation on cleanup failure; expose no paths/auth or
            # upstream response. Retrying deletion never calls a model.
            raise HTTPException(409, 'conversation_cleanup_failed') from None
        # Minimal, expiring rate accounting only: deletion must not reset the
        # existing daily-create/hourly-turn limits. No title, body, files or
        # native session is retained, and these rows cannot restore a chat.
        now = time.time()
        conn.execute("DELETE FROM research_chat_deleted_usage WHERE (kind='conversation' AND created_at<?) OR (kind='turn' AND created_at<?)", (now - 86400, now - 3600))
        if row['created_at'] > now - 86400:
            conn.execute('INSERT INTO research_chat_deleted_usage VALUES(?,?,?,?)', (cid, owner, 'conversation', row['created_at']))
        conn.execute("INSERT INTO research_chat_deleted_usage SELECT id,?,'turn',created_at FROM research_chat_jobs WHERE conversation_id=? AND created_at>?", (owner, cid, now - 3600))
        aids = [r[0] for r in conn.execute('SELECT DISTINCT a.id FROM research_chat_attachments a JOIN research_message_attachments l ON l.attachment_id=a.id JOIN research_chat_messages m ON m.id=l.message_id WHERE m.conversation_id=? AND a.owner_id=?', (cid, owner))]
        conn.execute('DELETE FROM research_message_attachments WHERE message_id IN (SELECT id FROM research_chat_messages WHERE conversation_id=?)', (cid,))
        conn.execute('DELETE FROM research_chat_questions WHERE job_id IN (SELECT id FROM research_chat_jobs WHERE conversation_id=?)', (cid,))
        conn.execute('DELETE FROM research_chat_messages WHERE conversation_id=?', (cid,))
        conn.execute('DELETE FROM research_chat_jobs WHERE conversation_id=?', (cid,))
        if session:
            conn.execute('DELETE FROM opencode_provider_messages WHERE owner_id=? AND session_id=?', (owner, session))
        conn.execute('DELETE FROM research_conversations WHERE id=? AND owner_id=?', (cid, owner))
        for aid in aids:
            conn.execute('DELETE FROM research_chat_attachments WHERE id=? AND owner_id=? AND NOT EXISTS(SELECT 1 FROM research_message_attachments WHERE attachment_id=?)', (aid, owner, aid))
        # Saved library reports are independent artifacts and intentionally kept.
