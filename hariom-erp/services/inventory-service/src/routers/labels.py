from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PaperReel, StockBatch
from ..services.labels import batch_label_payload, reel_label_payload
from ..utils.auth import get_current_plant_scope, get_current_user

router = APIRouter(prefix="/inventory/labels", tags=["inventory-labels"])


def _apply_batch_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(StockBatch.plant_id.in_(allowed))
        return query
    return query.filter(StockBatch.plant_id == plant_scope["selected_plant_id"])


def _apply_reel_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(PaperReel.plant_id.in_([uuid.UUID(str(value)) for value in allowed]))
        return query
    return query.filter(PaperReel.plant_id == uuid.UUID(str(plant_scope["selected_plant_id"])))


@router.get("/batches/{batch_id}")
def get_batch_label(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_batch_scope(db.query(StockBatch).filter(StockBatch.id == batch_id), plant_scope)
    batch = query.first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch label not found")
    return batch_label_payload(batch, batch.item)


@router.get("/reels/{reel_id}")
def get_reel_label(
    reel_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_reel_scope(db.query(PaperReel).filter(PaperReel.id == reel_id), plant_scope)
    reel = query.first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel label not found")
    return reel_label_payload(reel, reel.paper)
