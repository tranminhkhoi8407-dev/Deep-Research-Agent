"""Real CLI + real guard integration; isolated DBs and synthetic API by default.

--live opts in to a small public MiMo exchange. No documents, desktop auth,
production conversation changes, fabricated headers or paid-model fallback.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--model', choices=['mimo-v2.6-flash-free', 'longcat-2.5-preview-free'], default='mimo-v2.6-flash-free')
    args = parser.parse_args()
    import httpx
    import uvicorn
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
    parent = ROOT/'tmp/research-visuals-qa'; parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='direct-protocol-', dir=parent))
    os.environ.update(RESEARCH_CHAT_DATABASE_PATH=str(work/'chats.db'), AUTH_DATABASE_PATH=str(work/'auth.db'),
                      REPORTS_DIR=str(work/'reports'), RESEARCH_DATA_DIR=str(work/'documents'),
                      OPENCODE_DIRECT_ENABLED='true', OPENCODE_GATEWAY_TOKEN='synthetic-reader-token-with-at-least-32-characters',
                      OPENCODE_DIRECT_CONTROL_URL=f'http://127.0.0.1:{port}/internal/opencode/direct',
                      OPENCODE_READER_URL=f'http://127.0.0.1:{port}/internal/opencode/reader')
    from backend.main import app
    from backend.auth import current_user
    from backend import opencode_direct as direct, opencode_runtime as oc, research_chat as chats
    app.dependency_overrides[current_user] = lambda: {'id':'direct-fixture-owner'}
    direct.owned_folder = lambda convo: work/'conversations'/convo['id']
    real_environment = direct.environment
    provider_calls = []
    mode = {'unsafe_tool': True, 'stall': False}
    oc.status = lambda: {'configured':True,'ready':False,'code':'opencode_unreachable','models':[{'id':model,'name':oc.MODEL_POLICIES[model][0],'policy':oc.MODEL_POLICIES[model][1],'private_allowed':False,'ready':True,'code':'ready'} for model in direct.MODELS]}
    if not args.live:
        os.environ['OPENCODE_UPSTREAM_API_KEY'] = 'synthetic-key-never-sent-to-public-provider'
        direct.PLUGIN = ROOT/'tests/fixtures/opencode_direct_fixture.mjs'
        def environment(*values):
            env = real_environment(*values)
            env['NEXORA_DIRECT_FIXTURE_URL'] = f'http://127.0.0.1:{port}/offline/direct-provider/chat/completions'
            return env
        direct.environment = environment

    from fastapi import Request
    from fastapi.responses import StreamingResponse
    @app.post('/offline/direct-provider/chat/completions')
    async def provider(request: Request):
        assert not args.live
        value = await request.json()
        assert value['model'] == args.model
        assert value['max_tokens'] <= 1800
        tools = {tool['function']['name'] for tool in value.get('tools', [])}
        assert 'bash' in tools, 'Genuine OpenCode tools must be present, not fabricated or stripped'
        provider_calls.append({'model':value['model'], 'cap':value['max_tokens']})
        if mode['stall']:
            import asyncio
            async def delayed():
                await asyncio.sleep(40)
                yield 'data: [DONE]\n\n'
            return StreamingResponse(delayed(), media_type='text/event-stream')
        if mode['unsafe_tool']:
            mode['unsafe_tool'] = False
            delta = {'tool_calls':[{'index':0,'id':'unsafe-shell-fixture','type':'function','function':{'name':'bash','arguments':json.dumps({'command':'echo forbidden > forbidden.txt','description':'Synthetic security probe'})}}]}
        else:
            delta = {'content':'DIRECT-FIXTURE-OK'}
        chunk = {'id':'fixture','object':'chat.completion.chunk','created':int(time.time()),'model':value['model'],'choices':[{'index':0,'delta':{'role':'assistant',**delta},'finish_reason':None}]}
        end = {**chunk,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if 'tool_calls' in delta else 'stop'}],'usage':{'prompt_tokens':120,'completion_tokens':30,'total_tokens':150}}
        body = 'data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n'
        return StreamingResponse(iter([body]),media_type='text/event-stream')
    config = uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error',access_log=False)
    server = uvicorn.Server(config); thread = threading.Thread(target=server.run,daemon=True); thread.start()
    deadline=time.time()+15
    while not server.started and time.time()<deadline:
        time.sleep(.1)
    if not server.started: raise RuntimeError('isolated backend did not start')
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=10,trust_env=False) as client:
            def historical_conversation():
                from backend.research_chat_store import db
                created=client.post('/api/research/chats',json={'engine':'nexora'})
                assert created.status_code==201
                cid=created.json()['id']
                with db() as conn:
                    conn.execute("UPDATE research_conversations SET engine='opencode',model=?,external_ack=1,runtime_binding=? WHERE id=?",(args.model,json.dumps({'transport':direct.TRANSPORT}),cid))
                return client.get('/api/research/chats/'+cid)
            response=historical_conversation()
            assert response.status_code==200, response.status_code
            convo=response.json(); cid=convo['id']; assert convo['runtime_transport']=='direct_v1'
            def turn(text, client_id, expected='completed'):
                accepted=client.post('/api/research/chats/'+cid+'/messages',json={'text':text,'client_id':client_id})
                assert accepted.status_code==202, accepted.status_code
                limit=time.time()+95
                while time.time()<limit:
                    current=client.get('/api/research/chats/'+cid).json()
                    job=current['jobs'][0]
                    if job['status'] not in {'queued','running'}:
                        print(json.dumps({'live':args.live,'status':job['status'],'error_code':job.get('error_code'),'usage':job.get('usage'), 'user_documents_sent':False,'paid_fallback':False}))
                        assert job['status']==expected, job.get('error_code')
                        return current
                    time.sleep(.25)
                raise RuntimeError('isolated direct run timed out')
            first=turn('Reply exactly OK. No tools. Public connectivity test.' if args.live else 'Public synthetic probe.','direct-probe-first')
            from backend.research_chat_store import db
            with db() as conn:
                session=conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]
            assert session
            second=turn('Reply exactly OK AGAIN. No tools. Public follow-up test.' if args.live else 'Public synthetic follow-up.','direct-probe-second')
            with db() as conn:
                assert conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]==session
            if not args.live:
                assert first['jobs'][0]['usage']['tools_blocked']>=1
                assert not list(work.rglob('forbidden.txt'))
                assert len(provider_calls)==3, 'Only bounded tool-result continuation is allowed; no retry or model switch'
                mode['stall']=True
                accepted=client.post('/api/research/chats/'+cid+'/messages',json={'text':'Public stop fixture','client_id':'direct-stop-fixture'})
                assert accepted.status_code==202
                limit=time.time()+25
                while len(provider_calls)<4 and time.time()<limit: time.sleep(.1)
                assert len(provider_calls)==4
                assert client.post('/api/research/chats/'+cid+'/stop').status_code==200
                limit=time.time()+8
                while time.time()<limit:
                    stopped=client.get('/api/research/chats/'+cid).json()['jobs'][0]
                    if stopped['status']=='cancelled': break
                    time.sleep(.1)
                assert stopped['status']=='cancelled', stopped.get('error_code')
                mode['stall']=False
                turn('Public continuation after stop.','direct-after-stop')
                with db() as conn:
                    assert conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]==session
                original_profile=direct.profile
                direct.profile=lambda model: {**original_profile(model),'plugin':[]}
                created=historical_conversation().json()
                cid=created['id']
                missing=turn('Public missing-guard fixture.','direct-missing-guard',expected='failed')
                assert missing['jobs'][0]['error_code']=='opencode_direct_guard_missing'
                assert missing['jobs'][0]['usage']['calls']==0
                assert len(provider_calls)==5, 'Missing plugin never contacts even the synthetic provider'
                direct.profile=original_profile
            print(json.dumps({'result':'passed','model':args.model,'real_cli':'1.19.0','same_session_across_process_restart':True,'dangerous_tool_execution':False,'synthetic_provider_calls':len(provider_calls),'live':args.live}))
    finally:
        server.should_exit=True; thread.join(timeout=10)


if __name__=='__main__':
    main()
