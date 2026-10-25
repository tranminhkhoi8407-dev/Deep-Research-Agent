"""Default-public PDF processing for Muse: ownership, history and bounded context."""
import json
import pytest
import pymupdf
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from backend.main import app
from backend.auth import current_user
from backend import research_chat as chats, opencode_direct as direct, opencode_runtime as oc, chat_attachments as files
from backend.research_chat_store import db, update_job

REAL_RUN = chats.run_turn


def pdf_bytes(text='Public synthetic PDF. The sample experiment used 42 trials. PDF_TEST_ANCHOR.'):
    with pymupdf.open() as doc:
        doc.new_page().insert_text((50,70),text)
        return doc.tobytes()


@pytest.fixture
def fixture(tmp_path,monkeypatch):
    monkeypatch.setenv('RESEARCH_CHAT_DATABASE_PATH',str(tmp_path/'chat.db'))
    monkeypatch.setenv('REPORTS_DIR',str(tmp_path/'reports'))
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED','true')
    monkeypatch.setenv('OPENCODE_UPSTREAM_API_KEY','synthetic-key-never-sent')
    fake_cli = tmp_path / 'opencode-fixture'
    fake_cli.touch()
    monkeypatch.setattr(direct, 'binary', lambda: fake_cli)
    monkeypatch.setattr(chats,'run_turn',lambda _:None)
    monkeypatch.setattr(oc,'status',lambda:{'configured':False,'ready':False,'code':'opencode_unreachable','models':[{'id':direct.DEFAULT_MODEL,'name':'Muse Spark 1.3 Free','ready':False,'code':'opencode_unreachable','private_allowed':False,'policy':'training_data'}]})
    app.dependency_overrides[current_user]=lambda:{'id':'owner'}
    with TestClient(app) as client:
        cid=client.post('/api/research/chats',json={'engine':'opencode','external_data_ack':True}).json()['id']
        uploaded=client.post('/api/research/chats/attachments',headers={'X-Attachment-Name':'public.PDF'},content=pdf_bytes())
        assert uploaded.status_code==201,uploaded.text
        yield client,cid,uploaded.json()['id']
    app.dependency_overrides.pop(current_user,None)


def send(client,cid,aid,**changes):
    return client.post('/api/research/chats/'+cid+'/messages',json={'client_id':'pdf-first','text':'Explain the public PDF.','attachment_ids':[aid],**changes})


def test_pdf_defaults_public_processing_without_consent_or_general_private_permission(fixture):
    client,cid,aid=fixture
    config=client.get('/api/research/chats/config').json()['opencode']['models'][0]
    assert config['pdf_attachments'] and not config['private_allowed']
    assert not oc.private_allowed(direct.DEFAULT_MODEL)
    accepted=send(client,cid,aid);assert accepted.status_code==202,accepted.text
    assert send(client,cid,aid).json()['id']==accepted.json()['id']
    assert send(client,cid,aid,attachment_data_ack=False).json()['id']==accepted.json()['id']
    assert send(client,cid,aid,attachment_data_ack=True).status_code==409  # Old request fingerprints stay meaningful.
    with db() as conn:
        request=json.loads(conn.execute('SELECT request FROM research_chat_jobs WHERE id=?',(accepted.json()['id'],)).fetchone()[0])
        assert request['attachment_data_policy']=='public_pdf_default_v1'
        assert request['attachment_data_ack'] is False  # Never manufacture user consent.
    update_job(accepted.json()['id'],status='completed')
    assert send(client,cid,aid,client_id='pdf-followup',attachment_ids=[],attachment_data_ack=False,text='What was the trial count?').status_code==202


def test_foreign_files_and_other_formats_cannot_use_pdf_opt_in(fixture):
    client,cid,aid=fixture
    for name,content in [('notes.txt',b'Not a PDF'),('fake.pdf',b'Not PDF data')]:
        upload=client.post('/api/research/chats/attachments',headers={'X-Attachment-Name':name},content=content)
        if name=='fake.pdf': assert upload.status_code==422
        else: assert send(client,cid,upload.json()['id']).json()['detail']=='opencode_pdf_only'
    app.dependency_overrides[current_user]=lambda:{'id':'other'}
    foreign=client.post('/api/research/chats/attachments',headers={'X-Attachment-Name':'other.pdf'},content=pdf_bytes()).json()['id']
    app.dependency_overrides[current_user]=lambda:{'id':'owner'}
    assert send(client,cid,foreign).status_code==404
    assert send(client,cid,aid,action='report').json()['detail']=='attachment_chat_only'


def test_readable_pdf_text_enters_muse_packet_never_original_bytes_or_fake_evidence(fixture,monkeypatch):
    client,cid,aid=fixture
    packets=[]
    class Runtime:
        def __init__(self,*args): pass
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def invoke(self,*args,**kwargs): raise AssertionError('No report/inference adapter')
        def prompt(self,system,text,**kwargs):
            assert 'untrusted context' in system and 'current_user_request' in system
            packets.append(json.loads(text))
            return {},AIMessage(content='Synthetic answer using the PDF excerpt.')
    monkeypatch.setattr(chats.interactive,'InteractiveOpenCodeTurn',Runtime)
    accepted=send(client,cid,aid,text='').json();REAL_RUN(accepted['id'])
    detail=client.get('/api/research/chats/'+cid).json()
    assert detail['jobs'][0]['status']=='completed'
    assert 'PDF_TEST_ANCHOR' in packets[0]['attached_text_untrusted'][0]['excerpt']
    assert packets[0]['read_excerpts']==[] and packets[0]['attached_images_count']==0
    assert 'attachments without a text message' in packets[0]['current_user_request']
    assert '%PDF-' not in json.dumps(packets[0])
    follow=send(client,cid,aid,client_id='follow-pdf-context',attachment_ids=[],attachment_data_ack=False).json()
    REAL_RUN(follow['id']);assert 'PDF_TEST_ANCHOR' in packets[1]['attached_text_untrusted'][0]['excerpt']


def test_legacy_pdf_history_without_ack_uses_default_processing_but_is_not_published(fixture):
    client,cid,aid=fixture
    job=send(client,cid,aid).json();update_job(job['id'],status='completed')
    with db() as conn:
        body=json.loads(conn.execute('SELECT request FROM research_chat_jobs WHERE id=?',(job['id'],)).fetchone()[0])
        body.pop('attachment_data_ack')
        conn.execute('UPDATE research_chat_jobs SET request=? WHERE id=?',(json.dumps(body),job['id']))
    assert send(client,cid,aid,client_id='default-public-history',attachment_ids=[],attachment_data_ack=False).status_code==202
    app.dependency_overrides[current_user]=lambda:{'id':'other'}
    assert client.get('/api/research/chats/attachments/'+aid+'/content').status_code==404
    assert client.get('/api/research/chats/'+cid).status_code==404


def test_historical_transports_do_not_gain_pdf_or_private_notes_access(fixture):
    client,cid,aid=fixture
    for binding in [{},{'transport':direct.TRANSPORT}]:
        with db() as conn:conn.execute('UPDATE research_conversations SET runtime_binding=? WHERE id=?',(json.dumps(binding),cid))
        assert send(client,cid,aid).json()['detail']=='opencode_public_sources_only'
    assert client.post('/api/research/chats',json={'engine':'opencode','external_data_ack':True,'settings':{'research_notes':'Private'}}).status_code==422


def test_utf8_pdf_excerpts_are_bounded_and_partial(fixture):
    client,cid,aid=fixture
    with db() as conn: conn.execute('UPDATE research_chat_attachments SET text=? WHERE id=?',('Nghiên cứu dữ liệu công khai. '*4000,aid))
    assert send(client,cid,aid).status_code==202
    texts,images=files.context(cid,'owner',max_text_bytes=10000)
    assert not images and texts[0]['partial']
    assert sum(len(item['excerpt'].encode('utf-8')) for item in texts)<=10000


def test_scan_and_encrypted_pdf_fail_before_any_model_call(fixture):
    client,_,_=fixture
    with pymupdf.open() as doc:
        doc.new_page()
        scan=doc.tobytes()
        encrypted=doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,owner_pw='synthetic-owner',user_pw='synthetic-user')
    for content,code in [(scan,'attachment_no_text'),(encrypted,'attachment_invalid_document')]:
        result=client.post('/api/research/chats/attachments',headers={'X-Attachment-Name':'blocked.pdf'},content=content)
        assert result.status_code==422 and result.json()['detail']==code
    with db() as conn: assert conn.execute('SELECT count(*) FROM research_chat_jobs').fetchone()[0]==0
