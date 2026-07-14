from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from src.middleware.auth import get_token
from src.services.workspace import (
    INVENTORY_SERVICE_URL,
    ANALYTICS_SERVICE_URL,
    AUTH_SERVICE_URL,
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


def _memory_metrics() -> dict:
    try:
        current = int(Path("/sys/fs/cgroup/memory.current").read_text(encoding="utf-8").strip())
        maximum_raw = Path("/sys/fs/cgroup/memory.max").read_text(encoding="utf-8").strip()
        maximum = int(maximum_raw) if maximum_raw != "max" else 0
    except (OSError, ValueError):
        current = 0
        maximum = 0
    if maximum <= 0:
        try:
            meminfo = {}
            with open("/proc/meminfo", encoding="utf-8") as handle:
                for line in handle:
                    key, value = line.split(":", 1)
                    meminfo[key] = int(value.strip().split()[0]) * 1024
            maximum = meminfo.get("MemTotal", 0)
            current = max(0, maximum - meminfo.get("MemAvailable", 0))
        except (OSError, ValueError):
            pass
    return {
        "used_bytes": current or None,
        "limit_bytes": maximum or None,
        "used_percent": round(current / maximum * 100.0, 1) if current and maximum else None,
    }


async def _probe_service(name: str, base_url: str, token: str | None = None) -> dict:
    started = time.perf_counter()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(f"{base_url}/health", headers=headers)
        latency_ms = round((time.perf_counter() - started) * 1000.0, 1)
        healthy = response.status_code == 200
        return {
            "name": name,
            "status": "UP" if healthy else "DOWN",
            "http_status": response.status_code,
            "latency_ms": latency_ms,
            "detail": None if healthy else (response.text or "Health probe failed")[:240],
        }
    except httpx.RequestError as exc:
        return {
            "name": name,
            "status": "DOWN",
            "http_status": None,
            "latency_ms": round((time.perf_counter() - started) * 1000.0, 1),
            "detail": str(exc),
        }


@router.get("/system-health")
async def system_health(token: str = Depends(get_token)):
    try:
        authenticated_user = await auth_get("/auth/me", token)
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc
    roles = {str(role) for role in (authenticated_user.get("roles") or [])}
    if not roles.intersection({"Owner", "Admin"}):
        raise HTTPException(status_code=403, detail="Owner or Admin access required")
    definitions = [
        ("auth-service", AUTH_SERVICE_URL),
        ("masterdata-service", MASTER_SERVICE_URL),
        ("spec-service", SPEC_SERVICE_URL),
        ("sales-service", SALES_SERVICE_URL),
        ("production-service", PRODUCTION_SERVICE_URL),
        ("inventory-service", INVENTORY_SERVICE_URL),
        ("analytics-service", ANALYTICS_SERVICE_URL),
    ]
    services = await asyncio.gather(*[_probe_service(name, url, token) for name, url in definitions])
    disk = shutil.disk_usage("/")
    down = [service for service in services if service["status"] != "UP"]
    active_accounts = None
    try:
        users = await auth_get("/users/", token)
        rows = users if isinstance(users, list) else users.get("items") or []
        active_accounts = sum(1 for user in rows if user.get("is_active", True))
    except Exception:
        active_accounts = None
    scheduler = None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(
                f"{ANALYTICS_SERVICE_URL}/scheduler/status",
                headers={"Authorization": f"Bearer {token}"},
            )
        if response.status_code == 200:
            scheduler = response.json()
    except (httpx.RequestError, ValueError):
        scheduler = None
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "status": "HEALTHY" if not down else "DEGRADED",
        "services": services,
        "summary": {
            "services_up": len(services) - len(down),
            "services_total": len(services),
            "failed_probes": len(down),
            "max_probe_latency_ms": max((service["latency_ms"] for service in services), default=0),
            "active_accounts": active_accounts,
        },
        "runtime": {
            "memory": _memory_metrics(),
            "storage": {
                "used_bytes": disk.used,
                "total_bytes": disk.total,
                "used_percent": round(disk.used / disk.total * 100.0, 1) if disk.total else None,
            },
            "load_1m": round(os.getloadavg()[0], 2) if hasattr(os, "getloadavg") else None,
        },
        "scheduler": scheduler,
    }


def _entity_result(kind: str, label: str, href: str, subtitle: str = "") -> dict:
    return {
        "kind": kind,
        "label": label,
        "href": href,
        "subtitle": subtitle,
    }


def _workspace_warning(source: str, error: Exception) -> dict:
    detail = getattr(error, "detail", None) or getattr(error, "message", None) or str(error)
    return {
        "source": source,
        "message": detail or f"{source} unavailable",
    }


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
