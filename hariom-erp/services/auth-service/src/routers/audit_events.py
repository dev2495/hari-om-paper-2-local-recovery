"""Audit events router — structured cross-service activity log."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.deps import get_current_user

router = APIRouter(prefix="/audit-events", tags=["audit-events"])


class AuditEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: str
    plant_id: str | None = None
    actor_email: str | None = None
    actor_role: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    summary: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    ip: str | None = None
    user_agent: str | None = None
    source_service: str | None = None


class AuditEventRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    occurred_at: datetime
    plant_id: str | None
    actor_user_id: uuid.UUID | None
    actor_email: str | None
    actor_role: str | None
    event_type: str
    entity_type: str | None
    entity_id: str | None
    summary: str | None
    payload: dict[str, Any] = Field(default_factory=dict)
    ip: str | None
    user_agent: str | None
    source_service: str | None


def _serialize(row: models.AuditEvent) -> dict[str, Any]:
    try:
        payload = json.loads(row.payload) if row.payload else {}
    except Exception:
        payload = {}
    return {
        "id": str(row.id),
        "occurred_at": row.occurred_at.isoformat() if row.occurred_at else None,
        "plant_id": row.plant_id,
        "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
        "actor_email": row.actor_email,
        "actor_role": row.actor_role,
        "event_type": row.event_type,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "summary": row.summary,
        "payload": payload,
        "ip": row.ip,
        "user_agent": row.user_agent,
        "source_service": row.source_service,
    }


@router.post("/")
def post_audit_event(
    payload: AuditEventCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Write a single audit event. Open to any authenticated caller — the
    actor is always overridden to the JWT subject.
    """
    row = models.AuditEvent(
        plant_id=payload.plant_id,
        actor_user_id=current_user.id,
        actor_email=payload.actor_email or current_user.email,
        actor_role=payload.actor_role,
        event_type=payload.event_type,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        summary=payload.summary,
        payload=json.dumps(payload.payload) if payload.payload else None,
        ip=payload.ip or (request.client.host if request.client else None),
        user_agent=payload.user_agent or request.headers.get("User-Agent"),
        source_service=payload.source_service,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


@router.get("/")
def list_audit_events(
    since_hours: int = Query(default=72, ge=1, le=720),
    event_type: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_email: str | None = None,
    plant_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """List audit events with filters. Owners/Admins see everything;
    other roles see their own actions only.
    """
    role_names = {r.name for r in current_user.roles}
    is_owner_admin = "Owner" in role_names or "Admin" in role_names

    since = datetime.utcnow() - timedelta(hours=since_hours)
    query = db.query(models.AuditEvent).filter(models.AuditEvent.occurred_at >= since)
    if not is_owner_admin:
        query = query.filter(models.AuditEvent.actor_user_id == current_user.id)
    if event_type:
        query = query.filter(models.AuditEvent.event_type == event_type)
    if entity_type:
        query = query.filter(models.AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.filter(models.AuditEvent.entity_id == entity_id)
    if actor_email:
        query = query.filter(models.AuditEvent.actor_email == actor_email)
    if plant_id:
        query = query.filter(models.AuditEvent.plant_id == plant_id)

    total = query.count()
    rows = (
        query.order_by(models.AuditEvent.occurred_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [_serialize(row) for row in rows],
        "total_count": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(rows)) < total,
    }


# Convenience helper for in-process callers (used by users router for
# permission-change logging).
def record_audit_event(
    db: Session,
    *,
    event_type: str,
    actor_user: models.User | None = None,
    plant_id: str | None = None,
    actor_email: str | None = None,
    actor_role: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    summary: str | None = None,
    payload: dict[str, Any] | None = None,
    source_service: str | None = "auth-service",
) -> models.AuditEvent:
    row = models.AuditEvent(
        plant_id=plant_id,
        actor_user_id=actor_user.id if actor_user else None,
        actor_email=actor_email or (actor_user.email if actor_user else None),
        actor_role=actor_role,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        payload=json.dumps(payload) if payload else None,
        source_service=source_service,
    )
    db.add(row)
    return row
