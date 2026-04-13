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
    if method in ["POST", "PUT", "PATCH"]:
        body = await request.body()

    headers = {}
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
        response = await http_client.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            content=body,
        )
        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type"),
        )
    except httpx.RequestError:
        return Response(
            content=b'{"detail":"Service unavailable"}',
            status_code=503,
            media_type="application/json",
        )
