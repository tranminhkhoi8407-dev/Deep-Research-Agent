"""Private notebook media, with synthetic images and no external HTTP."""
import base64
import io
import json
import os

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from PIL import Image
from pycrdt import Doc, XmlFragment, XmlElement
from backend.main import app
from backend.accounts import register_login
from backend.collaboration import db, document_state
from backend import notebook_media as media

@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv('AUTH_DATABASE_PATH', str(tmp_path / 'media.db'))
    monkeypatch.setenv('ADMIN_EMAILS', '')
    monkeypatch.setenv('APP_ENV', 'development')

def login(client, identifier):
    user = register_login({'id': 'google:' + identifier, 'provider': 'google', 'name': identifier, 'email': identifier + '@example.invalid', 'avatar_url': None, 'username': None})
    payload = base64.b64encode(json.dumps({'user': {'id': user['id']}, 'remember': False}).encode())
    client.cookies.set('deep_research_session', TimestampSigner(os.getenv('AUTH_SESSION_SECRET') or 'deep-research-local-development-only-secret').sign(payload).decode())
    assert client.put('/api/collab/identity', json={'name': identifier}).status_code == 200
    return user['id']

def page(client):
    result = client.put('/api/collab/field-workspaces/mathematics', json={})
    assert result.status_code == 200, result.text
    return result.json()['home_page_id']

def image():
    buffer = io.BytesIO()
    png = Image.new('RGBA', (60, 40), (30, 130, 220, 120))
    png.save(buffer, 'PNG')
    return buffer.getvalue()

def upload(client, pid, payload=None):
    return client.post(f'/api/collab/pages/{pid}/images', content=payload if payload is not None else image(), headers={'Content-Type': 'image/png', 'X-Image-Name': 'synthetic.png'})

def image_doc(aid):
    return Doc({'notebook': XmlFragment([XmlElement('blockGroup', contents=[XmlElement('blockContainer', attributes={'id': 'photo'}, contents=[XmlElement('notebookImage', attributes={'assetId': aid, 'name': 'Synthetic image', 'caption': 'A caption'})])])])})

def initialize(client, pid, doc):
    return client.post(f'/api/collab/pages/{pid}/initialize-blocks', json={'expected_revision': 0, 'update': base64.b64encode(doc.get_update()).decode()})

def test_upload_private_preview_dedup_alpha_and_metadata():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as anonymous:
        login(alice, 'Alice'); login(bob, 'Bob'); pid = page(alice)
        first = upload(alice, pid); assert first.status_code == 201, first.text
        aid = first.json()['id']; assert first.json()['width'] == 60
        assert upload(alice, pid).json()['id'] == aid
        content = alice.get(f'/api/collab/pages/{pid}/images/{aid}')
        assert content.status_code == 200 and content.headers['content-type'] == 'image/webp'
        assert content.headers['cache-control'] == 'private, no-store'
        assert content.headers['x-content-type-options'] == 'nosniff'
        with Image.open(io.BytesIO(content.content)) as decoded:
            assert 'A' in decoded.getbands() and not decoded.getexif()
        assert bob.get(f'/api/collab/pages/{pid}/images/{aid}').status_code == 404
        assert bob.get(f'/api/collab/images/{aid}').status_code == 404
        assert anonymous.get(f'/api/collab/pages/{pid}/images/{aid}').status_code == 401
        assert bob.post(f'/api/collab/pages/{pid}/images', content=image()).status_code == 404
        assert alice.post(f'/api/collab/pages/{pid}/images', content=image(), headers={'Origin': 'https://untrusted.invalid'}).status_code == 403

@pytest.mark.parametrize('payload', [b'', b'<svg xmlns="http://www.w3.org/2000/svg"/>', b'<html>image</html>', b'not-image'])
def test_reject_invalid_content_without_storing(payload):
    with TestClient(app) as alice:
        login(alice, 'Alice'); pid = page(alice)
        assert upload(alice, pid, payload).status_code == 422
        with db() as conn: assert conn.execute('SELECT count(*) FROM notebook_images').fetchone()[0] == 0

def test_bounded_size_dimensions_and_quota(monkeypatch):
    with TestClient(app) as alice:
        uid = login(alice, 'Alice'); pid = page(alice)
        assert upload(alice, pid, b'a' * (media.MAX_BYTES + 1)).status_code == 413
        monkeypatch.setattr(media, 'MAX_OWNER_BYTES', 1)
        assert upload(alice, pid).status_code == 413
        with db() as conn: assert conn.execute('SELECT count(*) FROM notebook_images WHERE owner_id=?', (uid,)).fetchone()[0] == 0

def test_shared_viewer_can_read_but_not_upload_and_revocation_is_immediate():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, 'Alice'); bid = login(bob, 'Bob'); pid = page(alice); aid = upload(alice, pid).json()['id']
        invite = alice.post(f'/api/collab/pages/{pid}/invites', json={'username': 'Bob', 'role': 'viewer'}).json()['invite']['id']
        assert bob.patch(f'/api/collab/invites/{invite}?action=accept').status_code == 200
        assert bob.get(f'/api/collab/pages/{pid}/images/{aid}').status_code == 200
        assert upload(bob, pid).status_code == 404
        assert alice.delete(f'/api/collab/pages/{pid}/shares/{bid}').status_code == 200
        assert bob.get(f'/api/collab/pages/{pid}/images/{aid}').status_code == 404

def test_image_url_import_uses_bounded_public_fetch_and_never_saves_source_credentials(monkeypatch):
    from agent import documents
    calls = []
    def fetch(url, **options):
        calls.append((url, options)); return image(), 'image/png', url
    monkeypatch.setattr(documents, 'fetch_public', fetch)
    with TestClient(app) as alice:
        login(alice, 'Alice'); pid = page(alice)
        result = alice.post(f'/api/collab/pages/{pid}/images/import', json={'url': 'https://example.invalid/a.png?signature=synthetic-private-query'})
        assert result.status_code == 201, result.text
        assert calls[0][1] == {'limit': media.MAX_BYTES, 'timeout': 6, 'deadline_seconds': 20}
        assert 'signature' not in result.text
        assert alice.post(f'/api/collab/pages/{pid}/images/import', json={'url': 'https://user:pass@example.invalid/a.png'}).status_code == 422
        assert len(calls) == 1
        monkeypatch.setattr(documents, 'fetch_public', lambda *a, **k: (_ for _ in ()).throw(ValueError('secret-internal-address')))
        denied = alice.post(f'/api/collab/pages/{pid}/images/import', json={'url': 'https://127.0.0.1/a.png'})
        assert denied.status_code == 422 and 'secret-internal-address' not in denied.text

def test_copy_and_duplicate_media_grants_do_not_publish_or_depend_on_original_page():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, 'Alice'); login(bob, 'Bob'); home, destination = page(alice), page(bob)
        project = alice.get(f'/api/collab/pages/{home}').json()['project']['id']
        origin = alice.post(f'/api/collab/projects/{project}/pages', json={'title': 'Source image page', 'parent_id': home}).json()['page']['id']
        aid = upload(alice, origin).json()['id']; doc = image_doc(aid)
        assert initialize(alice, origin, doc).status_code == 200
        denied = initialize(bob, destination, doc); assert denied.status_code == 403
        assert bob.get(f'/api/collab/pages/{destination}/images/{aid}').status_code == 404
        invite = alice.post(f'/api/collab/pages/{origin}/invites', json={'username': 'Bob', 'role': 'viewer'}).json()['invite']['id']
        bob.patch(f'/api/collab/invites/{invite}?action=accept')
        assert initialize(bob, destination, doc).status_code == 200
        assert bob.get(f'/api/collab/pages/{destination}/images/{aid}').status_code == 200
        clone = bob.post(f'/api/collab/pages/{destination}/duplicate').json()['page']['id']
        assert bob.get(f'/api/collab/pages/{clone}/images/{aid}').status_code == 200
        assert alice.post(f'/api/collab/pages/{origin}/archive').status_code == 200
        assert bob.get(f'/api/collab/pages/{origin}/images/{aid}').status_code == 404
        assert bob.get(f'/api/collab/pages/{clone}/images/{aid}').status_code == 200
        with db() as conn:
            saved, _ = document_state(conn, clone)
            assert media.document_images(saved) == {aid}

def test_media_grants_validate_all_ids_before_any_write():
    with TestClient(app) as alice:
        uid = login(alice, 'Alice'); pid = page(alice); aid = upload(alice, pid).json()['id']
        data = alice.get(f'/api/collab/pages/{pid}').json()
        other = alice.post(f"/api/collab/projects/{data['project']['id']}/pages", json={'title': 'Destination'}).json()['page']['id']
        with db() as conn:
            with pytest.raises(Exception): media.grant_images(conn, other, uid, [aid, 'f' * 32])
            assert not conn.execute('SELECT 1 FROM notebook_page_images WHERE page_id=?', (other,)).fetchone()


def test_forged_live_image_is_not_saved_and_user_can_repair_without_losing_text():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, 'Alice'); login(bob, 'Bob'); source, destination = page(alice), page(bob)
        aid = upload(alice, source).json()['id']
        doc = Doc({'notebook': XmlFragment([XmlElement('blockGroup', contents=[XmlElement('blockContainer', attributes={'id': 'keep'}, contents=[XmlElement('paragraph')])])])})
        assert initialize(bob, destination, doc).status_code == 200
        with db() as conn: saved, _ = document_state(conn, destination)
        before = saved.get_state()
        saved['notebook'].children[0].children.append(XmlElement('blockContainer', attributes={'id': 'forged'}, contents=[XmlElement('notebookImage', attributes={'assetId': aid})]))
        with bob.websocket_connect(f'/api/collab/pages/{destination}/live') as socket:
            while socket.receive_json()['type'] != 'ready': pass
            socket.send_json({'type': 'update', 'format': 'blocks', 'id': 'forged', 'data': base64.b64encode(saved.get_update(before)).decode()})
            for _ in range(20):
                result = socket.receive_json()
                if result['type'] == 'error': break
            assert result['type'] == 'error' and result['id'] == 'forged'
            assert bob.get(f'/api/collab/pages/{destination}/images/{aid}').status_code == 404
            with db() as conn:
                authoritative, _ = document_state(conn, destination)
                assert media.document_images(authoritative) == set()
            children = saved['notebook'].children[0].children
            del children[len(children) - 1]
            socket.send_json({'type': 'update', 'format': 'blocks', 'id': 'repaired', 'data': base64.b64encode(saved.get_update()).decode()})
            for _ in range(20):
                result = socket.receive_json()
                if result['type'] == 'ack': break
            assert result['type'] == 'ack' and result['id'] == 'repaired'


def test_private_image_url_is_blocked_before_any_http_request(monkeypatch):
    from agent import documents
    monkeypatch.setattr(documents.socket, 'getaddrinfo', lambda *args, **kwargs: [(2, 1, 6, '', ('127.0.0.1', 443))])
    monkeypatch.setattr(documents.httpx, 'Client', lambda *a, **k: pytest.fail('Private address must not create an HTTP client'))
    with TestClient(app) as alice:
        login(alice, 'Alice'); pid = page(alice)
        assert alice.post(f'/api/collab/pages/{pid}/images/import', json={'url': 'https://private.invalid/a.png'}).status_code == 422
