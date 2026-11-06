from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..notification_service import (
    NOTIFICATION_CATEGORIES,
    category_event_filter,
    create_notifications,
    notification_category,
    notification_priority,
    serialize_notification,
)
from ..utils.deps import get_current_user, require_internal_event_request, require_role

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationEventCreate(BaseModel):
    event_type: str
    title: str
    message: str
    href: str | None = None
    recipient_roles: list[str] = Field(default_factory=list)
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list)
    # People by login e-mail (inventory records the PO raiser this way); plant-checked like everyone else.
    recipient_user_emails: list[str] = Field(default_factory=list, max_length=50)
    exclude_user_ids: list[uuid.UUID] = Field(default_factory=list)
    actor_user_id: uuid.UUID | None = None
    role_context: str | None = None
    plant_id: str | None = None
    required_permissions: list[str] = Field(default_factory=list)
    assigned_user_ids: list[uuid.UUID] = Field(default_factory=list)
    event_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


@router.get("/")
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=30, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    role: str | None = Query(default=None, description="Filter by role_context (e.g. 'Planner')"),
    event_type: str | None = Query(default=None, description="Filter by event_type (e.g. 'SALES_ORDER_RELEASED')"),
    search: str | None = Query(default=None, description="Search title + message"),
    category: str | None = Query(default=None, description="Inbox category (sales, planning, production, quality, stores, purchase, dispatch, design, system)"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """List notifications for the current user.

    Supports pagination (limit + offset), role-context filtering, event_type
    filtering, and full-text search across title + message. Returns total_count
    so the UI can render pagination.
    """
    query = db.query(models.Notification).filter(models.Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(models.Notification.is_read.is_(False))
    if role:
        query = query.filter(models.Notification.role_context == role)
    if event_type:
        query = query.filter(models.Notification.event_type == event_type)
    if category:
        query = query.filter(category_event_filter(category.strip().lower()))
    if search:
        needle = f"%{search.strip()}%"
        query = query.filter(
            (models.Notification.title.ilike(needle))
            | (models.Notification.message.ilike(needle))
        )

    total_count = query.count()
    rows = (
        query.order_by(models.Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [serialize_notification(row) for row in rows],
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(rows)) < total_count,
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


class NotificationIds(BaseModel):
    ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)


@router.get("/summary")
def notification_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Unread counts per inbox category and priority, for badges and inbox tabs."""
    rows = (
        db.query(models.Notification.event_type, models.Notification.payload)
        .filter(
            models.Notification.user_id == current_user.id,
            models.Notification.is_read.is_(False),
        )
        .all()
    )
    by_category = {name: 0 for name in NOTIFICATION_CATEGORIES}
    by_priority = {"critical": 0, "action": 0, "info": 0}
    for event_type, raw_payload in rows:
        payload: dict[str, Any] = {}
        if raw_payload:
            try:
                decoded = json.loads(raw_payload)
                payload = decoded if isinstance(decoded, dict) else {}
            except ValueError:
                payload = {}
        by_category[notification_category(event_type)] = by_category.get(notification_category(event_type), 0) + 1
        by_priority[notification_priority(event_type, payload)] += 1
    return {"unread": len(rows), "by_category": by_category, "by_priority": by_priority}


@router.post("/read")
def mark_many_read(
    payload: NotificationIds,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not payload.ids:
        return {"updated": 0}
    updated = (
        db.query(models.Notification)
        .filter(
            models.Notification.user_id == current_user.id,
            models.Notification.id.in_(payload.ids),
            models.Notification.is_read.is_(False),
        )
        .update({"is_read": True}, synchronize_session=False)
    )
    db.commit()
    return {"updated": updated}


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


@router.post("/{notification_id}/unread")
def mark_unread(
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
    notification.is_read = False
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
        plant_id=payload.plant_id,
        required_permissions=payload.required_permissions,
        assigned_user_ids=payload.assigned_user_ids,
        event_id=payload.event_id,
        recipient_user_emails=payload.recipient_user_emails,
    )
    db.commit()
    return {"created": created}


class NotificationActionResult(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    ok: bool
    message: str = Field(default="", max_length=500)


@router.post("/{notification_id}/action-result")
def record_action_result(
    notification_id: uuid.UUID,
    payload: NotificationActionResult,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """The outcome of a button on the user's own notification (6 Nov 2026), so the inbox shows what was
    done ("Debit note DN-261106-001 drafted", "Skipped: Scale doubt") instead of the buttons again. The
    button's own API did the work and checked the role; this only records what it answered."""
    notification = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.user_id == current_user.id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    try:
        data = json.loads(notification.payload) if notification.payload else {}
    except ValueError:
        data = {}
    action = data.get("action") if isinstance(data, dict) else None
    buttons = action.get("buttons") if isinstance(action, dict) else None
    if not isinstance(buttons, list) or not any(isinstance(button, dict) and button.get("key") == payload.key for button in buttons):
        raise HTTPException(status_code=422, detail="This notification has no such button")
    from datetime import datetime as _dt

    result = {"key": payload.key, "ok": payload.ok, "message": payload.message.strip(), "by": current_user.email, "at": _dt.utcnow().isoformat()}
    data["action_result"] = result
    notification.payload = json.dumps(data, sort_keys=True)
    if payload.ok:
        notification.is_read = True
    db.commit()
    db.refresh(notification)
    return serialize_notification(notification)


@router.get("/admin/recent")
def list_recent_events(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role(["Admin"])),
):
    rows = db.query(models.Notification).order_by(models.Notification.created_at.desc()).limit(limit).all()
    return {"items": [serialize_notification(row) for row in rows]}
