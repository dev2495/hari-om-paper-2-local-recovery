"""Doc Vault passthrough (6 Nov 2026): /api/documents/* → inventory-service /inventory/documents/*.

Uploads are multipart; the body and its Content-Type (with the boundary) go through untouched, up
to 15 MB (one 10 MB file plus the form). File responses keep Content-Disposition and a redirect's
Location (S3 presigned links), which the generic JSON proxy drops.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from src.middleware.auth import get_token
from src.services.http_client import _forward_headers, http_client

router = APIRouter()
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")
MAX_BODY_BYTES = 15 * 1024 * 1024
UPLOAD_TIMEOUT = httpx.Timeout(90.0, connect=10.0)
_KEEP_HEADERS = ("content-type", "content-disposition", "location", "cache-control", "x-content-type-options")


async def _pass(request: Request, token: str, service_path: str, *, timeout: httpx.Timeout | float | None = None) -> Response:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="The upload is larger than 15 MB. Send a smaller photo or split the PDF.")
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="The upload is larger than 15 MB. Send a smaller photo or split the PDF.")
    headers = _forward_headers(token, request)
    if request.method in {"GET", "HEAD"}:
        headers["Accept"] = "*/*"
    try:
        upstream = await http_client.request(
            request.method, f"{INVENTORY_SERVICE_URL}{service_path}", headers=headers,
            params=dict(request.query_params), content=body or None, timeout=timeout,
        )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The document service took too long. Try again; nothing is lost.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="The document service is not reachable. Try again in a minute.") from exc
    passed = {name: upstream.headers[name] for name in _KEEP_HEADERS if name in upstream.headers}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=passed)


@router.api_route("", methods=["GET", "POST"])
async def documents_root(request: Request, token: str = Depends(get_token)):
    timeout = UPLOAD_TIMEOUT if request.method == "POST" else None
    return await _pass(request, token, "/inventory/documents", timeout=timeout)


@router.get("/for/{entity_type}/{entity_id}")
async def documents_for(entity_type: str, entity_id: str, request: Request, token: str = Depends(get_token)):
    return await _pass(request, token, f"/inventory/documents/for/{entity_type}/{entity_id}")


@router.api_route("/{document_id}", methods=["GET", "PATCH"])
async def document_one(document_id: str, request: Request, token: str = Depends(get_token)):
    return await _pass(request, token, f"/inventory/documents/{document_id}")


@router.post("/{document_id}/pages")
async def document_pages(document_id: str, request: Request, token: str = Depends(get_token)):
    return await _pass(request, token, f"/inventory/documents/{document_id}/pages", timeout=UPLOAD_TIMEOUT)


@router.get("/{document_id}/{part}")
async def document_part(document_id: str, part: str, request: Request, token: str = Depends(get_token)):
    if part not in {"file", "thumb", "history"}:
        raise HTTPException(status_code=404, detail="Not found")
    return await _pass(request, token, f"/inventory/documents/{document_id}/{part}")


@router.post("/{document_id}/links")
async def document_link(document_id: str, request: Request, token: str = Depends(get_token)):
    return await _pass(request, token, f"/inventory/documents/{document_id}/links")


@router.delete("/{document_id}/links/{entity_type}/{entity_id}")
async def document_unlink(document_id: str, entity_type: str, entity_id: str, request: Request, token: str = Depends(get_token)):
    return await _pass(request, token, f"/inventory/documents/{document_id}/links/{entity_type}/{entity_id}")


@router.post("/{document_id}/void")
async def document_void(document_id: str, request: Request, token: str = Depends(get_token)):
    return await _pass(request, token, f"/inventory/documents/{document_id}/void")
