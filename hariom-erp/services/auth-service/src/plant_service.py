from __future__ import annotations

import uuid
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models


PLANT_A_ID = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
PLANT_B_ID = uuid.UUID("00000000-0000-0000-0000-0000000000b2")
PLANT_ALIASES = {
    "PLANT_A": PLANT_A_ID,
    "PLANT-1": PLANT_A_ID,
    "PLANT1": PLANT_A_ID,
    "PLANT_B": PLANT_B_ID,
    "PLANT-2": PLANT_B_ID,
    "PLANT2": PLANT_B_ID,
}
PSEUDO_ALL_PLANT_CODE = "ALL"


def normalize_plant_uuid(value, field_name: str = "plant_id", *, allow_none: bool = False) -> uuid.UUID | None:
    if value in (None, ""):
        if allow_none:
            return None
        raise HTTPException(status_code=400, detail=f"{field_name} is required")

    text = str(value).strip()
    if not text:
        if allow_none:
            return None
        raise HTTPException(status_code=400, detail=f"{field_name} is required")

    alias = PLANT_ALIASES.get(text.upper())
    if alias is not None:
        return alias

    try:
        return uuid.UUID(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}") from exc


def _ordered_plant_ids(values: Iterable[uuid.UUID]) -> list[uuid.UUID]:
    ordered: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _active_plants(db: Session) -> list[models.Plant]:
    return (
        db.query(models.Plant)
        .filter(
            models.Plant.is_active.is_(True),
            models.Plant.code != PSEUDO_ALL_PLANT_CODE,
        )
        .order_by(models.Plant.code.asc())
        .all()
    )


def _load_plants(db: Session, plant_ids: list[uuid.UUID]) -> list[models.Plant]:
    if not plant_ids:
        return []
    plants = (
        db.query(models.Plant)
        .filter(
            models.Plant.id.in_(plant_ids),
            models.Plant.is_active.is_(True),
            models.Plant.code != PSEUDO_ALL_PLANT_CODE,
        )
        .order_by(models.Plant.code.asc())
        .all()
    )
    found = {plant.id for plant in plants}
    missing = [str(plant_id) for plant_id in plant_ids if plant_id not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown or inactive plants: {', '.join(missing)}")
    plant_map = {plant.id: plant for plant in plants}
    return [plant_map[plant_id] for plant_id in plant_ids]


def apply_user_scope(
    *,
    db: Session,
    user: models.User,
    plant_id,
    allowed_plant_ids,
    is_owner_all_plants: bool,
) -> models.User:
    requested_plant_id = normalize_plant_uuid(plant_id, allow_none=True)
    requested_allowed_ids = _ordered_plant_ids(
        normalize_plant_uuid(value, field_name="allowed_plant_ids[]", allow_none=False)
        for value in (allowed_plant_ids or [])
    )

    if requested_plant_id and requested_plant_id not in requested_allowed_ids:
        requested_allowed_ids = [requested_plant_id, *requested_allowed_ids]

    if is_owner_all_plants:
        accessible_plants = _active_plants(db)
        user.is_owner_all_plants = True
        user.allowed_plants = accessible_plants
        if requested_plant_id:
            user.plant_id = requested_plant_id
        elif accessible_plants:
            user.plant_id = accessible_plants[0].id
        else:
            user.plant_id = None
        return user

    if requested_plant_id is None and requested_allowed_ids:
        requested_plant_id = requested_allowed_ids[0]

    if requested_plant_id is None:
        raise HTTPException(status_code=400, detail="plant_id is required for non-owner users")

    if not requested_allowed_ids:
        requested_allowed_ids = [requested_plant_id]

    user.is_owner_all_plants = False
    user.plant_id = requested_plant_id
    user.allowed_plants = _load_plants(db, requested_allowed_ids)
    return user


def resolve_allowed_plant_ids(db: Session | None, user: models.User) -> list[str]:
    if user.is_owner_all_plants:
        if db is None:
            relation_values = [str(plant.id) for plant in getattr(user, "allowed_plants", []) if getattr(plant, "is_active", True)]
            if relation_values:
                return relation_values
            return [str(user.plant_id)] if user.plant_id else []
        return [str(plant.id) for plant in _active_plants(db)]

    allowed = [str(plant.id) for plant in user.allowed_plants]
    if allowed:
        return allowed
    if user.plant_id:
        return [str(user.plant_id)]
    return []
