from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from ..middleware.auth import get_token
from ..services.workspace import (
    INVENTORY_SERVICE_URL,
    MASTER_SERVICE_URL,
    PRODUCTION_SERVICE_URL,
    SALES_SERVICE_URL,
    SPEC_SERVICE_URL,
    NAV_ITEMS,
    QUICK_ACTIONS,
    auth_get,
    filter_by_roles,
    matching_items,
    service_get,
)

router = APIRouter()


def _entity_result(kind: str, label: str, href: str, subtitle: str = "") -> dict:
    return {
        "kind": kind,
        "label": label,
        "href": href,
        "subtitle": subtitle,
    }


def _workspace_warning(source: str, error: Exception) -> dict:
    detail = getattr(error, "detail", None) or getattr(error, "message", None) or str(error)
    return {"source": source, "message": detail or f"{source} unavailable"}


@router.get("/command-palette")
async def command_palette(
    request: Request,
    q: str = Query(default=""),
    token: str = Depends(get_token),
):
    query = q.strip().lower()

    nav = matching_items(filter_by_roles(NAV_ITEMS, token), query)
    actions = matching_items(filter_by_roles(QUICK_ACTIONS, token), query)

    entities: list[dict] = []
    recent: list[dict] = []
    warnings: list[dict] = []

    try:
        notification_feed = await auth_get("/notifications?limit=8", token)
        for item in notification_feed.get("items", []):
            if item.get("href"):
                recent.append(
                    _entity_result(
                        "recent",
                        item.get("title") or "Recent",
                        item["href"],
                        item.get("message") or "",
                    )
                )
    except Exception as error:
        warnings.append(_workspace_warning("notifications", error))
        recent = []

    try:
        orders = await service_get(SALES_SERVICE_URL, "/sales-orders", token, request, params={"depth": "summary"})
        for row in (orders or [])[:50]:
            label = row.get("order_no") or row.get("id")
            subtitle = row.get("customer_name") or row.get("status") or "Sales order"
            text = f"{label} {subtitle}".lower()
            if not query or query in text:
                entities.append(_entity_result("sales-order", label, f"/sales-orders/{row.get('id')}", subtitle))
    except Exception as error:
        warnings.append(_workspace_warning("sales-orders", error))

    try:
        job_cards = await service_get(PRODUCTION_SERVICE_URL, "/job-cards", token, request, params={"search": q, "limit": 10})
        for row in job_cards or []:
            label = row.get("job_card_no") or row.get("id")
            subtitle = row.get("customer_name") or row.get("status") or "Job card"
            entities.append(_entity_result("job-card", label, f"/job-cards/{row.get('id')}", subtitle))
    except Exception as error:
        warnings.append(_workspace_warning("job-cards", error))

    try:
        specs = await service_get(SPEC_SERVICE_URL, "/specs/", token, request, params={"customer_name": q or None, "active_only": False})
        for row in (specs or [])[:10]:
            label = row.get("spec_no") or row.get("id")
            subtitle = row.get("customer_name") or row.get("status") or "Specification"
            text = f"{label} {subtitle}".lower()
            if not query or query in text:
                entities.append(_entity_result("spec", label, f"/specifications/{row.get('id')}", subtitle))
    except Exception as error:
        warnings.append(_workspace_warning("specifications", error))

    try:
        customers = await service_get(MASTER_SERVICE_URL, "/master/customers", token, request)
        for row in (customers or [])[:50]:
            label = row.get("name") or row.get("customer_code") or row.get("id")
            subtitle = row.get("customer_code") or "Customer"
            text = f"{label} {subtitle}".lower()
            if not query or query in text:
                entities.append(_entity_result("customer", label, f"/masters/customers", subtitle))
    except Exception as error:
        warnings.append(_workspace_warning("customers", error))

    try:
        items = await service_get(INVENTORY_SERVICE_URL, "/items/", token, request)
        for row in (items or [])[:50]:
            label = row.get("item_code") or row.get("name") or row.get("id")
            subtitle = row.get("item_name") or row.get("category") or "Inventory item"
            text = f"{label} {subtitle}".lower()
            if not query or query in text:
                entities.append(_entity_result("inventory-item", label, f"/inventory/items", subtitle))
    except Exception as error:
        warnings.append(_workspace_warning("inventory-items", error))

    return {
        "nav": nav,
        "actions": actions,
        "recent": recent[:8],
        "entities": entities[:20],
        "warnings": warnings[:8],
    }
