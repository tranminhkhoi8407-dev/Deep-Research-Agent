"""Snapshot persistence tests: tar roundtrips, restore policy, transports.

No network access: remote calls are faked by monkeypatching _remote_fetch
and _remote_store, or by stubbing httpx.Client for transport-shape tests.
"""

import io
import json
import sqlite3
import tarfile

import pytest

from backend import persist


@pytest.fixture()
def fake_root(tmp_path, monkeypatch):
    monkeypatch.setattr(persist, "project_root", lambda: tmp_path)
    monkeypatch.setenv("AUTH_DATABASE_PATH", "data/deep-research.db")
    monkeypatch.setenv("PAPER_DATABASE_PATH", "data/paper-library.db")
    monkeypatch.setenv("RESEARCH_CHAT_DATABASE_PATH", "data/research-chat.db")
    monkeypatch.setenv("AVATAR_DIR", "data/avatars")
    monkeypatch.setenv("REPORTS_DIR", "reports")
    database = tmp_path / "data" / "deep-research.db"
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)")
    connection.execute("INSERT INTO users VALUES ('u1', 'Alice')")
    connection.commit()
    connection.close()
    for name, content in (
        ("data/avatars/abc123.webp", b"avatar-bytes"),
        ("reports/hello.md", b"# hello"),
    ):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    persist._boot_restored_at = None
    persist._last_upload_at = 0.0
    return tmp_path


def test_r2_enabled_requires_all_variables(monkeypatch):
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    assert persist.r2_enabled() is False
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "bucket")
    assert persist.r2_enabled() is True


def test_sigv4_matches_independent_implementation():
    """Fixed IAM vector, cross-checked byte-for-byte against botocore.

    botocore (an independent SigV4 implementation) produces this exact
    Authorization header for the same inputs, so the test pins signing
    correctness — a one-byte canonicalization bug changes the signature.
    """
    headers = persist._signed_headers(
        "AKIDEXAMPLE",
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        "GET",
        "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-17",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        region="us-east-1",
        service="iam",
        amz_date="20150830T123600Z",
        include_content_sha=False,
    )
    assert headers["Authorization"] == (
        "AWS4-HMAC-SHA256 "
        "Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, "
        "SignedHeaders=host;x-amz-date, "
        "Signature=eac38b463dcacca4f2b64bdf3fcf2e3be2ff56cde358aa1751d4c3ae77f1b957"
    )
    assert headers["x-amz-date"] == "20150830T123600Z"


def test_sigv4_matches_production_shape():
    """PUT shape actually sent to R2 (also verified against botocore)."""
    headers = persist._signed_headers(
        "AKID",
        "SECRET",
        "PUT",
        "https://acc.r2.cloudflarestorage.com/bucket/snapshots/snapshot.tar.gz",
        "abc123",
        region="auto",
        service="s3",
        amz_date="20150830T123600Z",
        include_content_sha=True,
    )
    assert headers["Authorization"] == (
        "AWS4-HMAC-SHA256 "
        "Credential=AKID/20150830/auto/s3/aws4_request, "
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, "
        "Signature=ec8fed8f5eceecf53cf0f63a8580893309b74e44cc162a0bf714c15fbbc91f17"
    )
    assert headers["x-amz-content-sha256"] == "abc123"


def test_signed_headers_are_deterministic_and_keyed():
    url = "https://acc.r2.cloudflarestorage.com/bucket/snapshots/snapshot.tar.gz"
    kwargs = {"payload_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "amz_date": "20260101T000000Z"}
    first = persist._signed_headers("AKID", "SECRET", "PUT", url, **kwargs)
    second = persist._signed_headers("AKID", "SECRET", "PUT", url, **kwargs)
    assert first == second
    assert first["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKID/")
    assert "Signature=" in first["Authorization"]
    other = persist._signed_headers("AKID", "OTHER", "PUT", url, **kwargs)
    assert other["Authorization"] != first["Authorization"]


def test_snapshot_roundtrip(fake_root):
    payload, meta = persist.build_snapshot_bytes()
    assert set(meta["files"]) == {"data/deep-research.db", "data/avatars/abc123.webp", "reports/hello.md"}
    assert meta["bytes"] == len(payload)
    for name in meta["files"]:
        (fake_root / name).unlink()
    restored = persist.extract_snapshot_bytes(payload)
    assert sorted(restored) == sorted(meta["files"])
    connection = sqlite3.connect(fake_root / "data" / "deep-research.db")
    try:
        assert connection.execute("SELECT name FROM users WHERE id = 'u1'").fetchone()[0] == "Alice"
    finally:
        connection.close()
    assert (fake_root / "data/avatars/abc123.webp").read_bytes() == b"avatar-bytes"


def test_extract_rolls_back_on_corrupt_database(fake_root):
    payload, meta = persist.build_snapshot_bytes()
    assert "data/deep-research.db" in meta["files"]
    # Corrupt the database member inside the tarball.
    buffer = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as source:
        with tarfile.open(fileobj=buffer, mode="w:gz") as target:
            for member in source.getmembers():
                stream = source.extractfile(member)
                content = stream.read() if stream else b""
                if member.name == "data/deep-research.db":
                    content = b"definitely not sqlite"
                info = tarfile.TarInfo(name=member.name)
                info.size = len(content)
                target.addfile(info, io.BytesIO(content))
    with pytest.raises(ValueError, match="integrity check"):
        persist.extract_snapshot_bytes(buffer.getvalue())
    # The previous local database is untouched.
    connection = sqlite3.connect(fake_root / "data" / "deep-research.db")
    try:
        assert connection.execute("SELECT name FROM users WHERE id = 'u1'").fetchone()[0] == "Alice"
    finally:
        connection.close()


def test_extract_refuses_traversal_and_absolute_paths(fake_root):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name in ("../evil.txt", "/abs.txt", "data/ok.txt"):
            info = tarfile.TarInfo(name=name)
            content = b"x"
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    assert persist.extract_snapshot_bytes(buffer.getvalue()) == ["data/ok.txt"]
    assert not (fake_root / "evil.txt").exists()


def test_should_restore_policy():
    assert persist.should_restore(None, None) is False
    assert persist.should_restore({"other": 1}, None) is False
    # Fresh machine: an unreadable remote timestamp still restores.
    assert persist.should_restore({"created_at": "not-a-date"}, None) is True
    assert persist.should_restore(
        {"created_at": "2026-01-02T00:00:00+00:00"},
        {"created_at": "2026-01-01T00:00:00+00:00"},
    ) is True
    assert persist.should_restore(
        {"created_at": "2026-01-01T00:00:00+00:00"},
        {"created_at": "2026-01-02T00:00:00+00:00"},
    ) is False


def _fake_remote():
    """Fake remote backend: dict key -> bytes, with call log."""
    store: dict[str, bytes] = {}
    calls: list[str] = []

    def fake_fetch(name: str, timeout: float = 30.0):
        calls.append(f"GET {name}")
        if name in store:
            return 200, store[name]
        return 404, b""

    def fake_store(name: str, body: bytes, timeout: float = 30.0):
        calls.append(f"PUT {name}")
        store[name] = body
        return 200

    return store, calls, fake_fetch, fake_store


@pytest.fixture()
def fake_backend(monkeypatch):
    store, calls, fake_fetch, fake_store = _fake_remote()
    monkeypatch.setattr(persist, "_remote_fetch", fake_fetch)
    monkeypatch.setattr(persist, "_remote_store", fake_store)
    persist._boot_restored_at = None
    persist._last_upload_at = 0.0
    return store, calls


@pytest.fixture()
def any_backend_env(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_GITHUB_TOKEN", "token")
    monkeypatch.setenv("SNAPSHOT_GITHUB_REPO", "owner/repo")


def test_restore_downloads_newer_remote_snapshot(fake_root, any_backend_env, fake_backend, monkeypatch):
    store, _ = fake_backend
    payload, meta = persist.build_snapshot_bytes()
    store["snapshot.meta.json"] = json.dumps(meta).encode()
    store["snapshot.tar.gz"] = payload
    assert persist.restore_on_startup() is True
    connection = sqlite3.connect(fake_root / "data" / "deep-research.db")
    try:
        assert connection.execute("SELECT name FROM users WHERE id = 'u1'").fetchone()[0] == "Alice"
    finally:
        connection.close()


def test_upload_blocked_when_remote_newer_and_unseen(fake_root, any_backend_env, fake_backend):
    store, calls = fake_backend
    store["snapshot.meta.json"] = json.dumps({"created_at": "2026-05-01T00:00:00+00:00", "files": []}).encode()
    assert persist.upload_now("scheduled") is False
    assert not any(call.startswith("PUT") for call in calls)


def test_upload_blocked_on_network_error(fake_root, any_backend_env, monkeypatch):
    def failing_fetch(name: str, timeout: float = 30.0):
        raise ConnectionError("flaky network")

    monkeypatch.setattr(persist, "_remote_fetch", failing_fetch)
    assert persist.upload_now("scheduled") is False


def test_upload_blocked_on_forbidden(fake_root, any_backend_env, monkeypatch):
    async def _unused():
        pass

    def forbidden_fetch(name: str, timeout: float = 30.0):
        return 403, b""

    monkeypatch.setattr(persist, "_remote_fetch", forbidden_fetch)
    assert persist.upload_now("scheduled") is False
    assert persist.restore_on_startup() is False


def test_first_upload_when_storage_empty(fake_root, any_backend_env, fake_backend):
    store, calls = fake_backend
    assert persist.upload_now("scheduled") is True
    assert "snapshot.tar.gz" in store and "snapshot.meta.json" in store
    # Nothing changed: second upload is skipped without any PUT.
    calls.clear()
    assert persist.upload_now("scheduled") is False
    assert calls == ["GET snapshot.meta.json"]


def test_backend_selection_prefers_github(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_GITHUB_TOKEN", "token")
    monkeypatch.setenv("SNAPSHOT_GITHUB_REPO", "owner/repo")
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("R2_BUCKET", "bucket")
    assert persist._backend_kind() == "github"
    assert persist.snapshot_enabled() is True
    monkeypatch.delenv("SNAPSHOT_GITHUB_TOKEN")
    assert persist._backend_kind() == "r2"
    monkeypatch.delenv("R2_BUCKET")
    assert persist._backend_kind() is None
    assert persist.snapshot_enabled() is False


def test_disabled_mode_is_noop_without_network(monkeypatch):
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    assert persist.restore_on_startup() is False
    assert persist.upload_now() is False
    persist.start_background_uploader()
    persist.stop_background_uploader()


class _FakeGitHubClient:
    """Minimal GitHub Contents API emulator for transport-shape tests."""

    def __init__(self, files: dict[str, bytes], calls: list):
        self.files = files
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def _path(self, url: str) -> str:
        marker = "/contents/"
        assert marker in url, url
        return url.split(marker, 1)[1]

    def get(self, url, headers=None, params=None):
        import base64 as _base64

        headers = headers or {}
        path = self._path(url)
        self.calls.append(("GET", path, dict(headers), dict(params or {})))
        if path not in self.files:
            return _FakeResponse(404, b"")
        if headers.get("Accept") == "application/vnd.github.raw":
            return _FakeResponse(200, self.files[path])
        payload = {"sha": "sha-" + path, "content": _base64.b64encode(self.files[path]).decode()}
        return _FakeResponse(200, json.dumps(payload).encode())

    def put(self, url, headers=None, json=None):
        import base64 as _base64

        path = self._path(url)
        self.calls.append(("PUT", path, dict(headers or {}), dict(json or {})))
        body = json or {}
        if "content" not in body or "branch" not in body:
            return _FakeResponse(422, b"")
        if path in self.files and body.get("sha") != "sha-" + path:
            return _FakeResponse(409, b"")
        self.files[path] = _base64.b64decode(body["content"])
        return _FakeResponse(201, b"")

    def delete(self, url, headers=None, json=None):
        path = self._path(url)
        self.calls.append(("DELETE", path, dict(headers or {}), dict(json or {})))
        body = json or {}
        if path not in self.files:
            return _FakeResponse(404, b"")
        if body.get("sha") != "sha-" + path:
            return _FakeResponse(409, b"")
        del self.files[path]
        return _FakeResponse(200, b"")


class _FakeResponse:
    def __init__(self, status_code, content):
        self.status_code = status_code
        self.content = content

    def json(self):
        return json.loads(self.content.decode())


@pytest.fixture()
def github_api(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_GITHUB_TOKEN", "gh-token")
    monkeypatch.setenv("SNAPSHOT_GITHUB_REPO", "owner/repo")
    monkeypatch.setenv("SNAPSHOT_GITHUB_BRANCH", "main")
    monkeypatch.setenv("SNAPSHOT_GITHUB_PATH", "snapshots")
    for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(name, raising=False)
    files: dict[str, bytes] = {}
    calls: list = []

    def factory(*args, **kwargs):
        return _FakeGitHubClient(files, calls)

    import httpx

    monkeypatch.setattr(httpx, "Client", factory)
    assert persist._backend_kind() == "github"
    return files, calls


def test_github_fetch_roundtrip(github_api):
    files, calls = github_api
    assert persist._remote_fetch("snapshot.meta.json") == (404, b"")
    assert persist._remote_store("snapshot.meta.json", b'{"a":1}') == 201
    assert persist._remote_fetch("snapshot.meta.json") == (200, b'{"a":1}')
    assert persist._remote_delete("snapshot.meta.json") == 200
    assert persist._remote_fetch("snapshot.meta.json") == (404, b"")
    put_calls = [call for call in calls if call[0] == "PUT"]
    assert put_calls and put_calls[0][1] == "snapshots/snapshot.meta.json"
    assert put_calls[0][2]["Authorization"] == "Bearer gh-token"
    assert put_calls[0][3]["branch"] == "main"
    assert "sha" not in put_calls[0][3]


def test_github_update_sends_sha(github_api):
    files, calls = github_api
    files["snapshots/snapshot.meta.json"] = b"old"
    assert persist._remote_store("snapshot.meta.json", b"new") in (200, 201)
    put_calls = [call for call in calls if call[0] == "PUT"]
    assert put_calls[0][1] == "snapshots/snapshot.meta.json"
    assert put_calls[0][3]["sha"] == "sha-snapshots/snapshot.meta.json"
    status, content = persist._remote_fetch("snapshot.meta.json")
    assert (status, content) == (200, b"new")


def test_github_full_snapshot_cycle(fake_root, github_api):
    assert persist.restore_on_startup() is False
    assert persist.upload_now("scheduled") is True
    connection = sqlite3.connect(fake_root / "data" / "deep-research.db")
    try:
        connection.execute("INSERT INTO users VALUES ('u2', 'Bob')")
        connection.commit()
    finally:
        connection.close()
    assert persist.upload_now("scheduled") is True
    # Simulate a fresh machine: local files and marker are gone.
    (fake_root / "data" / "deep-research.db").unlink()
    (fake_root / "data" / ".snapshot-meta.json").unlink()
    persist._boot_restored_at = None
    persist._last_upload_at = 0.0
    assert persist.restore_on_startup() is True
    connection = sqlite3.connect(fake_root / "data" / "deep-research.db")
    try:
        names = {row[0] for row in connection.execute("SELECT id FROM users").fetchall()}
        assert names == {"u1", "u2"}
    finally:
        connection.close()


def test_marker_roundtrip(fake_root):
    assert persist.read_local_marker() is None
    persist.write_local_marker({"created_at": "2026-01-01T00:00:00+00:00"})
    assert json.loads((fake_root / "data" / ".snapshot-meta.json").read_text())["created_at"].startswith("2026")
