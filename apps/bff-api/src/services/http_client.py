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
