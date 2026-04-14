from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..notification_service import create_notifications, serialize_notification
from ..utils.deps import get_current_user, require_internal_event_request, require_role

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationEventCreate(BaseModel):
    event_type: str
    title: str
    message: str
    href: str | None = None
    recipient_roles: list[str] = Field(default_factory=list)
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list)
    exclude_user_ids: list[uuid.UUID] = Field(default_factory=list)
    actor_user_id: uuid.UUID | None = None
    role_context: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


@router.get("/")
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Notification).filter(models.Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(models.Notification.is_read.is_(False))
    rows = query.order_by(models.Notification.created_at.desc()).limit(limit).all()
    return {
        "items": [serialize_notification(row) for row in rows],
    }


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    count = db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.is_read.is_(False),
    ).count()
    return {"count": count}


@router.post("/mark-all-read")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.is_read.is_(False),
    ).update({"is_read": True})
    db.commit()
    return {"message": "All notifications marked as read"}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    notification = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.user_id == current_user.id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return serialize_notification(notification)


@router.post("/events")
def ingest_event(
    payload: NotificationEventCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    require_internal_event_request(request)
    created = create_notifications(
        db,
        event_type=payload.event_type,
        title=payload.title,
        message=payload.message,
        href=payload.href,
        recipient_roles=payload.recipient_roles,
        recipient_user_ids=payload.recipient_user_ids,
        exclude_user_ids=payload.exclude_user_ids,
        actor_user_id=payload.actor_user_id,
        role_context=payload.role_context,
        payload=payload.payload,
    )
    db.commit()
    return {"created": created}


@router.get("/admin/recent")
def list_recent_events(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"])),
):
    rows = db.query(models.Notification).order_by(models.Notification.created_at.desc()).limit(limit).all()
    return {"items": [serialize_notification(row) for row in rows]}
