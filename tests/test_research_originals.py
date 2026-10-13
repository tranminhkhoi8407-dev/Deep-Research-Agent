"""Owned original-page previews: no network or paid model requests."""
import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient
from backend.main import app
from backend.auth import current_user
from backend.research_documents import _preview_slots
from agent.documents import DocumentStore, extract_pdf


@pytest.fixture
def original(monkeypatch, tmp_path):
    monkeypatch.setenv("RESEARCH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUTH_DATABASE_PATH", str(tmp_path / "auth.db"))
    with fitz.open() as pdf:
        page = pdf.new_page()
        page.insert_text((60, 80), "Distillation learns from demonstrations.")
        second = pdf.new_page()
        second.insert_text((60, 80), "RL optimizes feedback.")
        second.set_rotation(90)
        raw = pdf.tobytes()
    document = DocumentStore().save("owner", {**extract_pdf(raw), "title": "Fixture"}, raw)
    app.dependency_overrides[current_user] = lambda: {"id": "owner"}
    yield document["id"]
    app.dependency_overrides.pop(current_user, None)


def test_owned_original_image_and_exact_quote_location(original):
    with TestClient(app) as client:
        base = f"/api/research/documents/{original}/pages/1"
        image = client.get(base + "/image")
        assert image.status_code == 200 and image.content.startswith(b"\x89PNG")
        assert image.headers["cache-control"] == "private, no-store"
        located = client.post(base + "/locate", json={"quote": "Distillation learns from demonstrations."})
        assert located.status_code == 200 and located.json()["matched"]
        assert located.json()["page_count"] == 2
        unmatched = client.post(base + "/locate", json={"quote": "This exact quote does not exist."})
        assert unmatched.json()["matched"] is False and unmatched.json()["rectangles"] == []
        # A generated document hash can start with 1 too. Replace only the page
        # number, never a matching substring inside the owner-scoped document ID.
        rotated = client.post(f"/api/research/documents/{original}/pages/2/locate", json={"quote": "RL optimizes feedback."})
        assert rotated.status_code == 200
        assert rotated.json()["matched"]
        for rect in rotated.json()["rectangles"]:
            assert 0 <= rect["x"] <= 1 and 0 <= rect["y"] <= 1 and 0 < rect["width"] <= 1
        for page in [0, 3, 101]:
            assert client.get(base.replace("/1", f"/{page}") + "/image").status_code == 404
        assert client.post(base + "/locate", json={"quote": "X" * 501}).status_code == 422


def test_original_page_routes_never_leak_another_accounts_pdf(original):
    app.dependency_overrides[current_user] = lambda: {"id": "other"}
    with TestClient(app) as client:
        for suffix in ["/content", "/pages/1/image"]:
            assert client.get(f"/api/research/documents/{original}" + suffix).status_code == 404
        assert client.post(f"/api/research/documents/{original}/pages/1/locate", json={"quote": "Distillation learns from demonstrations."}).status_code == 404
        assert client.get("/api/research/documents/invalid/pages/1/image").status_code == 404


def test_original_page_routes_require_a_current_login(original):
    app.dependency_overrides.pop(current_user, None)
    with TestClient(app) as client:
        for suffix in ["/content", "/pages/1/image"]:
            assert client.get(f"/api/research/documents/{original}" + suffix).status_code == 401
        assert client.post(f"/api/research/documents/{original}/pages/1/locate", json={"quote": "Distillation learns from demonstrations."}).status_code == 401


def test_preview_limits_parallel_renders_and_releases_slots(original):
    assert _preview_slots.acquire(False) and _preview_slots.acquire(False)
    try:
        with TestClient(app) as client:
            assert client.get(f"/api/research/documents/{original}/pages/1/image").status_code == 503
    finally:
        _preview_slots.release(); _preview_slots.release()
