"""Bounded, user-isolated document cache and public-only document reader.

Fetch connects to the validated IP (including redirects), not a second DNS lookup.
TLS still verifies the original hostname. No headless browser, cookies, OCR, or
paywall bypass. Text extraction is not a guarantee of table/formula fidelity.
"""
import hashlib
import ipaddress
import json
import os
import re
import socket
import sqlite3
import time
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx

MAX_BYTES = 20 * 1024 * 1024
MAX_CHARS = 160000
MAX_PAGES = 100
USER_AGENT = "NexoraResearch/1.0"
PDF_EXTRACTION_VERSION = 2


def canonical_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only public HTTP(S) URLs without credentials are accepted.")
    if parsed.port and parsed.port != (443 if parsed.scheme == "https" else 80):
        raise ValueError("Non-standard ports are not allowed.")
    return urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))


def public_addresses(url: str) -> list[str]:
    parsed = urlsplit(canonical_url(url))
    host = parsed.hostname or ""
    addresses = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(ip.split("%", 1)[0]).is_global for ip in addresses):
        raise ValueError("Private, local, reserved, or mixed-network targets are blocked.")
    return addresses


def fetch_public(url: str, *, limit: int = MAX_BYTES, timeout: float = 15) -> tuple[bytes, str, str]:
    current = canonical_url(url)
    for _ in range(5):
        parsed = urlsplit(current)
        address = public_addresses(current)[0]
        ip_host = f"[{address}]" if ":" in address else address
        target = urlunsplit((parsed.scheme, ip_host, parsed.path, parsed.query, ""))
        with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False) as client:
            with client.stream("GET", target, headers={"Host": parsed.netloc, "User-Agent": USER_AGENT}, extensions={"sni_hostname": parsed.hostname}) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    current = canonical_url(urljoin(current, response.headers.get("location", "")))
                    continue
                response.raise_for_status()
                if int(response.headers.get("content-length", "0")) > limit:
                    raise ValueError("Document exceeds the download limit.")
                result = bytearray()
                for block in response.iter_bytes():
                    result.extend(block)
                    if len(result) > limit:
                        raise ValueError("Document exceeds the download limit.")
                return bytes(result), response.headers.get("content-type", ""), current
    raise ValueError("Too many redirects.")


def robots_allowed(url: str, timeout: float = 10) -> bool:
    parsed = urlsplit(canonical_url(url))
    robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    try:
        content, _, _ = fetch_public(robots_url, limit=512000, timeout=timeout)
    except httpx.HTTPStatusError as error:
        return error.response.status_code in {404, 410}
    except Exception:
        # Fail closed on blocked networks, connection failures, or unknown policy.
        return False
    policy = RobotFileParser()
    policy.parse(content.decode("utf-8", errors="replace").splitlines())
    return policy.can_fetch(USER_AGENT, url)


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.content_parts: list[str] = []
        self.content_depth = 0
        self.hidden = 0

    def append(self, text):
        self.parts.append(text)
        if self.content_depth:
            self.content_parts.append(text)

    def handle_starttag(self, tag, attrs):
        if tag in {"main", "article"}:
            self.content_depth += 1
        if tag in {"script", "style", "nav", "footer", "noscript"}:
            self.hidden += 1
        if not self.hidden and tag in {"p", "div", "br", "li", "pre", "tr", "section", "h1", "h2", "h3", "h4"}:
            self.append("\n")
        if not self.hidden and tag in {"td", "th"}:
            self.append("\t")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "footer", "noscript"}:
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag in {"p", "div", "li", "pre", "tr", "h1", "h2", "h3", "h4"}:
            self.append("\n")
        if tag in {"main", "article"}:
            self.content_depth = max(0, self.content_depth - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.append(data)


def split_chunks(text: str, *, page: int | None = None, size: int = 2200) -> list[dict]:
    text = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+\n", "\n", text)).strip()
    chunks = []
    position = 0
    while position < len(text):
        end = min(position + size, len(text))
        if end < len(text):
            boundary = text.rfind("\n", position + size // 2, end)
            if boundary > position:
                end = boundary
        fragment = text[position:end].strip()
        if fragment:
            chunks.append({"text": fragment, "page": page, "locator": f"p. {page}" if page else f"text block {len(chunks) + 1}", "offset": position})
        position = end
    return chunks


def extract_pdf(content: bytes) -> dict:
    import pymupdf as fitz
    if len(content) > MAX_BYTES or not content.startswith(b"%PDF-"):
        raise ValueError("A PDF of at most 20 MB is required.")
    with fitz.open(stream=content, filetype="pdf") as document:
        if document.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported.")
        chunks = []
        chars = 0
        for index in range(min(document.page_count, MAX_PAGES)):
            # Line-level y/x sorting interleaves left/right columns in papers.
            # Order text blocks within columns, separated by spanning headings
            # or captions. This is a heuristic, not table/formula recognition.
            page = document[index]
            center = page.rect.width / 2
            blocks = []
            for block in page.get_text("dict")["blocks"]:
                if block["type"] != 0:
                    continue
                lines = [(line["bbox"], "".join(span["text"] for span in line["spans"])) for line in block["lines"]]
                groups_by_column = {}
                for bbox, text in lines:
                    column = "left" if bbox[2] <= center + 12 else "right" if bbox[0] >= center - 12 else "spanning"
                    groups_by_column.setdefault(column, []).append((bbox, text))
                # Some PDFs put two columns into one block. Split only clearly
                # separated left/right lines, not a full-width heading/caption.
                groups = groups_by_column.values() if set(groups_by_column) == {"left", "right"} else [lines]
                for group in groups:
                    bbox = (min(line[0][0] for line in group), min(line[0][1] for line in group), max(line[0][2] for line in group), max(line[0][3] for line in group))
                    text = "\n".join(line[1] for line in group)
                    if text.strip():
                        blocks.append((*bbox, text))
            left = [block for block in blocks if block[2] <= center + 12]
            right = [block for block in blocks if block[0] >= center - 12 and block not in left]
            columns = len(left) >= 3 and len(right) >= 3
            ordered = []
            if columns:
                spanning = sorted([block for block in blocks if block not in left and block not in right], key=lambda block: block[1])
                remaining_blocks = left + right
                for span in spanning:
                    above = [block for block in remaining_blocks if (block[1] + block[3]) / 2 < span[1]]
                    ordered.extend((block, "left" if block in left else "right") for group in (left, right) for block in sorted([item for item in above if item in group], key=lambda item: item[1]))
                    remaining_blocks = [block for block in remaining_blocks if block not in above]
                    ordered.append((span, "spanning"))
                ordered.extend((block, "left" if block in left else "right") for group in (left, right) for block in sorted([item for item in remaining_blocks if item in group], key=lambda item: item[1]))
            else:
                ordered = [(block, "single") for block in sorted(blocks, key=lambda item: (item[1], item[0]))]
            groups = []
            for block_index, (block, column) in enumerate(ordered):
                text = re.sub(r"(?<=[a-z])-\s*\n\s*(?=[a-z])", "", block[4]).strip()
                if groups and groups[-1]["column"] == column and len(groups[-1]["text"]) + len(text) + 2 <= 2200:
                    group = groups[-1]
                    group["text"] += "\n\n" + text
                    group["last_block"] = block_index
                    group["bbox"] = [min(group["bbox"][0], block[0]), min(group["bbox"][1], block[1]), max(group["bbox"][2], block[2]), max(group["bbox"][3], block[3])]
                else:
                    groups.append({"text": text, "column": column, "block_index": block_index, "last_block": block_index, "bbox": block[:4]})
            for group in groups:
                text, column, block_index = group["text"], group["column"], group["block_index"]
                remaining_chars = MAX_CHARS - chars
                fragments = split_chunks(text[:remaining_chars], page=index + 1)
                for fragment in fragments:
                    fragment.update(locator=f"p. {index + 1} · {column} · blocks {block_index + 1}-{group['last_block'] + 1}", column=column, block_index=block_index, bbox=[round(value, 2) for value in group["bbox"]])
                chunks.extend(fragments)
                chars += len(text[:remaining_chars])
                if chars >= MAX_CHARS:
                    break
            if chars >= MAX_CHARS:
                break
        if not chunks:
            raise ValueError("No extractable text. A scanned PDF requires OCR; upload a text PDF.")
        return {"chunks": chunks, "page_count": document.page_count, "truncated": document.page_count > MAX_PAGES or chars >= MAX_CHARS, "extraction": "pdf_text", "extraction_version": PDF_EXTRACTION_VERSION, "warning": "Column-aware text extraction is heuristic; tables, formulas and figure labels need visual verification; OCR is not performed."}


def extract_document(content: bytes, content_type: str) -> dict:
    if content.startswith(b"%PDF-"):
        return extract_pdf(content)
    if "html" not in content_type and "text/" not in content_type and "xml" not in content_type:
        raise ValueError("Unsupported document type.")
    text = content.decode("utf-8", errors="replace")
    if "html" in content_type:
        parser = TextExtractor()
        parser.feed(text)
        preferred = "".join(parser.content_parts)
        text = preferred if preferred.strip() else "".join(parser.parts)
    if not text.strip():
        raise ValueError("Document contains no text.")
    return {"chunks": split_chunks(text[:MAX_CHARS]), "truncated": len(text) > MAX_CHARS, "extraction": "html_text" if "html" in content_type else "text", "warning": "Text extraction only; interactive or image-only content may be missing."}


class DocumentStore:
    def __init__(self):
        self.root = Path(os.getenv("RESEARCH_DATA_DIR", "data/research")).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.database = self.root / "documents.db"
        with self.connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS documents (owner TEXT, id TEXT, url TEXT, payload TEXT, fetched REAL, PRIMARY KEY(owner,id))")

    def connect(self):
        connection = sqlite3.connect(self.database, timeout=20)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    @staticmethod
    def owner_key(owner: str) -> str:
        return hashlib.sha256(owner.encode()).hexdigest()

    def save(self, owner: str, document: dict, content: bytes | None = None) -> dict:
        payload = {**document}
        fingerprint = hashlib.sha256(content if content is not None else json.dumps(payload, sort_keys=True).encode()).hexdigest()
        payload.update(id=fingerprint, content_hash=fingerprint, fetched_at=time.time())
        key = self.owner_key(owner)
        if content is not None:
            directory = self.root / key
            directory.mkdir(exist_ok=True)
            (directory / f"{fingerprint}.pdf").write_bytes(content)
        with self.connect() as connection:
            connection.execute("INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?)", (key, fingerprint, payload.get("url", ""), json.dumps(payload, ensure_ascii=False), time.time()))
        return payload

    def get(self, owner: str, identifier: str) -> dict | None:
        with self.connect() as connection:
            row = connection.execute("SELECT payload FROM documents WHERE owner=? AND id=?", (self.owner_key(owner), identifier)).fetchone()
        return self._refresh_pdf(self.owner_key(owner), json.loads(row[0])) if row else None

    def _refresh_pdf(self, owner_key: str, payload: dict) -> dict:
        """Re-extract owned originals without re-upload, model calls or TTL reset."""
        identifier = payload.get("id", "")
        if payload.get("extraction") != "pdf_text" or payload.get("extraction_version", 0) >= PDF_EXTRACTION_VERSION or not re.fullmatch(r"[a-f0-9]{64}", identifier):
            return payload
        path = self.root / owner_key / f"{identifier}.pdf"
        if not path.is_file() or path.stat().st_size > MAX_BYTES:
            return payload
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != identifier:
            return payload
        refreshed = {**payload, **extract_pdf(content)}
        with self.connect() as connection:
            connection.execute("UPDATE documents SET payload=? WHERE owner=? AND id=?", (json.dumps(refreshed, ensure_ascii=False), owner_key, identifier))
        return refreshed

    def cached_url(self, owner: str, url: str) -> dict | None:
        # Versioned arXiv documents are immutable; latest documentation is short-lived.
        ttl = 86400 * 30 if re.search(r"/\d{4}\.\d{4,5}v\d+(?:$|[/?])", url) else 3600
        with self.connect() as connection:
            row = connection.execute("SELECT payload FROM documents WHERE owner=? AND url=? AND fetched>? ORDER BY fetched DESC LIMIT 1", (self.owner_key(owner), url, time.time() - ttl)).fetchone()
        return self._refresh_pdf(self.owner_key(owner), json.loads(row[0])) if row else None

    def find_cached(self, owner: str, query: str, limit: int = 4) -> list[dict]:
        """Bounded lexical reuse, not a multilingual semantic search guarantee.

        Only public-URL cache entries are considered. An uploaded private PDF is
        never silently borrowed into a different brief, even for the same owner.
        """
        def terms(text: str) -> set[str]:
            normalized = "".join(character for character in unicodedata.normalize("NFD", text.lower().replace("đ", "d")) if not unicodedata.combining(character))
            generic = set("the and for with how what this that from into help find read search explain research paper method methods official documentation guide sources analyze answer write english vietnamese tim doc giup cach ban tui minh phan tich nghien cuu tai lieu nguon phuong phap tieng viet anh bang tra loi".split())
            return set(re.findall(r"\w{3,}", normalized)) - generic

        keywords = terms(query)
        if not keywords:
            return []
        with self.connect() as connection:
            rows = connection.execute("SELECT url,payload,fetched FROM documents WHERE owner=? AND url<>'' ORDER BY fetched DESC LIMIT 80", (self.owner_key(owner),)).fetchall()
        ranked, seen = [], set()
        for url, payload, fetched in rows:
            if url in seen:
                continue
            seen.add(url)
            ttl = 86400 * 30 if re.search(r"/\d{4}\.\d{4,5}v\d+(?:$|[/?])", url) else 3600
            if time.time() - fetched > ttl:
                continue
            try:
                document = json.loads(payload)
            except (TypeError, ValueError):
                continue
            if not isinstance(document, dict) or not document.get("chunks"):
                continue
            metadata_matches = keywords & terms(document.get("title", "") + " " + url)
            body_matches = keywords & terms(" ".join(str(chunk.get("text", "")) for chunk in document["chunks"] if isinstance(chunk, dict)))
            if metadata_matches or len(body_matches) >= 2:
                ranked.append((len(metadata_matches) * 5 + len(body_matches), {**document, "cache_hit": True}))
        ranked.sort(key=lambda row: row[0], reverse=True)
        return [document for _, document in ranked[:max(0, min(limit, 8))]]

    def read_url(self, owner: str, url: str, title: str = "", timeout: float = 15) -> dict:
        url = canonical_url(url)
        cached = self.cached_url(owner, url)
        if cached:
            return {**cached, "cache_hit": True}
        if not robots_allowed(url, timeout=min(timeout, 10)):
            raise ValueError("Source access policy could not be confirmed or disallows crawling.")
        content, content_type, final_url = fetch_public(url, timeout=timeout)
        # A redirect can cross to a different site's crawl policy.
        if final_url != url and not robots_allowed(final_url, timeout=min(timeout, 10)):
            raise ValueError("Redirect target disallows crawling or has unknown access policy.")
        document = {**extract_document(content, content_type), "url": url, "resolved_url": final_url, "title": title or final_url, "cache_hit": False}
        return self.save(owner, document, content if content.startswith(b"%PDF-") else None)

    def pdf_path(self, owner: str, identifier: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{64}", identifier) or not self.get(owner, identifier):
            raise ValueError("Document not found.")
        path = self.root / self.owner_key(owner) / f"{identifier}.pdf"
        if not path.is_file():
            raise ValueError("Original PDF is not stored.")
        return path


def paper_url(value: str) -> str:
    """Preserve arXiv versions. DOI resolves normally, without bypassing access."""
    value = value.strip()
    arxiv = re.fullmatch(r"(?:(?:https?://)?(?:www\.)?arxiv\.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?", value)
    if arxiv:
        return f"https://arxiv.org/pdf/{arxiv.group(1)}"
    if re.fullmatch(r"10\.\d{4,9}/\S+", value):
        return canonical_url("https://doi.org/" + value)
    return canonical_url(value)
