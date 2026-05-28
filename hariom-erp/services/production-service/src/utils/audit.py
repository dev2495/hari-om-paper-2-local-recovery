"""Shared audit-event writer for production-service.

The existing `_record_audit_event` helpers in `planning.py` and `quality.py`
predate this module — they each have slightly different signatures. This
module exposes one canonical writer that the new operations module uses, and
that the older callers can migrate to over time.

Best-effort: any DB error is swallowed; the caller's transaction is not
disturbed. Audit is observability, not correctness.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import AuditEvent, PLANT_A_UUID

logger = logging.getLogger(__name__)


def _json_hash(payload: Optional[dict[str, Any]]) -> Optional[str]:
    if not payload:
        return None
    try:
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
    except (TypeError, ValueError):
        return None


def _to_uuid(value: Any) -> Optional[uuid.UUID]:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


def record_audit_event(
    *,
    db: Session,
    entity_type: str,
    entity_id: Any,
    action: str,
    actor_id: Optional[str] = None,
    actor_role: Optional[str] = None,
    plant_id: Any = None,
    job_card_id: Any = None,
    payload: Optional[dict[str, Any]] = None,
    before_payload: Optional[dict[str, Any]] = None,
    after_payload: Optional[dict[str, Any]] = None,
    request_id: Optional[str] = None,
) -> Optional[uuid.UUID]:
    """Append one audit-events row. Returns the audit id or None on error.

    Wrap in try/except at the call site if the caller must guarantee no audit
    failure propagates. This helper already logs+swallows DB errors but does
    not commit (the caller's transaction owns the commit).
    """
    try:
        plant_uuid = _to_uuid(plant_id) or PLANT_A_UUID
        entity_uuid = _to_uuid(entity_id)
        if entity_uuid is None:
            return None
        row = AuditEvent(
            plant_id=plant_uuid,
            entity_type=entity_type,
            entity_id=entity_uuid,
            action=action,
            actor_id=str(actor_id) if actor_id else None,
            actor_role=str(actor_role) if actor_role else None,
            job_card_id=_to_uuid(job_card_id),
            request_id=str(request_id) if request_id else None,
            before_hash=_json_hash(before_payload),
            after_hash=_json_hash(after_payload),
            payload=dict(payload or {}),
            event_ts=datetime.utcnow(),
        )
        db.add(row)
        db.flush()
        return row.id
    except Exception as exc:  # pragma: no cover — best-effort
        logger.warning("record_audit_event failed for %s/%s: %s", entity_type, action, exc)
        return None
