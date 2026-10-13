"""Authenticated, size-bounded PDF intake. Nothing is sent to external services."""
import asyncio
import threading
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response, JSONResponse
from pydantic import BaseModel, Field

from agent.documents import DocumentStore, MAX_BYTES, MAX_PAGES, extract_pdf
from backend.auth import current_user

router = APIRouter(prefix="/api/research/documents", tags=["research documents"])
_preview_slots = threading.BoundedSemaphore(2)
PRIVATE_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}


class LocateQuote(BaseModel):
    quote: str = Field(min_length=12, max_length=500)


def preview_page(path: Path, page_number: int, quote: str = ""):
    """Rasterize a stored, owned page. No source URLs, scripts or AI calls.

    Highlight ONLY the exact quote if the PDF text search can locate it. A
    failed match is explicit, never replaced with an approximate rectangle.
    """
    import pymupdf as fitz
    if not _preview_slots.acquire(blocking=False):
        raise HTTPException(503, "PDF preview is busy. Please retry.")
    try:
        with fitz.open(path) as document:
            if document.is_encrypted or not 1 <= page_number <= min(document.page_count, MAX_PAGES):
                raise HTTPException(404, "PDF page not found.")
            page = document[page_number - 1]
            bounds = page.rect
            if min(bounds.width, bounds.height) <= 0:
                raise HTTPException(422, "PDF page dimensions are invalid.")
            if quote:
                rectangles = page.search_for(quote)
                # search_for returns unrotated coordinates; pixmaps are rotated.
                rectangles = [rect * page.rotation_matrix for rect in rectangles][:80]
                return {"page": page_number, "page_count": document.page_count, "matched": bool(rectangles),
                        "rectangles": [{"x": rect.x0 / bounds.width, "y": rect.y0 / bounds.height,
                                        "width": rect.width / bounds.width, "height": rect.height / bounds.height} for rect in rectangles]}
            # Bound both dimensions and total pixels, including very tall PDFs.
            scale = min(1.8, 1400 / bounds.width, 1800 / bounds.height)
            return page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes("png")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(422, "This PDF page could not be displayed.") from error
    finally:
        _preview_slots.release()


def owned_pdf(owner: str, identifier: str) -> Path:
    try:
        return DocumentStore().pdf_path(owner, identifier)
    except ValueError as error:
        raise HTTPException(404, "Document not found.") from error


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
    path = await asyncio.to_thread(owned_pdf, user["id"], document_id)
    return FileResponse(path, media_type="application/pdf", headers=PRIVATE_HEADERS)


@router.get("/{document_id}/pages/{page_number}/image")
async def page_image(document_id: str, page_number: int, user: dict = Depends(current_user)):
    path = await asyncio.to_thread(owned_pdf, user["id"], document_id)
    content = await asyncio.to_thread(preview_page, path, page_number)
    return Response(content, media_type="image/png", headers=PRIVATE_HEADERS)


@router.post("/{document_id}/pages/{page_number}/locate")
async def locate_quote(document_id: str, page_number: int, body: LocateQuote, user: dict = Depends(current_user)):
    path = await asyncio.to_thread(owned_pdf, user["id"], document_id)
    result = await asyncio.to_thread(preview_page, path, page_number, body.quote)
    return JSONResponse(result, headers=PRIVATE_HEADERS)
