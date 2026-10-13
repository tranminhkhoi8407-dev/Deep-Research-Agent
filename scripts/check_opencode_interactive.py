"""Real OpenCode server + guard + native question integration in isolated profiles.

Default is an offline Responses fixture. --live uses only Muse Contributor Free,
public synthetic prompts and the existing server key; never paid fallback.
"""
import argparse
import asyncio
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
    parser.add_argument('--pdf', action='store_true', help='Test an owned public synthetic PDF through extraction and the genuine Muse runtime')
    args = parser.parse_args()
    import httpx
    import uvicorn
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
    parent = ROOT/'tmp/research-visuals-qa'; parent.mkdir(parents=True,exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='muse-hil-',dir=parent))
    os.environ.update(RESEARCH_CHAT_DATABASE_PATH=str(work/'chat.db'),AUTH_DATABASE_PATH=str(work/'auth.db'),
        REPORTS_DIR=str(work/'reports'),RESEARCH_DATA_DIR=str(work/'documents'),OPENCODE_DIRECT_ENABLED='true',
        OPENCODE_DIRECT_CONTROL_URL=f'http://127.0.0.1:{port}/internal/opencode/direct',
        OPENCODE_READER_URL=f'http://127.0.0.1:{port}/internal/opencode/reader')
    from backend.main import app
    from backend.auth import current_user
    from backend import opencode_direct as direct, opencode_runtime as oc
    from backend.research_chat_store import db
    app.dependency_overrides[current_user] = lambda: {'id':'muse-hil-fixture'}
    direct.owned_folder = lambda convo: work/'conversations'/convo['id']
    original_environment = direct.environment
    calls = []
    mode = {'ask':True,'unsafe':False,'stall':False}
    if args.pdf:
        mode['ask'] = False
    if not args.live:
        os.environ['OPENCODE_UPSTREAM_API_KEY'] = 'synthetic-key-never-sent-to-public-provider'
        direct.PLUGIN = ROOT/'tests/fixtures/opencode_direct_fixture.mjs'
        def environment(*values):
            env = original_environment(*values)
            env['NEXORA_DIRECT_FIXTURE_URL'] = f'http://127.0.0.1:{port}/offline/muse/responses'
            return env
        direct.environment = environment
    oc.status = lambda: {'configured':False,'ready':False,'code':'opencode_unreachable','models':[{'id':m,'name':oc.MODEL_POLICIES[m][0],'policy':oc.MODEL_POLICIES[m][1],'private_allowed':False,'ready':True,'code':'ready'} for m in direct.MODELS]}
    from fastapi import Request
    from fastapi.responses import StreamingResponse
    @app.post('/offline/muse/responses')
    async def provider(request: Request):
        assert not args.live
        body = await request.json()
        assert body['model'] == direct.DEFAULT_MODEL and body['max_output_tokens'] <= 1800
        assert body['store'] is False and 'messages' not in body
        names = {item.get('name') for item in body.get('tools',[]) if item.get('type')=='function'}
        assert {'bash','question'} <= names, 'Keep genuine OpenCode schemas; guard execution instead'
        calls.append({'input':body['input'],'tools':names})
        if args.pdf:
            assert 'PDF_TEST_ANCHOR' in json.dumps(body['input']), 'Extracted PDF text must reach the genuine SDK request'
            assert '%PDF-' not in json.dumps(body['input']), 'Original PDF bytes never enter the model request'
        if mode['stall']:
            async def delayed():
                await asyncio.sleep(40)
                yield ''
            return StreamingResponse(delayed(),media_type='text/event-stream')
        rid = 'resp_fixture_'+str(len(calls))
        if mode['ask'] or mode['unsafe']:
            unsafe = mode['unsafe']; mode['ask'] = mode['unsafe'] = False
            tool = 'bash' if unsafe else 'question'
            params = {'command':'echo forbidden > forbidden.txt','description':'Synthetic security probe'} if unsafe else {'questions':[{'header':'Goal','question':'Bạn muốn học nguyên lý hay triển khai thực tế?','options':[{'label':'Học nguyên lý','description':'Giải thích nền tảng'},{'label':'Triển khai','description':'Các bước ứng dụng'}],'multiple':False}]}
            item = {'id':'fc_'+rid,'type':'function_call','status':'completed','call_id':'call_'+rid,'name':tool,'arguments':json.dumps(params,ensure_ascii=False)}
            events = [('response.output_item.added',{'output_index':0,'item':{**item,'arguments':''}}),
                ('response.function_call_arguments.delta',{'item_id':item['id'],'output_index':0,'delta':item['arguments']}),
                ('response.function_call_arguments.done',{'item_id':item['id'],'output_index':0,'arguments':item['arguments']}),
                ('response.output_item.done',{'output_index':0,'item':item})]
        else:
            item={'id':'msg_'+rid,'type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'MUSE-FIXTURE-OK','annotations':[]}]}
            events=[('response.output_item.added',{'output_index':0,'item':{**item,'status':'in_progress','content':[]}}),
                ('response.content_part.added',{'item_id':item['id'],'output_index':0,'content_index':0,'part':{'type':'output_text','text':'','annotations':[]}}),
                ('response.output_text.delta',{'item_id':item['id'],'output_index':0,'content_index':0,'delta':'MUSE-FIXTURE-OK'}),
                ('response.output_text.done',{'item_id':item['id'],'output_index':0,'content_index':0,'text':'MUSE-FIXTURE-OK'}),
                ('response.output_item.done',{'output_index':0,'item':item})]
        response={'id':rid,'object':'response','created_at':int(time.time()),'model':direct.DEFAULT_MODEL,'status':'completed','output':[item],'usage':{'input_tokens':120,'output_tokens':30,'total_tokens':150}}
        events=[('response.created',{'response':{**response,'status':'in_progress','output':[]}}),*events,('response.completed',{'response':response})]
        data=''.join('event: '+name+'\ndata: '+json.dumps({'type':name,**value})+'\n\n' for name,value in events)
        return StreamingResponse(iter([data]),media_type='text/event-stream')
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error',access_log=False))
    thread=threading.Thread(target=server.run,daemon=True); thread.start()
    deadline=time.time()+15
    while not server.started and time.time()<deadline: time.sleep(.1)
    assert server.started
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=10,trust_env=False) as client:
            created=client.post('/api/research/chats',json={'engine':'opencode','external_data_ack':True})
            assert created.status_code==201, created.text
            cid=created.json()['id']; assert created.json()['runtime_transport']=='direct_hil_v1'
            path='/api/research/chats/'+cid
            def wait(states, seconds=95):
                limit=time.time()+seconds
                while time.time()<limit:
                    detail=client.get(path).json(); job=detail['jobs'][0]
                    if job['status'] in states:
                        print(json.dumps({'live':args.live,'status':job['status'],'error_code':job.get('error_code'),'usage':job['usage']},ensure_ascii=False))
                        return detail
                    if job['status'] in {'failed','cancelled','interrupted'}:
                        print(json.dumps({'status':job['status'],'error_code':job.get('error_code'),'usage':job['usage']}))
                        raise AssertionError(job.get('error_code'))
                    if job['status']=='completed' and 'awaiting_input' in states:
                        print(json.dumps({'live':args.live,'status':'completed_without_question','usage':job['usage']}))
                        raise AssertionError('Model completed without invoking the question tool; no interactive success is claimed')
                    time.sleep(.25)
                raise AssertionError('Interactive integration timed out')
            if args.pdf:
                import pymupdf
                with pymupdf.open() as document:
                    document.new_page().insert_text((50,70),'Public synthetic PDF. The sample experiment used exactly 42 trials. PDF_TEST_ANCHOR.')
                    payload=document.tobytes()
                uploaded=client.post('/api/research/chats/attachments',headers={'X-Attachment-Name':'public-synthetic.pdf'},content=payload)
                assert uploaded.status_code==201
                value={'client_id':'muse-pdf-first','text':'Read the attached public synthetic PDF text. Reply with the exact number of trials in it, briefly. Do not use tools or ask questions.','attachment_ids':[uploaded.json()['id']]}
                assert client.post(path+'/messages',json=value).status_code==202
                first=wait({'completed'})
                if args.live: assert '42' in first['messages'][-1]['body'], 'Model must answer from the supplied PDF text'
                with db() as conn:
                    session=conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]
                follow={'client_id':'muse-pdf-followup','text':'In the same public PDF, what was the exact number of trials? Reply briefly. Do not use tools or ask questions.'}
                assert client.post(path+'/messages',json=follow).status_code==202
                second=wait({'completed'})
                if args.live: assert '42' in second['messages'][-1]['body']
                with db() as conn:
                    assert conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]==session
                print(json.dumps({'result':'passed','live':args.live,'public_pdf_text':True,'followup_same_session':True,'paid_fallback':False,'user_documents_sent':False}))
                return
            prompt='This is a public synthetic test. Use the question tool to ask whether I want a theoretical or practical explanation of RAG, with two options and custom text. Wait for my answer. Do not use other tools.' if args.live else 'Public clarification fixture.'
            assert client.post(path+'/messages',json={'client_id':'muse-hil-first','text':prompt}).status_code==202
            waiting=wait({'awaiting_input'})
            q=waiting['questions'][-1]
            with db() as conn:
                assert not conn.execute('SELECT 1 FROM opencode_lease').fetchone(), 'Human wait releases provider lease'
                session=conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]
            assert client.get(path).json()['questions'][-1]['id']==q['id'], 'Refresh preserves question'
            assert client.post(path+'/messages',json={'client_id':'while-waiting','text':'Unrelated message'}).status_code==409
            before=len(calls); time.sleep(1); assert len(calls)==before
            value={'answers':[['Please give a brief practical explanation. This is public synthetic input.']] if args.live else [['Triển khai']]}
            assert client.post(path+'/questions/'+q['id']+'/answer',json=value).status_code==200
            assert client.post(path+'/questions/'+q['id']+'/answer',json=value).status_code==200
            done=wait({'completed'})
            assert done['messages'][-1]['role']=='assistant'
            with db() as conn:
                assert conn.execute('SELECT runtime_session FROM research_conversations WHERE id=?',(cid,)).fetchone()[0]==session
            if not args.live:
                assert len(calls)==2 and any(item.get('type')=='function_call_output' and 'Triển khai' in item.get('output','') for item in calls[1]['input'])
                mode['unsafe']=True
                client.post(path+'/messages',json={'client_id':'muse-unsafe-probe','text':'Public host tool safety fixture.'})
                unsafe=wait({'completed'}); assert unsafe['jobs'][0]['usage']['tools_blocked']>=1
                assert not list(work.rglob('forbidden.txt'))
                mode['ask']=True
                client.post(path+'/messages',json={'client_id':'muse-stop-probe','text':'Public stop fixture.'})
                wait({'awaiting_input'}); client.post(path+'/stop'); wait({'cancelled'},seconds=10)
                mode['ask']=True
                client.post(path+'/messages',json={'client_id':'muse-skip-probe','text':'Public skip fixture.'})
                q=wait({'awaiting_input'})['questions'][-1]
                assert client.post(path+'/questions/'+q['id']+'/answer',json={'reject':True}).status_code==200
                wait({'completed'})
            print(json.dumps({'result':'passed','model':direct.DEFAULT_MODEL,'live':args.live,'native_question_reply':True,'same_session':True,'paid_fallback':False,'host_tool_execution':False}))
    finally:
        server.should_exit=True; thread.join(timeout=10)


if __name__=='__main__':
    main()
