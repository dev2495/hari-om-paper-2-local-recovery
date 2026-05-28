"""Fire-and-forget audit-event emitter for masterdata-service.

Posts to auth-service /audit-events/ so the timeline at /system/audit shows
sales-side mutations. Best-effort: HTTP errors are swallowed so the caller's
business transaction is never blocked by audit-service flakiness.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8001")


def emit_audit_event(
    *,
    token: str,
    event_type: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    summary: Optional[str] = None,
    plant_id: Optional[str] = None,
    actor_role: Optional[str] = None,
    actor_email: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> bool:
    """Best-effort POST to auth-service /audit-events/. Returns True on success."""
    if not token:
        return False
    body: dict[str, Any] = {
        "event_type": event_type,
        "entity_type": entity_type,
        "source_service": "masterdata-service",
    }
    if entity_id is not None:
        body["entity_id"] = str(entity_id)
    if summary is not None:
        body["summary"] = summary
    if plant_id is not None:
        body["plant_id"] = str(plant_id)
    if actor_role is not None:
        body["actor_role"] = str(actor_role)
    if actor_email is not None:
        body["actor_email"] = str(actor_email)
    if payload is not None:
        body["payload"] = dict(payload)
    try:
        r = requests.post(
            f"{AUTH_SERVICE_URL}/audit-events/",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=2.0,
        )
        return r.status_code < 300
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning("audit emit failed (%s/%s): %s", entity_type, event_type, exc)
        return False
