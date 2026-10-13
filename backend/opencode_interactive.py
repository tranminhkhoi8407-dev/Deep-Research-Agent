"""Muse-only native OpenCode question/reply bridge.

Each job owns a loopback server in its conversation's isolated profile. Waiting
for a human releases the provider lease, NOT the native session. Only an
authenticated, validated answer can reacquire that lease and resume the tool.
No terminal attach, desktop credentials, automatic replay or host-tool approval.
"""
import json
import os
import re
import secrets
import socket
import subprocess
import time

import httpx
import psutil
from fastapi import HTTPException
from langchain_core.messages import AIMessage
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from backend import opencode_direct as direct, opencode_runtime as oc
from backend.research_chat_store import db, ident, cancelled, add_message

WAIT_SECONDS = 1800
MAX_WAITERS = 4


class Option(BaseModel):
    model_config = ConfigDict(extra='ignore')
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default='', max_length=500)


class Question(BaseModel):
    model_config = ConfigDict(extra='ignore')
    header: str = Field(default='', max_length=120)
    question: str = Field(min_length=1, max_length=2000)
    options: list[Option] = Field(default_factory=list, max_length=6)
    multiple: bool = False
    custom: bool = True

    @model_validator(mode='after')
    def valid_options(self):
        labels = [item.label for item in self.options]
        if len(set(labels)) != len(labels) or any(not item.strip() for item in labels) or not self.question.strip() or (not self.options and not self.custom):
            raise ValueError('Invalid clarification')
        return self


class Questions(BaseModel):
    questions: list[Question] = Field(min_length=1, max_length=3)


def public_question(row):
    return {**{key: row[key] for key in ('id', 'job_id', 'state', 'created_at', 'expires_at')},
            **json.loads(row['payload']), 'answers': json.loads(row['answers']) if row['answers'] else None}


def record_question(conn, job, native):
    if not re.fullmatch(r'que_[A-Za-z0-9]+', native.get('id', '')):
        raise oc.RuntimeErrorSafe('opencode_question_invalid')
    try:
        payload = Questions.model_validate(native).model_dump()
    except ValidationError:
        raise oc.RuntimeErrorSafe('opencode_question_invalid') from None
    existing = conn.execute('SELECT * FROM research_chat_questions WHERE job_id=? AND native_id=?', (job, native['id'])).fetchone()
    if existing:
        return dict(existing)
    count = conn.execute('SELECT count(*) FROM research_chat_questions WHERE job_id=?', (job,)).fetchone()[0]
    if count >= 3:
        raise oc.RuntimeErrorSafe('opencode_question_limit')
    qid, now = ident(), time.time()
    conn.execute('INSERT INTO research_chat_questions(id,job_id,native_id,payload,created_at,expires_at) VALUES(?,?,?,?,?,?)',
                 (qid, job, native['id'], json.dumps(payload, ensure_ascii=False), now, now+WAIT_SECONDS))
    return dict(conn.execute('SELECT * FROM research_chat_questions WHERE id=?', (qid,)).fetchone())


def answer_question(conn, owner, cid, qid, answers, reject=False):
    """One transaction: authorization, shape validation and idempotent commit."""
    row = conn.execute('SELECT q.*,j.conversation_id,j.status,j.cancel_requested FROM research_chat_questions q JOIN research_chat_jobs j ON j.id=q.job_id JOIN research_conversations c ON c.id=j.conversation_id WHERE q.id=? AND c.id=? AND c.owner_id=?', (qid, cid, owner)).fetchone()
    if not row:
        raise HTTPException(404, 'Question not found')
    chosen = 'rejected' if reject else 'answered'
    questions = Questions.model_validate(json.loads(row['payload'])).questions
    if reject:
        if answers:
            raise HTTPException(422, 'opencode_question_invalid_answer')
    else:
        if len(answers) != len(questions):
            raise HTTPException(422, 'opencode_question_invalid_answer')
        for question, values in zip(questions, answers):
            if not values or len(values) > (6 if question.multiple else 1) or len(set(values)) != len(values) or any(not value.strip() or len(value) > 2000 for value in values):
                raise HTTPException(422, 'opencode_question_invalid_answer')
            allowed = {item.label for item in question.options}
            if not question.custom and any(value not in allowed for value in values):
                raise HTTPException(422, 'opencode_question_invalid_answer')
    encoded = json.dumps(answers, ensure_ascii=False)
    if row['state'] in {'answered', 'rejected'}:
        if row['state'] == chosen and row['answers'] == encoded:
            return public_question(row)
        raise HTTPException(409, 'idempotency_conflict')
    if row['state'] != 'pending' or row['status'] != 'awaiting_input' or row['cancel_requested'] or row['expires_at'] <= time.time():
        raise HTTPException(409, 'opencode_question_expired')
    conn.execute('UPDATE research_chat_questions SET state=?,answers=? WHERE id=?', (chosen, encoded, qid))
    conn.execute("UPDATE research_chat_jobs SET status='queued',stage='resuming',updated_at=? WHERE id=?", (time.time(), row['job_id']))
    if not reject:
        text = '\n'.join(f"{question.question}\n→ {', '.join(values)}" for question, values in zip(questions, answers))
        add_message(conn, cid, 'user', text, row['job_id'])
    conn.execute('UPDATE research_conversations SET updated_at=? WHERE id=?', (time.time(), cid))
    return public_question(conn.execute('SELECT * FROM research_chat_questions WHERE id=?', (qid,)).fetchone())


def recover_workers(conn):
    """Native pending questions live in memory: never pretend restart resumed them."""
    for row in conn.execute('SELECT w.*,j.status FROM research_chat_workers w JOIN research_chat_jobs j ON j.id=w.job_id'):
        try:
            alive = psutil.Process(row['backend_pid']).create_time() == row['backend_identity']
        except psutil.Error:
            alive = False
        if alive:
            continue
        if row['status'] in {'queued', 'running', 'awaiting_input'}:
            conn.execute("UPDATE research_chat_jobs SET status='interrupted',stage='stopped',error_code='worker_interrupted',updated_at=? WHERE id=?", (time.time(), row['job_id']))
        conn.execute("UPDATE research_chat_questions SET state='interrupted' WHERE job_id=? AND state='pending'", (row['job_id'],))
        # Identify the exact dedicated process, including creation time and cwd.
        # Never kill by port/name or touch the user's personal OpenCode process.
        try:
            proc = psutil.Process(row['pid'])
            if proc.create_time() == row['identity'] and proc.cwd() == row['workspace'] and 'serve' in proc.cmdline():
                for child in reversed(proc.children(recursive=True)):
                    try:
                        child.terminate()
                    except psutil.Error:
                        pass
                proc.terminate()
        except psutil.Error:
            pass
        conn.execute('DELETE FROM opencode_lease WHERE job_id=?', (row['job_id'],))
        conn.execute('DELETE FROM research_chat_workers WHERE job_id=?', (row['job_id'],))


def shutdown_workers():
    """Let waiting threads exit before the backend shuts its executor down.

Only jobs served by this exact backend incarnation are revoked. Other backend
workers and the user's OpenCode desktop are not touched.
"""
    pid = os.getpid()
    identity = psutil.Process(pid).create_time()
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        jobs = [row['job_id'] for row in conn.execute('SELECT job_id FROM research_chat_workers WHERE backend_pid=? AND backend_identity=?', (pid, identity))]
        for job in jobs:
            conn.execute("UPDATE research_chat_jobs SET cancel_requested=1 WHERE id=? AND status IN ('queued','running','awaiting_input')", (job,))
            conn.execute("UPDATE research_chat_questions SET state='cancelled' WHERE job_id=? AND state='pending'", (job,))


class InteractiveOpenCodeTurn(direct.DirectOpenCodeTurn):
    transport = direct.INTERACTIVE_TRANSPORT

    def __enter__(self):
        if self.conversation['model'] != direct.DEFAULT_MODEL:
            raise oc.RuntimeErrorSafe('opencode_direct_model_changed')
        super().__enter__()
        self.remaining = float(self.budget['max_seconds'])
        self.snapshot = None
        return self

    def usage(self, lease):
        ctx = json.loads(lease['context'])
        result = {key: lease[key] for key in ('calls', 'input_reserved', 'output_reserved', 'input_measured', 'output_measured')}
        result.update(transport=self.transport, tools_blocked=ctx.get('tools_blocked', 0))
        if 'provider_status' in ctx:
            result['provider_status'] = ctx['provider_status']
        return result

    def pause(self, native):
        with db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            lease = oc.lease_row(conn)
            if lease['job_id'] != self.job:
                raise oc.RuntimeErrorSafe('opencode_direct_unauthorized')
            question = record_question(conn, self.job, native)
            self.snapshot = dict(lease)
            self.remaining = max(0, lease['expires_at'] - time.time())
            conn.execute("UPDATE research_chat_jobs SET status='awaiting_input',stage='awaiting_input',usage=?,updated_at=? WHERE id=?", (json.dumps(self.usage(lease)), time.time(), self.job))
            conn.execute('DELETE FROM opencode_lease WHERE job_id=?', (self.job,))
        return question

    def resume(self):
        with db() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if cancelled_in(conn, self.job):
                raise oc.RuntimeErrorSafe('cancelled')
            from backend.chat_attachments import guard_history
            guard_history(conn, self.conversation)
            active = conn.execute('SELECT * FROM opencode_lease WHERE slot=1').fetchone()
            if active and active['expires_at'] > time.time():
                return False
            conn.execute('DELETE FROM opencode_lease WHERE slot=1')
            values = {**self.snapshot, 'expires_at': time.time()+self.remaining}
            columns = tuple(values)
            conn.execute('INSERT INTO opencode_lease('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')', tuple(values[key] for key in columns))
            conn.execute("UPDATE research_chat_jobs SET status='running',stage='replying',updated_at=? WHERE id=?", (time.time(), self.job))
        return True

    def __exit__(self, *args):
        super().__exit__(*args)
        with db() as conn:
            conn.execute('DELETE FROM research_chat_workers WHERE job_id=?', (self.job,))
            conn.execute("UPDATE research_chat_questions SET state='interrupted' WHERE job_id=? AND state='pending'", (self.job,))

    def prompt(self, system, text, *, cap=1800, evidence=None, **_):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        password = secrets.token_urlsafe(32)
        self.env.update(OPENCODE_SERVER_PASSWORD=password, OPENCODE_SERVER_USERNAME='opencode', NEXORA_DIRECT_HIL='true')
        self.process = subprocess.Popen([str(direct.binary()), 'serve', '--hostname', '127.0.0.1', '--port', str(port)],
            cwd=self.folder/'workspace', env=self.env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.process_identity = psutil.Process(self.process.pid).create_time()
        with db() as conn:
            conn.execute('INSERT INTO research_chat_workers(job_id,pid,identity,backend_pid,backend_identity,workspace) VALUES(?,?,?,?,?,?)',
                (self.job, self.process.pid, self.process_identity, os.getpid(), psutil.Process(os.getpid()).create_time(), str(self.folder/'workspace')))
        started = time.time()
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', auth=('opencode', password), timeout=10, trust_env=False, follow_redirects=False) as client:
            while True:
                self.check_alive()
                try:
                    health = client.get('/global/health')
                    if health.is_success:
                        if health.json().get('version') != '1.19.0':
                            raise oc.RuntimeErrorSafe('opencode_worker_unsafe')
                        break
                except httpx.HTTPError:
                    pass
                if time.time()-started > 20:
                    raise oc.RuntimeErrorSafe('opencode_unreachable')
                time.sleep(.2)
            def request(method, path, **kwargs):
                try:
                    response = client.request(method, path, **kwargs)
                    if not response.is_success:
                        raise oc.RuntimeErrorSafe('opencode_generation_failed')
                    return response.json() if response.content else None
                except (httpx.HTTPError, ValueError):
                    raise oc.RuntimeErrorSafe('opencode_unreachable') from None
            session = self.conversation.get('runtime_session')
            if session:
                request('GET', '/session/'+session)
            else:
                session = request('POST', '/session', timeout=35, json={'title': self.conversation['title'][:120], 'permission': [
                    {'permission': '*', 'pattern': '*', 'action': 'ask'},
                    {'permission': 'question', 'pattern': '*', 'action': 'allow'},
                    {'permission': 'external_directory', 'pattern': '*', 'action': 'deny'},
                    {'permission': 'nexora_evidence_*', 'pattern': '*', 'action': 'allow'},
                    {'permission': 'StructuredOutput', 'pattern': '*', 'action': 'allow'}]})['id']
            if not re.fullmatch(r'ses_[A-Za-z0-9]+', session):
                raise oc.RuntimeErrorSafe('opencode_direct_unauthorized')
            with db() as conn:
                conn.execute('UPDATE research_conversations SET runtime_session=? WHERE id=?', (session, self.conversation['id']))
                lease = oc.lease_row(conn)
                ctx = json.loads(lease['context']); ctx['sessions'] = [session]
                conn.execute('UPDATE opencode_lease SET context=?,cap=? WHERE job_id=?', (json.dumps(ctx), min(cap,1800), self.job))
            old = {item['info']['id'] for item in request('GET', '/session/'+session+'/message')}
            system += ' Use the question tool when missing preferences or scope would materially change the answer. Ask at most 1–3 focused questions with 2–4 concise options and allow a custom answer. Do not ask for routine facts already supplied; never ask for secrets. Wait for the actual user answer before continuing. A rejected question is not consent: state a safe assumption or ask a simpler question in plain text. You cannot approve host tools by asking the user.'
            request('POST', '/session/'+session+'/prompt_async', json={'agent':'build', 'model':{'providerID':'opencode','modelID':self.conversation['model']}, 'system':system, 'parts':[{'type':'text','text':text}]})
            waiting = None
            queue_started = None
            next_heartbeat = 0
            while True:
                self.check_alive(paused=waiting is not None)
                now = time.time()
                if now >= next_heartbeat:
                    with db() as conn:
                        conn.execute('UPDATE research_chat_jobs SET updated_at=? WHERE id=?', (now, self.job))
                    next_heartbeat = now+2
                if waiting:
                    with db() as conn:
                        question = dict(conn.execute('SELECT * FROM research_chat_questions WHERE id=?', (waiting['id'],)).fetchone())
                    if now >= question['expires_at']:
                        with db() as conn:
                            conn.execute("UPDATE research_chat_questions SET state='expired' WHERE id=? AND state='pending'", (question['id'],))
                        raise oc.RuntimeErrorSafe('opencode_question_expired')
                    if question['state'] in {'answered','rejected'}:
                        queue_started = queue_started or now
                        if now-queue_started > 60:
                            raise oc.RuntimeErrorSafe('opencode_worker_busy')
                        if self.resume():
                            path = '/question/'+question['native_id']+'/'+('reply' if question['state']=='answered' else 'reject')
                            request('POST', path, **({'json':{'answers':json.loads(question['answers'])}} if question['state']=='answered' else {}))
                            if question['state'] == 'rejected':
                                # v1.19 ends the native loop on QuestionRejected.
                                # This explicit skip authorizes ONE bounded
                                # continuation, not a retry or invented answer.
                                request('POST', '/session/'+session+'/abort')
                                # The aborted question belongs to the explicit
                                # skip, not to the subsequent assistant answer.
                                old.update(item['info']['id'] for item in request('GET', '/session/'+session+'/message'))
                                request('POST', '/session/'+session+'/prompt_async', json={'agent':'build', 'model':{'providerID':'opencode','modelID':self.conversation['model']}, 'system':system, 'parts':[{'type':'text','text':'The user explicitly skipped the pending clarification. No option was chosen and no consent was granted. Continue briefly using a safe, clearly stated assumption if possible; otherwise explain what information is missing. Do not repeat the skipped question. Do not execute host tools.'}]})
                            waiting = None; queue_started = None
                    time.sleep(.2)
                    continue
                questions = request('GET', '/question')
                own = [item for item in questions if item.get('sessionID')==session]
                if own:
                    # No other job may use this native server. Foreign questions
                    # are never exposed to the browser or automatically answered.
                    waiting = self.pause(own[0])
                    continue
                with db() as conn:
                    lease = oc.lease_row(conn)
                    ctx = json.loads(lease['context'])
                if ctx.get('provider_error'):
                    raise oc.RuntimeErrorSafe(ctx['provider_error'])
                status = request('GET', '/session/status').get(session, {}).get('type', 'idle')
                if status == 'idle':
                    messages = request('GET', '/session/'+session+'/message')
                    current = [item for item in messages if item['info']['id'] not in old and item['info']['role']=='assistant']
                    if current and any(item['info'].get('error') for item in current):
                        raise oc.RuntimeErrorSafe('opencode_generation_failed' if lease['calls'] else 'opencode_direct_guard_missing')
                    if current and current[-1]['info'].get('finish') and current[-1]['info']['finish'] != 'tool-calls':
                        if not lease['calls']:
                            raise oc.RuntimeErrorSafe('opencode_direct_guard_missing')
                        content = '\n'.join(part.get('text','') for item in current for part in item['parts'] if part.get('type')=='text')
                        if not content.strip():
                            raise oc.RuntimeErrorSafe('empty_response')
                        usage = {'input_tokens':lease['input_measured'],'output_tokens':lease['output_measured']}
                        return {}, AIMessage(content=content, usage_metadata={**usage,'total_tokens':sum(usage.values())})
                time.sleep(.25)

    def check_alive(self, paused=False):
        if cancelled(self.job):
            raise oc.RuntimeErrorSafe('cancelled')
        if self.process and self.process.poll() is not None:
            raise oc.RuntimeErrorSafe('opencode_unreachable')
        if not paused:
            with db() as conn:
                row = conn.execute('SELECT expires_at FROM opencode_lease WHERE job_id=?', (self.job,)).fetchone()
            if not row or row['expires_at'] <= time.time():
                raise oc.RuntimeErrorSafe('opencode_direct_timeout')


def cancelled_in(conn, jid):
    row = conn.execute('SELECT cancel_requested,status FROM research_chat_jobs WHERE id=?', (jid,)).fetchone()
    return not row or row['cancel_requested'] or row['status'] not in {'queued','running','awaiting_input'}
