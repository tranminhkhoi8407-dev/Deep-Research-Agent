"""Account-scoped scholarly library and bounded public metadata discovery."""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import sqlite3
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.auth import current_user


router = APIRouter(prefix="/api/papers", tags=["paper library"])
FIELD_CATEGORIES = {
    "mathematics": ("math.AG", "math.CA", "math.DG", "math.PR", "math.OC", "math.NA"),
    "physics": ("quant-ph", "cond-mat.mtrl-sci", "astro-ph.HE", "hep-th", "gr-qc", "physics.comp-ph"),
    "chemistry": ("physics.chem-ph", "physics.atm-clus", "cond-mat.mtrl-sci", "cond-mat.soft"),
    "biology": ("q-bio.BM", "q-bio.CB", "q-bio.GN", "q-bio.NC", "q-bio.PE", "q-bio.QM"),
    "artificial-intelligence": ("cs.AI", "cs.LG", "stat.ML", "cs.CL", "cs.CV", "cs.RO", "cs.MA", "cs.NE", "cs.IR", "cs.HC", "cs.CY"),
}
FIELD_JOURNALS = {
    "mathematics": ("0003-486X", "0894-0347", "0036-1399", "0020-9910", "0001-5962", "0012-7094", "0022-040X"),
    "physics": ("0031-9007", "1745-2473", "2160-3308", "0034-6861", "2470-0010", "0004-637X", "1126-6708"),
    "chemistry": ("0002-7863", "1755-4330", "1433-7851", "0009-2665", "2155-5435", "2041-6520", "1523-7060"),
    "biology": ("1061-4036", "0261-4189", "1544-9173", "0092-8674", "1097-2765", "1474-760X", "2050-084X"),
    "artificial-intelligence": ("2522-5839", "1532-4435", "0162-8828", "0004-3702", "0885-6125", "0893-6080", "0031-3203"),
}
FieldId = Literal["mathematics", "physics", "chemistry", "biology", "artificial-intelligence"]
ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"
_cache: dict[tuple, tuple[float, dict]] = {}
_arxiv_lock = asyncio.Lock()
_last_arxiv_request = 0.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def _connect():
    path = Path(os.getenv("PAPER_DATABASE_PATH", "data/paper-library.db")).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS papers (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            metadata TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_papers (
            user_id TEXT NOT NULL,
            paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            metadata TEXT,
            status TEXT NOT NULL DEFAULT 'to_read',
            starred INTEGER NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT '',
            saved_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, paper_id)
        );
        CREATE TABLE IF NOT EXISTS user_paper_fields (
            user_id TEXT NOT NULL,
            paper_id TEXT NOT NULL,
            field TEXT NOT NULL,
            PRIMARY KEY (user_id, paper_id, field),
            FOREIGN KEY (user_id, paper_id) REFERENCES user_papers(user_id, paper_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS paper_collections (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            field TEXT NOT NULL DEFAULT 'artificial-intelligence',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_papers (
            collection_id TEXT NOT NULL REFERENCES paper_collections(id) ON DELETE CASCADE,
            paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            PRIMARY KEY (collection_id, paper_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_papers ON user_papers(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_collections_user ON paper_collections(user_id);
    """)
    # Existing installations may already have a user_papers table without a
    # per-account metadata snapshot. Keep their saved entries readable.
    columns = {row[1] for row in db.execute("PRAGMA table_info(user_papers)")}
    if "metadata" not in columns:
        db.execute("ALTER TABLE user_papers ADD COLUMN metadata TEXT")
    collection_columns = {row[1] for row in db.execute("PRAGMA table_info(paper_collections)")}
    if "field" not in collection_columns:
        db.execute("ALTER TABLE paper_collections ADD COLUMN field TEXT NOT NULL DEFAULT 'artificial-intelligence'")
    for row in db.execute("SELECT up.user_id, up.paper_id, up.metadata FROM user_papers up WHERE NOT EXISTS (SELECT 1 FROM user_paper_fields f WHERE f.user_id = up.user_id AND f.paper_id = up.paper_id)").fetchall():
        try:
            field = json.loads(row["metadata"] or "{}").get("field", "artificial-intelligence")
        except (ValueError, TypeError):
            field = "artificial-intelligence"
        if field not in FIELD_CATEGORIES:
            field = "artificial-intelligence"
        db.execute("INSERT OR IGNORE INTO user_paper_fields(user_id, paper_id, field) VALUES (?, ?, ?)", (row["user_id"], row["paper_id"], field))
    try:
        with db:
            yield db
    finally:
        db.close()


def _clean(value: str | None) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value or "")).split())


def _arxiv_entry(entry: ET.Element) -> dict:
    identifier = (entry.findtext(f"{ATOM}id") or "").rsplit("/", 1)[-1]
    base_id = re.sub(r"v\d+$", "", identifier)
    links = entry.findall(f"{ATOM}link")
    pdf = next((link.get("href") for link in links if link.get("title") == "pdf"), None)
    doi = entry.findtext(f"{ARXIV}doi")
    categories = [tag.get("term", "") for tag in entry.findall(f"{ATOM}category")]
    primary = entry.find(f"{ARXIV}primary_category")
    return {
        "id": f"arxiv:{base_id}", "source": "arxiv", "arxiv_id": base_id,
        "title": _clean(entry.findtext(f"{ATOM}title")),
        "abstract": _clean(entry.findtext(f"{ATOM}summary")),
        "authors": [_clean(author.findtext(f"{ATOM}name")) for author in entry.findall(f"{ATOM}author")],
        "published_at": entry.findtext(f"{ATOM}published") or "",
        "updated_at": entry.findtext(f"{ATOM}updated") or "",
        "primary_category": primary.get("term", "") if primary is not None else (categories[0] if categories else ""),
        "categories": categories,
        "doi": doi or "", "journal": _clean(entry.findtext(f"{ARXIV}journal_ref")),
        "url": f"https://arxiv.org/abs/{base_id}",
        "pdf_url": pdf.replace("http://", "https://") if pdf else f"https://arxiv.org/pdf/{base_id}",
        "license": (entry.find(f"{ARXIV}license").get("href", "") if entry.find(f"{ARXIV}license") is not None else ""),
        "venue_type": "preprint",
    }


def _crossref_item(item: dict) -> dict:
    doi = str(item.get("DOI") or "").strip().lower()
    date_parts = ((item.get("published") or {}).get("date-parts") or [[]])[0]
    published = "-".join(str(part).zfill(2) if i else str(part) for i, part in enumerate(date_parts))
    title = item.get("title") or []
    venue = item.get("container-title") or []
    return {
        "id": f"doi:{doi}", "source": "crossref", "arxiv_id": "",
        "title": _clean(title[0] if title else ""),
        "abstract": _clean(item.get("abstract")),
        "authors": [_clean(" ".join(part for part in [author.get("given"), author.get("family")] if part)) for author in (item.get("author") or [])],
        "published_at": published, "updated_at": item.get("indexed", {}).get("date-time", ""),
        "primary_category": "", "categories": [], "doi": doi,
        "journal": _clean(venue[0] if venue else ""),
        "url": f"https://doi.org/{doi}", "pdf_url": "",
        "license": (item.get("license") or [{}])[0].get("URL", ""),
        "venue_type": item.get("type", "journal-article"),
    }


async def _fetch_arxiv(q: str, category: str, page: int, field: str = "artificial-intelligence") -> dict:
    global _last_arxiv_request
    clauses = [f"cat:{category}"] if category else ["(" + " OR ".join(f"cat:{value}" for value in FIELD_CATEGORIES[field]) + ")"]
    terms = re.findall(r"[\w-]+", q, flags=re.UNICODE)[:8]
    clauses.extend(f"all:{term}" for term in terms)
    params = {"search_query": " AND ".join(clauses), "start": (page - 1) * 20, "max_results": 20, "sortBy": "relevance" if terms else "submittedDate", "sortOrder": "descending"}
    async with _arxiv_lock:
        delay = 3.0 - (time.monotonic() - _last_arxiv_request)
        if delay > 0:
            await asyncio.sleep(delay)
        _last_arxiv_request = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
                response = await client.get("https://export.arxiv.org/api/query", params=params, headers={"User-Agent": "DeepResearchWorkspace/1.0 (scholarly discovery)"})
                response.raise_for_status()
            root = ET.fromstring(response.content)
        except (httpx.HTTPError, ET.ParseError) as exc:
            raise HTTPException(502, "arXiv is temporarily unavailable. Please try again shortly.") from exc
    total = root.findtext("{http://a9.com/-/spec/opensearch/1.1/}totalResults")
    return {"papers": [_arxiv_entry(entry) for entry in root.findall(f"{ATOM}entry") if entry.findtext(f"{ATOM}id")], "total": int(total or 0), "page": page}


async def _fetch_journals(q: str, page: int, journal: str = "", field: str = "artificial-intelligence") -> dict:
    # Without one selected ISSN, restrict Crossref to the field's curated
    # journal set. A bare /works text search is not a field search.
    filters = ["type:journal-article"]
    if not journal:
        filters.extend(f"issn:{issn}" for issn in FIELD_JOURNALS[field])
    params = {"filter": ",".join(filters), "rows": 20, "offset": (page - 1) * 20}
    if q:
        params["query.bibliographic"] = q
    else:
        params.update({"sort": "published", "order": "desc"})
    contact_email = os.getenv("SCHOLARLY_CONTACT_EMAIL", "").strip()
    if contact_email:
        params["mailto"] = contact_email
    try:
        async with httpx.AsyncClient(timeout=18, follow_redirects=True) as client:
            endpoint = f"https://api.crossref.org/journals/{journal}/works" if journal else "https://api.crossref.org/works"
            response = await client.get(endpoint, params=params, headers={"User-Agent": "DeepResearchWorkspace/1.0"})
            response.raise_for_status()
            result = response.json()["message"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(502, "Crossref is temporarily unavailable. Please try again shortly.") from exc
    papers = [_crossref_item(item) for item in result.get("items", []) if item.get("DOI") and item.get("title")]
    return {"papers": papers, "total": result.get("total-results", 0), "page": page}


class PaperData(BaseModel):
    id: str = Field(min_length=5, max_length=160)
    source: Literal["arxiv", "crossref"]
    field: FieldId = "artificial-intelligence"
    arxiv_id: str = ""
    title: str = Field(min_length=1, max_length=600)
    abstract: str = Field(default="", max_length=20000)
    authors: list[str] = Field(default_factory=list, max_length=200)
    published_at: str = ""
    updated_at: str = ""
    primary_category: str = ""
    categories: list[str] = Field(default_factory=list, max_length=50)
    doi: str = ""
    journal: str = ""
    url: str
    pdf_url: str = ""
    license: str = ""
    venue_type: str = ""


class SavePaper(BaseModel):
    paper: PaperData


class PaperUpdate(BaseModel):
    status: Literal["to_read", "reading", "read", "archived"] | None = None
    starred: bool | None = None
    note: str | None = Field(default=None, max_length=20000)


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    field: FieldId = "artificial-intelligence"


class CollectionPaper(BaseModel):
    paper_id: str


def _saved_row(db: sqlite3.Connection, user_id: str, paper_id: str) -> dict | None:
    row = db.execute("SELECT COALESCE(up.metadata, p.metadata) AS metadata, up.status, up.starred, up.note, up.saved_at FROM user_papers up JOIN papers p ON p.id = up.paper_id WHERE up.user_id = ? AND up.paper_id = ?", (user_id, paper_id)).fetchone()
    if row is None:
        return None
    collection_ids = [item[0] for item in db.execute("SELECT cp.collection_id FROM collection_papers cp JOIN paper_collections c ON c.id = cp.collection_id WHERE cp.paper_id = ? AND c.user_id = ?", (paper_id, user_id))]
    fields = [item[0] for item in db.execute("SELECT field FROM user_paper_fields WHERE user_id = ? AND paper_id = ? ORDER BY field", (user_id, paper_id))]
    return {**json.loads(row["metadata"]), "fields": fields, "status": row["status"], "starred": bool(row["starred"]), "note": row["note"], "saved_at": row["saved_at"], "collection_ids": collection_ids}


@router.get("/search")
async def search_papers(source: Literal["arxiv", "journal"] = "arxiv", field: FieldId = "artificial-intelligence", q: str = Query("", max_length=120), category: str = "", journal: str = "", page: int = Query(1, ge=1, le=25), _user: dict = Depends(current_user)):
    q = q.strip()
    if category and (source != "arxiv" or category not in FIELD_CATEGORIES[field]):
        raise HTTPException(422, "Unsupported arXiv category for this field")
    if journal and (source != "journal" or journal not in FIELD_JOURNALS[field]):
        raise HTTPException(422, "Unsupported journal for this field")
    key = (source, field, q.casefold(), category, journal, page)
    cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    result = await (_fetch_arxiv(q, category, page, field) if source == "arxiv" else _fetch_journals(q, page, journal, field))
    result["papers"] = [{**paper, "field": field} for paper in result["papers"]]
    _cache[key] = (time.monotonic() + 3600, result)
    if len(_cache) > 300:
        for stale in list(_cache)[:100]:
            _cache.pop(stale, None)
    return result


@router.get("/library")
def saved_papers(field: FieldId | None = None, user: dict = Depends(current_user)):
    with _connect() as db:
        if field:
            ids = [row[0] for row in db.execute("SELECT up.paper_id FROM user_papers up JOIN user_paper_fields f ON f.user_id = up.user_id AND f.paper_id = up.paper_id WHERE up.user_id = ? AND f.field = ? ORDER BY up.updated_at DESC", (user["id"], field))]
        else:
            ids = [row[0] for row in db.execute("SELECT paper_id FROM user_papers WHERE user_id = ? ORDER BY updated_at DESC", (user["id"],))]
        return {"papers": [_saved_row(db, user["id"], paper_id) for paper_id in ids]}


@router.post("/library", status_code=201)
def save_paper(payload: SavePaper, user: dict = Depends(current_user)):
    paper = payload.paper
    if paper.source == "arxiv":
        if paper.id != f"arxiv:{paper.arxiv_id}" or not re.fullmatch(r"(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})", paper.arxiv_id):
            raise HTTPException(422, "Invalid arXiv identifier")
    elif paper.id != f"doi:{paper.doi.lower()}" or not re.fullmatch(r"10\.\d{4,9}/\S+", paper.doi, re.I):
        raise HTTPException(422, "Invalid DOI")
    if paper.source == "arxiv":
        paper = paper.model_copy(update={"url": f"https://arxiv.org/abs/{paper.arxiv_id}", "pdf_url": f"https://arxiv.org/pdf/{paper.arxiv_id}"})
    else:
        paper = paper.model_copy(update={"url": f"https://doi.org/{paper.doi}", "pdf_url": ""})
    with _connect() as db:
        db.execute("INSERT OR IGNORE INTO papers(id, source, metadata, updated_at) VALUES (?, ?, ?, ?)", (paper.id, paper.source, paper.model_dump_json(), _now()))
        db.execute("INSERT OR IGNORE INTO user_papers(user_id, paper_id, metadata, saved_at, updated_at) VALUES (?, ?, ?, ?, ?)", (user["id"], paper.id, paper.model_dump_json(), _now(), _now()))
        db.execute("UPDATE user_papers SET metadata = ? WHERE user_id = ? AND paper_id = ?", (paper.model_dump_json(), user["id"], paper.id))
        db.execute("INSERT OR IGNORE INTO user_paper_fields(user_id, paper_id, field) VALUES (?, ?, ?)", (user["id"], paper.id, paper.field))
        return {"paper": _saved_row(db, user["id"], paper.id)}


@router.patch("/library/{paper_id:path}")
def update_saved_paper(paper_id: str, payload: PaperUpdate, user: dict = Depends(current_user)):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No changes supplied")
    with _connect() as db:
        if _saved_row(db, user["id"], paper_id) is None:
            raise HTTPException(404, "Paper not saved")
        assignments = ", ".join(f"{key} = ?" for key in updates)
        values = [int(value) if key == "starred" else value for key, value in updates.items()]
        db.execute(f"UPDATE user_papers SET {assignments}, updated_at = ? WHERE user_id = ? AND paper_id = ?", (*values, _now(), user["id"], paper_id))
        return {"paper": _saved_row(db, user["id"], paper_id)}


@router.delete("/library/{paper_id:path}")
def remove_saved_paper(paper_id: str, user: dict = Depends(current_user)):
    with _connect() as db:
        result = db.execute("DELETE FROM user_papers WHERE user_id = ? AND paper_id = ?", (user["id"], paper_id))
        if not result.rowcount:
            raise HTTPException(404, "Paper not saved")
        db.execute("DELETE FROM collection_papers WHERE paper_id = ? AND collection_id IN (SELECT id FROM paper_collections WHERE user_id = ?)", (paper_id, user["id"]))
        db.execute("DELETE FROM papers WHERE id = ? AND NOT EXISTS (SELECT 1 FROM user_papers WHERE paper_id = ?)", (paper_id, paper_id))
    return {"status": "removed"}


@router.get("/collections")
def list_collections(field: FieldId | None = None, user: dict = Depends(current_user)):
    with _connect() as db:
        rows = db.execute("SELECT c.id, c.name, c.field, c.created_at, COUNT(cp.paper_id) AS paper_count FROM paper_collections c LEFT JOIN collection_papers cp ON cp.collection_id = c.id WHERE c.user_id = ? AND (? IS NULL OR c.field = ?) GROUP BY c.id ORDER BY c.created_at DESC", (user["id"], field, field)).fetchall()
        return {"collections": [dict(row) for row in rows]}


@router.post("/collections", status_code=201)
def create_collection(payload: CollectionCreate, user: dict = Depends(current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Collection name is required")
    collection = {"id": uuid.uuid4().hex, "name": name, "field": payload.field, "created_at": _now(), "paper_count": 0}
    with _connect() as db:
        db.execute("INSERT INTO paper_collections(id, user_id, name, field, created_at) VALUES (?, ?, ?, ?, ?)", (collection["id"], user["id"], name, collection["field"], collection["created_at"]))
    return {"collection": collection}


@router.delete("/collections/{collection_id}")
def delete_collection(collection_id: str, user: dict = Depends(current_user)):
    with _connect() as db:
        result = db.execute("DELETE FROM paper_collections WHERE id = ? AND user_id = ?", (collection_id, user["id"]))
        if not result.rowcount:
            raise HTTPException(404, "Collection not found")
    return {"status": "deleted"}


@router.post("/collections/{collection_id}/papers")
def add_to_collection(collection_id: str, payload: CollectionPaper, user: dict = Depends(current_user)):
    with _connect() as db:
        collection = db.execute("SELECT field FROM paper_collections WHERE id = ? AND user_id = ?", (collection_id, user["id"])).fetchone()
        if not collection:
            raise HTTPException(404, "Collection not found")
        if not db.execute("SELECT 1 FROM user_paper_fields WHERE paper_id = ? AND user_id = ? AND field = ?", (payload.paper_id, user["id"], collection["field"])).fetchone():
            raise HTTPException(404, "Save this paper in this field before adding it to a collection")
        db.execute("INSERT OR IGNORE INTO collection_papers(collection_id, paper_id) VALUES (?, ?)", (collection_id, payload.paper_id))
    return {"status": "added"}


@router.delete("/collections/{collection_id}/papers/{paper_id:path}")
def remove_from_collection(collection_id: str, paper_id: str, user: dict = Depends(current_user)):
    with _connect() as db:
        if not db.execute("SELECT 1 FROM paper_collections WHERE id = ? AND user_id = ?", (collection_id, user["id"])).fetchone():
            raise HTTPException(404, "Collection not found")
        db.execute("DELETE FROM collection_papers WHERE collection_id = ? AND paper_id = ?", (collection_id, paper_id))
    return {"status": "removed"}
