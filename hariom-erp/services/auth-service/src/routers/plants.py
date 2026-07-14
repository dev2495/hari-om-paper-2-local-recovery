from __future__ import annotations

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
    if db.query(models.Plant).filter(models.Plant.code == code).first():
        raise HTTPException(status_code=409, detail="Plant code already exists")
    plant = models.Plant(
        id=uuid.uuid4(),
        code=code,
        name=payload.name.strip(),
        address=payload.address.strip() if payload.address else None,
        legal_name=payload.legal_name.strip() if payload.legal_name else None,
        gstin=payload.gstin.strip().upper() if payload.gstin else None,
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
    if "code" in updates and updates["code"] is not None:
        code = _validated_code(updates["code"])
        duplicate = db.query(models.Plant).filter(models.Plant.code == code).first()
        if duplicate and duplicate.id != plant.id:
            raise HTTPException(status_code=409, detail="Plant code already exists")
        updates["code"] = code
    for key in ("name", "address", "legal_name"):
        if isinstance(updates.get(key), str):
            updates[key] = updates[key].strip()
    if isinstance(updates.get("gstin"), str):
        updates["gstin"] = updates["gstin"].strip().upper()
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
