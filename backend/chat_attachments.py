"""Private chat intake: bounded parsing, opaque IDs, no external requests.

Attachments are untrusted conversation context, never verified source evidence.
No original HTML/SVG/executable is served inline. Images are decoded and stripped
of metadata; only normalized JPEGs enter model calls and preview responses.
"""
import base64
import io
import json
import threading
import time
import unicodedata
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree

from fastapi import HTTPException
from backend.research_chat_store import db, ident

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TURN_BYTES = 20 * 1024 * 1024
MAX_FILES = 5
MAX_IMAGES = 3
MAX_TEXT = 20000
MAX_OWNER_BYTES = 100 * 1024 * 1024
TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.log', '.py', '.js', '.ts', '.tsx', '.tex', '.yaml', '.yml'}
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}
_parse_slots = threading.BoundedSemaphore(2)


def limits():
    return {'max_file_bytes': MAX_FILE_BYTES, 'max_total_bytes': MAX_TURN_BYTES,
            'max_files': MAX_FILES, 'max_images': MAX_IMAGES,
            'extensions': sorted(TEXT_EXTENSIONS | IMAGE_EXTENSIONS | {'.pdf', '.docx'})}


def safe_name(value):
    name = unicodedata.normalize('NFC', value).replace('\\', '/').split('/')[-1]
    return ''.join(ch for ch in name if not unicodedata.category(ch).startswith('C'))[:180] or 'attachment'


def image_supported():
    # Provider packages expose maintained profiles. Unknown models fail closed;
    # capability is never guessed from a provider name or user-supplied flag.
    try:
        from agent.nodes import get_llm
        return (getattr(get_llm(), 'profile', None) or {}).get('image_inputs') is True
    except Exception:
        return False


def parse(content, name):
    if not content:
        raise HTTPException(422, 'attachment_empty')
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, 'attachment_too_large')
    extension = PurePosixPath(name).suffix.lower()
    if not _parse_slots.acquire(blocking=False):
        raise HTTPException(503, 'attachment_parser_busy')
    try:
        text, warning = '', ''
        if extension in IMAGE_EXTENSIONS:
            from PIL import Image, ImageOps
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as image:
                    if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > 20000000:
                        raise HTTPException(422, 'attachment_invalid_image')
                    image.load()
                    normalized = ImageOps.exif_transpose(image).convert('RGB')
                    normalized.thumbnail((1600, 1600))
                    output = io.BytesIO()
                    normalized.save(output, 'JPEG', quality=80)
                    return 'image/jpeg', 'image', output.getvalue(), '', ''
        if extension == '.pdf':
            from agent.documents import extract_pdf
            try:
                extracted = extract_pdf(content)
            except ValueError as exc:
                if str(exc).startswith('No extractable text'):
                    raise HTTPException(422, 'attachment_no_text') from None
                raise
            text = '\n\n'.join(chunk['text'] for chunk in extracted.get('chunks', []))
            warning = 'attachment_partial' if extracted.get('truncated') else ''
        elif extension == '.docx':
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 500 or sum(item.file_size for item in entries) > 30 * 1024 * 1024:
                    raise HTTPException(422, 'attachment_invalid_document')
                xml = archive.read('word/document.xml')
                if len(xml) > 5 * 1024 * 1024 or b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
                    raise HTTPException(422, 'attachment_invalid_document')
                document = ElementTree.fromstring(xml)
                text = '\n'.join(''.join(node.itertext()) for node in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
        elif extension in TEXT_EXTENSIONS:
            text = content.decode('utf-8-sig')
            if '\x00' in text or any(ord(ch) < 32 and ch not in '\n\r\t' for ch in text):
                raise HTTPException(422, 'attachment_invalid_document')
        else:
            raise HTTPException(415, 'attachment_unsupported_type')
        if not text.strip():
            raise HTTPException(422, 'attachment_no_text')
        if len(text) > MAX_TEXT:
            warning = 'attachment_partial'
        return 'application/octet-stream', 'document', content, text[:MAX_TEXT], warning
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, 'attachment_invalid_document') from None
    finally:
        _parse_slots.release()


def public(row):
    return {key: row[key] for key in ('id', 'name', 'mime', 'kind', 'size', 'warning')}


def save(owner, content, name):
    name = safe_name(name)
    mime, kind, normalized, text, warning = parse(content, name)
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        # Only unused drafts expire; sent files remain available with history.
        conn.execute('DELETE FROM research_chat_attachments WHERE created_at<? AND id NOT IN (SELECT attachment_id FROM research_message_attachments)', (time.time() - 86400,))
        total, count = conn.execute('SELECT COALESCE(SUM(size),0),count(*) FROM research_chat_attachments WHERE owner_id=?', (owner,)).fetchone()
        if total + len(content) > MAX_OWNER_BYTES or count >= 200:
            raise HTTPException(413, 'attachment_storage_limit')
        identifier = ident()
        conn.execute('INSERT INTO research_chat_attachments(id,owner_id,name,mime,kind,size,content,text,warning,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', (identifier, owner, name, mime, kind, len(content), normalized, text, warning, time.time()))
        return public(conn.execute('SELECT * FROM research_chat_attachments WHERE id=?', (identifier,)).fetchone())


def owned(conn, owner, identifiers):
    if len(identifiers) > MAX_FILES or len(set(identifiers)) != len(identifiers):
        raise HTTPException(422, 'attachment_count_limit')
    rows = []
    for identifier in identifiers:
        row = conn.execute('SELECT * FROM research_chat_attachments WHERE id=? AND owner_id=?', (identifier, owner)).fetchone()
        if row is None:
            raise HTTPException(404, 'attachment_not_found')
        rows.append(row)
    if sum(row['size'] for row in rows) > MAX_TURN_BYTES or sum(row['kind'] == 'image' for row in rows) > MAX_IMAGES:
        raise HTTPException(422, 'attachment_count_limit')
    return rows


def public_pdf_session(conversation):
    """Default-public PDF processing, not publication or general private access."""
    from backend import opencode_direct as direct
    row = dict(conversation)
    return (direct.enabled() and row.get('engine') == 'opencode'
            and row.get('model') == direct.DEFAULT_MODEL and bool(row.get('external_ack'))
            and json.loads(row.get('runtime_binding', '{}')).get('transport') == direct.INTERACTIVE_TRANSPORT)


def guard(engine, model, rows, *, public_pdf=False):
    from backend import opencode_runtime as oc
    if rows and public_pdf:
        if any(row['kind'] != 'document' or PurePosixPath(row['name']).suffix.lower() != '.pdf' for row in rows):
            raise HTTPException(422, 'opencode_pdf_only')
    elif rows and engine == 'opencode' and not oc.private_allowed(model):
        raise HTTPException(422, 'opencode_public_sources_only')
    if any(row['kind'] == 'image' for row in rows) and (not image_supported() or engine == 'opencode' and model != oc.native.MODEL_ID):
        raise HTTPException(422, 'attachment_image_not_supported')


def guard_history(conn, conversation):
    """Recheck owner and supported file type before EVERY turn, including resume."""
    row = dict(conversation)
    if row['engine'] != 'opencode':
        return
    from backend import opencode_runtime as oc
    rows = conn.execute('''SELECT a.* FROM research_message_attachments link
        JOIN research_chat_messages m ON m.id=link.message_id
        JOIN research_chat_attachments a ON a.id=link.attachment_id
        WHERE m.conversation_id=?''', (row['id'],)).fetchall()
    for attachment in rows:
        if attachment['owner_id'] != row['owner_id']:
            raise HTTPException(422, 'opencode_public_sources_only')
        if public_pdf_session(row):
            guard(row['engine'], row['model'], [attachment], public_pdf=True)
        elif not oc.private_allowed(row['model']):
            raise HTTPException(422, 'opencode_public_sources_only')


def context(cid, owner, *, max_text_bytes=None):
    with db() as conn:
        rows = conn.execute('''SELECT a.*,m.seq FROM research_chat_messages m
            JOIN research_message_attachments link ON link.message_id=m.id
            JOIN research_chat_attachments a ON a.id=link.attachment_id
            WHERE m.conversation_id=? AND a.owner_id=?
            ORDER BY m.seq DESC,link.position LIMIT 20''', (cid, owner)).fetchall()
    texts, images, seen, remaining = [], [], set(), max_text_bytes or 16000
    document_count = len({row['id'] for row in rows if row['kind'] == 'document'})
    allowance = min(8000, remaining // max(1, document_count))
    for row in rows:
        if row['id'] in seen:
            continue
        seen.add(row['id'])
        if row['kind'] == 'image' and len(images) < MAX_IMAGES:
            images.append({'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(row['content']).decode()}})
        elif row['kind'] == 'document' and remaining > 0:
            excerpt = row['text'][:min(allowance, remaining)]
            if max_text_bytes:
                excerpt = excerpt.encode('utf-8')[:min(allowance, remaining)].decode('utf-8', errors='ignore')
            remaining -= len(excerpt.encode('utf-8')) if max_text_bytes else len(excerpt)
            texts.append({'attachment_id': row['id'], 'filename': row['name'], 'excerpt': excerpt,
                          'partial': bool(row['warning']) or len(excerpt) < len(row['text'])})
    return texts, images
