from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import Request, Response


HTTP_TIMEOUT = float(os.getenv("BFF_HTTP_TIMEOUT_SECONDS", "30"))
http_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)


def _forward_headers(token: str, request: Request) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": request.headers.get("accept", "application/json"),
    }
    plant_id = request.headers.get("X-Plant-ID")
    if plant_id:
      headers["X-Plant-ID"] = plant_id
    content_type = request.headers.get("content-type")
    if content_type:
      headers["Content-Type"] = content_type
    return headers


async def proxy_to_service(
    base_url: str,
    service_path: str,
    request: Request,
    token: str,
    *,
    json_body: Any | None = None,
) -> Response:
    raw_body = await request.body()
    request_kwargs: dict[str, Any] = {
        "method": request.method,
        "url": f"{base_url}{service_path}",
        "headers": _forward_headers(token, request),
        "params": dict(request.query_params),
    }
    if json_body is not None:
        request_kwargs["json"] = json_body
    elif raw_body:
        request_kwargs["content"] = raw_body

    response = await http_client.request(**request_kwargs)
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=response.headers.get("content-type"),
    )
import httpx
import jwt
import os
from fastapi import Request, Response
from typing import Optional

http_client = httpx.AsyncClient(timeout=30.0)
JWT_SECRET = os.getenv("JWT_SECRET", "change_me_in_production")


async def proxy_to_service(
    service_url: str,
    path: str,
    request: Request,
    token: Optional[str] = None,
    force_method: Optional[str] = None,
) -> Response:
    url = f"{service_url}{path}"
    method = force_method or request.method

    body = None
    json_payload = None
    if method in ["POST", "PUT", "PATCH"]:
        body = await request.body()
        if body and "application/json" in (request.headers.get("content-type") or "").lower():
            try:
                json_payload = await request.json()
            except Exception:
                json_payload = None

    headers = {}
    content_type = request.headers.get("content-type")
    accept = request.headers.get("accept")
    if content_type:
        headers["Content-Type"] = content_type
    if accept:
        headers["Accept"] = accept
    if token:
        headers["Authorization"] = f"Bearer {token}"
        
        # Extract plant_id for isolation
        # 1. Check if client sent X-Plant-ID header (Owner override)
        plant_id = request.headers.get("X-Plant-ID")
        
        # 2. If not, extract from JWT
        if not plant_id:
            try:
                # We decode without verification if we just need the claim, 
                # but verification is better if secret is available.
                payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
                plant_id = payload.get("plant_id")
            except Exception:
                plant_id = None
        
        # 3. Forward to downstream service
        if plant_id:
            headers["X-Plant-ID"] = plant_id

    params = dict(request.query_params)

    try:
        request_kwargs = {
            "method": method,
            "url": url,
            "headers": headers,
            "params": params,
        }
        if json_payload is not None:
            request_kwargs["json"] = json_payload
        else:
            request_kwargs["content"] = body
        response = await http_client.request(
            **request_kwargs,
        )
        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type"),
        )
    except httpx.RequestError as exc:
        detail = f"Service unavailable: {exc.__class__.__name__}"
        return Response(
            content=f'{{"detail":"{detail}"}}'.encode("utf-8"),
            status_code=503,
            media_type="application/json",
        )
