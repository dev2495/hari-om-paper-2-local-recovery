from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..utils.auth import (
    accepted_persisted_plant_ids,
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    require_role,
)

router = APIRouter(prefix="/master/papers", tags=["papers"])


def _derived_thickness(gsm: Optional[float], bulk_factor: Optional[float]) -> Optional[float]:
    if gsm in (None, "") or bulk_factor in (None, ""):
        return None
    return round(float(gsm) * float(bulk_factor) / 1000.0, 4)


class PaperCreate(BaseModel):
    code: str
    variety: str
    gsm: float
    bf: Optional[float] = None
    ply_bond: Optional[float] = None
    bulk_factor: Optional[float] = None
    price: Optional[float] = None
    thickness_mm: Optional[float] = None


class PaperUpdate(BaseModel):
    code: Optional[str] = None
    variety: Optional[str] = None
    gsm: Optional[float] = None
    bf: Optional[float] = None
    ply_bond: Optional[float] = None
    bulk_factor: Optional[float] = None
    price: Optional[float] = None
    thickness_mm: Optional[float] = None
    active: Optional[bool] = None


class PaperResponse(BaseModel):
    id: uuid.UUID
    code: str
    variety: str
    gsm: float
    bf: Optional[float]
    thickness_mm: Optional[float]
    ply_bond: Optional[float]
    price: Optional[float]
    bulk_factor: Optional[float]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def _serialize_paper(model: models.PaperMaster) -> PaperResponse:
    payload = {
        "id": model.id,
        "code": model.code or "",
        "variety": model.variety or "",
        "gsm": float(model.gsm) if model.gsm is not None else 0.0,
        "bf": model.bf,
        "thickness_mm": _derived_thickness(model.gsm, model.bulk_factor),
        "ply_bond": model.ply_bond,
        "price": model.price,
        "bulk_factor": model.bulk_factor,
        "plant_id": model.plant_id,
        "active": model.active,
        "created_at": model.created_at,
    }
    return PaperResponse.model_validate(payload)


@router.get("/", response_model=List[PaperResponse])
def get_papers(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.PaperMaster).filter(models.PaperMaster.active == True)
    query = apply_plant_scope(query, models.PaperMaster.plant_id, plant_scope)
    return [_serialize_paper(row) for row in query.order_by(models.PaperMaster.code.asc()).all()]


@router.get("/{paper_id}", response_model=PaperResponse)
def get_paper(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.PaperMaster).filter(
        models.PaperMaster.id == paper_id,
        models.PaperMaster.active == True,
    )
    paper = apply_plant_scope(query, models.PaperMaster.plant_id, plant_scope).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return _serialize_paper(paper)


@router.post("/", response_model=PaperResponse)
def create_paper(
    paper: PaperCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    code = paper.code.strip().upper()
    existing = db.query(models.PaperMaster).filter(
        models.PaperMaster.plant_id.in_(plant_values),
        models.PaperMaster.code == code,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Paper code already exists in this plant")

    resolved_strength_value = int(round(paper.bf or 0))
    resolved_strength_type = "BF"
    resolved_bf = paper.bf if paper.bf is not None else float(resolved_strength_value)

    db_paper = models.PaperMaster(
        code=code,
        variety=paper.variety.strip(),
        gsm=paper.gsm,
        bf=resolved_bf,
        thickness_mm=_derived_thickness(paper.gsm, paper.bulk_factor),
        ply_bond=paper.ply_bond,
        strength_type=resolved_strength_type,
        strength_value=resolved_strength_value,
        category="KRAFT",
        price=paper.price,
        bulk_factor=paper.bulk_factor,
        plant_id=plant_id,
    )
    db.add(db_paper)
    db.commit()
    db.refresh(db_paper)
    return _serialize_paper(db_paper)


@router.put("/{paper_id}", response_model=PaperResponse)
def update_paper(
    paper_id: uuid.UUID,
    paper_update: PaperUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_paper = db.query(models.PaperMaster).filter(
        models.PaperMaster.id == paper_id,
        models.PaperMaster.plant_id.in_(plant_values),
    ).first()
    if not db_paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    update_data = paper_update.model_dump(exclude_unset=True)
    if "code" in update_data:
        code = str(update_data["code"]).strip().upper()
        duplicate = db.query(models.PaperMaster).filter(
            models.PaperMaster.id != paper_id,
            models.PaperMaster.plant_id.in_(plant_values),
            models.PaperMaster.code == code,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Paper code already exists in this plant")
        db_paper.code = code

    if "variety" in update_data and update_data["variety"] is not None:
        db_paper.variety = str(update_data["variety"]).strip()
    if "gsm" in update_data and update_data["gsm"] is not None:
        db_paper.gsm = float(update_data["gsm"])
    if "bf" in update_data:
        db_paper.bf = update_data["bf"]
    if "ply_bond" in update_data:
        db_paper.ply_bond = update_data["ply_bond"]
    if "bulk_factor" in update_data:
        db_paper.bulk_factor = update_data["bulk_factor"]
    if "price" in update_data:
        db_paper.price = update_data["price"]
    if "bf" in update_data and update_data["bf"] is not None:
        db_paper.strength_value = int(round(update_data["bf"]))
        db_paper.bf = update_data["bf"]
    if "active" in update_data:
        db_paper.active = bool(update_data["active"])

    db_paper.thickness_mm = _derived_thickness(db_paper.gsm, db_paper.bulk_factor)
    db.commit()
    db.refresh(db_paper)
    return _serialize_paper(db_paper)


@router.delete("/{paper_id}")
def delete_paper(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_paper = db.query(models.PaperMaster).filter(
        models.PaperMaster.id == paper_id,
        models.PaperMaster.plant_id.in_(plant_values),
    ).first()
    if not db_paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    db_paper.active = False
    db.commit()
    return {"message": "Paper deactivated successfully"}
