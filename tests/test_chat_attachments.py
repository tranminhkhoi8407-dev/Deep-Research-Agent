"""Owned intake and transport checks; every model call is offline/mocked."""
import io
import asyncio
import json
import time
import zipfile
from types import SimpleNamespace

import pytest
from PIL import Image
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from backend.main import app
from backend.auth import current_user
from backend import research_chat as chats, chat_attachments as files, opencode_runtime as oc, opencode_native as native
from backend.research_chat_store import db

REAL_RUN = chats.run_turn


@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv('OPENCODE_DIRECT_ENABLED', 'false')
    monkeypatch.setenv('RESEARCH_CHAT_DATABASE_PATH', str(tmp_path / 'chat.db'))
    monkeypatch.setattr(chats, 'run_turn', lambda _: None)
    monkeypatch.setattr(files, 'image_supported', lambda: True)
    monkeypatch.setattr(oc, 'status', lambda: {'configured': True, 'ready': True, 'code': 'ready', 'models': []})
    app.dependency_overrides[current_user] = lambda: {'id': 'owner'}
    yield
    app.dependency_overrides.pop(current_user, None)


def image_bytes():
    output = io.BytesIO(); Image.new('RGB', (40, 20), 'blue').save(output, 'PNG'); return output.getvalue()


def upload(client, name='notes.txt', content=b'An untrusted research note with no instructions.'):
    return client.post('/api/research/chats/attachments', content=content, headers={'X-Attachment-Name': name})


def create(client, **extra):
    legacy = extra.get('engine') == 'opencode'
    response = client.post('/api/research/chats', json={k:v for k,v in extra.items() if not legacy or k not in {'engine','model','external_data_ack'}})
    assert response.status_code == 201, response.text
    cid=response.json()['id']
    if legacy:
        with db() as conn:
            conn.execute("UPDATE research_conversations SET engine='opencode',model=?,external_ack=1 WHERE id=?", (extra['model'],cid))
    return cid


def send(client, cid, aid, **extra):
    return client.post(f'/api/research/chats/{cid}/messages', json={'client_id': 'attachment-001', 'text': '', 'attachment_ids': [aid], **extra})


def test_config_and_upload_owner_content_delete(setup):
    with TestClient(app) as client:
        assert client.get('/api/research/chats/config').json()['attachments']['max_files'] == 5
        result = upload(client); assert result.status_code == 201
        metadata = result.json(); aid = metadata['id']
        assert not any(key in metadata for key in ('text', 'content', 'owner_id'))
        assert len(aid) == 32
        content = client.get(f'/api/research/chats/attachments/{aid}/content')
        assert content.status_code == 200 and content.headers['x-content-type-options'] == 'nosniff'
        assert content.headers['content-disposition'] == 'attachment'
        app.dependency_overrides[current_user] = lambda: {'id': 'other'}
        assert client.get(f'/api/research/chats/attachments/{aid}/content').status_code == 404
        assert client.delete(f'/api/research/chats/attachments/{aid}').status_code == 404
        cid = create(client); assert send(client, cid, aid).status_code == 404
        app.dependency_overrides[current_user] = lambda: {'id': 'owner'}
        assert client.delete(f'/api/research/chats/attachments/{aid}').status_code == 204
        assert client.get(f'/api/research/chats/attachments/{aid}/content').status_code == 404


@pytest.mark.parametrize('name,content,status,code', [
    ('empty.txt', b'', 422, 'attachment_empty'),
    ('active.svg', b'<svg><script>bad</script></svg>', 415, 'attachment_unsupported_type'),
    ('bad.pdf', b'fake PDF', 422, 'attachment_invalid_document'),
    ('binary.txt', b'\x00\x01hidden', 422, 'attachment_invalid_document'),
    ('bad.png', b'not an image', 422, 'attachment_invalid_document'),
    ('bad.docx', b'not a ZIP', 422, 'attachment_invalid_document'),
])
def test_invalid_intake_never_stores_or_runs_models(setup, name, content, status, code):
    with TestClient(app) as client:
        response = upload(client, name, content)
        assert response.status_code == status and response.json()['detail'] == code
        with db() as conn: assert conn.execute('SELECT count(*) FROM research_chat_attachments').fetchone()[0] == 0


def test_size_bounds_origin_and_names(setup, monkeypatch):
    monkeypatch.setattr(files, 'MAX_FILE_BYTES', 50)
    with TestClient(app) as client:
        assert upload(client, content=b'a' * 51).status_code == 413
        response = client.post('/api/research/chats/attachments', content=b'text', headers={'Origin': 'https://evil.example', 'X-Attachment-Name': 'notes.txt'})
        assert response.status_code == 403
        assert upload(client, '../../notes.txt', b'safe').json()['name'] == 'notes.txt'


def test_images_reencoded_and_history_survives_idempotent_send(setup):
    with TestClient(app) as client:
        result = upload(client, 'sample.png', image_bytes()); assert result.status_code == 201
        metadata = result.json(); aid = metadata['id']; cid = create(client)
        original = client.get(f'/api/research/chats/attachments/{aid}/content')
        assert original.headers['content-type'] == 'image/jpeg' and original.content.startswith(b'\xff\xd8')
        job = send(client, cid, aid); assert job.status_code == 202
        assert send(client, cid, aid).json()['id'] == job.json()['id']
        assert client.delete(f'/api/research/chats/attachments/{aid}').status_code == 409
        detail = client.get(f'/api/research/chats/{cid}').json()
        assert len(detail['messages']) == 1 and detail['messages'][0]['attachments'][0]['name'] == 'sample.png'
        assert 'base64' not in json.dumps(detail) and 'owner_id' not in json.dumps(detail)
        texts, images = files.context(cid, 'owner'); assert not texts and len(images) == 1
        assert files.context(cid, 'other') == ([], [])


def test_pdf_docx_and_partial_text(setup):
    import pymupdf
    document = pymupdf.open(); page = document.new_page(); page.insert_text((40, 40), 'Readable synthetic PDF only.')
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Readable DOCX text.</w:t></w:r></w:p></w:body></w:document>')
    with TestClient(app) as client:
        assert upload(client, 'source.pdf', document.tobytes()).status_code == 201
        assert upload(client, 'source.docx', archive.getvalue()).status_code == 201
        assert upload(client, 'large.txt', b'x' * 20001).json()['warning'] == 'attachment_partial'
        document = pymupdf.open(); document.new_page()
        assert upload(client, 'scan.pdf', document.tobytes()).json()['detail'] == 'attachment_no_text'


def test_model_permission_and_report_routes_do_not_ignore_files(setup, monkeypatch):
    with TestClient(app) as client:
        text_id = upload(client).json()['id']; image_id = upload(client, 'sample.png', image_bytes()).json()['id']
        cid = create(client)
        assert send(client, cid, text_id, action='report', text='Analyze report').json()['detail'] == 'attachment_chat_only'
        monkeypatch.setattr(files, 'image_supported', lambda: False)
        assert send(client, cid, image_id).json()['detail'] == 'attachment_image_not_supported'
        assert send(client, cid, text_id, attachment_ids=[text_id] * 2).json()['detail'] == 'attachment_count_limit'
        external = create(client, engine='opencode', model='mimo-v2.6-flash-free', external_data_ack=True)
        assert send(client, external, text_id).json()['detail'] == 'opencode_public_sources_only'
        assert send(client, external, text_id, attachment_ids=['../escape']).status_code == 422
        with db() as conn: assert conn.execute('SELECT count(*) FROM research_chat_jobs').fetchone()[0] == 0


def test_attachment_text_is_in_native_packet_not_evidence(setup, monkeypatch):
    packets = []
    def factory(jid):
        def invoke(schema, messages, **kwargs):
            packets.append(kwargs['prepared_payload'])
            return {'parsed': {'text': 'Offline fixture reply.'}, 'raw': AIMessage(content='')}
        return invoke
    monkeypatch.setattr(chats, 'native_invoke', factory)
    with TestClient(app) as client:
        aid = upload(client, content=b'Exact synthetic note: 42.').json()['id']; cid = create(client)
        job = send(client, cid, aid).json(); REAL_RUN(job['id'])
        assert client.get(f'/api/research/chats/{cid}').json()['jobs'][0]['status'] == 'completed'
        assert packets[0]['attached_text_untrusted'][0]['excerpt'] == 'Exact synthetic note: 42.'
        assert packets[0]['read_excerpts'] == []


def test_native_image_call_receives_only_owned_normalized_image(setup, monkeypatch):
    from agent import nodes, model_output
    monkeypatch.setattr(nodes, 'get_llm', lambda: SimpleNamespace())
    captured = []
    def structured(llm, schema, messages, **kwargs):
        captured.extend(messages); return {'parsed': {'text': 'Image fixture reply.'}, 'raw': AIMessage(content='')}
    monkeypatch.setattr(model_output, 'structured_invoke', structured)
    with TestClient(app) as client:
        aid = upload(client, 'owned.png', image_bytes()).json()['id']; cid = create(client)
        job = send(client, cid, aid).json(); REAL_RUN(job['id'])
        assert client.get(f'/api/research/chats/{cid}').json()['jobs'][0]['status'] == 'completed'
        assert isinstance(captured[1], HumanMessage)
        assert captured[1].content[1]['image_url']['url'].startswith('data:image/jpeg;base64,')


def test_unknown_capability_fails_closed(monkeypatch):
    from agent import nodes
    monkeypatch.setattr(nodes, 'get_llm', lambda: SimpleNamespace(profile=None)); assert not files.image_supported()
    monkeypatch.setattr(nodes, 'get_llm', lambda: SimpleNamespace(profile={'image_inputs': True})); assert files.image_supported()


def test_all_current_documents_have_context_even_when_partial(setup):
    with TestClient(app) as client:
        aids = [upload(client, f'file{i}.txt', b'x' * 19000).json()['id'] for i in range(5)]
        cid = create(client); assert send(client, cid, aids[0], attachment_ids=aids).status_code == 202
        text, _ = files.context(cid, 'owner'); assert len(text) == 5
        assert sum(len(item['excerpt']) for item in text) <= 16000
        assert all(item['partial'] for item in text)


def test_opencode_native_gateway_injects_owned_images_but_rejects_foreign_urls(setup, monkeypatch):
    captured = []
    class Model:
        _llm_type = 'google-genai'; model = 'fixture-vision'
        async def ainvoke(self, messages):
            captured.extend(messages); return AIMessage(content='Offline vision response.')
    llm = Model()
    monkeypatch.setattr(native, 'configured_llm', lambda: llm)
    monkeypatch.setattr(native, 'bounded_model', lambda *args: llm)
    monkeypatch.setattr(native, 'cancelled', lambda _: False)
    context = {'owner': 'owner', 'binding': native.binding_for(llm), 'chat_images': [{'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,owned-test-fixture'}}]}
    payload = {'messages': [{'role': 'system', 'content': 'Research only'}, {'role': 'user', 'content': 'Explain the attached image.'}]}
    value = asyncio.run(native.completion(payload, context, 'session-fixture', 'job-fixture', 1000, time.time() + 30))
    assert value['choices'][0]['message']['content'] == 'Offline vision response.'
    assert captured[-1].content[1] == context['chat_images'][0]
    payload['messages'][-1]['content'] = [{'type': 'image_url', 'image_url': {'url': 'http://169.254.169.254/private'}}]
    with pytest.raises(native.NativeAdapterError, match='opencode_unsupported_content'):
        asyncio.run(native.completion(payload, context, 'session-fixture', 'job-fixture', 1000, time.time() + 30))
