"""Direct guard authorization/budget tests: no model or subprocess calls."""
import json
import time

from fastapi.testclient import TestClient
import pytest

from backend.main import app
from backend.auth import current_user
from backend import opencode_direct as direct, opencode_runtime as oc
from backend.research_chat_store import db, ident, public_conversation


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('RESEARCH_CHAT_DATABASE_PATH', str(tmp_path/'chats.db'))
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED', 'true')
    monkeypatch.setenv('OPENCODE_UPSTREAM_API_KEY', 'synthetic-provider-key')
    monkeypatch.setenv('OPENCODE_GATEWAY_TOKEN', 'synthetic-reader-token-with-32-characters')
    monkeypatch.setenv('OPENCODE_ALLOWED_MODELS', 'mimo-v2.6-flash-free,longcat-2.5-preview-free')
    fake_cli = tmp_path / 'opencode-fixture'
    fake_cli.touch()
    monkeypatch.setattr(direct, 'binary', lambda: fake_cli)
    monkeypatch.setattr(oc, 'status', lambda: {'configured': False, 'ready': False, 'code': 'opencode_unreachable', 'models': [{'id':m,'name':m,'ready':True,'code':'ready','policy':'improvement_data','private_allowed':False} for m in direct.MODELS]})
    app.dependency_overrides[current_user] = lambda: {'id':'owner-one'}
    cid,jid,token=ident(),ident(),'synthetic-unique-lease-token-32-characters'
    context={'owner':'owner-one','conversation':cid,'transport':direct.TRANSPORT,'direct_token':token,'model':'mimo-v2.6-flash-free','budget':{'max_llm_calls':2,'max_input_tokens':5000,'max_output_tokens':3600,'max_seconds':60},'sessions':[],'evidence':[]}
    with db() as conn:
        now=time.time()
        conn.execute("INSERT INTO research_conversations(id,owner_id,engine,model,title,settings,runtime_binding,created_at,updated_at) VALUES(?,?,?,?,?,'{}',?,?,?)",(cid,'owner-one','opencode','mimo-v2.6-flash-free','Fixture',json.dumps({'transport':direct.TRANSPORT}),now,now))
        conn.execute("INSERT INTO research_chat_jobs(id,conversation_id,client_id,fingerprint,action,status,request,created_at,updated_at) VALUES(?,?,?,'fixture','chat','running','{}',?,?)",(jid,cid,jid,now,now))
        conn.execute('INSERT INTO opencode_lease(slot,job_id,expires_at,context,cap) VALUES(1,?,?,?,1800)',(jid,now+60,json.dumps(context)))
    with TestClient(app) as client:
        yield client,cid,jid,{'Authorization':'Bearer '+token}
    app.dependency_overrides.pop(current_user, None)


def post(client, headers, action, **body):
    return client.post('/internal/opencode/direct/'+action,headers=headers,json=body)


def reserve(client, headers, **changes):
    body={'model':'mimo-v2.6-flash-free','provider':'opencode','session':'ses_fixture','input_estimate':1800,'request_id':'11111111-1111-4111-8111-111111111111'}
    return post(client,headers,'reserve',**{**body,**changes})


def test_budget_reserved_before_provider_and_settlement_cannot_replay(setup):
    client,cid,jid,headers=setup
    first=reserve(client,headers)
    assert first.status_code==200 and first.json()['output_cap']==1800
    assert reserve(client,headers).status_code==429
    rid=first.json()['request_id']
    assert post(client,headers,'settle',request_id=rid,usage={'prompt_tokens':100,'completion_tokens':20}).status_code==200
    assert post(client,headers,'settle',request_id=rid,usage={}).status_code==409
    assert reserve(client,headers,request_id='22222222-2222-4222-8222-222222222222').status_code==200
    assert reserve(client,headers,request_id='33333333-3333-4333-8333-333333333333').status_code==429
    with db() as conn:
        row=conn.execute('SELECT * FROM opencode_lease').fetchone()
        assert row['calls']==2 and row['output_reserved']==3600 and row['input_measured']==100
        convo=conn.execute('SELECT * FROM research_conversations WHERE id=?',(cid,)).fetchone()
        public=public_conversation(convo)
        assert public['runtime_transport']==direct.TRANSPORT
        assert not any(k in public for k in ('runtime_session','owner_id','direct_token'))


@pytest.mark.parametrize('changes',[{'model':'gpt-paid-model'},{'provider':'openai'},{'model':'longcat-2.5-preview-free'},{'input_estimate':True},{'input_estimate':-1},{'input_estimate':999999},{'session':'../other-owner'},{'request_id':'bad'}])
def test_invalid_or_wrong_model_requests_never_consume_a_call(setup,changes):
    client,_,_,headers=setup
    assert reserve(client,headers,**changes).status_code in {400,403,429}
    with db() as conn:
        assert conn.execute('SELECT calls FROM opencode_lease').fetchone()[0]==0


def test_worker_token_is_not_a_direct_job_authorization(setup):
    client,_,_,headers=setup
    assert reserve(client,{'Authorization':'Bearer synthetic-reader-token-with-32-characters'}).status_code==403
    assert reserve(client,{}).status_code==403
    assert reserve(client,headers).status_code==200
    assert reserve(client,headers,session='ses_other_owner',request_id='22222222-2222-4222-8222-222222222222').status_code==403


@pytest.mark.parametrize('state',['cancelled','expired','wrong-owner','not-direct'])
def test_revoked_or_foreign_scope_is_closed_before_network(setup,state):
    client,cid,jid,headers=setup
    with db() as conn:
        if state=='cancelled': conn.execute('UPDATE research_chat_jobs SET cancel_requested=1 WHERE id=?',(jid,))
        if state=='expired': conn.execute('UPDATE opencode_lease SET expires_at=0')
        if state=='wrong-owner': conn.execute("UPDATE research_conversations SET owner_id='owner-two' WHERE id=?",(cid,))
        if state=='not-direct': conn.execute("UPDATE research_conversations SET runtime_binding='{}' WHERE id=?",(cid,))
    assert reserve(client,headers).status_code in {403,409}


def test_tool_allowlist_is_exact_and_bounded(setup):
    client,_,_,headers=setup
    for name in ['bash','read','edit','task','nexora_evidence_read_other']:
        assert post(client,headers,'tool',model='mimo-v2.6-flash-free',session='ses_fixture',tool=name).status_code==403
    for _ in range(12):
        assert post(client,headers,'tool',model='mimo-v2.6-flash-free',session='ses_fixture',tool='nexora_evidence_read').status_code==200
    assert post(client,headers,'tool',model='mimo-v2.6-flash-free',session='ses_fixture',tool='nexora_evidence_read').status_code==403


def test_direct_routing_is_opt_in_and_old_sessions_stay_gateway(setup,monkeypatch):
    client,_,_,_=setup
    config=client.get('/api/research/chats/config').json()['opencode']
    assert config['ready'] and not config['gateway_ready']
    assert all(m['transport'] in {direct.TRANSPORT,direct.INTERACTIVE_TRANSPORT} for m in config['models'])
    assert client.post('/api/research/chats',json={'engine':'opencode','model':'mimo-v2.6-flash-free','external_data_ack':True}).status_code==422
    new=client.post('/api/research/chats',json={'engine':'opencode','external_data_ack':True}).json()
    assert new['runtime_transport']==direct.INTERACTIVE_TRANSPORT and new['model']==direct.DEFAULT_MODEL
    assert client.post('/api/research/chats/'+new['id']+'/messages',json={'client_id':'report-fixture','text':'Create report','action':'report'}).json()['detail']=='opencode_direct_chat_only'
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED','false')
    assert client.post('/api/research/chats/'+new['id']+'/messages',json={'client_id':'disabled-fixture','text':'Hello'}).json()['detail']=='opencode_direct_disabled'
    assert not direct.is_direct({'runtime_binding':'{}'})
    assert not direct.is_direct({'runtime_binding':json.dumps({'provider':'gemini','model':'fixture'})})


def test_profile_keeps_normal_tools_but_no_unprotected_provider_endpoint():
    config=direct.profile('mimo-v2.6-flash-free')
    assert config['permission']['*']=='ask'
    assert config['provider']['opencode']['options']['baseURL']=='http://127.0.0.1:9/guard-required'
    assert config['plugin']==[direct.PLUGIN.as_uri()]
    assert config['small_model']==config['model']
    assert config['compaction']['auto'] is False and config['agent']['title']['disable']


def test_direct_reader_capability_cannot_cross_into_next_job(setup):
    client,_,_,headers=setup
    body={'tool':'search','query':'public'}
    assert client.post('/internal/opencode/reader',headers=headers,json=body).status_code==200
    assert client.post('/internal/opencode/reader',headers={'Authorization':'Bearer synthetic-reader-token-with-32-characters'},json=body).status_code==403
    with db() as conn:
        row=conn.execute('SELECT context FROM opencode_lease').fetchone()
        ctx=json.loads(row[0]); ctx['direct_token']='replacement-job-token-with-at-least-32-characters'
        conn.execute('UPDATE opencode_lease SET context=?',(json.dumps(ctx),))
    assert client.post('/internal/opencode/reader',headers=headers,json=body).status_code==403


def test_child_environment_does_not_inherit_desktop_or_unrelated_credentials(tmp_path,monkeypatch):
    monkeypatch.setenv('OPENCODE_UPSTREAM_API_KEY','synthetic-service-key')
    monkeypatch.setenv('OPENAI_API_KEY','must-not-inherit')
    monkeypatch.setenv('GITHUB_TOKEN','must-not-inherit')
    monkeypatch.setenv('OPENCODE_AUTH_CONTENT','must-not-inherit')
    monkeypatch.setenv('OPENCODE_PURE','true')
    env=direct.environment(tmp_path,'mimo-v2.6-flash-free','lease-token-with-at-least-32-characters')
    assert 'OPENCODE_PURE' not in env
    assert all(k not in env for k in ('OPENAI_API_KEY','GITHUB_TOKEN','OPENCODE_AUTH_CONTENT','OPENCODE_UPSTREAM_API_KEY'))
    assert env['OPENCODE_GATEWAY_TOKEN']==env['NEXORA_DIRECT_LEASE_TOKEN']
    assert env['NEXORA_DIRECT_PROVIDER_KEY']=='synthetic-service-key'
    assert env['OPENCODE_EXPERIMENTAL_NATIVE_LLM']=='false'


def test_direct_prototype_stays_public_even_with_old_longcat_private_opt_in(setup,monkeypatch):
    client,_,_,_=setup
    monkeypatch.setenv('OPENCODE_PRIVATE_MODELS','longcat-2.5-preview-free')
    assert oc.private_allowed('longcat-2.5-preview-free')
    previous=oc.status()
    for model in previous['models']: model['private_allowed']=True
    monkeypatch.setattr(oc,'status',lambda:previous)
    models=client.get('/api/research/chats/config').json()['opencode']['models']
    assert all(model['private_allowed'] is False for model in models)
    response=client.post('/api/research/chats',json={'engine':'opencode','model':direct.DEFAULT_MODEL,'external_data_ack':True,'settings':{'research_notes':'Private fixture must never be sent'}})
    assert response.status_code==422 and response.json()['detail']=='opencode_public_sources_only'
