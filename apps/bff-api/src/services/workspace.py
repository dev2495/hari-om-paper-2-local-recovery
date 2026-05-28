from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx
import jwt
from fastapi import Request, Response


AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:28001")
SALES_SERVICE_URL = os.getenv("SALES_SERVICE_URL", "http://localhost:28008")
SPEC_SERVICE_URL = os.getenv("SPEC_SERVICE_URL", "http://localhost:28003")
PRODUCTION_SERVICE_URL = os.getenv("PRODUCTION_SERVICE_URL", "http://localhost:28004")
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://localhost:28005")
MASTER_SERVICE_URL = os.getenv("MASTER_SERVICE_URL", "http://localhost:28002")
INTERNAL_EVENT_TOKEN = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")

workspace_http_client = httpx.AsyncClient(timeout=20.0)

NAV_ITEMS = [
    {"label": "Dashboard", "href": "/dashboard", "roles": ["Owner", "Admin", "Planner", "PlantManager", "Store", "Sales", "Dispatch", "Operator"]},
    {"label": "Sales Orders", "href": "/sales-orders", "roles": ["Owner", "Admin", "Planner", "Sales"]},
    {"label": "Specifications", "href": "/specifications", "roles": ["Owner", "Admin"]},
    {"label": "Planning", "href": "/planning", "roles": ["Owner", "Admin", "Planner", "PlantManager"]},
    {"label": "Job Cards", "href": "/job-cards", "roles": ["Owner", "Admin", "Planner", "PlantManager", "Operator"]},
    {"label": "Supervisor Entry", "href": "/supervisor-entry", "roles": ["Owner", "Admin", "PlantManager", "Operator"]},
    {"label": "Inventory", "href": "/inventory", "roles": ["Owner", "Admin", "Store", "PlantManager", "Sales", "Dispatch"]},
    {"label": "Dispatch", "href": "/dispatch", "roles": ["Owner", "Admin", "Planner", "Store", "Sales", "Dispatch"]},
    {"label": "Reports", "href": "/reports", "roles": ["Owner", "Admin", "Planner", "PlantManager", "Store", "Sales", "Dispatch"]},
    {"label": "User Management", "href": "/system/users", "roles": ["Owner", "Admin"]},
    {"label": "Variance Tolerances", "href": "/system/tolerances", "roles": ["Owner", "Admin"]},
]

QUICK_ACTIONS = [
    {"label": "New Sales Order", "href": "/sales-orders/new", "roles": ["Owner", "Admin", "Planner", "Sales"]},
    {"label": "New Specification", "href": "/specifications/new", "roles": ["Owner", "Admin"]},
    {"label": "Open Planning Board", "href": "/planning", "roles": ["Owner", "Admin", "Planner", "PlantManager"]},
    {"label": "Supervisor Entry", "href": "/supervisor-entry", "roles": ["Owner", "Admin", "PlantManager", "Operator"]},
    {"label": "Open Reports", "href": "/reports/owner", "roles": ["Owner", "Admin", "Planner", "PlantManager", "Store", "Sales", "Dispatch"]},
    {"label": "Role Matrix", "href": "/system/users", "roles": ["Owner", "Admin"]},
    {"label": "Variance Tolerances", "href": "/system/tolerances", "roles": ["Owner", "Admin"]},
]


def _json_from_response(response: Response) -> Any:
    if not response.body:
        return None
    try:
        return json.loads(response.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def current_user_claims(token: str | None) -> dict[str, Any]:
    if not token:
        return {}
    try:
        return jwt.decode(token, options={"verify_signature": False, "verify_exp": False}, algorithms=["HS256"])
    except Exception:
        return {}


def filter_by_roles(items: list[dict[str, Any]], token: str | None) -> list[dict[str, Any]]:
    claims = current_user_claims(token)
    roles = set(claims.get("roles") or [])
    if "Owner" in roles or "Admin" in roles:
        return items
    return [item for item in items if not item.get("roles") or roles.intersection(item.get("roles") or [])]


def matching_items(items: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return items[:8]
    return [
        item for item in items
        if needle in item.get("label", "").lower() or needle in item.get("href", "").lower()
    ][:8]


async def service_get(
    service_url: str,
    path: str,
    token: str,
    request: Request,
    *,
    params: Optional[dict[str, Any]] = None,
) -> Any:
    headers = {"Authorization": f"Bearer {token}"}
    plant_id = request.headers.get("X-Plant-ID")
    if plant_id:
        headers["X-Plant-ID"] = plant_id
    response = await workspace_http_client.get(
        f"{service_url}{path}",
        headers=headers,
        params=params or {},
    )
    response.raise_for_status()
    return response.json()


async def auth_get(path: str, token: str) -> Any:
    response = await workspace_http_client.get(
        f"{AUTH_SERVICE_URL}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    response.raise_for_status()
    return response.json()


async def emit_notification_event(
    *,
    token: str | None,
    event_type: str,
    title: str,
    message: str,
    href: str | None = None,
    recipient_roles: list[str] | None = None,
    recipient_user_ids: list[str] | None = None,
    exclude_user_ids: list[str] | None = None,
    role_context: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    claims = current_user_claims(token)
    actor_user_id = claims.get("user_id")
    await workspace_http_client.post(
        f"{AUTH_SERVICE_URL}/notifications/events",
        headers={
            "x-internal-token": INTERNAL_EVENT_TOKEN,
            "content-type": "application/json",
        },
        json={
            "event_type": event_type,
            "title": title,
            "message": message,
            "href": href,
            "recipient_roles": recipient_roles or [],
            "recipient_user_ids": recipient_user_ids or [],
            "exclude_user_ids": exclude_user_ids or [],
            "actor_user_id": actor_user_id,
            "role_context": role_context,
            "payload": payload or {},
        },
    )


async def emit_from_response(
    response: Response,
    *,
    token: str | None,
    event_type: str,
    title: str,
    message: str,
    href: str | None = None,
    recipient_roles: list[str] | None = None,
    recipient_user_ids: list[str] | None = None,
    exclude_user_ids: list[str] | None = None,
    role_context: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    if response.status_code >= 400:
        return
    try:
        await emit_notification_event(
            token=token,
            event_type=event_type,
            title=title,
            message=message,
            href=href,
            recipient_roles=recipient_roles,
            recipient_user_ids=recipient_user_ids,
            exclude_user_ids=exclude_user_ids,
            role_context=role_context,
            payload=payload,
        )
    except httpx.RequestError:
        return


def response_body_json(response: Response) -> Any:
    return _json_from_response(response)
