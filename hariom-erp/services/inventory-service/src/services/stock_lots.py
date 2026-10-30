"""Lots in the store and where they sit (spec 2.7, client 2026-10-28).

Shared by locations, moves, counts and corrections:
  - ``location_stock``: the reels and lots in store at one location (or with no location yet);
  - ``stock_summary_by_location``: counts and totals per location for the Locations list;
  - ``resolve_lot``: a scanned or typed label (QR payload, /scan link, AT or lot number) to its reel or lot.

"In store" means a reel IN_STOCK with weight left, or a lot with a balance, that is not returned to the
supplier and not on the floor (WIP). Location never changes QC status; the status is shown as it is.
"""
from __future__ import annotations

import urllib.parse
import uuid
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Iterable, Optional

from fastapi import Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..utils.auth import get_current_plant_scope
from .books import ist_day
from ..models import (
    InventoryLocation,
    ItemMaster,
    PaperReel,
    ReelScanEvent,
    ReelScanEventType,
    ReelStatus,
    StockAdjustmentLine,
    StockAdjustmentVoucher,
    StockBatch,
    StockTransaction,
    TransactionType,
)

ONE_PLANT_WORDS = "Choose one plant at the top to see its stock counts, locations and stock book."


def get_one_plant(plant_scope: dict = Depends(get_current_plant_scope)) -> str:
    """The one plant a stock page works on. "All plants" gets a plain-word 400 instead of "ALL scope is read-only"."""
    if plant_scope.get("scope_all") or not plant_scope.get("selected_plant_id"):
        raise HTTPException(status_code=400, detail=ONE_PLANT_WORDS)
    return str(plant_scope["selected_plant_id"])


NOT_IN_STORE_STATUSES = frozenset({"RETURNED", "WIP"})
NOT_COUNTED_TYPES = frozenset({"FINISHED_GOOD", "TOOL"})
QC_WORDS = {
    "UNRESTRICTED": "Cleared",
    "QC_HOLD": "Waiting for QC",
    "BLOCKED": "Rejected by QC",
    "CONCESSION": "Cleared on concession",
    "SCRAP": "Scrap",
    "DISPATCH_STAGING": "Ready to dispatch",
    "RETURNED": "Returned to supplier",
    "WIP": "On the floor",
}


def _enum(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def plant_uuid(plant_id: Any) -> uuid.UUID:
    return plant_id if isinstance(plant_id, uuid.UUID) else uuid.UUID(str(plant_id))


def location_brief(location: Optional[InventoryLocation]) -> Optional[dict[str, Any]]:
    if location is None:
        return None
    return {
        "id": str(location.id),
        "code": location.code,
        "name": str(location.name or "").strip() or location.code,
        "purpose": location.purpose,
        "active": location.active == "true",
        "is_receiving_default": bool(location.is_receiving_default),
    }


def batch_balances(db: Session, batch_ids: Iterable[Any]) -> dict[str, float]:
    ids = [value for value in batch_ids if value]
    if not ids:
        return {}
    rows = db.query(StockTransaction.batch_id, func.sum(StockTransaction.qty_change)).filter(
        StockTransaction.batch_id.in_(ids),
    ).group_by(StockTransaction.batch_id).all()
    return {str(batch_id): round(float(total or 0.0), 3) for batch_id, total in rows}


def lot_code(entity: Any) -> str:
    metadata = getattr(entity, "inward_metadata", None) or {}
    if isinstance(entity, PaperReel):
        return str(metadata.get("amigo_no") or entity.reel_code or "").strip().upper()
    return str(metadata.get("amigo_no") or getattr(entity, "batch_no", "") or "").strip().upper()


def lot_row(
    entity: Any,
    item: Optional[ItemMaster],
    qty: float,
    *,
    locations: Optional[dict[str, InventoryLocation]] = None,
    here_since: Optional[datetime] = None,
) -> dict[str, Any]:
    is_reel = isinstance(entity, PaperReel)
    status = str(entity.stock_status or "")
    location = (locations or {}).get(str(entity.location_id)) if entity.location_id else None
    since = getattr(entity, "inward_date", None) if is_reel else None
    if not is_reel:
        # A bulk lot is "in since" its GRN's received date (backdated GRNs too), kept on the lot at inward.
        metadata = getattr(entity, "inward_metadata", None) or {}
        received = metadata.get("received_date") or (metadata.get("saved_label") or {}).get("inward_date")
        try:
            since = date.fromisoformat(str(received)[:10]) if received else None
        except ValueError:
            since = None
    created = getattr(entity, "created_at", None)
    return {
        "entity_type": "REEL" if is_reel else "BATCH",
        "id": str(entity.id),
        "code": lot_code(entity),
        "item_id": str(item.id) if item else str(entity.paper_id if is_reel else entity.item_id),
        "item_code": getattr(item, "item_code", None),
        "item_name": getattr(item, "name", None),
        "item_type": _enum(getattr(item, "type", None)),
        "uom": "KG" if is_reel else _enum(getattr(item, "uom", None)) or "KG",
        "qty": round(float(qty or 0.0), 3),
        "stock_status": status,
        "qc_word": QC_WORDS.get(status, status.replace("_", " ").title()),
        "held": status in {"QC_HOLD", "BLOCKED"},
        "physical_form": getattr(entity, "physical_form", None) if is_reel else None,
        "location_id": str(entity.location_id) if entity.location_id else None,
        "location_code": location.code if location else None,
        "location_name": (str(location.name or "").strip() or location.code) if location else None,
        # created_at is naive UTC: its IST day (a lot made at 01:00 IST is in since that day, not the day before).
        "in_since": (since.isoformat() if since else (ist_day(created).isoformat() if created else None)),
        "created_at": created.isoformat() if created else None,
        # When it came to the place it is now (its last move there, else when it was received): naive UTC.
        "here_since": (here_since or created).isoformat() if (here_since or created) else None,
        "unit_cost": round(float(getattr(entity, "unit_cost", None) or getattr(item, "unit_cost", None) or 0.0), 4),
    }


def _location_filter(column, location_id: Any):
    if location_id in (None, "", "unassigned", "UNASSIGNED"):
        return column.is_(None)
    return column == location_id


def arrival_times(db: Session, location_id: Any, reels: list[PaperReel], batches: list[StockBatch]) -> dict[str, datetime]:
    """When each lot came to ``location_id``: its last move there, else when it was received (naive UTC).

    A count uses this to tell a lot that was on the rack when counting started from one that arrived
    later (a GRN or a put-away during the count), which is never "not found".
    """
    out: dict[str, datetime] = {str(row.id): row.created_at for row in [*reels, *batches] if row.created_at}
    if location_id in (None, "", "unassigned", "UNASSIGNED"):
        return out
    batch_ids = [batch.id for batch in batches]
    if batch_ids:
        for batch_id, moved_at in db.query(StockTransaction.batch_id, func.max(StockTransaction.created_at)).filter(
            StockTransaction.batch_id.in_(batch_ids),
            StockTransaction.transaction_type == TransactionType.MOVE,
            StockTransaction.location_id == location_id,
            StockTransaction.qty_change == 0,
        ).group_by(StockTransaction.batch_id).all():
            key = str(batch_id)
            if moved_at and (key not in out or moved_at > out[key]):
                out[key] = moved_at
    reel_ids = [reel.id for reel in reels]
    if reel_ids:
        wanted = str(location_id)
        for reel_id, moved_at, metadata in db.query(ReelScanEvent.reel_id, ReelScanEvent.timestamp, ReelScanEvent.event_metadata).filter(
            ReelScanEvent.reel_id.in_(reel_ids), ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN,
        ).all():
            key = str(reel_id)
            if moved_at and str((metadata or {}).get("to_location_id") or "") == wanted and (key not in out or moved_at > out[key]):
                out[key] = moved_at
    return out


def location_stock(
    db: Session,
    plant_id: str,
    location_id: Any,
    *,
    materials_only: bool = False,
    item_ids: Optional[Iterable[Any]] = None,
) -> dict[str, list[dict[str, Any]]]:
    """Reels and lots in store at ``location_id`` (None = not in any location yet), oldest first."""
    wanted = {str(value) for value in (item_ids or []) if value}
    reels = db.query(PaperReel).filter(
        PaperReel.plant_id == plant_uuid(plant_id),
        _location_filter(PaperReel.location_id, location_id),
        PaperReel.status == ReelStatus.IN_STOCK,
        PaperReel.current_weight_kg > 0,
        ~PaperReel.stock_status.in_(sorted(NOT_IN_STORE_STATUSES)),
    ).order_by(PaperReel.inward_date.asc(), PaperReel.reel_code.asc()).all()
    batches = db.query(StockBatch).filter(
        StockBatch.plant_id == str(plant_id),
        _location_filter(StockBatch.location_id, location_id),
        ~StockBatch.stock_status.in_(sorted(NOT_IN_STORE_STATUSES)),
    ).order_by(StockBatch.created_at.asc()).all()
    balances = batch_balances(db, [batch.id for batch in batches])
    item_keys = {reel.paper_id for reel in reels} | {batch.item_id for batch in batches}
    items = {str(item.id): item for item in db.query(ItemMaster).filter(ItemMaster.id.in_(item_keys)).all()} if item_keys else {}
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}

    def keep(item_id: Any) -> bool:
        item = items.get(str(item_id))
        if materials_only and _enum(getattr(item, "type", None)) in NOT_COUNTED_TYPES:
            return False
        return not wanted or str(item_id) in wanted

    reels = [reel for reel in reels if keep(reel.paper_id)]
    batches = [batch for batch in batches if balances.get(str(batch.id), 0.0) > 0.0005 and keep(batch.item_id)]
    arrived = arrival_times(db, location_id, reels, batches)
    reel_rows = [lot_row(reel, items.get(str(reel.paper_id)), reel.current_weight_kg, locations=locations, here_since=arrived.get(str(reel.id))) for reel in reels]
    lot_rows = [lot_row(batch, items.get(str(batch.item_id)), balances.get(str(batch.id), 0.0), locations=locations, here_since=arrived.get(str(batch.id))) for batch in batches]
    return {"reels": reel_rows, "lots": lot_rows}


def unit_totals(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        totals[row["uom"]] += float(row["qty"] or 0.0)
    return [{"uom": uom, "qty": round(qty, 3)} for uom, qty in sorted(totals.items())]


def stock_summary_by_location(db: Session, plant_id: str, *, materials_only: bool = False) -> dict[Optional[str], dict[str, Any]]:
    """Per location id (None = not in any location yet): reels, lots and totals per unit of stock in store
    (``materials_only`` leaves out finished goods and tools)."""
    summary: dict[Optional[str], dict[str, Any]] = defaultdict(lambda: {"reels": 0, "lots": 0, "totals": defaultdict(float), "held": 0})
    for location_id, weight, status in db.query(PaperReel.location_id, PaperReel.current_weight_kg, PaperReel.stock_status).filter(
        PaperReel.plant_id == plant_uuid(plant_id),
        PaperReel.status == ReelStatus.IN_STOCK,
        PaperReel.current_weight_kg > 0,
        ~PaperReel.stock_status.in_(sorted(NOT_IN_STORE_STATUSES)),
    ).all():
        row = summary[str(location_id) if location_id else None]
        row["reels"] += 1
        row["totals"]["KG"] += float(weight or 0.0)
        row["held"] += 1 if status in {"QC_HOLD", "BLOCKED"} else 0
    batch_query = db.query(StockBatch.id, StockBatch.location_id, StockBatch.stock_status, ItemMaster.uom).join(
        ItemMaster, ItemMaster.id == StockBatch.item_id,
    ).filter(StockBatch.plant_id == str(plant_id), ~StockBatch.stock_status.in_(sorted(NOT_IN_STORE_STATUSES)))
    if materials_only:
        batch_query = batch_query.filter(~ItemMaster.type.in_(sorted(NOT_COUNTED_TYPES)))
    batches = batch_query.all()
    balances = batch_balances(db, [row.id for row in batches])
    for batch in batches:
        qty = balances.get(str(batch.id), 0.0)
        if qty <= 0.0005:
            continue
        row = summary[str(batch.location_id) if batch.location_id else None]
        row["lots"] += 1
        row["totals"][_enum(batch.uom) or "KG"] += qty
        row["held"] += 1 if batch.stock_status in {"QC_HOLD", "BLOCKED"} else 0
    return {
        key: {
            "reels": value["reels"], "lots": value["lots"], "held": value["held"],
            "totals": [{"uom": uom, "qty": round(qty, 3)} for uom, qty in sorted(value["totals"].items())],
        }
        for key, value in summary.items()
    }


def _unwrap(code: str) -> str:
    text = str(code or "").strip()
    for _ in range(2):
        if "?" in text and ("c=" in text or "scan=" in text):
            query = urllib.parse.urlparse(text if "://" in text else f"http://x{text if text.startswith('/') else '/' + text}").query
            params = urllib.parse.parse_qs(query)
            inner = (params.get("c") or params.get("scan") or [""])[0]
            if inner:
                text = inner.strip()
                continue
        break
    return text


def resolve_lot(db: Session, plant_id: str, code: str) -> dict[str, Any]:
    """The reel or lot a scanned / typed label points to, in this plant (plain-word 404 / 409 otherwise).

    Returns {"entity_type", "entity", "item", "code"}; refuses rack, tool and job-card labels with a
    message saying what was scanned, and a label printed for another plant.
    """
    raw = _unwrap(code)
    if not raw:
        raise HTTPException(status_code=422, detail={"code": "EMPTY", "message": "Scan or type a label."})
    if raw.lower().startswith("hariom://tool/"):
        raise HTTPException(status_code=409, detail={"code": "TOOL_LABEL", "message": "That is a tool label. Scan the reel, coil or lot label."})
    if "/production/" in raw or "job_card_id=" in raw:
        raise HTTPException(status_code=409, detail={"code": "JOB_CARD", "message": "That is a job card. Scan the reel, coil or lot label."})
    parts = raw.split("|")
    entity: Any = None
    entity_type = ""
    if len(parts) >= 5 and parts[0].upper() == "HARIOM":
        kind = parts[1].upper()
        if kind in {"LOC", "LOCATION"}:
            raise HTTPException(status_code=409, detail={
                "code": "RACK_LABEL", "message": f"That is a rack label ({parts[4].strip() or 'location'}). Scan the reel, coil or lot label.",
                "location_id": parts[3].strip(),
            })
        if parts[2].strip() and parts[2].strip().lower() != str(plant_id).lower():
            raise HTTPException(status_code=409, detail={"code": "OTHER_PLANT", "message": "This label belongs to another plant."})
        try:
            record_id = uuid.UUID(parts[3].strip())
        except ValueError:
            record_id = None
        if record_id and kind == "REEL":
            entity = db.query(PaperReel).filter(PaperReel.id == record_id, PaperReel.plant_id == plant_uuid(plant_id)).first()
            entity_type = "REEL"
        elif record_id and kind == "BATCH":
            entity = db.query(StockBatch).filter(StockBatch.id == record_id, StockBatch.plant_id == str(plant_id)).first()
            entity_type = "BATCH"
        if entity is None:
            raw = "|".join(parts[4:]).strip()
    if entity is None:
        typed = raw.strip().upper()
        entity = db.query(PaperReel).filter(
            PaperReel.plant_id == plant_uuid(plant_id), func.upper(PaperReel.reel_code) == typed,
        ).first()
        entity_type = "REEL"
        if entity is None:
            entity = db.query(StockBatch).filter(
                StockBatch.plant_id == str(plant_id), func.upper(StockBatch.batch_no) == typed,
            ).first()
            entity_type = "BATCH"
        if entity is None:
            raise HTTPException(status_code=404, detail={"code": "UNKNOWN_LABEL", "message": f"{typed or 'This label'} is not in the system for this plant."})
    item = db.query(ItemMaster).filter(ItemMaster.id == (entity.paper_id if entity_type == "REEL" else entity.item_id)).first()
    return {"entity_type": entity_type, "entity": entity, "item": item, "code": lot_code(entity)}


def entity_qty(db: Session, entity_type: str, entity: Any) -> float:
    """Book quantity of a lot right now (reel weight, or the lot's ledger balance)."""
    if entity_type == "REEL":
        return round(float(entity.current_weight_kg or 0.0), 3) if entity.status == ReelStatus.IN_STOCK else 0.0
    return batch_balances(db, [entity.id]).get(str(entity.id), 0.0)


def posted_since(db: Session, entity_type: str, entity_id: Any, since: Optional[datetime], *, exclude_voucher_id: Any = None) -> float:
    """What other count and correction postings changed on one reel / lot after ``since`` (naive UTC).

    Two counts of the same lot, or a count and a correction, are each measured against the book at their
    own moment; whatever another one already posted since is taken off, so the stock ends at what was
    counted and is never changed twice for one difference.
    """
    if since is None or entity_id is None:
        return 0.0
    column = StockAdjustmentLine.reel_id if entity_type == "REEL" else StockAdjustmentLine.batch_id
    query = db.query(func.sum(StockAdjustmentLine.qty_delta)).join(
        StockAdjustmentVoucher, StockAdjustmentVoucher.id == StockAdjustmentLine.adjustment_id,
    ).filter(column == entity_id, StockAdjustmentVoucher.status == "POSTED", StockAdjustmentVoucher.posted_at > since)
    if exclude_voucher_id is not None:
        query = query.filter(StockAdjustmentVoucher.id != exclude_voucher_id)
    return round(float(query.scalar() or 0.0), 3)


def in_store(db: Session, entity_type: str, entity: Any) -> bool:
    if str(entity.stock_status or "") in NOT_IN_STORE_STATUSES:
        return False
    return entity_qty(db, entity_type, entity) > 0.0005


def now_utc() -> datetime:
    return datetime.utcnow()
