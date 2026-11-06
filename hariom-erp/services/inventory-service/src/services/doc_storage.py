"""Where Doc Vault files are kept (6 Nov 2026).

Two backends behind one small interface:

``local`` (default)
    A directory: ``DOCS_STORAGE_DIR``, else ``$ERP_RUNTIME_DIR/documents``, else ``./data/documents``.
    On live this directory is the named volume ``erp_documents`` mounted at ``/data/documents``
    (deploy/aws-ec2/docker-compose.yml), never the container's own filesystem.

``s3``
    ``DOCS_STORAGE_BACKEND=s3`` with ``DOCS_S3_BUCKET``, ``DOCS_S3_REGION`` and ``DOCS_S3_PREFIX``.
    Objects are written with SSE (AES256). Reads are streamed through the service by default
    (the site's CSP only allows same-origin images and frames); ``DOCS_S3_DELIVERY=redirect``
    sends the browser a 5-minute presigned GET instead. See docs/runbooks/doc-vault-storage.md.

Keys look like ``{plant}/{yyyy}/{mm}/{doc_id}.{ext}``; thumbnails ``thumbs/{plant}/{yyyy}/{mm}/{doc_id}.jpg``.
Each page row records the backend it was written to, so files written before a switch to S3 keep
reading from the local volume until they are copied across.

If S3 is chosen but boto3 or the bucket is missing, writes fail with :class:`StorageUnavailable`
(the API answers 503 "Document storage is not set up") and nothing else in the service breaks.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional, Protocol

PRESIGN_SECONDS = 300
_CHUNK = 256 * 1024


class StorageUnavailable(RuntimeError):
    """The configured backend cannot be used (not set up, missing library, bucket unreachable)."""


class StorageObjectMissing(FileNotFoundError):
    """The key is not in the backend."""


def document_key(plant_id: str, doc_id: str, ext: str, when: Optional[datetime] = None, *, page_no: int = 1) -> str:
    """``{plant}/{yyyy}/{mm}/{doc_id}.{ext}``; page 2 onwards get ``-p2`` etc. before the extension."""
    when = when or datetime.utcnow()
    suffix = "" if page_no <= 1 else f"-p{page_no}"
    return f"{_safe(plant_id)}/{when:%Y}/{when:%m}/{_safe(doc_id)}{suffix}.{_safe(ext).lower()}"


def thumb_key_for(key: str) -> str:
    stem = key.rsplit(".", 1)[0]
    return f"thumbs/{stem}.jpg"


def _safe(part: str) -> str:
    cleaned = "".join(ch for ch in str(part) if ch.isalnum() or ch in "-_")
    if not cleaned:
        raise ValueError("empty storage key part")
    return cleaned


class DocStorage(Protocol):
    name: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def stream(self, key: str) -> Iterator[bytes]: ...

    def head(self, key: str) -> Optional[int]:
        """Size in bytes, or None when the key is missing."""

    def presigned_get(self, key: str, *, filename: str, content_type: str, expires: int = PRESIGN_SECONDS) -> Optional[str]:
        """A short-lived direct URL, or None when the backend serves bytes itself."""


@dataclass
class LocalStorage:
    root: Path
    name: str = "local"

    def _path(self, key: str) -> Path:
        root = self.root.resolve()
        path = (root / key).resolve()
        if root not in path.parents:
            raise ValueError("storage key escapes the storage directory")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + ".part")
            with temporary.open("wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        except OSError as exc:
            raise StorageUnavailable(f"Could not write the document file: {exc.strerror or exc}") from exc

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise StorageObjectMissing(key)
        return path.read_bytes()

    def stream(self, key: str) -> Iterator[bytes]:
        path = self._path(key)
        if not path.is_file():
            raise StorageObjectMissing(key)

        def chunks() -> Iterator[bytes]:
            with path.open("rb") as handle:
                while True:
                    block = handle.read(_CHUNK)
                    if not block:
                        return
                    yield block

        return chunks()

    def head(self, key: str) -> Optional[int]:
        path = self._path(key)
        return path.stat().st_size if path.is_file() else None

    def presigned_get(self, key: str, *, filename: str, content_type: str, expires: int = PRESIGN_SECONDS) -> Optional[str]:
        return None


class S3Storage:
    name = "s3"

    def __init__(self, bucket: str, region: Optional[str], prefix: str = "", *, client=None, delivery: str = "proxy"):
        if not bucket:
            raise StorageUnavailable("DOCS_S3_BUCKET is not set")
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.delivery = delivery
        if client is None:
            try:
                import boto3  # noqa: WPS433 - optional dependency, imported only when S3 is chosen
                from botocore.config import Config
            except ImportError as exc:  # pragma: no cover - depends on the image
                raise StorageUnavailable("boto3 is not installed; S3 document storage cannot be used") from exc
            client = boto3.client("s3", region_name=region or None,
                                  config=Config(signature_version="s3v4", retries={"max_attempts": 4, "mode": "standard"}))
        self.client = client

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            self.client.put_object(Bucket=self.bucket, Key=self._key(key), Body=data, ContentType=content_type,
                                   ServerSideEncryption="AES256")
        except Exception as exc:  # botocore raises many types; the caller only needs "could not store"
            raise StorageUnavailable(f"Could not store the document in S3: {exc}") from exc

    def _get_object(self, key: str):
        try:
            return self.client.get_object(Bucket=self.bucket, Key=self._key(key))
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None
            if code in {"NoSuchKey", "404", "NotFound"}:
                raise StorageObjectMissing(key) from exc
            raise StorageUnavailable(f"Could not read the document from S3: {exc}") from exc

    def get(self, key: str) -> bytes:
        return self._get_object(key)["Body"].read()

    def stream(self, key: str) -> Iterator[bytes]:
        body = self._get_object(key)["Body"]
        return iter(lambda: body.read(_CHUNK), b"")

    def head(self, key: str) -> Optional[int]:
        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=self._key(key))["ContentLength"])
        except Exception:
            return None

    def presigned_get(self, key: str, *, filename: str, content_type: str, expires: int = PRESIGN_SECONDS) -> Optional[str]:
        if self.delivery != "redirect":
            return None
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": self._key(key), "ResponseContentType": content_type,
                    "ResponseContentDisposition": f'inline; filename="{filename}"'},
            ExpiresIn=expires,
        )


def local_root() -> Path:
    configured = os.getenv("DOCS_STORAGE_DIR", "").strip()
    if configured:
        return Path(configured)
    runtime = os.getenv("ERP_RUNTIME_DIR", "").strip()
    if runtime:
        return Path(runtime) / "documents"
    return Path.cwd() / "data" / "documents"


_cache: dict[str, DocStorage] = {}


def configured_backend() -> str:
    value = os.getenv("DOCS_STORAGE_BACKEND", "local").strip().lower() or "local"
    return value if value in {"local", "s3"} else "local"


def get_storage(name: Optional[str] = None) -> DocStorage:
    """The backend new files go to (``name=None``) or the one a page row was written to."""
    backend = (name or configured_backend()).lower()
    if backend in _cache:
        return _cache[backend]
    if backend == "s3":
        storage: DocStorage = S3Storage(
            os.getenv("DOCS_S3_BUCKET", "").strip(),
            os.getenv("DOCS_S3_REGION", "").strip() or os.getenv("AWS_REGION", "").strip() or None,
            os.getenv("DOCS_S3_PREFIX", "").strip(),
            delivery=os.getenv("DOCS_S3_DELIVERY", "proxy").strip().lower(),
        )
    else:
        storage = LocalStorage(local_root())
    _cache[backend] = storage
    return storage


def reset_storage_cache() -> None:
    """Tests and a config change: build the backends again from the environment."""
    _cache.clear()
