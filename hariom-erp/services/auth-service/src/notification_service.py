from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models
from .plant_service import normalize_plant_uuid


PLANT_SCOPED_ROLES = {
    "QC",
    "PlantManager",
    "Planner",
    "Store",
    "Dispatch",
    "Sales",
    "Operator",
}
ALL_PLANT_ROLES = {"Owner", "Admin"}


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


def _canonical_plant_id(value: str | uuid.UUID | None) -> str | None:
    if value in (None, ""):
        return None
    try:
        return str(normalize_plant_uuid(value, allow_none=False))
    except HTTPException:
        text = str(value).strip()
        return text or None


def user_role_names(user: models.User) -> set[str]:
    return {str(role.name) for role in (user.roles or []) if getattr(role, "name", None)}


def user_permission_names(user: models.User) -> set[str]:
    return {
        str(permission.name)
        for role in (user.roles or [])
        for permission in (role.permissions or [])
        if getattr(permission, "name", None)
    }


def user_allowed_plant_ids(user: models.User) -> set[str]:
    plants: set[str] = set()
    for plant in getattr(user, "allowed_plants", []) or []:
        canonical = _canonical_plant_id(getattr(plant, "id", None) or plant)
        if canonical:
            plants.add(canonical)
    if user.plant_id:
        canonical = _canonical_plant_id(user.plant_id)
        if canonical:
            plants.add(canonical)
    return plants


def user_can_receive_for_plant(
    user: models.User,
    plant_id: str | None,
    matched_role: str | None,
    *,
    explicit_user: bool = False,
) -> bool:
    if not user.is_active:
        return False
    if not plant_id:
        # Explicit recipient IDs do not bypass resource scope. Plant-scoped
        # QC events without a plant never leak to Owner/Admin/QC users.
        return False
    if getattr(user, "is_owner_all_plants", False):
        return True
    canonical = _canonical_plant_id(plant_id)
    if not canonical:
        return False
    return canonical in user_allowed_plant_ids(user)


def user_has_required_capability(
    user: models.User,
    *,
    required_permissions: Iterable[str] | None = None,
    required_roles: Iterable[str] | None = None,
) -> bool:
    permissions = {str(item).strip() for item in (required_permissions or []) if str(item).strip()}
    roles = {str(item).strip() for item in (required_roles or []) if str(item).strip()}
    if permissions and not user_permission_names(user).intersection(permissions) and not user_role_names(user).intersection(ALL_PLANT_ROLES):
        return False
    if roles and not user_role_names(user).intersection(roles):
        return False
    return True


def resolve_event_plant_id(*, plant_id: str | None, payload: dict[str, Any] | None) -> str | None:
    blob = payload or {}
    return _canonical_plant_id(
        plant_id
        or blob.get("plant_id")
        or blob.get("plant")
        or blob.get("selected_plant_id")
    )


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
    plant_id: str | None = None,
    required_permissions: Iterable[str] | None = None,
    assigned_user_ids: Iterable[str | uuid.UUID] | None = None,
    event_id: str | None = None,
) -> int:
    recipients: dict[uuid.UUID, tuple[models.User, str | None]] = {}
    excluded_ids = _uuid_set(exclude_user_ids or [])
    assigned_ids = _uuid_set(assigned_user_ids or [])
    event_payload = dict(payload or {})
    resolved_plant_id = resolve_event_plant_id(plant_id=plant_id, payload=event_payload)
    if resolved_plant_id:
        event_payload.setdefault("plant_id", resolved_plant_id)
    resolved_event_id = str(event_id or event_payload.get("event_id") or "").strip() or None

    if recipient_roles:
        roles = db.query(models.Role).filter(models.Role.name.in_(list(recipient_roles))).all()
        for role in roles:
            for user in role.users:
                if not user.is_active or user.id in excluded_ids:
                    continue
                if assigned_ids and user.id not in assigned_ids:
                    continue
                if not user_can_receive_for_plant(user, resolved_plant_id, role.name):
                    continue
                if not user_has_required_capability(
                    user,
                    required_permissions=required_permissions,
                ):
                    continue
                current = recipients.get(user.id)
                if current is None:
                    recipients[user.id] = (user, role.name)

    if recipient_user_ids:
        users = db.query(models.User).filter(models.User.id.in_(list(_uuid_set(recipient_user_ids)))).all()
        for user in users:
            if not user.is_active or user.id in excluded_ids:
                continue
            if assigned_ids and user.id not in assigned_ids:
                continue
            if not user_can_receive_for_plant(user, resolved_plant_id, role_context, explicit_user=True):
                continue
            if not user_has_required_capability(user, required_permissions=required_permissions):
                continue
            current = recipients.get(user.id)
            recipients[user.id] = (user, current[1] if current else role_context)

    actor_uuid = None
    try:
        actor_uuid = actor_user_id if isinstance(actor_user_id, uuid.UUID) else uuid.UUID(str(actor_user_id)) if actor_user_id else None
    except (ValueError, TypeError):
        actor_uuid = None

    payload_blob = json.dumps(event_payload, sort_keys=True) if event_payload else None
    created = 0
    delivered_at = datetime.utcnow()

    for user_id, (user, matched_role) in recipients.items():
        if resolved_event_id:
            existing = (
                db.query(models.Notification)
                .filter(
                    models.Notification.user_id == user_id,
                    models.Notification.event_id == resolved_event_id,
                    models.Notification.event_type == event_type,
                )
                .first()
            )
            if existing:
                continue
        notification = models.Notification(
            user_id=user_id,
            actor_user_id=actor_uuid,
            event_type=event_type,
            title=title,
            message=message,
            href=href,
            role_context=matched_role or role_context,
            payload=payload_blob,
            plant_id=resolved_plant_id,
            event_id=resolved_event_id,
            delivery_status="DELIVERED",
            delivered_at=delivered_at,
        )
        db.add(notification)
        db.flush()
        db.add(
            models.NotificationDeliveryLog(
                notification_id=notification.id,
                event_id=resolved_event_id,
                event_type=event_type,
                user_id=user_id,
                plant_id=resolved_plant_id,
                channel="in_app",
                status="DELIVERED",
                role_context=matched_role or role_context,
                detail="in-app notification persisted",
            )
        )
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
        "plant_id": notification.plant_id,
        "event_id": notification.event_id,
        "delivery_status": notification.delivery_status,
        "delivered_at": notification.delivered_at.isoformat() if notification.delivered_at else None,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "actor_user_id": str(notification.actor_user_id) if notification.actor_user_id else None,
        "payload": payload,
    }
