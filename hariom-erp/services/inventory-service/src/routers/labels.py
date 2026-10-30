from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PaperReel, StockBatch
from ..services.labels import batch_label_payload, reel_label_payload, with_reel_facts
from ..services.lot_finder import find_by_number
from ..utils.auth import authorized_plant_ids, get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/inventory/labels", tags=["inventory-labels"])
# The issue desks and the people who check stock against a label (Owner / Admin pass as super roles).
FIND_ROLES = ["Store", "PlantManager", "RMIssue", "InwardQC", "QC"]


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


@router.get("/find")
def find_label_by_number(
    code: str = Query(..., min_length=1, max_length=120, description="Typed lot / Amigo inward, AT, vendor reel, old mark or GRN number"),
    kind: str = Query(default="ALL", pattern="^(ALL|LOT|REEL)$"),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(FIND_ROLES)),
):
    """A typed number to its lots / reels / coils in this plant (client 2026-10-30): read only, so a typed
    number works like a scan on the issue desks. Case, spaces and separators are ignored; a unique part works."""
    return find_by_number(db, authorized_plant_ids(plant_scope), code, kind=kind, limit=limit)


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
    # The human-readable lines (GSM / BF / polybond from incoming QC, else the spec) are worked out now.
    return with_reel_facts(db, reel_label_payload(reel, reel.paper), reel, reel.paper)
