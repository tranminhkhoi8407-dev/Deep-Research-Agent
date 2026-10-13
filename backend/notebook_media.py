"""Private page images. No public uploads, third-party rendering or active SVG."""
import asyncio
import hashlib
import io
import os
import re
import threading
import time
import warnings
from urllib.parse import unquote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from backend.auth import collaboration_user

MAX_BYTES = 10 * 1024 * 1024
MAX_OWNER_BYTES = 100 * 1024 * 1024
_slots = threading.BoundedSemaphore(2)


def same_origin(request: Request):
    origin = request.headers.get('origin')
    allowed = {value.strip().rstrip('/') for value in os.getenv('CORS_ORIGINS', os.getenv('FRONTEND_URL', 'http://127.0.0.1:5173')).split(',')}
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and (request.headers.get('sec-fetch-site') == 'cross-site' or (origin and origin.rstrip('/') not in allowed)):
        raise HTTPException(403, 'Origin not allowed')


router = APIRouter(prefix='/api/collab', tags=['private notebook images'], dependencies=[Depends(same_origin)])


def initialize(conn):
    conn.executescript('''
      CREATE TABLE IF NOT EXISTS notebook_images (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
        mime TEXT NOT NULL, content BLOB NOT NULL, size INTEGER NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, digest TEXT NOT NULL, created_at REAL NOT NULL,
        UNIQUE(owner_id,digest)
      );
      CREATE TABLE IF NOT EXISTS notebook_page_images (
        page_id TEXT NOT NULL REFERENCES research_pages(id),
        image_id TEXT NOT NULL REFERENCES notebook_images(id),
        PRIMARY KEY(page_id,image_id)
      );
    ''')


def normalize(payload):
    from PIL import Image, ImageOps
    if not payload or len(payload) > MAX_BYTES:
        raise HTTPException(413 if payload else 422, 'notebook_image_size')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as image:
                if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > 20000000 or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('Unsupported image')
                image.load()
                pixels = ImageOps.exif_transpose(image).convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
                pixels.thumbnail((4096, 4096))
                output = io.BytesIO()
                pixels.save(output, 'WEBP', quality=90, method=4)
                return output.getvalue(), pixels.width, pixels.height
    except Exception:
        raise HTTPException(422, 'notebook_image_invalid') from None


def store(page_id, user_id, payload, name):
    from backend import collaboration as c
    # Decode only after an initial permission check, then recheck transactionally.
    with c.db() as conn:
        c.page_detail(conn, page_id, user_id, 3)
    content, width, height = normalize(payload)
    digest = hashlib.sha256(content).hexdigest()
    name = ''.join(ch for ch in name.replace('\\', '/').split('/')[-1] if ch.isprintable())[:150] or 'image.webp'
    with c.db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        c.page_detail(conn, page_id, user_id, 3)
        row = conn.execute('SELECT * FROM notebook_images WHERE owner_id=? AND digest=?', (user_id, digest)).fetchone()
        if not row:
            if conn.execute('SELECT COALESCE(SUM(size),0) FROM notebook_images WHERE owner_id=?', (user_id,)).fetchone()[0] + len(content) > MAX_OWNER_BYTES:
                raise HTTPException(413, 'notebook_image_quota')
            if conn.execute('SELECT count(*) FROM notebook_images WHERE owner_id=? AND created_at>?', (user_id, time.time() - 3600)).fetchone()[0] >= 40:
                raise HTTPException(429, 'notebook_image_rate')
            aid = c.ident()
            conn.execute('INSERT INTO notebook_images VALUES(?,?,?,?,?,?,?,?,?,?)', (aid, user_id, name, 'image/webp', content, len(content), width, height, digest, time.time()))
            row = conn.execute('SELECT * FROM notebook_images WHERE id=?', (aid,)).fetchone()
        conn.execute('INSERT OR IGNORE INTO notebook_page_images VALUES(?,?)', (page_id, row['id']))
        return {key: row[key] for key in ('id', 'name', 'mime', 'size', 'width', 'height')}


@router.post('/pages/{page_id}/images', status_code=201)
async def upload_image(page_id: str, request: Request, user=Depends(collaboration_user)):
    from backend import collaboration as c
    with c.db() as conn:
        c.page_detail(conn, page_id, user['id'], 3)
        c.rate_limit(conn, user['id'], 'notebook.image_upload', page_id)
    data = bytearray()
    async for block in request.stream():
        if len(data) + len(block) > MAX_BYTES:
            raise HTTPException(413, 'notebook_image_size')
        data.extend(block)
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'notebook_image_busy')
    try:
        return await asyncio.to_thread(store, page_id, user['id'], bytes(data), unquote(request.headers.get('x-image-name', 'image.webp')))
    finally:
        _slots.release()


class ImageURL(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=8, max_length=2048)


@router.post('/pages/{page_id}/images/import', status_code=201)
def import_image(page_id: str, body: ImageURL, user=Depends(collaboration_user)):
    from backend import collaboration as c
    from agent.documents import canonical_url, fetch_public
    with c.db() as conn:
        c.page_detail(conn, page_id, user['id'], 3)
        c.rate_limit(conn, user['id'], 'notebook.image_url', page_id)
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'notebook_image_busy')
    try:
        url = canonical_url(body.url)
        payload, _mime, final = fetch_public(url, limit=MAX_BYTES, timeout=6, deadline_seconds=20)
        return store(page_id, user['id'], payload, unquote(urlsplit(final).path.split('/')[-1]) or 'image.webp')
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, 'notebook_image_url_failed') from None
    finally:
        _slots.release()


@router.get('/pages/{page_id}/images/{image_id}')
def image_content(page_id: str, image_id: str, user=Depends(collaboration_user)):
    from backend import collaboration as c
    with c.db() as conn:
        c.page_detail(conn, page_id, user['id'])
        row = conn.execute('SELECT i.* FROM notebook_images i JOIN notebook_page_images p ON p.image_id=i.id WHERE p.page_id=? AND i.id=?', (page_id, image_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Image not found')
        return Response(bytes(row['content']), media_type=row['mime'], headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"})


@router.get('/images/{image_id}')
def exported_image(image_id: str, user=Depends(collaboration_user)):
    from backend import collaboration as c
    with c.db() as conn:
        pages = conn.execute('SELECT p.* FROM research_pages p JOIN notebook_page_images m ON m.page_id=p.id WHERE m.image_id=? AND p.archived_at IS NULL', (image_id,)).fetchall()
        allowed = next((page for page in pages if c.page_access(conn, page, user['id']) >= 1), None)
        if not allowed:
            raise HTTPException(404, 'Image not found')
        row = conn.execute('SELECT * FROM notebook_images WHERE id=?', (image_id,)).fetchone()
        return Response(bytes(row['content']), media_type=row['mime'], headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/pages/{page_id}/images/{image_id}/attach')
def attach_image(page_id: str, image_id: str, user=Depends(collaboration_user)):
    from backend import collaboration as c
    with c.db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        c.page_detail(conn, page_id, user['id'], 3)
        grant_images(conn, page_id, user['id'], {image_id})
        return {'attached': True}


def document_images(document):
    from pycrdt import XmlElement
    found, count = set(), 0
    def walk(node, depth=0):
        nonlocal count
        count += 1
        if count > 15000 or depth > 80:
            raise HTTPException(422, 'Notebook too large')
        if not isinstance(node, XmlElement):
            return
        if node.tag == 'notebookImage':
            image_id = node.attributes.get('assetId') or ''
            if not isinstance(image_id, str) or not re.fullmatch('[a-f0-9]{32}', image_id):
                raise HTTPException(422, 'Invalid notebook image')
            found.add(image_id)
        for child in node.children:
            walk(child, depth + 1)
    for child in document['notebook'].children:
        walk(child)
    return found


def authorize_document_images(conn, page_id, actor, document):
    """Copied images share only after an editor proves access to the source.

    A guessed ID in an opaque Yjs update must never grant image access. Existing
    destination grants remain valid for Undo/version restore after source archive.
    """
    grant_images(conn, page_id, actor, document_images(document))


def grant_images(conn, page_id, actor, image_ids):
    from backend import collaboration as c
    missing = []
    for image_id in image_ids:
        if not re.fullmatch('[a-f0-9]{32}', image_id):
            raise HTTPException(422, 'Invalid notebook image')
        if conn.execute('SELECT 1 FROM notebook_page_images WHERE page_id=? AND image_id=?', (page_id, image_id)).fetchone():
            continue
        sources = conn.execute('SELECT p.* FROM research_pages p JOIN notebook_page_images m ON m.page_id=p.id WHERE m.image_id=? AND p.archived_at IS NULL', (image_id,)).fetchall()
        if not any(c.page_access(conn, page, actor) >= 1 for page in sources):
            raise HTTPException(403, 'Image source access required')
        missing.append(image_id)
    for image_id in missing:
        conn.execute('INSERT INTO notebook_page_images VALUES(?,?)', (page_id, image_id))
