"""Authenticated, size-bounded PDF intake. Nothing is sent to external services."""
import asyncio
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from agent.documents import DocumentStore, MAX_BYTES, extract_pdf
from backend.auth import current_user

router = APIRouter(prefix="/api/research/documents", tags=["research documents"])


@router.post("")
async def upload_document(request: Request, user: dict = Depends(current_user)):
    if request.headers.get("content-type", "").split(";")[0] != "application/pdf":
        raise HTTPException(415, "Upload a PDF with Content-Type: application/pdf.")
    payload = bytearray()
    async for block in request.stream():
        payload.extend(block)
        if len(payload) > MAX_BYTES:
            raise HTTPException(413, "PDF limit is 20 MB.")
    try:
        document = await asyncio.to_thread(extract_pdf, bytes(payload))
        title = Path(unquote(request.headers.get("x-document-name", "Paper.pdf"))).name[:240]
        store = DocumentStore()
        document = await asyncio.to_thread(store.save, user["id"], {**document, "title": title, "url": ""}, bytes(payload))
    except Exception as error:
        raise HTTPException(422, str(error)) from error
    return {key: document.get(key) for key in ("id", "title", "page_count", "truncated", "warning")}


@router.get("/{document_id}/content")
async def read_original(document_id: str, user: dict = Depends(current_user)):
    try:
        path = DocumentStore().pdf_path(user["id"], document_id)
    except ValueError as error:
        raise HTTPException(404, "Document not found.") from error
    return FileResponse(path, media_type="application/pdf", headers={"Cache-Control": "private, no-store"})
