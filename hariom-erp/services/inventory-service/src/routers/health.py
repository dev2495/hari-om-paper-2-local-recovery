from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation, PaperReel, StockBatch, STOCK_STATUS_VALUES, StockTransaction
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
            "items": {},
        }
        for location in location_rows
    }

    def add_item(bucket: dict[str, Any], item_id: Any, code: str | None, name: str | None, qty: float, weight_kg: float) -> None:
        key = str(item_id or code or name or "UNKNOWN")
        item_bucket = bucket["items"].setdefault(
            key,
            {
                "item_id": key,
                "item_code": code or "UNKNOWN",
                "item_name": name or "Unknown item",
                "qty": 0.0,
                "weight_kg": 0.0,
            },
        )
        item_bucket["qty"] += float(qty or 0.0)
        item_bucket["weight_kg"] += float(weight_kg or 0.0)

    reel_query = _apply_scope(db.query(PaperReel), PaperReel, plant_scope)
    for reel in reel_query.all():
        if not reel.location_id:
            continue
        bucket = by_location.get(str(reel.location_id))
        if not bucket:
            continue
        bucket["reel_count"] += 1
        weight = float(reel.current_weight_kg or 0.0)
        bucket["weight_kg"] += weight
        add_item(
            bucket,
            reel.paper_id,
            getattr(reel.paper, "item_code", None),
            getattr(reel.paper, "name", None),
            0.0,
            weight,
        )

    batch_query = _apply_scope(db.query(StockBatch), StockBatch, plant_scope)
    for batch in batch_query.all():
        if not batch.location_id:
            continue
        bucket = by_location.get(str(batch.location_id))
        if not bucket:
            continue
        bucket["batch_count"] += 1
        qty = max(0.0, float(get_batch_balance(str(batch.id), db)))
        bucket["qty"] += qty
        add_item(
            bucket,
            batch.item_id,
            getattr(batch.item, "item_code", None),
            getattr(batch.item, "name", None),
            qty,
            0.0,
        )

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
                "items": [
                    {
                        **item_row,
                        "qty": round(float(item_row["qty"]), 2),
                        "weight_kg": round(float(item_row["weight_kg"]), 2),
                    }
                    for item_row in sorted(
                        row["items"].values(),
                        key=lambda item: (float(item["weight_kg"] or 0) + float(item["qty"] or 0)),
                        reverse=True,
                    )
                ],
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
    status_rows: dict[str, dict[str, Any]] = {}

    def location_payload(location: InventoryLocation | None) -> dict[str, Any]:
        if not location:
            return {"location_id": None, "location_code": None, "warehouse": None, "zone": None, "bin": None}
        return {
            "location_id": str(location.id),
            "location_code": location.code,
            "warehouse": location.warehouse,
            "zone": location.zone,
            "bin": location.bin,
        }

    def add_status_row(status: str, qty: float, weight_kg: float, entity_type: str) -> None:
        bucket = status_rows.setdefault(
            status,
            {"stock_status": status, "qty": 0.0, "weight_kg": 0.0, "reels": 0, "batches": 0},
        )
        bucket["qty"] += float(qty or 0.0)
        bucket["weight_kg"] += float(weight_kg or 0.0)
        if entity_type == "REEL":
            bucket["reels"] += 1
        else:
            bucket["batches"] += 1

    def latest_batch_job(batch_id: Any) -> dict[str, Any]:
        txn = (
            db.query(StockTransaction)
            .filter(StockTransaction.batch_id == batch_id)
            .order_by(StockTransaction.created_at.desc())
            .first()
        )
        metadata = dict(getattr(txn, "movement_metadata", None) or {})
        return {
            "job_card_id": metadata.get("job_card_id") or metadata.get("job_id") or metadata.get("source_job_card_id"),
            "job_card_no": metadata.get("job_card_no") or metadata.get("job_no"),
        }

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
        add_status_row(reel.stock_status, 0.0, weight, "REEL")
        detail_rows.append(
            {
                "entity_type": "REEL",
                "id": str(reel.id),
                "code": reel.reel_code,
                "item_id": str(reel.paper_id),
                "item_code": getattr(reel.paper, "item_code", None),
                "item_name": getattr(reel.paper, "name", None),
                "days_old": days_old,
                "age_bucket": bucket["label"],
                "stock_status": reel.stock_status,
                "qty": 0.0,
                "weight_kg": round(weight, 2),
                "job_card_id": None,
                "job_card_no": None,
                **location_payload(reel.inventory_location),
            }
        )

    for batch in _apply_scope(db.query(StockBatch), StockBatch, plant_scope).all():
        days_old = max(0, (today - batch.created_at.date()).days)
        bucket = buckets[bucket_for(days_old)]
        qty = max(0.0, float(get_batch_balance(str(batch.id), db)))
        bucket["qty"] += qty
        bucket["batches"] += 1
        add_status_row(batch.stock_status, qty, 0.0, "BATCH")
        job_ref = latest_batch_job(batch.id)
        detail_rows.append(
            {
                "entity_type": "BATCH",
                "id": str(batch.id),
                "code": batch.batch_no,
                "item_id": str(batch.item_id),
                "item_code": getattr(batch.item, "item_code", None),
                "item_name": getattr(batch.item, "name", None),
                "days_old": days_old,
                "age_bucket": bucket["label"],
                "stock_status": batch.stock_status,
                "qty": round(qty, 2),
                "weight_kg": 0.0,
                **job_ref,
                **location_payload(batch.inventory_location),
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
        "status_rows": [
            {
                **row,
                "qty": round(float(row["qty"]), 2),
                "weight_kg": round(float(row["weight_kg"]), 2),
            }
            for row in sorted(status_rows.values(), key=lambda row: (row["stock_status"]))
        ],
        "rows": sorted(detail_rows, key=lambda row: (row["days_old"], row["stock_status"]), reverse=True)[:250],
        "slow_rows": [row for row in sorted(detail_rows, key=lambda row: row["days_old"], reverse=True) if row["days_old"] > 60][:50],
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
