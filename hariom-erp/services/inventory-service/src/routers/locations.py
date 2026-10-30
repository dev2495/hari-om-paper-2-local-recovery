from __future__ import annotations

from datetime import datetime
import uuid

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryCertification, InventoryLocation, PaperReel, StockBatch, StockCountLocation
from ..services.locations import default_receiving_location, location_payload_name
from ..services.stock_lots import batch_balances, get_one_plant, entity_qty, location_brief, location_stock, lot_row, plant_uuid, stock_summary_by_location, unit_totals
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, is_actual_owner, require_owner, require_role

router = APIRouter(prefix="/inventory/locations", tags=["inventory-locations"])

# Locations are managed by Store, PlantManager, Owner and Admin (spec 2.8); everyone may view them.
MANAGE_ROLES = ["Store", "PlantManager"]
PURPOSES = {"STORAGE", "WIP", "QC", "DISPATCH", "SCRAP"}
# Goods inward puts stock in the RM store when no rack is chosen, so it must be a place counts look at: a
# store rack or the QC bay, never the floor, a dispatch bay or the scrap area.
RECEIVING_PURPOSES = {"STORAGE", "QC"}
PURPOSE_WORDS = {"WIP": "the production floor", "DISPATCH": "a dispatch bay", "SCRAP": "the scrap area"}


class LocationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=80)
    warehouse: str = Field(min_length=1, max_length=80)
    zone: str | None = Field(default=None, max_length=80)
    bin: str | None = Field(default=None, max_length=80)
    purpose: str = "STORAGE"
    # Plain name shown with the code, e.g. "Paper rack A1" (client 2026-10-28).
    name: str | None = Field(default=None, max_length=120)


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plant_id: uuid.UUID
    code: str
    warehouse: str
    zone: str | None = None
    bin: str | None = None
    purpose: str | None = None
    active: str
    name: str | None = None
    is_receiving_default: bool = False
    updated_by: str | None = None
    updated_at: datetime | None = None
    created_at: datetime


@router.post("", response_model=LocationResponse)
def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(MANAGE_ROLES)),
):
    normalized_purpose = payload.purpose.strip().upper()
    if normalized_purpose not in PURPOSES:
        raise HTTPException(status_code=400, detail="purpose must be STORAGE, WIP, QC, DISPATCH, or SCRAP")
    if normalized_purpose == "WIP":
        # Stock never moves to the floor (it is issued there and used), so a new floor location has no use.
        raise HTTPException(status_code=409, detail="Stock reaches the production floor only through the issue desks, so it is not a location to add. Add a store rack, QC bay, scrap area or dispatch bay.")

    existing = db.query(InventoryLocation).filter(
        InventoryLocation.plant_id == plant_id,
        InventoryLocation.code == payload.code.strip().upper(),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location code already exists in this plant")

    location = InventoryLocation(
        plant_id=plant_id,
        code=payload.code.strip().upper(),
        warehouse=payload.warehouse.strip().upper(),
        zone=(payload.zone or "").strip().upper() or None,
        bin=(payload.bin or "").strip().upper() or None,
        purpose=normalized_purpose,
        name=" ".join((payload.name or "").split()) or None,
        updated_by=_actor(current_user),
        updated_at=datetime.utcnow(),
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.get("", response_model=list[LocationResponse])
def list_locations(
    include_inactive: bool = Query(default=False),
    code: Optional[str] = Query(default=None, max_length=80),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(InventoryLocation)
    if not include_inactive:
        query = query.filter(InventoryLocation.active == "true")
    if code and code.strip():
        query = query.filter(func.upper(InventoryLocation.code) == code.strip().upper())
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(InventoryLocation.plant_id.in_(allowed))
    else:
        query = query.filter(InventoryLocation.plant_id == plant_scope["selected_plant_id"])
    return query.order_by(InventoryLocation.warehouse.asc(), InventoryLocation.zone.asc().nullsfirst(), InventoryLocation.bin.asc().nullsfirst()).all()


def location_rights(current_user: dict) -> dict[str, bool]:
    """What this login may do on the Locations pages (the endpoints check the same rules)."""
    roles = set(current_user.get("roles") or [])
    super_role = bool(roles & {"Owner", "Admin"})
    return {
        "manage": super_role or bool(roles & set(MANAGE_ROLES)),
        "move": super_role or bool(roles & {"Store", "GRN", "RMIssue", "PlantManager", "Dispatch"}),
        "correct": super_role or bool(roles & {"Store", "RMIssue", "GRN", "PlantManager"}),
        "put_away_all": is_actual_owner(current_user),
        "issue": super_role or bool(roles & {"Store", "PlantManager", "RMIssue"}),
        "inspect": super_role or bool(roles & {"QC", "InwardQC", "QualityControl"}),
    }


def _actor(current_user: dict) -> str:
    return str(current_user.get("actor_identity") or current_user.get("actual_sub") or current_user.get("sub") or "system")


def _plant_location(db: Session, plant_id: str, location_id: uuid.UUID) -> InventoryLocation:
    location = db.query(InventoryLocation).filter(
        InventoryLocation.id == location_id, InventoryLocation.plant_id == str(plant_id),
    ).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found in this plant")
    return location


def _location_payload(location: InventoryLocation) -> dict[str, Any]:
    return {
        **LocationResponse.model_validate(location).model_dump(mode="json"),
        "name": str(location.name or "").strip() or location.code,
        "active": location.active == "true",
    }


def _open_counts(db: Session, plant_id: str, location_id: Optional[uuid.UUID]) -> list[dict[str, Any]]:
    """Counts still open (counting or waiting for the Owner) that include this rack."""
    query = db.query(InventoryCertification, StockCountLocation).join(
        StockCountLocation, StockCountLocation.count_id == InventoryCertification.id,
    ).filter(
        InventoryCertification.plant_id == str(plant_id),
        InventoryCertification.status.in_(["DRAFT", "SUBMITTED"]),
    )
    query = query.filter(StockCountLocation.location_id == location_id) if location_id else query.filter(StockCountLocation.bucket == "UNASSIGNED")
    return [
        {
            "id": str(count.id), "count_no": count.count_session_no, "kind": count.kind, "status": count.status,
            "month": count.month.isoformat() if count.month else None,
            "rack_status": rack.status, "counted_by": rack.counted_by,
        }
        for count, rack in query.order_by(InventoryCertification.created_at.desc()).all()
    ]


def _last_counted(db: Session, plant_id: str) -> dict[str, dict[str, Any]]:
    """Per location: when its rack was last marked done in a count that is not cancelled, and whether that
    count is approved yet (a count still with the store or the Owner says so, not "Last counted")."""
    rows = db.query(StockCountLocation.location_id, StockCountLocation.done_at, InventoryCertification.status).join(
        InventoryCertification, InventoryCertification.id == StockCountLocation.count_id,
    ).filter(
        StockCountLocation.plant_id == str(plant_id),
        StockCountLocation.status == "DONE",
        InventoryCertification.status != "CANCELLED",
        StockCountLocation.location_id.isnot(None),
        StockCountLocation.done_at.isnot(None),
    ).order_by(StockCountLocation.done_at.desc()).all()
    out: dict[str, dict[str, Any]] = {}
    for location_id, done_at, status in rows:
        out.setdefault(str(location_id), {"at": done_at.isoformat(), "approved": str(status) in {"APPROVED", "CERTIFIED"}})
    return out


@router.get("/overview")
def locations_overview(
    include_inactive: bool = Query(default=True),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """The Locations page: every location with what is on it, plus stock not in any location yet."""
    summary = stock_summary_by_location(db, plant_id)
    last = _last_counted(db, plant_id)
    query = db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id))
    if not include_inactive:
        query = query.filter(InventoryLocation.active == "true")
    empty = {"reels": 0, "lots": 0, "held": 0, "totals": []}
    items = [
        {**_location_payload(row), "stock": summary.get(str(row.id), empty), "last_counted_at": (last.get(str(row.id)) or {}).get("at"),
         "last_count_approved": bool((last.get(str(row.id)) or {}).get("approved"))}
        # The receiving default (RM store) first: it is where goods inward lands.
        # Active first: ``active`` is a "true"/"false" enum that sorts "true" before "false", so it is compared as a flag.
        for row in query.order_by((InventoryLocation.active == "true").desc(), InventoryLocation.is_receiving_default.desc(), InventoryLocation.code.asc()).all()
    ]
    open_counts = db.query(InventoryCertification.id).filter(
        InventoryCertification.plant_id == str(plant_id), InventoryCertification.status.in_(["DRAFT", "SUBMITTED"]),
    ).count()
    unassigned = summary.get(None, empty)
    # The Owner's "put all in the RM store" moves materials only; finished goods go to dispatch bays.
    materials = stock_summary_by_location(db, plant_id, materials_only=True).get(None, empty) if unassigned["lots"] or unassigned["reels"] else empty
    return {
        "plant_id": str(plant_id), "items": items, "unassigned": unassigned,
        "unassigned_materials": materials, "unassigned_finished_lots": max(0, unassigned["lots"] - materials["lots"]),
        "open_count_total": open_counts, "can": location_rights(current_user),
    }


@router.get("/unassigned")
def unassigned_stock(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Stock in store that is not in any location yet (put it away by scanning the rack, then the lots)."""
    stock = location_stock(db, plant_id, None)
    return {**stock, "totals": unit_totals([*stock["reels"], *stock["lots"]])}


class PutAwayAllPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_location_id: uuid.UUID | None = None


def _reels_and_lots(reels: int, lots: int) -> str:
    """'2 reels and 1 lot', '1 lot', '3 reels' — plain words with the right plural for each part."""
    parts = [f"{reels} reel{'s' if reels != 1 else ''}" if reels else "", f"{lots} lot{'s' if lots != 1 else ''}" if lots else ""]
    return " and ".join(part for part in parts if part) or "Nothing"


@router.post("/put-away-all")
def put_away_all_unassigned(
    payload: PutAwayAllPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_owner),
):
    """Owner only: put every material reel and lot that has no location into the RM store (or a chosen rack)."""
    from .stock_moves import _target_location, apply_move

    target = _target_location(db, plant_id, payload.to_location_id) if payload.to_location_id else default_receiving_location(db, plant_id, actor=_actor(current_user))
    stock = location_stock(db, plant_id, None, materials_only=True)
    actor = _actor(current_user)
    moved = 0
    for row in stock["reels"]:
        reel = db.get(PaperReel, uuid.UUID(row["id"]))
        apply_move(db, plant_id=plant_id, entity_type="REEL", entity=reel, location=target, actor=actor, source="PUT_AWAY_ALL")
        moved += 1
    for row in stock["lots"]:
        batch = db.get(StockBatch, uuid.UUID(row["id"]))
        apply_move(db, plant_id=plant_id, entity_type="BATCH", entity=batch, location=target, actor=actor, source="PUT_AWAY_ALL")
        moved += 1
    db.commit()
    return {
        "moved": moved, "reels": len(stock["reels"]), "lots": len(stock["lots"]), "to": location_brief(target),
        "message": f"{_reels_and_lots(len(stock['reels']), len(stock['lots']))} put in {location_payload_name(target)}." if moved else "Nothing was left without a location.",
    }


@router.get("/lots")
def lots_for_labels(
    ids: str = Query(..., max_length=4000, description="Comma-separated reel / lot ids"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Reels and lots of this plant by id, for printing their labels (e.g. new lots made by a count)."""
    from ..models import ItemMaster

    wanted: list[uuid.UUID] = []
    for raw in ids.split(","):
        try:
            wanted.append(uuid.UUID(raw.strip()))
        except ValueError:
            continue
    wanted = wanted[:60]
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}
    reels = db.query(PaperReel).filter(PaperReel.id.in_(wanted), PaperReel.plant_id == plant_uuid(plant_id)).all() if wanted else []
    batches = db.query(StockBatch).filter(StockBatch.id.in_(wanted), StockBatch.plant_id == str(plant_id)).all() if wanted else []
    balances = batch_balances(db, [batch.id for batch in batches])
    item_ids = {reel.paper_id for reel in reels} | {batch.item_id for batch in batches}
    items = {str(row.id): row for row in db.query(ItemMaster).filter(ItemMaster.id.in_(item_ids)).all()} if item_ids else {}
    from ..services.labels import reel_label_facts

    # A reel / coil label carries the readable lines too (client 2026-10-30): QC averages, else "(spec)".
    rows = [{**lot_row(reel, items.get(str(reel.paper_id)), entity_qty(db, "REEL", reel), locations=locations),
             **reel_label_facts(db, reel, items.get(str(reel.paper_id)))} for reel in reels]
    rows += [lot_row(batch, items.get(str(batch.item_id)), balances.get(str(batch.id), 0.0), locations=locations) for batch in batches]
    order = {str(value): index for index, value in enumerate(wanted)}
    rows.sort(key=lambda row: order.get(row["id"], 0))
    return {"plant_id": str(plant_id), "items": rows, "can": location_rights(current_user)}


@router.get("/{location_id}")
def get_location(
    location_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Where a rack QR lands: the location, what is on it (with QC state) and the counts that include it."""
    location = _plant_location(db, plant_id, location_id)
    stock = location_stock(db, plant_id, location.id)
    last = _last_counted(db, plant_id).get(str(location.id)) or {}
    return {
        "location": _location_payload(location),
        "stock": stock,
        "totals": unit_totals([*stock["reels"], *stock["lots"]]),
        "open_counts": _open_counts(db, plant_id, location.id),
        "last_counted_at": last.get("at"),
        "last_count_approved": bool(last.get("approved")),
        "can": location_rights(current_user),
    }


class LocationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str | None = Field(default=None, min_length=1, max_length=80)
    name: str | None = Field(default=None, max_length=120)
    warehouse: str | None = Field(default=None, min_length=1, max_length=80)
    zone: str | None = Field(default=None, max_length=80)
    bin: str | None = Field(default=None, max_length=80)
    purpose: str | None = None
    active: bool | None = None
    is_receiving_default: bool | None = None


@router.patch("/{location_id}")
def update_location(
    location_id: uuid.UUID,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(MANAGE_ROLES)),
):
    """Edit, switch off / on, or make the receiving default. A location holding stock, or the RM store,
    cannot be switched off; locations are never deleted."""
    location = _plant_location(db, plant_id, location_id)
    fields = payload.model_dump(exclude_unset=True)
    if "code" in fields and fields["code"]:
        code = fields["code"].strip().upper()
        clash = db.query(InventoryLocation.id).filter(
            InventoryLocation.plant_id == str(plant_id), func.upper(InventoryLocation.code) == code, InventoryLocation.id != location.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"{code} is already used by another location in this plant.")
        location.code = code
    if "name" in fields:
        location.name = " ".join((fields["name"] or "").split()) or None
    if fields.get("warehouse"):
        location.warehouse = fields["warehouse"].strip().upper()
    if "zone" in fields:
        location.zone = (fields["zone"] or "").strip().upper() or None
    if "bin" in fields:
        location.bin = (fields["bin"] or "").strip().upper() or None
    if fields.get("purpose"):
        purpose = fields["purpose"].strip().upper()
        if purpose not in PURPOSES:
            raise HTTPException(status_code=400, detail="purpose must be STORAGE, WIP, QC, DISPATCH, or SCRAP")
        if purpose not in RECEIVING_PURPOSES and location.is_receiving_default:
            raise HTTPException(status_code=409, detail=f"{location.code} is the RM store, where goods inward puts stock, so it cannot be {PURPOSE_WORDS.get(purpose, 'that')}. Make another store rack the RM store first.")
        if purpose != str(location.purpose or "").upper() and purpose in {"WIP", "DISPATCH"}:
            # Material on a floor or dispatch-bay location would drop out of every count while the book
            # still holds it; finished goods may sit in a dispatch bay.
            stock = location_stock(db, plant_id, location.id, materials_only=purpose == "DISPATCH")
            held = len(stock["reels"]) + len(stock["lots"])
            if held:
                what = "the production floor" if purpose == "WIP" else "a dispatch bay"
                raise HTTPException(status_code=409, detail=f"{location.code} holds {held} reel{'s' if held != 1 else ''} or lot{'s' if held != 1 else ''} of {'stock' if purpose == 'WIP' else 'material'}. Move them to a store rack before making it {what}.")
        location.purpose = purpose
    if fields.get("active") is False and location.active == "true":
        if location.is_receiving_default:
            raise HTTPException(status_code=409, detail=f"{location.code} is where goods inward puts stock. Make another location the RM store first.")
        stock = location_stock(db, plant_id, location.id)
        held = len(stock["reels"]) + len(stock["lots"])
        if held:
            raise HTTPException(status_code=409, detail=f"{location.code} still holds {held} reel{'s' if held != 1 else ''} or lot{'s' if held != 1 else ''}. Move them out before switching it off.")
        location.active = "false"
    elif fields.get("active") is True:
        location.active = "true"
    if fields.get("is_receiving_default") is True and not location.is_receiving_default:
        if location.active != "true" or (str(location.purpose or "STORAGE").upper() or "STORAGE") not in RECEIVING_PURPOSES:
            raise HTTPException(status_code=409, detail="Only an active store rack or QC bay can be the RM store, never the floor, a dispatch bay or the scrap area.")
        db.query(InventoryLocation).filter(
            InventoryLocation.plant_id == str(plant_id), InventoryLocation.is_receiving_default.is_(True),
        ).update({InventoryLocation.is_receiving_default: False}, synchronize_session="fetch")
        db.flush()
        location.is_receiving_default = True
    elif fields.get("is_receiving_default") is False and location.is_receiving_default:
        raise HTTPException(status_code=409, detail="Every plant needs one RM store. Make another location the RM store instead.")
    location.updated_by = _actor(current_user)
    location.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(location)
    return _location_payload(location)
