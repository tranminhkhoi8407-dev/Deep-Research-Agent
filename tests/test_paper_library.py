"""Paper discovery and private library contracts without external network calls."""

import asyncio
import xml.etree.ElementTree as ET

from fastapi.testclient import TestClient

import backend.paper_library as library
from backend.auth import current_user
from backend.main import app


PAPER = {
    "id": "arxiv:2401.12345", "source": "arxiv", "arxiv_id": "2401.12345",
    "title": "A useful AI paper", "abstract": "A test abstract", "authors": ["Researcher One"],
    "published_at": "2024-01-20T00:00:00Z", "updated_at": "2024-01-20T00:00:00Z",
    "primary_category": "cs.AI", "categories": ["cs.AI"], "doi": "", "journal": "",
    "url": "https://arxiv.org/abs/2401.12345", "pdf_url": "https://arxiv.org/pdf/2401.12345",
    "license": "", "venue_type": "preprint",
}


def test_arxiv_atom_metadata_parser():
    entry = ET.fromstring("""<entry xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <id>http://arxiv.org/abs/2401.12345v2</id><title>  Useful  AI  paper </title>
      <summary>Abstract text</summary><author><name>Researcher One</name></author>
      <published>2024-01-20T00:00:00Z</published><updated>2024-02-01T00:00:00Z</updated>
      <category term="cs.AI"/><arxiv:primary_category term="cs.AI"/>
      <arxiv:doi>10.1234/example</arxiv:doi>
    </entry>""")
    paper = library._arxiv_entry(entry)
    assert paper["id"] == "arxiv:2401.12345"
    assert paper["title"] == "Useful AI paper"
    assert paper["primary_category"] == "cs.AI"
    assert paper["doi"] == "10.1234/example"


def test_crossref_journal_metadata_parser():
    paper = library._crossref_item({
        "DOI": "10.1234/EXAMPLE", "title": ["An <i>AI</i> journal paper"],
        "abstract": "<jats:p>Peer-reviewed abstract.</jats:p>",
        "author": [{"given": "Ada", "family": "Lovelace"}],
        "container-title": ["Journal of AI"], "published": {"date-parts": [[2025, 6, 2]]},
        "type": "journal-article",
    })
    assert paper["id"] == "doi:10.1234/example"
    assert paper["journal"] == "Journal of AI"
    assert paper["abstract"] == "Peer-reviewed abstract."
    assert paper["published_at"] == "2025-06-02"


def test_search_requires_login_and_filters_category(monkeypatch, tmp_path):
    monkeypatch.setenv("PAPER_DATABASE_PATH", str(tmp_path / "papers.db"))
    library._cache.clear()

    async def fake_fetch(query, category, page, field):
        assert (query, category, page, field) == ("agents", "cs.AI", 1, "artificial-intelligence")
        return {"papers": [PAPER], "total": 1, "page": 1}

    monkeypatch.setattr(library, "_fetch_arxiv", fake_fetch)
    with TestClient(app) as client:
        assert client.get("/api/papers/search?category=cs.AI").status_code == 401
        assert client.get("/api/papers/library").status_code == 401
        assert client.get("/api/papers/collections").status_code == 401
        app.dependency_overrides[current_user] = lambda: {"id": "test:a"}
        try:
            result = client.get("/api/papers/search?source=arxiv&q=agents&category=cs.AI")
            assert result.status_code == 200
            assert result.json()["papers"][0]["id"] == PAPER["id"]
            assert result.json()["papers"][0]["field"] == "artificial-intelligence"
            assert client.get("/api/papers/search?category=wrong").status_code == 422
        finally:
            app.dependency_overrides.clear()
            library._cache.clear()


def test_saved_papers_notes_and_collections_are_account_scoped(monkeypatch, tmp_path):
    monkeypatch.setenv("PAPER_DATABASE_PATH", str(tmp_path / "papers.db"))
    viewer = {"id": "test:a"}
    app.dependency_overrides[current_user] = lambda: viewer
    try:
        with TestClient(app) as client:
            saved = client.post("/api/papers/library", json={"paper": PAPER})
            assert saved.status_code == 201
            assert saved.json()["paper"]["status"] == "to_read"

            updated = client.patch("/api/papers/library/arxiv:2401.12345", json={"status": "reading", "starred": True, "note": "Check the baseline."})
            assert updated.status_code == 200
            assert updated.json()["paper"]["note"] == "Check the baseline."

            created = client.post("/api/papers/collections", json={"name": "Agent studies"})
            collection_id = created.json()["collection"]["id"]
            assert client.post(f"/api/papers/collections/{collection_id}/papers", json={"paper_id": PAPER["id"]}).status_code == 200
            assert client.get("/api/papers/library").json()["papers"][0]["collection_ids"] == [collection_id]

            viewer["id"] = "test:b"
            assert client.get("/api/papers/library").json()["papers"] == []
            assert client.get("/api/papers/collections").json()["collections"] == []
            assert client.patch("/api/papers/library/arxiv:2401.12345", json={"note": "Changed"}).status_code == 404
            assert client.post(f"/api/papers/collections/{collection_id}/papers", json={"paper_id": PAPER["id"]}).status_code == 404

            other_version = {**PAPER, "title": "My own metadata snapshot"}
            assert client.post("/api/papers/library", json={"paper": other_version}).status_code == 201
            assert client.get("/api/papers/library").json()["papers"][0]["title"] == "My own metadata snapshot"

            viewer["id"] = "test:a"
            assert client.get("/api/papers/library").json()["papers"][0]["title"] == PAPER["title"]
            assert client.get("/api/papers/library").json()["papers"][0]["note"] == "Check the baseline."
            assert client.delete("/api/papers/library/arxiv:2401.12345").status_code == 200
            assert client.get("/api/papers/library").json()["papers"] == []
            assert client.get("/api/papers/collections").json()["collections"][0]["paper_count"] == 0
            viewer["id"] = "test:b"
            assert client.get("/api/papers/library").json()["papers"][0]["title"] == "My own metadata snapshot"
    finally:
        app.dependency_overrides.clear()


def test_field_search_uses_own_categories_and_curated_journals(monkeypatch, tmp_path):
    monkeypatch.setenv("PAPER_DATABASE_PATH", str(tmp_path / "papers.db"))
    library._cache.clear()
    calls = []

    async def fake_arxiv(query, category, page, field):
        calls.append(("arxiv", query, category, page, field))
        return {"papers": [PAPER], "total": 1, "page": page}

    async def fake_journal(query, page, journal, field):
        calls.append(("journal", query, page, journal, field))
        return {"papers": [{**PAPER, "source": "crossref", "id": "doi:10.1000/test", "doi": "10.1000/test", "arxiv_id": ""}], "total": 1, "page": page}

    monkeypatch.setattr(library, "_fetch_arxiv", fake_arxiv)
    monkeypatch.setattr(library, "_fetch_journals", fake_journal)
    app.dependency_overrides[current_user] = lambda: {"id": "test:a"}
    try:
        with TestClient(app) as client:
            math = client.get("/api/papers/search?field=mathematics&category=math.AG")
            assert math.status_code == 200
            assert math.json()["papers"][0]["field"] == "mathematics"
            assert calls[-1] == ("arxiv", "", "math.AG", 1, "mathematics")
            assert client.get("/api/papers/search?field=mathematics&category=cs.AI").status_code == 422
            chemistry = client.get("/api/papers/search?source=journal&field=chemistry&journal=0002-7863")
            assert chemistry.status_code == 200
            assert chemistry.json()["papers"][0]["field"] == "chemistry"
            assert calls[-1] == ("journal", "", 1, "0002-7863", "chemistry")
            assert client.get("/api/papers/search?source=journal&field=biology&journal=0002-7863").status_code == 422
            assert client.get("/api/papers/search?field=unknown").status_code == 422
    finally:
        app.dependency_overrides.clear()
        library._cache.clear()


def test_crossref_requests_never_search_unfiltered_fields(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"message": {"items": [], "total-results": 0}}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def get(self, url, params, headers):
            calls.append((url, params, headers))
            return FakeResponse()

    monkeypatch.setattr(library.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    for field, issns in library.FIELD_JOURNALS.items():
        assert len(issns) == len(set(issns)) == 7
        asyncio.run(library._fetch_journals("research methods", 1, "", field))
        url, params, _headers = calls[-1]
        assert url == "https://api.crossref.org/works"
        assert params["query.bibliographic"] == "research methods"
        assert set(params["filter"].split(",")) == {"type:journal-article", *(f"issn:{value}" for value in issns)}
        assert not any(f"issn:{value}" in params["filter"] for other, values in library.FIELD_JOURNALS.items() if other != field for value in values)

    asyncio.run(library._fetch_journals("", 1, "1755-4330", "chemistry"))
    url, params, _headers = calls[-1]
    assert url == "https://api.crossref.org/journals/1755-4330/works"
    assert params["filter"] == "type:journal-article"
    assert params["sort"] == "published"


def test_saved_papers_and_collections_are_separated_by_field(monkeypatch, tmp_path):
    monkeypatch.setenv("PAPER_DATABASE_PATH", str(tmp_path / "papers.db"))
    app.dependency_overrides[current_user] = lambda: {"id": "test:a"}
    try:
        with TestClient(app) as client:
            biology = {**PAPER, "field": "biology", "primary_category": "q-bio.GN", "categories": ["q-bio.GN"]}
            assert client.post("/api/papers/library", json={"paper": biology}).status_code == 201
            assert len(client.get("/api/papers/library?field=biology").json()["papers"]) == 1
            assert client.get("/api/papers/library?field=mathematics").json()["papers"] == []
            chemistry_collection = client.post("/api/papers/collections", json={"name": "Molecules", "field": "chemistry"}).json()["collection"]
            assert client.post(f"/api/papers/collections/{chemistry_collection['id']}/papers", json={"paper_id": PAPER["id"]}).status_code == 404
            assert client.get("/api/papers/collections?field=biology").json()["collections"] == []
            assert len(client.get("/api/papers/collections?field=chemistry").json()["collections"]) == 1
            assert client.post("/api/papers/library", json={"paper": {**PAPER, "field": "mathematics"}}).status_code == 201
            assert set(client.get("/api/papers/library?field=biology").json()["papers"][0]["fields"]) == {"biology", "mathematics"}
            assert len(client.get("/api/papers/library?field=mathematics").json()["papers"]) == 1
    finally:
        app.dependency_overrides.clear()
