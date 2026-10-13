"""Durable human input, ownership and lease pause/resume; no provider calls."""
import json
import time
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.auth import current_user
from backend import research_chat as chats, opencode_direct as direct, opencode_interactive as hil
from backend.research_chat_store import db, ident, cancelled, recover_jobs


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    monkeypatch.setenv('RESEARCH_CHAT_DATABASE_PATH',str(tmp_path/'chat.db'))
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED','true')
    monkeypatch.setenv('OPENCODE_UPSTREAM_API_KEY','synthetic-key')
    monkeypatch.setattr(chats,'run_turn',lambda _:None)
    app.dependency_overrides[current_user]=lambda:{'id':'owner'}
    with TestClient(app) as client:
        result=client.post('/api/research/chats',json={'engine':'opencode','external_data_ack':True})
        assert result.status_code==201,result.text
        cid=result.json()['id']
        sent=client.post('/api/research/chats/'+cid+'/messages',json={'text':'Public ambiguous research request','client_id':'fixture-first'})
        assert sent.status_code==202,sent.text
        jid=sent.json()['id']
        with db() as conn:
            conn.execute("UPDATE research_chat_jobs SET status='awaiting_input',stage='awaiting_input' WHERE id=?",(jid,))
            row=hil.record_question(conn,jid,{'id':'que_fixture','questions':[{'header':'Goal','question':'Theory or practice?','options':[{'label':'Theory'},{'label':'Practice'}],'custom':True}]})
        yield client,cid,jid,row['id']
    app.dependency_overrides.pop(current_user,None)


def answer(client,cid,qid,**value):
    return client.post('/api/research/chats/'+cid+'/questions/'+qid+'/answer',json=value)


def test_fixed_model_and_new_session_has_no_paid_choice(fixture):
    client,cid,_,_=fixture
    detail=client.get('/api/research/chats/'+cid).json()
    assert detail['model']==direct.DEFAULT_MODEL and detail['runtime_transport']==direct.INTERACTIVE_TRANSPORT
    for model in ['mimo-v2.6-flash-free','longcat-2.5-preview-free','muse-spark-1.3','nexora-configured']:
        assert client.post('/api/research/chats',json={'engine':'opencode','model':model,'external_data_ack':True}).json()['detail']=='opencode_fixed_model_required'


def test_pending_question_is_durable_sanitized_and_blocks_other_turn(fixture):
    client,cid,jid,qid=fixture
    for _ in range(2):
        value=client.get('/api/research/chats/'+cid).json()
        assert value['questions'][0]['id']==qid and value['jobs'][0]['status']=='awaiting_input'
        assert 'native_id' not in value['questions'][0] and 'runtime_session' not in value
    assert not cancelled(jid)
    assert client.post('/api/research/chats/'+cid+'/messages',json={'text':'Other','client_id':'another-turn'}).status_code==409
    assert client.patch('/api/research/chats/'+cid,json={'archived':True}).status_code==409


def test_answer_idempotency_and_same_job_without_model_replay(fixture):
    client,cid,jid,qid=fixture
    for _ in range(2):
        result=answer(client,cid,qid,answers=[['Practice']]); assert result.status_code==200
    assert answer(client,cid,qid,answers=[['Theory']]).status_code==409
    assert answer(client,cid,qid,reject=True).status_code==409
    with db() as conn:
        assert conn.execute('SELECT count(*) FROM research_chat_jobs').fetchone()[0]==1
        assert conn.execute("SELECT count(*) FROM research_chat_messages WHERE job_id=? AND body LIKE '%Practice%'",(jid,)).fetchone()[0]==1
        assert conn.execute('SELECT status FROM research_chat_jobs WHERE id=?',(jid,)).fetchone()[0]=='queued'


@pytest.mark.parametrize('values',[[],[[]],[['Theory','Practice']],[['  ']],[['a'*2001]],[['Theory'],['Practice']]])
def test_invalid_answer_never_resumes(fixture,values):
    client,cid,jid,qid=fixture
    assert answer(client,cid,qid,answers=values).status_code==422
    with db() as conn:
        assert conn.execute('SELECT status FROM research_chat_jobs WHERE id=?',(jid,)).fetchone()[0]=='awaiting_input'


def test_custom_answer_multi_choice_and_reject(fixture):
    client,cid,_,qid=fixture
    assert answer(client,cid,qid,answers=[['My own public goal']]).status_code==200


def test_multiple_question_constraints(fixture):
    client,cid,jid,qid=fixture
    with db() as conn:
        value={'questions':[{'question':'Choose','options':[{'label':'A'},{'label':'B'}],'multiple':True,'custom':False},{'question':'Explain','custom':True}]}
        conn.execute('UPDATE research_chat_questions SET payload=? WHERE id=?',(json.dumps(value),qid))
    assert answer(client,cid,qid,answers=[['Unknown'],['Text']]).status_code==422
    assert answer(client,cid,qid,answers=[['A','A'],['Text']]).status_code==422
    assert answer(client,cid,qid,answers=[['A','B'],['Text']]).status_code==200


def test_reject_does_not_invent_user_answer(fixture):
    client,cid,jid,qid=fixture
    assert answer(client,cid,qid,reject=True,answers=[['Theory']]).status_code==422
    for _ in range(2): assert answer(client,cid,qid,reject=True).status_code==200
    with db() as conn:
        assert conn.execute('SELECT count(*) FROM research_chat_messages WHERE job_id=?',(jid,)).fetchone()[0]==1


def test_foreign_scope_and_origin_never_answers(fixture):
    client,cid,_,qid=fixture
    app.dependency_overrides[current_user]=lambda:{'id':'other'}
    assert answer(client,cid,qid,answers=[['Practice']]).status_code==404
    app.dependency_overrides[current_user]=lambda:{'id':'owner'}
    assert answer(client,ident(),qid,answers=[['Practice']]).status_code==404
    response=client.post('/api/research/chats/'+cid+'/questions/'+qid+'/answer',json={'answers':[['Theory']]},headers={'Origin':'https://evil.invalid'})
    assert response.status_code==403


@pytest.mark.parametrize('mode',['expired','stopped','abandoned'])
def test_closed_questions_cannot_resume(fixture,mode):
    client,cid,jid,qid=fixture
    with db() as conn:
        if mode=='expired': conn.execute('UPDATE research_chat_questions SET expires_at=0 WHERE id=?',(qid,))
        if mode=='abandoned': conn.execute('UPDATE research_chat_jobs SET updated_at=0 WHERE id=?',(jid,))
    if mode=='stopped': client.post('/api/research/chats/'+cid+'/stop')
    if mode=='abandoned': recover_jobs()
    assert answer(client,cid,qid,answers=[['Theory']]).status_code==409


def test_pause_releases_global_slot_resume_keeps_same_budget_and_scope(fixture):
    client,cid,jid,_=fixture
    with db() as conn:
        conn.execute("UPDATE research_chat_jobs SET status='running' WHERE id=?",(jid,))
        convo=dict(conn.execute('SELECT * FROM research_conversations WHERE id=?',(cid,)).fetchone())
        context={'owner':'owner','conversation':cid,'model':direct.DEFAULT_MODEL,'transport':direct.INTERACTIVE_TRANSPORT,'direct_token':'synthetic-token-with-at-least-32-characters','sessions':['ses_fixture'],'budget':{'max_llm_calls':4,'max_input_tokens':300000,'max_output_tokens':6000},'requests':{'used':{'settled':True,'cap':1800}}}
        conn.execute('INSERT INTO opencode_lease(slot,job_id,expires_at,context,calls,input_reserved,output_reserved,cap) VALUES(1,?,?,?,1,5000,1800,1800)',(jid,time.time()+40,json.dumps(context)))
    turn=hil.InteractiveOpenCodeTurn(jid,convo,{'max_seconds':90})
    row=turn.pause({'id':'que_second','questions':[{'question':'Next?','options':[{'label':'Yes'}]}]})
    with db() as conn:
        assert not conn.execute('SELECT 1 FROM opencode_lease').fetchone()
        assert conn.execute('SELECT status FROM research_chat_jobs WHERE id=?',(jid,)).fetchone()[0]=='awaiting_input'
    assert answer(client,cid,row['id'],answers=[['Yes']]).status_code==200
    assert turn.resume()
    with db() as conn:
        lease=conn.execute('SELECT * FROM opencode_lease').fetchone()
        assert lease['job_id']==jid and lease['calls']==1 and lease['output_reserved']==1800 and lease['input_reserved']==5000
        assert json.loads(lease['context'])==context
        assert time.time()+35<lease['expires_at']<time.time()+42


def test_invalid_questions_and_question_count_are_bounded(fixture):
    _,_,jid,_=fixture
    with db() as conn:
        for questions in [[],[{'question':'   '}],[{'question':'Q','custom':False}],[{'question':'Q','options':[{'label':'A'},{'label':'A'}]}]]:
            with pytest.raises(Exception,match='opencode_question_invalid'):
                hil.record_question(conn,jid,{'id':'que_invalid','questions':questions})
        for key in ['que_second','que_third']:
            hil.record_question(conn,jid,{'id':key,'questions':[{'question':'Q'}]})
        with pytest.raises(Exception,match='opencode_question_limit'):
            hil.record_question(conn,jid,{'id':'que_fourth','questions':[{'question':'Q'}]})


@pytest.mark.parametrize('same_process',[True,False])
def test_restart_closes_question_and_only_exact_owned_child_can_be_cleaned(fixture,monkeypatch,same_process):
    _,_,jid,qid=fixture
    terminated=[]
    class Child:
        def create_time(self): return 123 if same_process else 999
        def cwd(self): return 'C:/isolated/fixture/workspace'
        def cmdline(self): return ['opencode.exe','serve']
        def children(self,recursive): return []
        def terminate(self): terminated.append('child')
    def process(pid):
        if pid==987654321: raise hil.psutil.NoSuchProcess(pid)
        return Child()
    monkeypatch.setattr(hil.psutil,'Process',process)
    with db() as conn:
        conn.execute('INSERT INTO research_chat_workers VALUES(?,?,?,?,?,?)',(jid,1234,123,987654321,55,'C:/isolated/fixture/workspace'))
    recover_jobs()
    with db() as conn:
        assert conn.execute('SELECT status FROM research_chat_jobs WHERE id=?',(jid,)).fetchone()[0]=='interrupted'
        assert conn.execute('SELECT state FROM research_chat_questions WHERE id=?',(qid,)).fetchone()[0]=='interrupted'
        assert not conn.execute('SELECT 1 FROM research_chat_workers').fetchone()
    assert terminated==(['child'] if same_process else [])


def test_shutdown_revokes_only_this_backend_incarnation(fixture):
    client,_,jid,qid=fixture
    other=client.post('/api/research/chats',json={'engine':'nexora'}).json()['id']
    second=client.post('/api/research/chats/'+other+'/messages',json={'client_id':'other-worker-fixture','text':'Public fixture'}).json()['id']
    with db() as conn:
        conn.execute('INSERT INTO research_chat_workers VALUES(?,?,?,?,?,?)',(jid,987654321,12,hil.os.getpid(),hil.psutil.Process(hil.os.getpid()).create_time(),'C:/synthetic'))
        conn.execute('INSERT INTO research_chat_workers VALUES(?,?,?,?,?,?)',(second,987654322,13,987654323,99,'C:/synthetic-other'))
    hil.shutdown_workers()
    with db() as conn:
        assert conn.execute('SELECT cancel_requested FROM research_chat_jobs WHERE id=?',(jid,)).fetchone()[0]==1
        assert conn.execute('SELECT cancel_requested FROM research_chat_jobs WHERE id=?',(second,)).fetchone()[0]==0
        assert conn.execute('SELECT state FROM research_chat_questions WHERE id=?',(qid,)).fetchone()[0]=='cancelled'
