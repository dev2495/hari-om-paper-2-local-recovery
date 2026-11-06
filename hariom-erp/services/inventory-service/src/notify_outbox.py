"""In-app notifications from inventory, written to ``audit_outbox`` in the same transaction as the change.

The supervised audit relay (``shared/audit_relay.py``) posts the ``notify`` part of each row to the auth
service (``POST /notifications/events``), which fans it out and dedupes by the row id. Recipients:

- ``recipient_roles``: every active holder of the role who may see the plant (Owner sees every plant);
- ``recipient_user_emails``: named people, e.g. the PO raiser (inventory records people by login e-mail).
  The auth service resolves each e-mail to its user; the plant check still applies, so a person who cannot
  see the plant gets nothing.

Action buttons (shared contract, 6 Nov 2026; the inbox renders them):

    payload["action"] = {
        "kind": "WEIGHT_VARIANCE",          # what the buttons act on
        "id": "<record id>",
        "buttons": [
            {"key": "make", "label": "Make debit note", "method": "POST",
             "path": "/api/purchase/v2/weight-variances/<id>/decide",     # BFF path, same origin only
             "body": {"decision": "MAKE_DEBIT_NOTE"}, "tone": "primary"},
            {"key": "skip", "label": "Skip…", "method": "POST", "path": "...", "body": {"decision": "SKIP"},
             "reason_category": "WEIGHT_SHORT_SKIP", "tone": "secondary"},   # asks for a reason code first
            {"key": "open", "label": "Open bill", "href": "/quality/incoming?bill=R:<id>"},  # a link, no call
        ],
    }

The API behind each button checks the role and the state itself; the button is only a shortcut.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


def _clean(values: Iterable[Any] | None) -> list[str]:
    out: list[str] = []
    for value in values or []:
        text_value = str(value or "").strip()
        if text_value and text_value not in out and not text_value.lower().startswith("system"):
            out.append(text_value)
    return out


def enqueue_notification(
    db: Session,
    *,
    plant_id: str,
    event_type: str,
    title: str,
    message: str,
    href: Optional[str] = None,
    recipient_roles: Iterable[str] = (),
    recipient_user_emails: Iterable[str] = (),
    role_context: Optional[str] = None,
    action: Optional[dict[str, Any]] = None,
    payload: Optional[dict[str, Any]] = None,
    entity_type: str = "inventory",
    entity_id: Optional[str] = None,
    priority: Optional[str] = None,
) -> Optional[str]:
    """Queue one notification; returns the outbox row id (None when nobody would get it)."""
    roles = _clean(recipient_roles)
    emails = [email.lower() for email in _clean(recipient_user_emails)]
    if not roles and not emails:
        return None
    event_id = str(uuid.uuid4())
    occurred = datetime.utcnow()
    body_payload = {**(payload or {}), "plant_id": str(plant_id)}
    if action:
        body_payload["action"] = action
    if priority:
        body_payload["priority"] = priority
    body = {
        "id": event_id,
        "occurred_at": occurred.isoformat(),
        "source_service": "inventory-service",
        "event_type": event_type,
        "entity_type": entity_type,
        "entity_id": str(entity_id or ""),
        "plant_id": str(plant_id),
        "summary": title,
        "payload": body_payload,
        "notify": {
            "title": title[:200],
            "message": message,
            "href": href,
            "recipient_roles": roles,
            "recipient_user_emails": emails,
            "role_context": role_context,
        },
    }
    db.execute(
        text("INSERT INTO audit_outbox (id, occurred_at, body, delivered_at, attempts) VALUES (:id, :occurred_at, :body, NULL, 0)"),
        {"id": event_id, "occurred_at": occurred, "body": json.dumps(body, default=str)},
    )
    return event_id
