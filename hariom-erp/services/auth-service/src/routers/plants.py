from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..plant_service import resolve_allowed_plant_ids
from ..utils.deps import get_current_user, get_session_claims, require_role

router = APIRouter(prefix="/plants", tags=["plants"])


class PlantCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=200)
    address: str | None = None
    legal_name: str | None = Field(default=None, max_length=200)
    gstin: str | None = Field(default=None, max_length=32)
    is_active: bool = True


class PlantUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = None
    legal_name: str | None = Field(default=None, max_length=200)
    gstin: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None


def _serialize_plant(plant: models.Plant, *, allowed_ids: set[str] | None = None, privileged: bool = False) -> dict:
    allowed = allowed_ids or set()
    return {
        "id": str(plant.id),
        "code": plant.code,
        "name": plant.name,
        "legal_name": plant.legal_name,
        "address": plant.address,
        "gstin": plant.gstin,
        "is_active": plant.is_active,
        "is_allowed": privileged or str(plant.id) in allowed,
        "user_count": len(plant.users),
    }


def _plant_lookup(db: Session, plant_id: str) -> models.Plant | None:
    value = str(plant_id or "").strip()
    if not value or value.upper() == "ALL":
        return None
    plant = db.query(models.Plant).filter(models.Plant.code == value).first()
    if plant:
        return plant
    try:
        return db.query(models.Plant).filter(models.Plant.id == uuid.UUID(value)).first()
    except ValueError:
        return None


# GST state / union-territory codes (first two digits of a GSTIN), same list as the party masters.
_GST_STATE_CODES = {
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18",
    "19", "20", "21", "22", "23", "24", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37",
    "38", "97", "99",
}
_GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$")


def _validated_gstin(value: str | None) -> str | None:
    """The plant GSTIN prints on the delivery challan (client 2026-10-28). Blank clears it."""
    gstin = re.sub(r"\s+", "", str(value or "")).upper()
    if not gstin:
        return None
    if len(gstin) != 15:
        raise HTTPException(status_code=422, detail=f"GSTIN must be 15 characters (got {len(gstin)})")
    if not _GSTIN_PATTERN.match(gstin):
        raise HTTPException(status_code=422, detail="GSTIN must be 2-digit state code + 10-character PAN + 3 characters, e.g. 24ABCDE1234F1Z5")
    if gstin[:2] not in _GST_STATE_CODES:
        raise HTTPException(status_code=422, detail=f"GSTIN starts with {gstin[:2]}, which is not a GST state code")
    return gstin


def _blank_to_none(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _validated_code(value: str) -> str:
    code = str(value or "").strip().upper()
    if not code or code == "ALL":
        raise HTTPException(status_code=400, detail="ALL is a reporting scope, not an editable plant.")
    return code


@router.get("")
def list_plants(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    claims = get_session_claims(current_user)
    effective_roles = set(claims.get("roles") or [])
    allowed_ids = set(resolve_allowed_plant_ids(db, current_user))

    query = db.query(models.Plant).filter(models.Plant.is_active.is_(True))
    if "Owner" not in effective_roles and "Admin" not in effective_roles and allowed_ids:
        query = query.filter(models.Plant.id.in_(list(allowed_ids)))

    plants = query.order_by(models.Plant.code.asc()).all()
    privileged = bool({"Owner", "Admin"} & effective_roles)
    return [_serialize_plant(plant, allowed_ids=allowed_ids, privileged=privileged) for plant in plants]


@router.post("")
def create_plant(
    payload: PlantCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_role(["Owner", "Admin"])),
):
    code = _validated_code(payload.code)
    # A name made only of spaces passes min_length but is empty once trimmed; refuse it like PATCH does.
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Plant name is required")
    if db.query(models.Plant).filter(models.Plant.code == code).first():
        raise HTTPException(status_code=409, detail="Plant code already exists")
    plant = models.Plant(
        id=uuid.uuid4(),
        code=code,
        name=name,
        address=_blank_to_none(payload.address),
        legal_name=_blank_to_none(payload.legal_name),
        gstin=_validated_gstin(payload.gstin),
        is_active=payload.is_active,
    )
    db.add(plant)
    db.commit()
    db.refresh(plant)
    return _serialize_plant(plant, privileged=True)


@router.patch("/{plant_id}")
def update_plant(
    plant_id: str,
    payload: PlantUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_role(["Owner", "Admin"])),
):
    plant = _plant_lookup(db, plant_id)
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    updates = payload.model_dump(exclude_unset=True)
    # These columns can never be empty; null is refused in plain words instead of failing on save.
    for key, label in (("code", "Plant code"), ("name", "Plant name"), ("is_active", "Active / inactive")):
        if key in updates and updates[key] is None:
            raise HTTPException(status_code=422, detail=f"{label} is required")
    if "code" in updates and updates["code"] is not None:
        code = _validated_code(updates["code"])
        duplicate = db.query(models.Plant).filter(models.Plant.code == code).first()
        if duplicate and duplicate.id != plant.id:
            raise HTTPException(status_code=409, detail="Plant code already exists")
        updates["code"] = code
    if isinstance(updates.get("name"), str):
        updates["name"] = updates["name"].strip()
        if not updates["name"]:
            raise HTTPException(status_code=422, detail="Plant name is required")
    for key in ("address", "legal_name"):
        if key in updates:
            updates[key] = _blank_to_none(updates[key])
    if "gstin" in updates:
        updates["gstin"] = _validated_gstin(updates["gstin"])
    for key, value in updates.items():
        setattr(plant, key, value)
    db.commit()
    db.refresh(plant)
    return _serialize_plant(plant, privileged=True)


@router.delete("/{plant_id}")
def delete_plant(
    plant_id: str,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_role(["Owner", "Admin"])),
):
    plant = _plant_lookup(db, plant_id)
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    plant.is_active = False
    db.commit()
    return {"message": "Plant disabled", "plant_id": str(plant.id)}
