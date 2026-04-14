from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..plant_service import resolve_allowed_plant_ids
from ..utils.deps import get_current_user, get_session_claims

router = APIRouter(prefix="/plants", tags=["plants"])


@router.get("/")
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
    return [
        {
            "id": str(plant.id),
            "code": plant.code,
            "name": plant.name,
            "legal_name": plant.legal_name,
            "address": plant.address,
            "gstin": plant.gstin,
            "is_active": plant.is_active,
            "is_allowed": str(plant.id) in allowed_ids or "Owner" in effective_roles or "Admin" in effective_roles,
            "user_count": len(plant.users),
        }
        for plant in plants
    ]
