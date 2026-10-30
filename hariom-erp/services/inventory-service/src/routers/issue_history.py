"""Issue history (client 2026-10-30): every issue to the floor in one list.

Reels and coils (whole, to the slitter or the winders), parchment by colour and kg, adhesive / packing lots
and the older issue-to-job-card moves, each with its business date, the moment it was registered, its shift,
the material and reel / lot, the quantity in its own unit, where it went, who issued it and the rack it was
picked from. Filters: date range (business dates), shift, material, card, person, kind. The quantities are
the ones the stock book counts as Issued on the same business day. Nothing returns from the floor.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation, ItemMaster, PaperReel, ReelIssue, ReelIssueStatus, StockBatch, StockTransaction, TransactionType
from ..services.shift_rule import floor_shift_now
from ..utils.auth import authorized_plant_ids, get_current_plant_scope, get_current_user
from .reel_issues import shift_words

router = APIRouter(prefix="/inventory/issue-history", tags=["inventory-issue-history"])

MAX_DAYS = 400
MAX_ROWS = 3000
KINDS = {"ALL", "REEL", "MATERIAL"}
UNIT_WORDS = {"KG": "kg", "PCS": "pcs", "L": "L"}


def _enum(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _uuid(value: Any) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _place(locations: dict[str, InventoryLocation], location_id: Any) -> Optional[dict[str, str]]:
    row = locations.get(str(location_id)) if location_id else None
    if row is None:
        return None
    return {"id": str(row.id), "code": row.code, "name": str(row.name or "").strip() or row.code}


def _reel_destination(issue: ReelIssue, item_type: str) -> str:
    section = str(issue.issue_section or "").upper()
    if str(issue.issue_mode or "").upper() != "FLOOR":
        return "Slitting (older issue)" if section == "SLITTING_SECTION" else "Winder (older issue)"
    if item_type == "PARCHMENT":
        return "Floor"
    return "Floor · slitter" if section == "SLITTING_SECTION" else "Floor · winders"


def history_rows(
    db: Session,
    plants: list[str],
    date_from: date,
    date_to: date,
) -> list[dict[str, Any]]:
    """Every issue whose business date falls in the period, newest registration first."""
    rows: list[dict[str, Any]] = []
    plant_uuids = [value for value in (_uuid(plant) for plant in plants) if value is not None]

    reel_issues = (
        db.query(ReelIssue, PaperReel, ItemMaster)
        .join(PaperReel, ReelIssue.reel_id == PaperReel.id)
        .join(ItemMaster, PaperReel.paper_id == ItemMaster.id)
        .filter(ReelIssue.plant_id.in_(plant_uuids), ReelIssue.issue_date >= date_from, ReelIssue.issue_date <= date_to)
        .all()
    ) if plant_uuids else []

    txns = (
        db.query(StockTransaction, ItemMaster, StockBatch)
        .join(ItemMaster, StockTransaction.item_id == ItemMaster.id)
        .outerjoin(StockBatch, StockTransaction.batch_id == StockBatch.id)
        .filter(
            StockTransaction.plant_id.in_([str(plant) for plant in plants]),
            or_(
                StockTransaction.transaction_type == TransactionType.ISSUE_PRODUCTION,
                StockTransaction.transaction_type == TransactionType.MOVE,
            ),
            StockTransaction.effective_date >= date_from,
            StockTransaction.effective_date <= date_to,
        )
        .all()
    )
    # A move is an issue only on its store side (issue to work in progress); its WIP_IN twin is floor stock.
    txns = [row for row in txns if _enum(row[0].transaction_type) == TransactionType.ISSUE_PRODUCTION.value
            or (row[0].movement_metadata or {}).get("side") == "STORE_OUT"]

    location_ids = {issue.from_location_id or reel.location_id for issue, reel, _ in reel_issues} | {txn.location_id for txn, _, _ in txns}
    location_ids.discard(None)
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.id.in_(list(location_ids))).all()} if location_ids else {}

    for issue, reel, item in reel_issues:
        item_type = _enum(item.type).upper()
        form = str(reel.physical_form or "REEL").upper()
        card = issue.slitting_card or {}
        rows.append({
            "id": f"reel:{issue.id}",
            "source": "REEL_ISSUE",
            "kind": "MATERIAL" if item_type == "PARCHMENT" else "REEL",
            "day": issue.issue_date.isoformat() if issue.issue_date else None,
            "issued_at": issue.created_at.isoformat() if issue.created_at else None,
            "shift": issue.shift,
            "shift_label": shift_words(issue.shift, issue.issue_date),
            "item_id": str(item.id),
            "item_code": item.item_code,
            "item_name": item.name,
            "item_type": item_type,
            "lot": reel.reel_code,
            "lot_kind": "Coil" if form == "COIL" else "Reel",
            "vendor_reel_no": reel.source_reel_no,
            "qty": round(float(issue.issued_weight_kg or 0.0), 3),
            "uom": "KG",
            "to": _reel_destination(issue, item_type),
            "card": None,
            "card_label": None,
            "issued_by": issue.issued_by,
            "from_location": _place(locations, issue.from_location_id or reel.location_id),
            "note": (
                f"Slitting card: {card.get('coils_made')} coils, {card.get('wastage_kg')} kg wastage" if card
                else ("Slitting card to write" if str(issue.issue_section or "").upper() == "SLITTING_SECTION" and issue.status == ReelIssueStatus.OPEN else None)
            ),
            "plant_id": str(issue.plant_id),
        })

    for txn, item, batch in txns:
        meta = txn.movement_metadata or {}
        is_move = _enum(txn.transaction_type) == TransactionType.MOVE.value
        card_id = meta.get("job_card_id") or meta.get("production_job_id")
        card_no = meta.get("job_card_no") or meta.get("card_no")
        if is_move:
            destination = f"Job card · {str(meta.get('stage') or 'WIP').title()}"
        elif meta.get("destination") == "FLOOR" or (card_id is None and str(meta.get("reason_code") or "FLOOR_ISSUE").upper() == "FLOOR_ISSUE"):
            destination = "Floor"
        else:
            destination = "Job card (correction)"
        lot_meta = (batch.inward_metadata or {}) if batch is not None else {}
        rows.append({
            "id": f"txn:{txn.id}",
            "source": "MATERIAL_ISSUE" if not is_move else "WIP_ISSUE",
            "kind": "REEL" if _enum(item.tracking_mode) == "REEL" and _enum(item.type).upper() != "PARCHMENT" else "MATERIAL",
            "day": txn.effective_date.isoformat() if txn.effective_date else None,
            "issued_at": (meta.get("issued_at") or (txn.created_at.isoformat() if txn.created_at else None)),
            "shift": meta.get("shift"),
            "shift_label": shift_words(meta.get("shift"), txn.effective_date) if meta.get("shift") else (f"{txn.effective_date.day} {txn.effective_date.strftime('%b')}" if txn.effective_date else ""),
            "item_id": str(item.id),
            "item_code": item.item_code,
            "item_name": item.name,
            "item_type": _enum(item.type).upper(),
            "lot": lot_meta.get("amigo_no") or (batch.batch_no if batch is not None else None),
            "lot_kind": "Lot",
            "vendor_reel_no": None,
            "qty": round(-float(txn.qty_change or 0.0), 3),
            "uom": _enum(item.uom).upper() or "KG",
            "to": destination,
            "card": str(card_id) if card_id else None,
            "card_label": card_no or (f"Card {str(card_id)[:8].upper()}" if card_id else None),
            "issued_by": meta.get("issued_by") or meta.get("operator_id"),
            "from_location": _place(locations, txn.location_id),
            "note": meta.get("notes") or meta.get("note"),
            "plant_id": str(txn.plant_id),
        })

    rows.sort(key=lambda row: (row["issued_at"] or row["day"] or "", row["id"]), reverse=True)
    return rows


def _matches(row: dict[str, Any], *, shift: Optional[str], item_id: Optional[str], item: str, card: str, person: str, kind: str) -> bool:
    if kind != "ALL" and row["kind"] != kind:
        return False
    if shift and str(row.get("shift") or "").upper() != shift:
        return False
    if item_id and row["item_id"] != item_id:
        return False
    if item and item not in f"{row['item_code']} {row['item_name']} {row['lot'] or ''} {row['vendor_reel_no'] or ''}".lower():
        return False
    if card and card not in f"{row['card'] or ''} {row['card_label'] or ''} {row['to']}".lower():
        return False
    if person and person not in str(row.get("issued_by") or "").lower():
        return False
    return True


@router.get("")
def issue_history(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    shift: Optional[str] = Query(default=None, max_length=20),
    item_id: Optional[uuid.UUID] = Query(default=None),
    item: Optional[str] = Query(default=None, max_length=120, description="Material code / name or reel / lot number"),
    card: Optional[str] = Query(default=None, max_length=120),
    person: Optional[str] = Query(default=None, max_length=200),
    kind: str = Query(default="ALL"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Issues in the period (business dates, the shift rule's day), filtered; with totals per unit."""
    today = floor_shift_now().business_date
    end = date_to or today
    start = date_from or (end - timedelta(days=6))
    if end < start:
        raise HTTPException(status_code=422, detail="The period ends before it starts. Pick the dates again.")
    if (end - start).days > MAX_DAYS:
        raise HTTPException(status_code=422, detail=f"Pick a period of at most {MAX_DAYS} days.")
    wanted_kind = str(kind or "ALL").strip().upper()
    if wanted_kind not in KINDS:
        raise HTTPException(status_code=422, detail="kind must be ALL, REEL or MATERIAL")
    wanted_shift = str(shift or "").strip().upper().replace("SHIFT_", "").replace("SHIFT ", "") or None
    plants = authorized_plant_ids(plant_scope)
    period = history_rows(db, plants, start, end)
    rows = [
        row for row in period
        if _matches(row, shift=wanted_shift, item_id=str(item_id) if item_id else None, item=str(item or "").strip().lower(),
                    card=str(card or "").strip().lower(), person=str(person or "").strip().lower(), kind=wanted_kind)
    ]
    totals: dict[str, dict[str, Any]] = {}
    for row in rows:
        unit = row["uom"]
        bucket = totals.setdefault(unit, {"uom": unit, "unit": UNIT_WORDS.get(unit, unit.lower()), "qty": 0.0, "count": 0})
        bucket["qty"] = round(bucket["qty"] + float(row["qty"] or 0.0), 3)
        bucket["count"] += 1
    # Everyone who issued in the period (not only the filtered rows), for the person filter.
    people = sorted({str(row["issued_by"]) for row in period if row.get("issued_by")})
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "today": today.isoformat(),
        "count": len(rows),
        "truncated": len(rows) > MAX_ROWS,
        "totals": sorted(totals.values(), key=lambda row: row["uom"]),
        "people": people,
        "rows": rows[:MAX_ROWS],
    }
