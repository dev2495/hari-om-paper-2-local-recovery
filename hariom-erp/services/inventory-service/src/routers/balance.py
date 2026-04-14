from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ItemMaster
from ..services import (
    get_all_items_balance,
    get_available_item_qty,
    get_item_balance,
    get_item_batches,
    get_dispatch_allocated_qty,
)
from ..utils.auth import get_current_plant_scope, get_current_user

router = APIRouter(tags=["balance"])


def _apply_item_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(ItemMaster.plant_id.in_(allowed))
        return query
    return query.filter(ItemMaster.plant_id == plant_scope["selected_plant_id"])


@router.get("/all-balances")
def get_all_balances(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    plant_id = None if plant_scope.get("scope_all") else plant_scope["selected_plant_id"]
    plant_ids = plant_scope.get("allowed_plants") if plant_scope.get("scope_all") else None
    return {
        "items": get_all_items_balance(db=db, plant_id=plant_id, plant_ids=plant_ids),
    }


@router.get("/balance/{item_id}")
def get_item_stock_balance(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_item_scope(db.query(ItemMaster).filter(ItemMaster.id == item_id), plant_scope)
    item = query.first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "item_id": str(item.id),
        "item_code": item.item_code,
        "name": item.name,
        "type": item.type.value,
        "uom": item.uom.value,
        "balance": round(get_item_balance(str(item.id), db), 2),
        "dispatch_allocated_qty": round(get_dispatch_allocated_qty(db=db, item_id=str(item.id)), 2),
        "available_qty": round(get_available_item_qty(str(item.id), db), 2),
        "batches": get_item_batches(str(item.id), db),
    }
