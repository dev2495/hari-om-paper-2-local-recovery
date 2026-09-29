"""Audit events router — structured cross-service activity log."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from .. import models
from ..database import get_db
from ..utils.deps import get_current_user, get_session_claims, require_internal_event_request

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


class IngestEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    occurred_at: datetime
    event_type: str = Field(max_length=120)
    source_service: str = Field(max_length=60)
    entity_type: str | None = None
    entity_id: str | None = None
    plant_id: str | None = None
    actor_user_id: uuid.UUID | None = None
    actor_email: str | None = None
    actor_role: str | None = None
    request_path: str | None = None
    summary: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/ingest")
def ingest_event(payload: IngestEvent, request: Request, db: Session = Depends(get_db)):
    require_internal_event_request(request)
    values = payload.model_dump(exclude={"request_path"})
    # A deleted historical actor must not prevent durable operational history.
    if values["actor_user_id"] and not db.get(models.User, values["actor_user_id"]):
        values["actor_user_id"] = None
    values["payload"] = json.dumps({**payload.payload, "request_path": payload.request_path})
    db.execute(insert(models.AuditEvent).values(**values).on_conflict_do_nothing(index_elements=["id"]))
    db.commit()
    return {"id": str(payload.id), "recorded": True}


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
    require_internal_event_request(request)
    row = models.AuditEvent(
        plant_id=payload.plant_id,
        actor_user_id=current_user.id,
        actor_email=current_user.email,
        actor_role=",".join(get_session_claims(current_user)["roles"]),
        event_type=payload.event_type,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        summary=payload.summary,
        payload=json.dumps(payload.payload) if payload.payload else None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
        source_service=payload.source_service,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def _filtered_query(
    db: Session,
    current_user: models.User,
    *,
    since_hours: int,
    event_type: str | None,
    entity_type: str | None,
    entity_id: str | None,
    actor_email: str | None,
    plant_id: str | None,
    source_service: str | None,
    q: str | None,
):
    role_names = set(get_session_claims(current_user)["roles"])
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
        query = query.filter(or_(models.AuditEvent.plant_id == plant_id, models.AuditEvent.plant_id.is_(None)))
    if source_service:
        query = query.filter(models.AuditEvent.source_service == source_service)
    if q and q.strip():
        needle = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(or_(
            models.AuditEvent.summary.ilike(needle, escape="\\"),
            models.AuditEvent.entity_id.ilike(needle, escape="\\"),
            models.AuditEvent.event_type.ilike(needle, escape="\\"),
            models.AuditEvent.actor_email.ilike(needle, escape="\\"),
            models.AuditEvent.payload.ilike(needle, escape="\\"),
        ))
    return query


@router.get("/")
def list_audit_events(
    since_hours: int = Query(default=72, ge=1, le=8760),
    event_type: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_email: str | None = None,
    plant_id: str | None = None,
    source_service: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """List audit events with filters and free-text search. Owners/Admins see everything;
    other roles see their own actions only. Plant filter keeps account-wide (no plant) events.
    """
    query = _filtered_query(db, current_user, since_hours=since_hours, event_type=event_type, entity_type=entity_type,
                            entity_id=entity_id, actor_email=actor_email, plant_id=plant_id, source_service=source_service, q=q)
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


@router.get("/facets")
def audit_event_facets(
    since_hours: int = Query(default=168, ge=1, le=8760),
    event_type: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_email: str | None = None,
    plant_id: str | None = None,
    source_service: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Counts behind the audit filters and chart: by module, record type, event, person and day."""
    query = _filtered_query(db, current_user, since_hours=since_hours, event_type=event_type, entity_type=entity_type,
                            entity_id=entity_id, actor_email=actor_email, plant_id=plant_id, source_service=source_service, q=q)
    sub = query.subquery()

    def top(column, limit: int):
        rows = (
            db.query(getattr(sub.c, column), func.count())
            .group_by(getattr(sub.c, column))
            .order_by(func.count().desc())
            .limit(limit)
            .all()
        )
        return [{"value": value, "count": int(count)} for value, count in rows if value]

    day = func.date_trunc("day", sub.c.occurred_at)
    by_day = (
        db.query(day, sub.c.source_service, func.count())
        .group_by(day, sub.c.source_service)
        .order_by(day)
        .all()
    )
    return {
        "total": int(db.query(func.count()).select_from(sub).scalar() or 0),
        "source_service": top("source_service", 20),
        "entity_type": top("entity_type", 40),
        "event_type": top("event_type", 60),
        "actor_email": top("actor_email", 30),
        "by_day": [{"day": d.date().isoformat() if d else None, "source_service": service or "unknown", "count": int(count)} for d, service, count in by_day],
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
