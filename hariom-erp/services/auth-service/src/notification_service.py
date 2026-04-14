from __future__ import annotations

import json
import uuid
from typing import Any, Iterable

from sqlalchemy.orm import Session

from . import models


def _uuid_set(values: Iterable[str | uuid.UUID | None]) -> set[uuid.UUID]:
    resolved: set[uuid.UUID] = set()
    for value in values:
        if not value:
            continue
        try:
            resolved.add(value if isinstance(value, uuid.UUID) else uuid.UUID(str(value)))
        except (ValueError, TypeError):
            continue
    return resolved


def create_notifications(
    db: Session,
    *,
    event_type: str,
    title: str,
    message: str,
    href: str | None = None,
    recipient_roles: Iterable[str] | None = None,
    recipient_user_ids: Iterable[str | uuid.UUID] | None = None,
    exclude_user_ids: Iterable[str | uuid.UUID] | None = None,
    actor_user_id: str | uuid.UUID | None = None,
    role_context: str | None = None,
    payload: dict[str, Any] | None = None,
) -> int:
    recipients: dict[uuid.UUID, tuple[models.User, str | None]] = {}
    excluded_ids = _uuid_set(exclude_user_ids or [])

    if recipient_roles:
        roles = db.query(models.Role).filter(models.Role.name.in_(list(recipient_roles))).all()
        for role in roles:
            for user in role.users:
                if not user.is_active or user.id in excluded_ids:
                    continue
                recipients[user.id] = (user, role.name)

    if recipient_user_ids:
        users = db.query(models.User).filter(models.User.id.in_(list(_uuid_set(recipient_user_ids)))).all()
        for user in users:
            if not user.is_active or user.id in excluded_ids:
                continue
            current = recipients.get(user.id)
            recipients[user.id] = (user, current[1] if current else role_context)

    actor_uuid = None
    try:
        actor_uuid = actor_user_id if isinstance(actor_user_id, uuid.UUID) else uuid.UUID(str(actor_user_id)) if actor_user_id else None
    except (ValueError, TypeError):
        actor_uuid = None

    payload_blob = json.dumps(payload or {}, sort_keys=True) if payload is not None else None
    created = 0

    for user_id, (user, matched_role) in recipients.items():
        notification = models.Notification(
            user_id=user_id,
            actor_user_id=actor_uuid,
            event_type=event_type,
            title=title,
            message=message,
            href=href,
            role_context=matched_role or role_context,
            payload=payload_blob,
        )
        db.add(notification)
        created += 1

    if created:
        db.flush()
    return created


def serialize_notification(notification: models.Notification) -> dict[str, Any]:
    payload = {}
    if notification.payload:
        try:
            payload = json.loads(notification.payload)
        except ValueError:
            payload = {}

    return {
        "id": str(notification.id),
        "event_type": notification.event_type,
        "title": notification.title,
        "message": notification.message,
        "href": notification.href,
        "role_context": notification.role_context,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "actor_user_id": str(notification.actor_user_id) if notification.actor_user_id else None,
        "payload": payload,
    }
