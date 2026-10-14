"""Durable snapshots of local state to external storage.

Render Free (and any re-deploy) wipes the local filesystem, which deletes
user accounts, reports, avatars and libraries. When snapshot storage is
configured — a private GitHub repo (no credit card needed) or a Cloudflare
R2 bucket — the API:

- downloads the newest snapshot at startup (before serving requests), and
- uploads a fresh snapshot every few minutes and on graceful shutdown.

Safety rules (fail closed, never overwrite blindly):

- Uploads happen only after this boot restored the remote snapshot, or after
  the bucket was verified to really hold no snapshot (HTTP 404 — network
  errors and 403s block uploads instead of risking an overwrite).
- A remote snapshot newer than anything this boot has seen is never
  overwritten; restart first so it is restored instead.
- SQLite files are snapshotted through the online-backup API (never by
  copying live .db/-wal files), and every restored database must pass
  ``PRAGMA integrity_check`` or the restore is rolled back.

Without R2 configuration everything behaves exactly as before (local only),
and snapshot failures never crash the API: they are logged and skipped.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import sqlite3
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlsplit

_SNAPSHOT_NAME = "snapshot.tar.gz"
_META_NAME = "snapshot.meta.json"
_MARKER_NAME = ".snapshot-meta.json"
_MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024

_uploader_thread: threading.Thread | None = None
_uploader_stop = threading.Event()
_uploader_lock = threading.Lock()
_last_upload_at = 0.0
# created_at of the snapshot restored by this boot (None when no restore ran).
_boot_restored_at: str | None = None


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def r2_enabled() -> bool:
    return all(
        os.getenv(name, "").strip()
        for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
    )


def snapshot_interval() -> float:
    try:
        return max(60.0, float(os.getenv("SNAPSHOT_INTERVAL_SECONDS", "300")))
    except ValueError:
        return 300.0


def _r2_base() -> tuple[str, str]:
    account = os.getenv("R2_ACCOUNT_ID", "").strip()
    bucket = os.getenv("R2_BUCKET", "").strip()
    prefix = os.getenv("R2_PREFIX", "").strip().strip("/")
    base = f"https://{account}.r2.cloudflarestorage.com/{bucket}"
    if prefix:
        base += f"/{prefix}"
    return base, prefix


def _r2_key(name: str) -> str:
    _, prefix = _r2_base()
    key = f"snapshots/{name}"
    return f"{prefix}/{key}" if prefix else key


# ---------------------------------------------------------------------------
# Minimal AWS Signature V4 (R2 is S3-compatible). No new dependencies.
# ---------------------------------------------------------------------------

def _canonical_query(query: str) -> str:
    pairs = parse_qsl(query, keep_blank_values=True)
    encoded = [(quote(key, safe="~"), quote(value, safe="~")) for key, value in pairs]
    return "&".join(f"{key}={value}" for key, value in sorted(encoded))


def _signed_headers(
    access_key: str,
    secret_key: str,
    method: str,
    url: str,
    payload_hash: str,
    *,
    region: str = "auto",
    service: str = "s3",
    amz_date: str | None = None,
    include_content_sha: bool = True,
) -> dict[str, str]:
    parts = urlsplit(url)
    if amz_date is None:
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = amz_date[:8]
    canonical_uri = quote(parts.path or "/", safe="/~")
    if include_content_sha:
        header_names = "host;x-amz-content-sha256;x-amz-date"
        canonical_headers = f"host:{parts.netloc}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    else:
        header_names = "host;x-amz-date"
        canonical_headers = f"host:{parts.netloc}\nx-amz-date:{amz_date}\n"
    canonical_request = "\n".join([
        method.upper(), canonical_uri, _canonical_query(parts.query),
        canonical_headers, header_names, payload_hash,
    ])
    scope = f"{datestamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()])

    def _hmac(key: bytes, message: str) -> bytes:
        return hmac.new(key, message.encode(), hashlib.sha256).digest()

    signing_key = _hmac(_hmac(_hmac(_hmac(b"AWS4" + secret_key.encode(), datestamp), region), service), "aws4_request")
    signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers = {
        "Authorization": f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={header_names}, Signature={signature}",
        "x-amz-date": amz_date,
    }
    if include_content_sha:
        headers["x-amz-content-sha256"] = payload_hash
    return headers


def _r2_request(method: str, name: str, body: bytes | None = None, timeout: float = 30.0) -> tuple[int, bytes]:
    import httpx

    base, _ = _r2_base()
    url = f"{base}/{_r2_key(name)}"
    payload_hash = hashlib.sha256(body or b"").hexdigest()
    headers = _signed_headers(
        os.getenv("R2_ACCESS_KEY_ID", "").strip(),
        os.getenv("R2_SECRET_ACCESS_KEY", "").strip(),
        method,
        url,
        payload_hash,
    )
    if body is not None:
        headers["Content-Length"] = str(len(body))
    with httpx.Client(timeout=timeout) as client:
        response = client.request(method, url, headers=headers, content=body)
        return response.status_code, response.content


# ---------------------------------------------------------------------------
# GitHub Contents API transport: needs no credit card, only a fine-grained
# personal access token with Contents read/write on one private repository.
# ---------------------------------------------------------------------------

def _github_repo() -> tuple[str, str, str, str] | None:
    token = os.getenv("SNAPSHOT_GITHUB_TOKEN", "").strip()
    repo = os.getenv("SNAPSHOT_GITHUB_REPO", "").strip()
    if not token or "/" not in repo:
        return None
    owner, name = (part.strip() for part in repo.split("/", 1))
    if not owner or not name:
        return None
    branch = os.getenv("SNAPSHOT_GITHUB_BRANCH", "main").strip() or "main"
    prefix = os.getenv("SNAPSHOT_GITHUB_PATH", "snapshots").strip().strip("/")
    return token, f"{owner}/{name}", branch, prefix


def github_enabled() -> bool:
    return _github_repo() is not None


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _github_paths(name: str) -> tuple[str, str]:
    config = _github_repo()
    assert config is not None
    _, repo, _, prefix = config
    path = f"{prefix}/{name}" if prefix else name
    return f"https://api.github.com/repos/{repo}/contents/{quote(path, safe='/')}", path


def _github_fetch(name: str, timeout: float = 30.0) -> tuple[int, bytes]:
    """GET a file as raw bytes: (200, content) or (404, b''). Raises on network errors."""
    import httpx

    config = _github_repo()
    assert config is not None
    token, _, branch, _ = config
    url, _ = _github_paths(name)
    headers = {**_github_headers(token), "Accept": "application/vnd.github.raw"}
    with httpx.Client(timeout=timeout) as client:
        response = client.get(url, headers=headers, params={"ref": branch})
        if response.status_code == 404:
            return 404, b""
        return response.status_code, response.content


def _github_current_sha(url: str, headers: dict[str, str], branch: str, timeout: float) -> tuple[int, str | None]:
    """Return (status, sha): 200+sha when the file exists, 404+None when absent."""
    import httpx

    with httpx.Client(timeout=timeout) as client:
        response = client.get(url, headers=headers, params={"ref": branch})
        if response.status_code == 404:
            return 404, None
        if response.status_code != 200:
            return response.status_code, None
        try:
            sha = response.json().get("sha")
        except ValueError:
            return response.status_code, None
        return 200, sha if isinstance(sha, str) else None


def _github_store(name: str, body: bytes, timeout: float = 30.0) -> int:
    config = _github_repo()
    assert config is not None
    token, _, branch, _ = config
    import httpx

    url, _ = _github_paths(name)
    headers = _github_headers(token)
    status, sha = _github_current_sha(url, headers, branch, timeout)
    if status not in (200, 404):
        return status
    payload: dict[str, object] = {
        "message": f"snapshot {name}",
        "content": base64.b64encode(body).decode("ascii"),
        "branch": branch,
    }
    if sha is not None:
        payload["sha"] = sha
    with httpx.Client(timeout=timeout) as client:
        response = client.put(url, headers=headers, json=payload)
        return response.status_code


def _github_delete(name: str, timeout: float = 30.0) -> int:
    config = _github_repo()
    assert config is not None
    token, _, branch, _ = config
    import httpx

    url, _ = _github_paths(name)
    headers = _github_headers(token)
    status, sha = _github_current_sha(url, headers, branch, timeout)
    if status == 404:
        return 404
    if status != 200 or sha is None:
        return status
    with httpx.Client(timeout=timeout) as client:
        response = client.delete(url, headers=headers, json={"message": f"remove {name}", "sha": sha, "branch": branch})
        return response.status_code


# ---------------------------------------------------------------------------
# Uniform remote layer: every orchestration path below uses these three
# helpers, so the fail-closed guards hold no matter which backend is active.
# ---------------------------------------------------------------------------

def _backend_kind() -> str | None:
    explicit = os.getenv("SNAPSHOT_BACKEND", "").strip().lower()
    if explicit == "github":
        return "github" if github_enabled() else None
    if explicit == "r2":
        return "r2" if r2_enabled() else None
    if github_enabled():
        return "github"
    if r2_enabled():
        return "r2"
    return None


def snapshot_enabled() -> bool:
    return _backend_kind() is not None


def _remote_fetch(name: str, timeout: float = 30.0) -> tuple[int, bytes]:
    kind = _backend_kind()
    if kind == "github":
        return _github_fetch(name, timeout)
    if kind == "r2":
        return _r2_request("GET", name, None, timeout)
    raise RuntimeError("Snapshot storage is not configured")


def _remote_store(name: str, body: bytes, timeout: float = 30.0) -> int:
    kind = _backend_kind()
    if kind == "github":
        return _github_store(name, body, timeout)
    if kind == "r2":
        status, _ = _r2_request("PUT", name, body, timeout)
        return status
    raise RuntimeError("Snapshot storage is not configured")


def _remote_delete(name: str, timeout: float = 30.0) -> int:
    kind = _backend_kind()
    if kind == "github":
        return _github_delete(name, timeout)
    if kind == "r2":
        status, _ = _r2_request("DELETE", name, None, timeout)
        return status
    raise RuntimeError("Snapshot storage is not configured")


# ---------------------------------------------------------------------------
# Snapshot contents: every local file that holds user data.
# ---------------------------------------------------------------------------

def _database_paths() -> list[Path]:
    roots = [
        os.getenv("AUTH_DATABASE_PATH", "data/deep-research.db"),
        os.getenv("PAPER_DATABASE_PATH", "data/paper-library.db"),
        os.getenv("RESEARCH_CHAT_DATABASE_PATH", "data/research-chat.db"),
    ]
    databases: list[Path] = []
    for raw in roots:
        path = (project_root() / raw).resolve() if not Path(raw).is_absolute() else Path(raw)
        if path.is_file():
            databases.append(path)
    return databases


def _data_dirs() -> list[Path]:
    roots = [
        os.getenv("AVATAR_DIR", "data/avatars"),
        os.getenv("REPORTS_DIR", "reports"),
    ]
    directories: list[Path] = []
    for raw in roots:
        path = (project_root() / raw).resolve() if not Path(raw).is_absolute() else Path(raw)
        if path.is_dir():
            directories.append(path)
    return directories


def _clean_db_copy(src: Path, staging_dir: Path) -> Path:
    """Copy a live SQLite database through the online-backup API.

    Copying .db/-wal files directly can capture a half-written transaction;
    the backup API yields a transactionally consistent image instead.
    """
    staging = staging_dir / f"{src.name}.clean"
    if staging.exists():
        staging.unlink()
    src_con = sqlite3.connect(f"file:{src}?mode=ro", uri=True, timeout=30)
    try:
        dst_con = sqlite3.connect(staging, timeout=30)
        try:
            src_con.backup(dst_con)
        finally:
            dst_con.close()
    finally:
        src_con.close()
    if not _check_db_integrity(staging):
        raise ValueError(f"Database backup failed integrity check: {src.name}")
    return staging


def _check_db_integrity(path: Path) -> bool:
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
        try:
            rows = connection.execute("PRAGMA integrity_check").fetchall()
            return len(rows) == 1 and str(rows[0][0]).lower() == "ok"
        finally:
            connection.close()
    except Exception:
        return False


def collect_snapshot_files() -> list[Path]:
    """All persisted paths, duplicates removed (legacy helper for tooling)."""
    seen: set[str] = set()
    ordered: list[Path] = []
    candidates = [
        *[(db, False) for db in _database_paths()],
        *[(file, False) for directory in _data_dirs() for file in sorted(directory.rglob("*")) if file.is_file()],
    ]
    for path, _ in candidates:
        key = str(path)
        if key not in seen:
            seen.add(key)
            ordered.append(path)
    return ordered


def build_snapshot_bytes() -> tuple[bytes, dict]:
    """Tarball (paths relative to the project root) + metadata dict."""
    root = project_root()
    staged: list[tuple[str, Path, Path | None]] = []
    total = 0
    with tempfile.TemporaryDirectory(prefix="snapshot-dbs-") as staging_name:
        staging_dir = Path(staging_name)
        entries: list[tuple[str, Path, bool]] = []
        for db in _database_paths():
            try:
                entries.append((db.relative_to(root).as_posix(), _clean_db_copy(db, staging_dir), True))
            except ValueError:
                continue
        for directory in _data_dirs():
            for file in sorted(directory.rglob("*")):
                if file.is_file():
                    try:
                        entries.append((file.relative_to(root).as_posix(), file, False))
                    except ValueError:
                        continue
        for relative, source, _is_db in entries:
            if ".." in Path(relative).parts:
                continue
            size = source.stat().st_size
            if total + size > _MAX_SNAPSHOT_BYTES:
                break
            total += size
            staged.append((relative, source, None))
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            for relative, source, _ in staged:
                info = archive.gettarinfo(str(source), arcname=relative)
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                with source.open("rb") as handle:
                    archive.addfile(info, handle)
    meta = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "files": [relative for relative, _, _ in staged],
        "bytes": len(buffer.getvalue()),
    }
    return buffer.getvalue(), meta


def extract_snapshot_bytes(payload: bytes) -> list[str]:
    """Restore a snapshot tarball under the project root.

    Every restored ``*.db`` must pass ``PRAGMA integrity_check``; otherwise
    the whole restore is rolled back and a ``ValueError`` is raised, leaving
    the previous local files untouched.
    """
    root = project_root()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        names: list[str] = []
        for member in archive.getmembers():
            if not member.isfile():
                continue
            name = member.name
            # Refuse absolute paths and directory traversal unconditionally.
            if name.startswith("/") or ".." in Path(name).parts:
                continue
            target = (root / name).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                continue
            names.append(name)
        backups: dict[str, bytes | None] = {}
        for name in names:
            target = root / name
            backups[name] = target.read_bytes() if target.is_file() else None
        try:
            for name in names:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(name)
                if source is None:
                    raise ValueError(f"Cannot read snapshot member: {name}")
                with target.open("wb") as handle:
                    handle.write(source.read())
            for name in names:
                if name.endswith(".db") and not _check_db_integrity(root / name):
                    raise ValueError(f"Restored database failed integrity check: {name}")
        except Exception:
            for name, content in backups.items():
                target = root / name
                try:
                    if content is None:
                        if target.is_file():
                            target.unlink()
                    else:
                        target.write_bytes(content)
                except OSError:
                    pass
            raise
    return names


def _marker_path() -> Path:
    return project_root() / "data" / _MARKER_NAME


def read_local_marker() -> dict | None:
    try:
        return json.loads(_marker_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_local_marker(meta: dict) -> None:
    try:
        _marker_path().parent.mkdir(parents=True, exist_ok=True)
        _marker_path().write_text(json.dumps(meta), encoding="utf-8")
    except OSError:
        pass


def _marker_time(marker: dict | None) -> float:
    if not marker or not isinstance(marker.get("created_at"), str):
        return 0.0
    try:
        parsed = datetime.fromisoformat(marker["created_at"])
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except ValueError:
        return 0.0


def fetch_remote_meta() -> tuple[str, dict | None]:
    """Return ("ok", meta), ("absent", None) or ("error", None). Never raises."""
    try:
        status, content = _remote_fetch(_META_NAME)
    except Exception as exc:
        print(f"[persist] Snapshot metadata fetch failed: {exc}")
        return "error", None
    if status == 404:
        return "absent", None
    if status != 200:
        # 401/403 (bad credentials) and 5xx must never look like "no snapshot".
        print(f"[persist] Snapshot metadata fetch returned HTTP {status}.")
        return "error", None
    try:
        meta = json.loads(content.decode("utf-8"))
    except ValueError:
        print("[persist] Snapshot metadata is not valid JSON.")
        return "error", None
    if not isinstance(meta, dict) or not isinstance(meta.get("created_at"), str):
        print("[persist] Snapshot metadata is malformed.")
        return "error", None
    return "ok", meta


def remote_meta() -> dict | None:
    state, meta = fetch_remote_meta()
    return meta if state == "ok" else None


def should_restore(remote: dict | None, local: dict | None) -> bool:
    if not remote or not isinstance(remote.get("created_at"), str):
        return False
    if not local or not isinstance(local.get("created_at"), str):
        return True
    try:
        return datetime.fromisoformat(remote["created_at"]) > datetime.fromisoformat(local["created_at"])
    except ValueError:
        return True


def restore_on_startup() -> bool:
    """Download and apply the newest snapshot when it is newer than local."""
    global _boot_restored_at
    if not snapshot_enabled():
        return False
    try:
        state, remote = fetch_remote_meta()
        if state != "ok" or not should_restore(remote, read_local_marker()):
            return False
        assert remote is not None
        status, payload = _remote_fetch(_SNAPSHOT_NAME)
        if status != 200 or not payload:
            print("[persist] Snapshot archive missing despite newer metadata.")
            return False
        restored = extract_snapshot_bytes(payload)
        write_local_marker(remote)
        _boot_restored_at = remote["created_at"]
        global _last_upload_at
        _last_upload_at = time.time()
        print(f"[persist] Restored {len(restored)} files from snapshot ({remote.get('created_at')}).")
        return True
    except Exception as exc:
        print(f"[persist] Snapshot restore failed (continuing local-only): {exc}")
        return False


def _newest_local_mtime() -> float:
    newest = 0.0
    for path in collect_snapshot_files():
        try:
            newest = max(newest, path.stat().st_mtime)
        except OSError:
            continue
    return newest


def upload_now(reason: str = "scheduled", timeout: float = 30.0) -> bool:
    """Upload a fresh snapshot when local data changed.

    Fail-closed: uploads run only after this boot restored the remote
    snapshot, or after the bucket was verified to hold no snapshot at all
    (HTTP 404). Network errors, 403s and newer unseen remote snapshots all
    block the upload instead of risking an overwrite.
    """
    global _last_upload_at
    if not snapshot_enabled():
        return False
    with _uploader_lock:
        try:
            state, remote = fetch_remote_meta()
            if state == "error":
                print("[persist] Skipping upload: cannot verify remote snapshot state.")
                return False
            marker = read_local_marker()
            if state == "ok":
                assert remote is not None
                remote_created = remote["created_at"]
                marker_created = marker.get("created_at") if isinstance(marker, dict) else None
                if _boot_restored_at != remote_created and marker_created != remote_created:
                    print("[persist] Remote snapshot is newer than local state; refusing to overwrite. Restart to restore it first.")
                    return False
            if marker and _newest_local_mtime() <= max(_marker_time(marker), _last_upload_at):
                return False
            payload, meta = build_snapshot_bytes()
            if not meta["files"]:
                return False
            status = _remote_store(_SNAPSHOT_NAME, payload, timeout=timeout)
            if status not in (200, 201, 204):
                print(f"[persist] Snapshot upload failed with status {status}.")
                return False
            meta_body = json.dumps(meta).encode("utf-8")
            status = _remote_store(_META_NAME, meta_body, timeout=timeout)
            if status not in (200, 201, 204):
                print(f"[persist] Snapshot metadata upload failed with status {status}.")
                return False
            _last_upload_at = time.time()
            write_local_marker(meta)
            print(f"[persist] Uploaded snapshot ({reason}): {len(meta['files'])} files, {meta['bytes']} bytes.")
            return True
        except Exception as exc:
            print(f"[persist] Snapshot upload failed (continuing local-only): {exc}")
            return False


def _uploader_loop() -> None:
    while not _uploader_stop.wait(snapshot_interval()):
        if _uploader_stop.is_set():
            break
        upload_now("scheduled")


def start_background_uploader() -> None:
    global _uploader_thread
    if not snapshot_enabled() or (_uploader_thread is not None and _uploader_thread.is_alive()):
        return
    _uploader_stop.clear()
    _uploader_thread = threading.Thread(target=_uploader_loop, name="snapshot-uploader", daemon=True)
    _uploader_thread.start()
    print("[persist] Snapshot uploader started.")


def stop_background_uploader() -> None:
    global _uploader_thread
    _uploader_stop.set()
    thread, _uploader_thread = _uploader_thread, None
    if thread is not None:
        thread.join(timeout=5.0)
    # Final upload on graceful shutdown (Render gives ~30s on SIGTERM).
    try:
        upload_now("shutdown", timeout=20.0)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Connectivity check: `python -m backend.persist check`
# ---------------------------------------------------------------------------

def cmd_check() -> int:
    kind = _backend_kind()
    if kind is None:
        print("Snapshot storage is not configured.")
        print("GitHub: set SNAPSHOT_GITHUB_TOKEN and SNAPSHOT_GITHUB_REPO (owner/name).")
        print("R2: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.")
        return 2
    print(f"Snapshot backend: {kind}")
    key = "connectivity-check.bin"
    probe = os.urandom(64)
    try:
        status = _remote_store(key, probe)
        print(f"PUT {key}: HTTP {status}")
        if status not in (200, 201, 204):
            print("Upload failed: check the bucket/repo name, credentials and prefix.")
            return 1
        status, content = _remote_fetch(key)
        print(f"GET {key}: HTTP {status}, {len(content)} bytes")
        if status != 200 or content != probe:
            print("Download mismatch: storage is reachable but roundtrip failed.")
            return 1
        status = _remote_delete(key)
        print(f"DELETE {key}: HTTP {status}")
        if status not in (200, 201, 204, 404):
            print("Delete failed (the probe file may remain in storage).")
            return 1
    except Exception as exc:
        print(f"Snapshot request failed: {exc}")
        return 1
    print("Snapshot storage OK: writable and readable.")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(cmd_check())
