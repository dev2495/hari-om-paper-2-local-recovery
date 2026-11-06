"""Gate (6 Nov 2026).

Signed-in: /api/gate/* → inventory-service /inventory/gate/*. The host of a walk-in visit is filled here
from the auth user list (name, department, e-mail for the notification), never from the browser.

Public (no login, the visitor's own phone after scanning the gate QR): /api/public/visit/* → inventory
/inventory/gate/public/* with the internal token. Rate limits per client IP (10 a minute for check-ins,
look-ups and photos; status polling has its own, looser limit) and 3 open visits per mobile (inventory).
Nothing here returns an e-mail, a phone number or a user's role: the host list is name + department.
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from collections import deque
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from src.middleware.auth import get_token
from src.services.http_client import _forward_headers, http_client
from src.services.workspace import current_user_claims

router = APIRouter()
public_router = APIRouter()

INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://127.0.0.1:18005")
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:18001")
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://127.0.0.1:18002")
INTERNAL_EVENT_TOKEN = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")
_KEEP_HEADERS = ("content-type", "content-disposition", "cache-control", "x-content-type-options")
MAX_PHOTO_BYTES = 6 * 1024 * 1024
TOKEN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
HOST_DESK_ROLES = {"Watchman", "PlantManager", "Owner", "Admin"}


# ── Rate limits (per BFF process) ──────────────────────────────────────────────────────────────
class SlidingWindow:
    def __init__(self, limit: int, seconds: float) -> None:
        self.limit, self.seconds = limit, seconds
        self.hits: dict[str, deque[float]] = {}
        self.lock = asyncio.Lock()

    async def allow(self, key: str, now: Optional[float] = None) -> bool:
        current = now if now is not None else time.monotonic()
        async with self.lock:
            bucket = self.hits.setdefault(key, deque())
            while bucket and current - bucket[0] >= self.seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(current)
            if len(self.hits) > 5000:
                for stale in [k for k, v in self.hits.items() if not v or current - v[-1] >= self.seconds][:2000]:
                    self.hits.pop(stale, None)
            return True

    def reset(self) -> None:
        self.hits.clear()


WRITE_LIMIT = SlidingWindow(int(os.getenv("GATE_PUBLIC_WRITES_PER_MINUTE", "10")), 60.0)
READ_LIMIT = SlidingWindow(int(os.getenv("GATE_PUBLIC_READS_PER_MINUTE", "60")), 60.0)


def client_ip(request: Request) -> str:
    # Caddy sets X-ERP-Client-IP to the real remote address (deploy/aws-ec2/Caddyfile); Next passes it on.
    return (request.headers.get("X-ERP-Client-IP") or (request.client.host if request.client else "") or "unknown").strip()[:64]


async def _limit(request: Request, window: SlidingWindow) -> None:
    if not await window.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many tries from this phone. Wait a minute, or speak to the watchman at the gate.")


# ── Upstream helpers ───────────────────────────────────────────────────────────────────────────
def _internal_headers(content_type: Optional[str] = "application/json") -> dict[str, str]:
    headers = {"X-Internal-Token": INTERNAL_EVENT_TOKEN, "Accept": "application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


async def _call(method: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        return await http_client.request(method, url, **kwargs)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The gate service took too long. Try again.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="The gate service is not reachable. Try again in a minute.") from exc


def _relay(upstream: httpx.Response) -> Response:
    passed = {name: upstream.headers[name] for name in _KEEP_HEADERS if name in upstream.headers}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=passed)


def _json(upstream: httpx.Response) -> Any:
    try:
        return upstream.json()
    except ValueError:
        return None


async def _hosts_for_plant(plant_id: str) -> dict[str, Any]:
    upstream = await _call("GET", f"{AUTH_SERVICE_URL}/users/internal/gate-hosts", params={"plant_id": plant_id},
                           headers=_internal_headers(None), timeout=8.0)
    if upstream.status_code != 200:
        raise HTTPException(status_code=503, detail="The list of people could not be loaded. Try again in a minute.")
    return _json(upstream) or {"items": [], "departments": []}


def _public_hosts(data: dict[str, Any], q: str = "") -> dict[str, Any]:
    term = q.strip().lower()
    items = [row for row in data.get("items", []) if not term or term in str(row.get("name", "")).lower() or term in str(row.get("department", "")).lower()]
    present = {row.get("department_key") for row in data.get("items", [])}
    return {
        "items": [{"id": row["id"], "name": row["name"], "department": row.get("department"), "department_key": row.get("department_key")} for row in items[:40]],
        "departments": [row for row in data.get("departments", []) if row.get("key") in present],
    }


async def _enrich_host(body: dict[str, Any], plant_id: str) -> dict[str, Any]:
    """Replace whatever host details the browser sent with the auth user list's own."""
    host_id = str(body.get("host_user_id") or "").strip()
    department = str(body.get("host_department_key") or "").strip().upper()
    for key in ("host_name", "host_email"):
        body.pop(key, None)
    if host_id:
        data = await _hosts_for_plant(plant_id)
        match = next((row for row in data.get("items", []) if row.get("id") == host_id), None)
        if not match:
            raise HTTPException(status_code=422, detail="That person is not in this plant's list. Pick whom to meet again.")
        body.update(host_user_id=match["id"], host_name=match["name"], host_email=match.get("email"), host_department_key=match.get("department_key"))
    elif department:
        body.update(host_user_id=None, host_department_key=department)
    else:
        body.update(host_user_id=None, host_department_key=None)
    return body


def _roles(token: str) -> set[str]:
    claims = current_user_claims(token)
    return {str(role) for role in (claims.get("effective_roles") or claims.get("roles") or [])} | ({str(claims["role"])} if claims.get("role") else set())


# ── Signed-in routes ───────────────────────────────────────────────────────────────────────────
@router.get("/hosts")
async def desk_hosts(request: Request, q: str = "", token: str = Depends(get_token)):
    """Whom a walk-in visitor meets (the watchman's form): name + department of the plant's people."""
    if not _roles(token) & HOST_DESK_ROLES:
        raise HTTPException(status_code=403, detail="Operation not permitted for your role")
    plant_id = (request.headers.get("X-Plant-ID") or "").strip()
    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(status_code=400, detail="Pick one plant at the top first.")
    return _public_hosts(await _hosts_for_plant(plant_id), q)


@router.post("/visits")
async def desk_walk_in(request: Request, token: str = Depends(get_token)):
    plant_id = (request.headers.get("X-Plant-ID") or "").strip()
    if not plant_id or plant_id.upper() == "ALL":
        raise HTTPException(status_code=400, detail="Pick one plant at the top first.")
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Send the visitor form as JSON.") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Send the visitor form as JSON.")
    if not _roles(token) & HOST_DESK_ROLES:
        raise HTTPException(status_code=403, detail="Operation not permitted for your role")
    body = await _enrich_host(body, plant_id)
    headers = _forward_headers(token, request)
    headers["Content-Type"] = "application/json"
    return _relay(await _call("POST", f"{INVENTORY_SERVICE_URL}/inventory/gate/visits", headers=headers, json=body))


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH"])
async def gate_passthrough(path: str, request: Request, token: str = Depends(get_token)):
    if ".." in path or path.startswith("public"):
        raise HTTPException(status_code=404, detail="Not found")
    headers = _forward_headers(token, request)
    if request.method == "GET":
        headers["Accept"] = "*/*"
    body = await request.body()
    return _relay(await _call(request.method, f"{INVENTORY_SERVICE_URL}/inventory/gate/{path}", headers=headers,
                              params=dict(request.query_params), content=body or None))


# ── Public routes (no login) ───────────────────────────────────────────────────────────────────
def _check_token(value: str) -> str:
    if not TOKEN.match(value or ""):
        raise HTTPException(status_code=404, detail="This QR is not in use. Ask the watchman to check you in.")
    return value


async def _public_gate(token: str) -> dict[str, Any]:
    upstream = await _call("GET", f"{INVENTORY_SERVICE_URL}/inventory/gate/public/gates/{token}", headers=_internal_headers(None), timeout=8.0)
    if upstream.status_code != 200:
        detail = (_json(upstream) or {}).get("detail") if upstream.status_code < 500 else None
        raise HTTPException(status_code=404 if upstream.status_code == 404 else 503,
                            detail=detail or "The check-in service is not reachable. Speak to the watchman at the gate.")
    return _json(upstream) or {}


async def _purposes(plant_id: str) -> list[dict[str, str]]:
    upstream = await _call("GET", f"{MASTER_SERVICE_URL}/master/reason-codes/internal/public-list",
                           params={"category": "VISIT_PURPOSE", "plant_id": plant_id}, headers=_internal_headers(None), timeout=8.0)
    if upstream.status_code != 200:
        raise HTTPException(status_code=503, detail="The check-in form could not load. Try again, or speak to the watchman.")
    return [{"code": str(row.get("code")), "label": str(row.get("label"))} for row in (_json(upstream) or []) if row.get("code")]


def _public_error(upstream: httpx.Response) -> JSONResponse:
    data = _json(upstream) or {}
    detail = data.get("detail") if isinstance(data, dict) else None
    if upstream.status_code >= 500 or not isinstance(detail, str):
        return JSONResponse(status_code=503 if upstream.status_code >= 500 else upstream.status_code,
                            content={"detail": "Something went wrong. Try again, or speak to the watchman at the gate."})
    return JSONResponse(status_code=upstream.status_code, content={"detail": detail})


@public_router.get("/{token}")
async def public_form(token: str, request: Request):
    await _limit(request, READ_LIMIT)
    gate = await _public_gate(_check_token(token))
    purposes = await _purposes(gate["plant_id"])
    return {"gate_name": gate.get("gate_name"), "purposes": purposes}


@public_router.get("/{token}/hosts")
async def public_hosts(token: str, request: Request, q: str = ""):
    await _limit(request, READ_LIMIT)
    gate = await _public_gate(_check_token(token))
    return _public_hosts(await _hosts_for_plant(gate["plant_id"]), q[:60])


@public_router.post("/{token}/lookup")
async def public_lookup(token: str, request: Request):
    await _limit(request, WRITE_LIMIT)
    _check_token(token)
    body = await request.json()
    mobile = re.sub(r"\D", "", str((body or {}).get("mobile") or ""))[-10:]
    # Privacy (lead decision 7 Nov 2026): a logged-out page never reveals who a mobile number belongs to.
    # Returning visitors are prefilled only on the watchman's signed-in desk. The route stays (rate-limited)
    # so older cached pages do not break.
    del mobile
    return {"known": False}


@public_router.post("/{token}")
async def public_check_in(token: str, request: Request):
    await _limit(request, WRITE_LIMIT)
    gate = await _public_gate(_check_token(token))
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Fill in the form and try again.") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Fill in the form and try again.")
    allowed = {"request_id", "mobile", "name", "company", "purpose_code", "purpose_note", "people", "vehicle_no", "host_user_id", "host_department_key"}
    body = {key: value for key, value in body.items() if key in allowed}
    purposes = {row["code"]: row["label"] for row in await _purposes(gate["plant_id"])}
    code = str(body.get("purpose_code") or "").strip().upper()
    if code not in purposes:
        raise HTTPException(status_code=422, detail="Pick the purpose of your visit from the list.")
    body["purpose_code"], body["purpose_label"] = code, purposes[code]
    body = await _enrich_host(body, gate["plant_id"])
    upstream = await _call("POST", f"{INVENTORY_SERVICE_URL}/inventory/gate/public/gates/{token}/visits", headers=_internal_headers(), json=body, timeout=10.0)
    if upstream.status_code != 200:
        return _public_error(upstream)
    return _json(upstream)


@public_router.get("/pass/{pass_token}")
async def public_pass(pass_token: str, request: Request):
    await _limit(request, READ_LIMIT)
    upstream = await _call("GET", f"{INVENTORY_SERVICE_URL}/inventory/gate/public/visits/{_check_token(pass_token)}", headers=_internal_headers(None), timeout=8.0)
    if upstream.status_code != 200:
        return _public_error(upstream)
    return _json(upstream)


@public_router.post("/pass/{pass_token}/photo")
async def public_photo(pass_token: str, request: Request):
    await _limit(request, WRITE_LIMIT)
    _check_token(pass_token)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PHOTO_BYTES + 64 * 1024:
        raise HTTPException(status_code=413, detail="The photo is too large. Take it again.")
    body = await request.body()
    if len(body) > MAX_PHOTO_BYTES + 64 * 1024:
        raise HTTPException(status_code=413, detail="The photo is too large. Take it again.")
    content_type = request.headers.get("content-type") or ""
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(status_code=415, detail="Send the photo as a form upload.")
    upstream = await _call("POST", f"{INVENTORY_SERVICE_URL}/inventory/gate/public/visits/{pass_token}/photo",
                           headers=_internal_headers(content_type), content=body, timeout=httpx.Timeout(60.0, connect=10.0))
    if upstream.status_code != 200:
        return _public_error(upstream)
    return _json(upstream)
