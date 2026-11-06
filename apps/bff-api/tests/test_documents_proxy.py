"""BFF: Doc Vault passthrough (6 Nov 2026) keeps multipart bodies, file headers and redirects."""
import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.routes import documents


def _request(method: str, body: bytes = b"", headers: list | None = None, query: bytes = b""):
    sent = {"done": False}

    async def receive():
        if sent["done"]:
            return {"type": "http.disconnect"}
        sent["done"] = True
        return {"type": "http.request", "body": body, "more_body": False}
    base = [(b"x-plant-id", b"plant-a")] + (headers or [])
    return Request({"type": "http", "method": method, "path": "/", "headers": base, "query_string": query}, receive)


def test_multipart_upload_is_forwarded_untouched():
    body = b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.jpg\"\r\n\r\n\xff\xd8\xff\r\n--b--\r\n"
    request = _request("POST", body, [(b"content-type", b"multipart/form-data; boundary=b")])
    upstream = httpx.Response(200, json={"created": True}, request=httpx.Request("POST", "http://x"))
    with patch.object(documents.http_client, "request", new=AsyncMock(return_value=upstream)) as call:
        response = asyncio.run(documents.documents_root(request, "token"))
    args, kwargs = call.await_args
    assert args == ("POST", f"{documents.INVENTORY_SERVICE_URL}/inventory/documents")
    assert kwargs["content"] == body and kwargs["headers"]["Content-Type"] == "multipart/form-data; boundary=b"
    assert kwargs["headers"]["X-Plant-ID"] == "plant-a" and response.status_code == 200


def test_file_keeps_disposition_and_redirect_location():
    upstream = httpx.Response(200, content=b"%PDF-1.4", headers={"content-type": "application/pdf",
                              "content-disposition": 'inline; filename="DV-2611-0001.pdf"'}, request=httpx.Request("GET", "http://x"))
    with patch.object(documents.http_client, "request", new=AsyncMock(return_value=upstream)):
        response = asyncio.run(documents.document_part("abc", "file", _request("GET", query=b"page=1"), "token"))
    assert response.headers["content-disposition"].startswith("inline") and response.body == b"%PDF-1.4"
    moved = httpx.Response(307, headers={"location": "https://bucket.s3/signed"}, request=httpx.Request("GET", "http://x"))
    with patch.object(documents.http_client, "request", new=AsyncMock(return_value=moved)):
        response = asyncio.run(documents.document_part("abc", "thumb", _request("GET"), "token"))
    assert response.status_code == 307 and response.headers["location"] == "https://bucket.s3/signed"
    with pytest.raises(HTTPException):
        asyncio.run(documents.document_part("abc", "secrets", _request("GET"), "token"))


def test_oversized_upload_is_refused_before_forwarding():
    request = _request("POST", b"", [(b"content-length", str(16 * 1024 * 1024).encode())])
    with patch.object(documents.http_client, "request", new=AsyncMock()) as call:
        with pytest.raises(HTTPException) as refused:
            asyncio.run(documents.documents_root(request, "token"))
    assert refused.value.status_code == 413 and call.await_count == 0
