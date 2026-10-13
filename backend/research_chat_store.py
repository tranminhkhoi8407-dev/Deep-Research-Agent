"""Durable, owner-scoped research conversations, jobs and worker leases."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


def ident():
    return uuid.uuid4().hex


@contextmanager
def db():
    path = Path(os.getenv("RESEARCH_CHAT_DATABASE_PATH", "data/research-chat.db")).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS research_conversations (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, engine TEXT NOT NULL,
        model TEXT NOT NULL, title TEXT NOT NULL, settings TEXT NOT NULL,
        external_ack INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
        title_custom INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0, runtime_session TEXT,
        runtime_binding TEXT NOT NULL DEFAULT '{}',
        created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_chats_owner ON research_conversations(owner_id,archived,updated_at);
      CREATE TABLE IF NOT EXISTS research_chat_deleted_usage (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, created_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_deleted_usage ON research_chat_deleted_usage(owner_id,kind,created_at);
      CREATE TABLE IF NOT EXISTS research_chat_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES research_conversations(id),
        role TEXT NOT NULL, body TEXT NOT NULL, job_id TEXT, created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_chat_jobs (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES research_conversations(id),
        client_id TEXT NOT NULL, fingerprint TEXT NOT NULL, action TEXT NOT NULL,
        status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'queued', request TEXT NOT NULL,
        error_code TEXT, report_id TEXT, usage TEXT NOT NULL DEFAULT '{}',
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        UNIQUE(conversation_id,client_id)
      );
      CREATE TABLE IF NOT EXISTS research_chat_attachments (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
        mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
        content BLOB NOT NULL, text TEXT NOT NULL, warning TEXT NOT NULL,
        created_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_owner ON research_chat_attachments(owner_id);
      CREATE TABLE IF NOT EXISTS research_message_attachments (
        message_id TEXT NOT NULL REFERENCES research_chat_messages(id),
        attachment_id TEXT NOT NULL REFERENCES research_chat_attachments(id),
        position INTEGER NOT NULL, PRIMARY KEY(message_id,attachment_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_research_turn ON research_chat_jobs(conversation_id)
        WHERE status IN ('queued','running');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_research_active_turn ON research_chat_jobs(conversation_id)
        WHERE status IN ('queued','running','awaiting_input');
      CREATE TABLE IF NOT EXISTS research_chat_questions (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES research_chat_jobs(id),
        native_id TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
        answers TEXT, created_at REAL NOT NULL, expires_at REAL NOT NULL,
        UNIQUE(job_id,native_id)
      );
      CREATE TABLE IF NOT EXISTS research_chat_workers (
        job_id TEXT PRIMARY KEY REFERENCES research_chat_jobs(id),
        pid INTEGER NOT NULL, identity REAL NOT NULL,
        backend_pid INTEGER NOT NULL, backend_identity REAL NOT NULL,
        workspace TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opencode_lease (
        slot INTEGER PRIMARY KEY CHECK(slot=1), job_id TEXT NOT NULL, expires_at REAL NOT NULL,
        context TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
        input_reserved INTEGER NOT NULL DEFAULT 0, output_reserved INTEGER NOT NULL DEFAULT 0,
        input_measured INTEGER NOT NULL DEFAULT 0, output_measured INTEGER NOT NULL DEFAULT 0,
        cap INTEGER NOT NULL DEFAULT 1000
      );
      CREATE TABLE IF NOT EXISTS opencode_provider_messages (
        owner_id TEXT NOT NULL, session_id TEXT NOT NULL, call_id TEXT NOT NULL,
        binding TEXT NOT NULL, payload TEXT NOT NULL, created_at REAL NOT NULL,
        PRIMARY KEY(owner_id,session_id,call_id)
      );
    """)
    columns = {item["name"] for item in conn.execute("PRAGMA table_info(research_conversations)")}
    if "runtime_binding" not in columns:
        conn.execute("BEGIN IMMEDIATE")
        if "runtime_binding" not in {item["name"] for item in conn.execute("PRAGMA table_info(research_conversations)")}:
            conn.execute("ALTER TABLE research_conversations ADD COLUMN runtime_binding TEXT NOT NULL DEFAULT '{}'")
        conn.commit()
    if 'title_custom' not in columns:
        conn.execute('BEGIN IMMEDIATE')
        if 'title_custom' not in {item['name'] for item in conn.execute('PRAGMA table_info(research_conversations)')}:
            conn.execute('ALTER TABLE research_conversations ADD COLUMN title_custom INTEGER NOT NULL DEFAULT 0')
            conn.execute("UPDATE research_conversations SET title_custom=1 WHERE title NOT IN ('Cuộc trò chuyện mới','New conversation')")
        conn.commit()
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def conversation(conn, owner, cid):
    return conn.execute("SELECT * FROM research_conversations WHERE id=? AND owner_id=?", (cid, owner)).fetchone()


def public_conversation(row):
    # Runtime IDs, worker address/auth, full settings and owner identities never
    # leave this boundary. Settings are selected explicitly on the detail route.
    binding = json.loads(row["runtime_binding"])
    label = f"Nexora · {binding['provider']} · {binding['model']}" if 'provider' in binding and 'model' in binding else row["model"]
    return {**{k: row[k] for k in ("id", "engine", "model", "title", "created_at", "updated_at")}, "model_label": label, "runtime_transport": binding.get('transport', 'gateway'), "pinned": bool(row["pinned"]), "archived": bool(row["archived"])}


def public_job(row):
    return {**{k: row[k] for k in ("id", "action", "status", "stage", "error_code", "report_id", "created_at", "updated_at")}, "usage": json.loads(row["usage"])}


def update_job(jid, **changes):
    allowed = {"status", "stage", "error_code", "report_id", "usage"}
    changes = {k: json.dumps(v) if k == "usage" else v for k, v in changes.items() if k in allowed}
    if not changes:
        return
    with db() as conn:
        conn.execute("UPDATE research_chat_jobs SET " + ",".join(k + "=?" for k in changes) + ",updated_at=? WHERE id=?", (*changes.values(), time.time(), jid))


def cancelled(jid):
    with db() as conn:
        row = conn.execute("SELECT cancel_requested,status FROM research_chat_jobs WHERE id=?", (jid,)).fetchone()
        return not row or row["cancel_requested"] or row["status"] not in ("queued", "running", "awaiting_input")


def add_message(conn, cid, role, body, jid=None):
    identifier = ident()
    conn.execute("INSERT INTO research_chat_messages(id,conversation_id,role,body,job_id,created_at) VALUES(?,?,?,?,?,?)", (identifier, cid, role, body, jid, time.time()))
    return identifier


def recover_jobs():
    """Recover only abandoned jobs; never replay a billable prompt on restart."""
    with db() as conn:
        from backend.opencode_interactive import recover_workers
        recover_workers(conn)
        # Live workers heartbeat at stage boundaries; provider requests have a
        # 60s deadline. Don't interrupt another live backend worker on startup.
        conn.execute("UPDATE research_chat_jobs SET status='interrupted',error_code='worker_interrupted',updated_at=? WHERE status IN ('queued','running') AND updated_at<?", (time.time(), time.time() - 900))
        # Interactive workers heartbeat while waiting. A missing worker must
        # never leave an actionable question whose native Deferred is gone.
        conn.execute("UPDATE research_chat_jobs SET status='interrupted',error_code='worker_interrupted',stage='stopped',updated_at=? WHERE status='awaiting_input' AND updated_at<?", (time.time(), time.time() - 90))
        conn.execute("UPDATE research_chat_questions SET state='interrupted' WHERE state='pending' AND job_id IN (SELECT id FROM research_chat_jobs WHERE status IN ('failed','cancelled','interrupted','completed'))")
        conn.execute("DELETE FROM opencode_lease WHERE expires_at<?", (time.time(),))
