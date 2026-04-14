from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation, PaperReel, StockBatch, STOCK_STATUS_VALUES
from ..services import get_batch_balance
from ..utils.auth import get_current_plant_scope, get_current_user

router = APIRouter(prefix="/inventory/health", tags=["inventory-health"])


def _apply_scope(query, model, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(model.plant_id.in_(allowed))
        return query
    return query.filter(model.plant_id == plant_scope["selected_plant_id"])


def _stock_status_summary(db: Session, plant_scope: dict) -> dict[str, dict[str, float]]:
    buckets: dict[str, dict[str, float]] = {
        status: {"weight_kg": 0.0, "batch_qty": 0.0, "reel_count": 0.0, "batch_count": 0.0}
        for status in STOCK_STATUS_VALUES
    }

    reel_query = _apply_scope(db.query(PaperReel), PaperReel, plant_scope)
    for reel in reel_query.all():
        bucket = buckets.setdefault(reel.stock_status, {"weight_kg": 0.0, "batch_qty": 0.0, "reel_count": 0.0, "batch_count": 0.0})
        bucket["weight_kg"] += float(reel.current_weight_kg or 0.0)
        bucket["reel_count"] += 1

    batch_query = _apply_scope(db.query(StockBatch), StockBatch, plant_scope)
    for batch in batch_query.all():
        current_qty = max(0.0, float(get_batch_balance(str(batch.id), db)))
        bucket = buckets.setdefault(batch.stock_status, {"weight_kg": 0.0, "batch_qty": 0.0, "reel_count": 0.0, "batch_count": 0.0})
        bucket["batch_qty"] += current_qty
        bucket["batch_count"] += 1

    return buckets


@router.get("/status-summary")
def health_status_summary(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    buckets = _stock_status_summary(db, plant_scope)
    rows = [
        {
          "stock_status": status,
          "weight_kg": round(payload["weight_kg"], 2),
          "batch_qty": round(payload["batch_qty"], 2),
          "reel_count": int(payload["reel_count"]),
          "batch_count": int(payload["batch_count"]),
        }
        for status, payload in buckets.items()
        if payload["weight_kg"] > 0 or payload["batch_qty"] > 0 or payload["reel_count"] > 0 or payload["batch_count"] > 0
    ]
    rows.sort(key=lambda row: row["stock_status"])
    return {
        "rows": rows,
        "totals": {
            "weight_kg": round(sum(row["weight_kg"] for row in rows), 2),
            "batch_qty": round(sum(row["batch_qty"] for row in rows), 2),
            "reel_count": sum(row["reel_count"] for row in rows),
            "batch_count": sum(row["batch_count"] for row in rows),
        },
    }


@router.get("/location-occupancy")
def health_location_occupancy(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    location_rows = _apply_scope(
        db.query(InventoryLocation).filter(InventoryLocation.active == "true"),
        InventoryLocation,
        plant_scope,
    ).all()
    by_location: dict[str, dict[str, Any]] = {
        str(location.id): {
            "location_id": str(location.id),
            "plant_id": str(location.plant_id),
            "code": location.code,
            "warehouse": location.warehouse,
            "zone": location.zone,
            "bin": location.bin,
            "purpose": location.purpose,
            "reel_count": 0,
            "batch_count": 0,
            "weight_kg": 0.0,
            "qty": 0.0,
        }
        for location in location_rows
    }

    reel_query = _apply_scope(db.query(PaperReel), PaperReel, plant_scope)
    for reel in reel_query.all():
        if not reel.location_id:
            continue
        bucket = by_location.get(str(reel.location_id))
        if not bucket:
            continue
        bucket["reel_count"] += 1
        bucket["weight_kg"] += float(reel.current_weight_kg or 0.0)

    batch_query = _apply_scope(db.query(StockBatch), StockBatch, plant_scope)
    for batch in batch_query.all():
        if not batch.location_id:
            continue
        bucket = by_location.get(str(batch.location_id))
        if not bucket:
            continue
        bucket["batch_count"] += 1
        bucket["qty"] += max(0.0, float(get_batch_balance(str(batch.id), db)))

    rows = list(by_location.values())
    rows.sort(key=lambda row: (row["warehouse"] or "", row["zone"] or "", row["bin"] or "", row["code"]))
    occupied = sum(1 for row in rows if row["reel_count"] or row["batch_count"] or row["weight_kg"] > 0 or row["qty"] > 0)
    return {
        "summary": {
            "total_locations": len(rows),
            "occupied_locations": occupied,
            "empty_locations": max(0, len(rows) - occupied),
        },
        "rows": [
            {
                **row,
                "weight_kg": round(float(row["weight_kg"]), 2),
                "qty": round(float(row["qty"]), 2),
            }
            for row in rows
        ],
    }


@router.get("/aging")
def health_aging(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    today = date.today()
    buckets = {
        "0-30": {"label": "0-30", "weight_kg": 0.0, "qty": 0.0, "reels": 0, "batches": 0},
        "31-60": {"label": "31-60", "weight_kg": 0.0, "qty": 0.0, "reels": 0, "batches": 0},
        "61-90": {"label": "61-90", "weight_kg": 0.0, "qty": 0.0, "reels": 0, "batches": 0},
        "90+": {"label": "90+", "weight_kg": 0.0, "qty": 0.0, "reels": 0, "batches": 0},
    }
    detail_rows: list[dict[str, Any]] = []

    def bucket_for(days_old: int) -> str:
        if days_old <= 30:
            return "0-30"
        if days_old <= 60:
            return "31-60"
        if days_old <= 90:
            return "61-90"
        return "90+"

    for reel in _apply_scope(db.query(PaperReel), PaperReel, plant_scope).all():
        days_old = max(0, (today - reel.inward_date).days)
        bucket = buckets[bucket_for(days_old)]
        weight = float(reel.current_weight_kg or 0.0)
        bucket["weight_kg"] += weight
        bucket["reels"] += 1
        if days_old > 60 and weight > 0:
            detail_rows.append(
                {
                    "entity_type": "REEL",
                    "id": str(reel.id),
                    "code": reel.reel_code,
                    "days_old": days_old,
                    "stock_status": reel.stock_status,
                    "weight_kg": round(weight, 2),
                }
            )

    for batch in _apply_scope(db.query(StockBatch), StockBatch, plant_scope).all():
        days_old = max(0, (today - batch.created_at.date()).days)
        bucket = buckets[bucket_for(days_old)]
        qty = max(0.0, float(get_batch_balance(str(batch.id), db)))
        bucket["qty"] += qty
        bucket["batches"] += 1
        if days_old > 60 and qty > 0:
            detail_rows.append(
                {
                    "entity_type": "BATCH",
                    "id": str(batch.id),
                    "code": batch.batch_no,
                    "days_old": days_old,
                    "stock_status": batch.stock_status,
                    "qty": round(qty, 2),
                }
            )

    return {
        "buckets": [
            {
                "label": payload["label"],
                "weight_kg": round(payload["weight_kg"], 2),
                "qty": round(payload["qty"], 2),
                "reels": payload["reels"],
                "batches": payload["batches"],
            }
            for payload in buckets.values()
        ],
        "slow_rows": sorted(detail_rows, key=lambda row: row["days_old"], reverse=True)[:50],
    }


@router.get("/genealogy-exceptions")
def health_genealogy_exceptions(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    reel_query = _apply_scope(db.query(PaperReel), PaperReel, plant_scope)
    reels = reel_query.all()
    parents = {str(reel.id): reel for reel in reels}
    children_by_parent: dict[str, list[PaperReel]] = defaultdict(list)

    for reel in reels:
        if reel.parent_reel_id:
            children_by_parent[str(reel.parent_reel_id)].append(reel)

    rows: list[dict[str, Any]] = []
    for parent_id, children in children_by_parent.items():
        parent = parents.get(parent_id)
        if not parent:
            continue
        child_total = sum(float(child.current_weight_kg or 0.0) for child in children)
        abnormal = child_total > float(parent.inward_weight_kg or 0.0) + 0.01 or any(
            child.stock_status in {"QC_HOLD", "BLOCKED", "SCRAP"} for child in children
        )
        if not abnormal:
            continue
        rows.append(
            {
                "parent_reel_id": parent_id,
                "parent_reel_code": parent.reel_code,
                "parent_inward_weight_kg": round(float(parent.inward_weight_kg or 0.0), 2),
                "child_total_weight_kg": round(child_total, 2),
                "child_count": len(children),
                "child_statuses": sorted({child.stock_status for child in children}),
            }
        )

    return {
        "rows": rows,
        "count": len(rows),
    }


@router.get("/summary")
def health_summary(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    status_summary = health_status_summary(db=db, plant_scope=plant_scope, current_user=current_user)
    location_summary = health_location_occupancy(db=db, plant_scope=plant_scope, current_user=current_user)
    aging_summary = health_aging(db=db, plant_scope=plant_scope, current_user=current_user)

    blocked_qty = 0.0
    qc_hold_qty = 0.0
    for row in status_summary["rows"]:
        total = float(row.get("weight_kg") or 0.0) + float(row.get("batch_qty") or 0.0)
        if row["stock_status"] == "BLOCKED":
            blocked_qty += total
        if row["stock_status"] == "QC_HOLD":
            qc_hold_qty += total

    return {
        "dispatch_allocated_qty": 0.0,
        "active_dispatch_allocations": 0,
        "blocked_qty": round(blocked_qty, 2),
        "qc_hold_qty": round(qc_hold_qty, 2),
        "occupied_locations": location_summary["summary"]["occupied_locations"],
        "total_locations": location_summary["summary"]["total_locations"],
        "aging_hotspots": len(aging_summary["slow_rows"]),
        "status_rows": status_summary["rows"],
        # Compatibility keys for stale clients; operational UI no longer uses reservation terminology.
        "reservation_qty": 0.0,
        "active_reservations": 0,
    }
