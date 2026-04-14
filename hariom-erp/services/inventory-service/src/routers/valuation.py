from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ItemMaster, PaperReel
from ..services import get_all_items_balance
from ..utils.auth import get_current_plant_scope, get_current_user

router = APIRouter(prefix="/inventory/valuation", tags=["inventory-valuation"])


def _apply_scope(query, model, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(model.plant_id.in_(allowed))
        return query
    return query.filter(model.plant_id == plant_scope["selected_plant_id"])


def _normalize_cost_source(raw_source) -> str:
    if raw_source is None:
        return "UNAVAILABLE"
    return str(getattr(raw_source, "value", raw_source) or "UNAVAILABLE")


def _resolve_item_cost(item: Optional[ItemMaster]) -> tuple[float, str]:
    if item is None:
        return 0.0, "UNAVAILABLE"
    unit_cost = float(getattr(item, "unit_cost", 0.0) or 0.0)
    source = _normalize_cost_source(getattr(item, "cost_source", None))
    if unit_cost <= 0:
        return 0.0, "UNAVAILABLE"
    return unit_cost, source


def _resolve_reel_cost(reel: Optional[PaperReel]) -> tuple[float, str]:
    if reel is None:
        return 0.0, "UNAVAILABLE"
    reel_cost = float(getattr(reel, "unit_cost", 0.0) or 0.0)
    reel_source = _normalize_cost_source(getattr(reel, "cost_source", None))
    if reel_cost > 0:
        return reel_cost, reel_source
    return _resolve_item_cost(getattr(reel, "paper", None))


@router.get("/summary")
def valuation_summary(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    plant_id = None if plant_scope.get("scope_all") else plant_scope["selected_plant_id"]
    plant_ids = plant_scope.get("allowed_plants") if plant_scope.get("scope_all") else None
    rows = get_all_items_balance(db=db, plant_id=plant_id, plant_ids=plant_ids)

    item_query = _apply_scope(db.query(ItemMaster), ItemMaster, plant_scope)
    item_map = {str(item.id): item for item in item_query.all()}

    for row in rows:
        item = item_map.get(str(row["item_id"]))
        unit_cost, cost_source = _resolve_item_cost(item)
        row["unit_cost"] = round(unit_cost, 4)
        row["cost_source"] = cost_source
        row["inventory_value"] = round(float(row["balance"]) * unit_cost, 2)

    total_value = round(sum(float(row["inventory_value"]) for row in rows), 2)
    return {
        "as_of": datetime.utcnow().isoformat(),
        "filters": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        },
        "rows": rows,
        "totals": {
            "inventory_value": total_value,
            "sku_count": len(rows),
        },
    }


@router.get("/reels")
def valuation_reels(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_scope(db.query(PaperReel), PaperReel, plant_scope)
    if start_date:
        query = query.filter(PaperReel.inward_date >= start_date)
    if end_date:
        query = query.filter(PaperReel.inward_date <= end_date)

    rows = []
    total_value = 0.0
    for reel in query.order_by(PaperReel.inward_date.desc(), PaperReel.reel_code.asc()).all():
        unit_cost, cost_source = _resolve_reel_cost(reel)
        value = round(float(reel.current_weight_kg or 0.0) * unit_cost, 2)
        total_value += value
        rows.append(
            {
                "id": str(reel.id),
                "reel_code": reel.reel_code,
                "paper_id": str(reel.paper_id),
                "inward_date": reel.inward_date.isoformat(),
                "stock_status": reel.stock_status,
                "current_weight_kg": round(float(reel.current_weight_kg or 0.0), 2),
                "unit_cost": round(unit_cost, 4),
                "cost_source": cost_source,
                "inventory_value": value,
            }
        )

    return {
        "as_of": datetime.utcnow().isoformat(),
        "filters": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        },
        "rows": rows,
        "totals": {
            "inventory_value": round(total_value, 2),
            "reel_count": len(rows),
        },
    }
