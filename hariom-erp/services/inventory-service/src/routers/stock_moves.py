from __future__ import annotations

from datetime import datetime, timedelta
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..concession_use import guard_concession_stock
from ..database import get_db
from ..models import (
    InventoryLocation,
    PaperReel,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TransactionType,
)
from ..services import get_batch_balance
from ..services.books import assert_books_open
from ..services.stock_calc import validate_batch_sufficient_stock
from ..services.stock_lots import entity_qty, get_one_plant, location_brief, lot_row, plant_uuid, resolve_lot
from ..services.wip_movement import build_wip_issue_transactions
from ..utils.auth import SUPER_ROLES, get_current_plant, get_current_user, require_role

router = APIRouter(prefix="/inventory/stock-moves", tags=["inventory-stock-moves"])

STOCK_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}
HELD_STOCK_STATUSES = {"QC_HOLD", "BLOCKED", "SCRAP", "CONCESSION"}
# Who may move stock between places (spec 2.8); Dispatch moves finished goods only.
MOVE_ROLES = ["Store", "GRN", "RMIssue", "PlantManager", "Dispatch"]
FLOOR_REFUSAL = "Already used up or on the floor. Nothing comes back from the floor."
# A move changes only the place (spec 2.7: location never changes QC status). The one status change this
# endpoint still makes is production's server-to-server release of a finished-goods QC hold: QC_HOLD ->
# UNRESTRICTED on a finished-goods lot, keyed "QC-REL-<hold id>", made by someone who may release holds.
# The browser proxy (BFF) never forwards a status.
QC_RELEASE_REF = "QC-REL-"
QC_RELEASE_ROLES = {"PlantManager", "QC", "InProcessQC", "InwardQC", "QualityControl"}
STATUS_REFUSAL = "A move changes only the place. QC status changes only through QC."


def _reject_held_status_escape(current: str | None, requested: str | None, entity: str) -> None:
    current_status = str(current or "").upper()
    next_status = str(requested or current_status).upper()
    if current_status in HELD_STOCK_STATUSES and next_status != current_status:
        raise HTTPException(
            status_code=400,
            detail=f"{entity} is not movable off {current_status} via stock move",
        )


class StockMoveCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str
    entity_id: uuid.UUID
    to_location_id: uuid.UUID | None = None
    stock_status: str | None = None
    reason: str | None = Field(default=None, max_length=500)
    external_ref: str | None = Field(default=None, max_length=120)

    @field_validator("entity_type")
    @classmethod
    def validate_entity_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"BATCH", "REEL"}:
            raise ValueError("entity_type must be BATCH or REEL")
        return normalized

    @field_validator("stock_status")
    @classmethod
    def validate_stock_status(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized


class StockMoveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str
    entity_id: uuid.UUID
    to_location_id: uuid.UUID | None = None
    stock_status: str
    recorded_at: datetime
    transaction_id: uuid.UUID | None = None


class WipIssueCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: uuid.UUID
    batch_id: uuid.UUID
    qty: float = Field(gt=0)
    job_card_id: uuid.UUID
    stage: str = Field(default="WINDER", max_length=40)
    wip_location_id: uuid.UUID | None = None
    external_ref: str | None = Field(default=None, max_length=100)
    customer_id: uuid.UUID | None = None
    sales_order_id: uuid.UUID | None = None

    @field_validator("stage")
    @classmethod
    def validate_stage(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING"}:
            raise ValueError("stage must be SLITTING, WINDER, OVEN, PROCESS, or PACKING")
        return normalized


class WipIssueResponse(BaseModel):
    item_id: uuid.UUID
    batch_id: uuid.UUID
    job_card_id: uuid.UUID
    qty_issued_to_wip: float
    stage: str
    wip_location_id: uuid.UUID | None
    store_transaction_id: uuid.UUID
    wip_transaction_id: uuid.UUID
    batch_balance: float
    message: str


@router.post("/wip-issue", response_model=WipIssueResponse)
def issue_batch_to_wip(
    payload: WipIssueCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Production", "RMIssue"])),
):
    batch = db.query(StockBatch).filter(
        StockBatch.id == payload.batch_id,
        StockBatch.item_id == payload.item_id,
        StockBatch.plant_id == plant_id,
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    guard_concession_stock(
        db,
        plant_id=plant_id,
        entity=batch,
        customer_id=payload.customer_id,
        sales_order_id=payload.sales_order_id,
        allowed_statuses={"UNRESTRICTED", "WIP"},
        blocked_detail=f"Batch is not issuable to WIP ({batch.stock_status})",
    )
    if not validate_batch_sufficient_stock(str(batch.id), payload.qty, db):
        raise HTTPException(status_code=400, detail="Insufficient batch stock for WIP issue")

    wip_location_id = payload.wip_location_id
    if wip_location_id:
        location = db.query(InventoryLocation).filter(
            InventoryLocation.id == wip_location_id,
            InventoryLocation.plant_id == plant_id,
        ).first()
        if not location:
            raise HTTPException(status_code=404, detail="WIP location not found")

    if payload.external_ref:
        existing = db.query(StockTransaction).filter(
            StockTransaction.external_ref == f"{payload.external_ref}:WIP",
            StockTransaction.plant_id == plant_id,
        ).first()
        if existing:
            store_existing = db.query(StockTransaction).filter(
                StockTransaction.external_ref == f"{payload.external_ref}:STORE",
                StockTransaction.plant_id == plant_id,
            ).first()
            return WipIssueResponse(
                item_id=payload.item_id,
                batch_id=payload.batch_id,
                job_card_id=payload.job_card_id,
                qty_issued_to_wip=abs(float(existing.qty_change or 0.0)),
                stage=payload.stage,
                wip_location_id=existing.location_id,
                store_transaction_id=store_existing.id if store_existing else existing.id,
                wip_transaction_id=existing.id,
                batch_balance=get_batch_balance(str(batch.id), db),
                message="WIP issue already posted (idempotent)",
            )

    # A WIP issue is a store issue dated now, so a closed month refuses it like every other issue.
    assert_books_open(db, plant_id, None)
    txns = build_wip_issue_transactions(
        item_id=payload.item_id,
        batch_id=payload.batch_id,
        qty=payload.qty,
        job_card_id=payload.job_card_id,
        plant_id=plant_id,
        from_location_id=batch.location_id,
        wip_location_id=wip_location_id,
        stage=payload.stage,
        operator_id=str(current_user.get("sub") or current_user.get("actor_identity") or ""),
        external_ref=payload.external_ref,
    )
    for txn in txns:
        db.add(txn)
    db.commit()
    for txn in txns:
        db.refresh(txn)

    return WipIssueResponse(
        item_id=payload.item_id,
        batch_id=payload.batch_id,
        job_card_id=payload.job_card_id,
        qty_issued_to_wip=payload.qty,
        stage=payload.stage,
        wip_location_id=wip_location_id,
        store_transaction_id=txns[0].id,
        wip_transaction_id=txns[1].id,
        batch_balance=get_batch_balance(str(batch.id), db),
        message=f"Issued {payload.qty} to WIP for {payload.stage}",
    )


def _is_qc_release(payload: StockMoveCreate, current_user: dict, entity_type: str, entity: Any) -> bool:
    """Production's FG hold release (server to server): QC_HOLD -> UNRESTRICTED of a finished-goods lot."""
    if entity_type != "BATCH" or not str(payload.external_ref or "").startswith(QC_RELEASE_REF):
        return False
    if str(entity.stock_status or "").upper() != "QC_HOLD" or payload.stock_status != "UNRESTRICTED":
        return False
    item = getattr(entity, "item", None)
    if str(getattr(getattr(item, "type", None), "value", getattr(item, "type", "")) or "") != "FINISHED_GOOD":
        return False
    roles = set(current_user.get("roles") or [])
    return bool(roles & (SUPER_ROLES | QC_RELEASE_ROLES))


def _check_move_rights(current_user: dict, release: bool) -> None:
    roles = set(current_user.get("roles") or [])
    if roles & SUPER_ROLES or roles & set(MOVE_ROLES) or release:
        return
    raise HTTPException(status_code=403, detail="Operation not permitted for your role")


def _refuse_status_change(current: Optional[str], requested: Optional[str], entity: str) -> None:
    """Held stock keeps its hold (400, as before); any other status change by a move is refused too."""
    _reject_held_status_escape(current, requested, entity)
    if requested and requested != str(current or "").upper():
        raise HTTPException(status_code=409, detail=STATUS_REFUSAL)


@router.post("", response_model=StockMoveResponse)
def create_stock_move(
    payload: StockMoveCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Move one reel or lot to another place in the store. Only the place changes.

    Moves never touch the floor: no WIP target, nothing issued or consumed, and a lot that is used up or
    issued cannot be moved. A held lot may move but stays held. From, to and who are recorded. The one
    status change kept is production's FG hold release, server to server (see QC_RELEASE_REF).
    """
    location = _target_location(db, plant_id, payload.to_location_id) if payload.to_location_id else None

    if payload.entity_type == "BATCH":
        batch = db.query(StockBatch).filter(
            StockBatch.id == payload.entity_id,
            StockBatch.plant_id == plant_id,
        ).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if payload.external_ref:
            existing = db.query(StockTransaction).filter(
                StockTransaction.external_ref == payload.external_ref,
                StockTransaction.plant_id == plant_id,
            ).first()
            if existing:
                return StockMoveResponse(
                    entity_type="BATCH",
                    entity_id=batch.id,
                    to_location_id=existing.location_id,
                    stock_status=existing.stock_status,
                    recorded_at=existing.created_at,
                    transaction_id=existing.id,
                )
        release = _is_qc_release(payload, current_user, "BATCH", batch)
        _check_move_rights(current_user, release)
        if not release:
            _refuse_status_change(batch.stock_status, payload.stock_status, "Batch")
            _guard_movable(db, current_user, "BATCH", batch)
            _guard_target_for(location, "BATCH", batch)
        txn = apply_move(
            db, plant_id=plant_id, entity_type="BATCH", entity=batch, location=location, actor=_actor(current_user),
            source="MOVE", reason=payload.reason, ref=payload.external_ref, stock_status=payload.stock_status,
            keep_location=location is None,
        )
        db.commit()
        db.refresh(txn)
        return StockMoveResponse(
            entity_type="BATCH",
            entity_id=batch.id,
            to_location_id=batch.location_id,
            stock_status=batch.stock_status,
            recorded_at=txn.created_at,
            transaction_id=txn.id,
        )

    reel = db.query(PaperReel).filter(
        PaperReel.id == payload.entity_id,
        PaperReel.plant_id == plant_id,
    ).first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")

    _check_move_rights(current_user, False)
    _refuse_status_change(reel.stock_status, payload.stock_status, "Reel")
    _guard_movable(db, current_user, "REEL", reel)
    _guard_target_for(location, "REEL", reel)
    event = apply_move(
        db, plant_id=plant_id, entity_type="REEL", entity=reel, location=location, actor=_actor(current_user),
        source="MOVE", reason=payload.reason, ref=payload.external_ref, stock_status=payload.stock_status,
        keep_location=location is None,
    )
    db.commit()
    db.refresh(event)
    return StockMoveResponse(
        entity_type="REEL",
        entity_id=reel.id,
        to_location_id=reel.location_id,
        stock_status=reel.stock_status,
        recorded_at=event.timestamp,
        transaction_id=None,
    )


def _actor(current_user: dict) -> str:
    return str(current_user.get("actor_identity") or current_user.get("actual_sub") or current_user.get("sub") or "system")


def _target_location(db: Session, plant_id: str, location_id: Any) -> InventoryLocation:
    location = db.query(InventoryLocation).filter(
        InventoryLocation.id == location_id,
        InventoryLocation.plant_id == plant_id,
    ).first()
    if not location:
        raise HTTPException(status_code=404, detail="Target location not found")
    if location.active != "true":
        raise HTTPException(status_code=409, detail=f"{location.code} is switched off. Choose an active location.")
    if str(location.purpose or "").upper() == "WIP":
        raise HTTPException(status_code=409, detail=f"{location.code} is the production floor. Stock goes to the floor only through the issue desks.")
    return location


def _is_finished_good(entity_type: str, entity: Any) -> bool:
    if entity_type != "BATCH":
        return False
    item = getattr(entity, "item", None)
    return str(getattr(getattr(item, "type", None), "value", getattr(item, "type", "")) or "") == "FINISHED_GOOD"


def _guard_target_for(location: Optional[InventoryLocation], entity_type: str, entity: Any) -> None:
    """Material never goes to a dispatch bay: a count covers store racks, and the bay is for finished goods."""
    if location is not None and str(location.purpose or "").upper() == "DISPATCH" and not _is_finished_good(entity_type, entity):
        raise HTTPException(status_code=409, detail=f"{location.code} is a dispatch bay, for finished goods only. Put material on a store rack.")


def _guard_movable(db: Session, current_user: dict, entity_type: str, entity: Any) -> None:
    """Only stock still in the store moves; Dispatch (without a store role) moves finished goods only."""
    status = str(entity.stock_status or "").upper()
    if status in {"RETURNED", "WIP"} or entity_qty(db, entity_type, entity) <= 0.0005:
        raise HTTPException(status_code=409, detail=FLOOR_REFUSAL)
    roles = set(current_user.get("roles") or [])
    if roles & SUPER_ROLES or roles & {"Store", "GRN", "RMIssue", "PlantManager"}:
        return
    item_type = ""
    if entity_type == "BATCH":
        item = getattr(entity, "item", None)
        item_type = str(getattr(getattr(item, "type", None), "value", getattr(item, "type", "")) or "")
    if item_type != "FINISHED_GOOD":
        raise HTTPException(status_code=403, detail="Dispatch moves finished goods only. Ask the store to move materials.")


def apply_move(
    db: Session,
    *,
    plant_id: str,
    entity_type: str,
    entity: Any,
    location: Optional[InventoryLocation],
    actor: str,
    source: str,
    reason: Optional[str] = None,
    ref: Optional[str] = None,
    stock_status: Optional[str] = None,
    keep_location: bool = False,
    extra: Optional[dict[str, Any]] = None,
):
    """Put a reel or lot at ``location`` (None = no location) and record from, to, who, when.

    Quantity never changes: a lot gets a MOVE ledger row of 0, a reel a MOVE_SCAN event. Used by scan
    moves, put-away, count approval (wrong place) and server-to-server status moves.
    """
    from_id = entity.location_id
    from_location = db.get(InventoryLocation, from_id) if from_id else None
    if not keep_location:
        entity.location_id = location.id if location else None
    if entity_type == "BATCH" and not keep_location:
        entity.location = location.code if location else None
    entity.stock_status = stock_status or entity.stock_status
    metadata = {
        "source": source,
        "from_location_id": str(from_id) if from_id else None,
        "from_location_code": from_location.code if from_location else None,
        "to_location_id": str(entity.location_id) if entity.location_id else None,
        "to_location_code": location.code if location else (from_location.code if keep_location and from_location else None),
        "actor": actor,
        "moved_at": datetime.utcnow().isoformat(),
        "stock_status": entity.stock_status,
        "reason": reason,
        "external_ref": ref,
        **(extra or {}),
    }
    if entity_type == "BATCH":
        txn = StockTransaction(
            item_id=entity.item_id,
            batch_id=entity.id,
            transaction_type=TransactionType.MOVE,
            qty_change=0.0,
            reference_type=ReferenceType.INTERNAL,
            reference_id=entity.id,
            plant_id=str(plant_id),
            location_id=entity.location_id,
            stock_status=entity.stock_status,
            movement_metadata={**metadata, "balance_after": get_batch_balance(str(entity.id), db)},
            external_ref=ref,
        )
        db.add(txn)
        db.flush()
        return txn
    event = ReelScanEvent(
        plant_id=plant_uuid(plant_id),
        reel_id=entity.id,
        event_type=ReelScanEventType.MOVE_SCAN,
        source=ReelScanSource.INVENTORY,
        operator_id=None,
        event_metadata=metadata,
    )
    db.add(event)
    db.flush()
    return event


class ScanMovePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_location_id: uuid.UUID
    code: str = Field(min_length=1, max_length=500)
    client_ref: str = Field(min_length=4, max_length=80)
    reason: str | None = Field(default=None, max_length=300)


class ScanMoveUndoPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_ref: str = Field(min_length=4, max_length=80)


def _scan_ref(client_ref: str) -> str:
    return f"SCANMOVE:{client_ref.strip()}"[:120]


def _find_scan_move(db: Session, plant_id: str, ref: str, *, reel_id: Any = None):
    """The batch MOVE row or reel MOVE_SCAN event a scan move wrote under ``ref`` (idempotency / undo)."""
    txn = db.query(StockTransaction).filter(StockTransaction.external_ref == ref, StockTransaction.plant_id == str(plant_id)).first()
    if txn is not None:
        return "BATCH", txn
    query = db.query(ReelScanEvent).filter(
        ReelScanEvent.plant_id == plant_uuid(plant_id),
        ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN,
    )
    query = query.filter(ReelScanEvent.reel_id == reel_id) if reel_id else query.filter(ReelScanEvent.timestamp >= datetime.utcnow() - timedelta(days=2))
    for event in query.order_by(ReelScanEvent.timestamp.desc()).limit(500).all():
        if (event.event_metadata or {}).get("external_ref") == ref:
            return "REEL", event
    return None, None


def _move_result(db: Session, plant_id: str, entity_type: str, entity: Any, item: Any, *, moved: bool, from_location: Any, to_location: Any, ref: str, message: str) -> dict[str, Any]:
    return {
        "moved": moved,
        "already_here": not moved,
        "client_ref": ref.split(":", 1)[-1],
        "lot": lot_row(entity, item, entity_qty(db, entity_type, entity)),
        "from": location_brief(from_location),
        "to": location_brief(to_location),
        "held": str(entity.stock_status or "") in {"QC_HOLD", "BLOCKED"},
        "message": message,
    }


@router.post("/scan")
def scan_move(
    payload: ScanMovePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(MOVE_ROLES)),
):
    """Phone move / put-away: a scanned reel or lot label goes to the scanned rack (spec 2.7).

    Idempotent on ``client_ref`` (a retried scan does not move twice). Refuses floor stock, the floor as
    a target and another plant's label in plain words. A held lot moves but stays held.
    """
    target = _target_location(db, plant_id, payload.to_location_id)
    found = resolve_lot(db, plant_id, payload.code)
    entity_type, entity, item = found["entity_type"], found["entity"], found["item"]
    ref = _scan_ref(payload.client_ref)
    kind, previous = _find_scan_move(db, plant_id, ref, reel_id=entity.id if entity_type == "REEL" else None)
    if previous is not None:
        meta = (previous.movement_metadata if kind == "BATCH" else previous.event_metadata) or {}
        from_location = db.get(InventoryLocation, uuid.UUID(meta["from_location_id"])) if meta.get("from_location_id") else None
        return _move_result(db, plant_id, entity_type, entity, item, moved=True, from_location=from_location, to_location=target, ref=ref, message="Already moved.")
    _guard_movable(db, current_user, entity_type, entity)
    _guard_target_for(target, entity_type, entity)
    if entity.location_id == target.id:
        return _move_result(db, plant_id, entity_type, entity, item, moved=False, from_location=target, to_location=target, ref=ref, message=f"{found['code']} is already here.")
    from_location = db.get(InventoryLocation, entity.location_id) if entity.location_id else None
    apply_move(db, plant_id=plant_id, entity_type=entity_type, entity=entity, location=target, actor=_actor(current_user),
               source="SCAN_MOVE", reason=payload.reason, ref=ref, extra={"client_ref": payload.client_ref})
    db.commit()
    held = " It stays on QC hold." if str(entity.stock_status or "") in {"QC_HOLD", "BLOCKED"} else ""
    return _move_result(
        db, plant_id, entity_type, entity, item, moved=True, from_location=from_location, to_location=target, ref=ref,
        message=f"{found['code']} moved {'from ' + from_location.code + ' ' if from_location else ''}to {target.code}.{held}",
    )


@router.post("/scan/undo")
def undo_scan_move(
    payload: ScanMoveUndoPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(MOVE_ROLES)),
):
    """Put a scan-moved lot back where it was, if nothing has moved it since."""
    ref = _scan_ref(payload.client_ref)
    undo_ref = f"SCANMOVE-UNDO:{payload.client_ref.strip()}"[:120]
    kind, record = _find_scan_move(db, plant_id, ref)
    if record is None:
        raise HTTPException(status_code=404, detail="That move was not found.")
    meta = (record.movement_metadata if kind == "BATCH" else record.event_metadata) or {}
    entity = db.get(StockBatch, record.batch_id) if kind == "BATCH" else db.get(PaperReel, record.reel_id)
    to_id = meta.get("to_location_id")
    back_kind, done = _find_scan_move(db, plant_id, undo_ref, reel_id=entity.id if kind == "REEL" else None)
    if done is not None:
        return {"undone": True, "message": "Already put back."}
    if str(entity.location_id or "") != str(to_id or ""):
        raise HTTPException(status_code=409, detail="It has been moved again since, so it was not put back.")
    # An undo is a move like any other: a reel or lot issued since stays where it was used up, so the
    # count's "used during the count" check still finds it on the rack it left (spec 0.1, 2.3).
    _guard_movable(db, current_user, kind, entity)
    back = db.get(InventoryLocation, uuid.UUID(meta["from_location_id"])) if meta.get("from_location_id") else None
    if back is not None and back.active != "true":
        raise HTTPException(status_code=409, detail=f"{back.code} is switched off, so it was not put back. Move it to an active rack.")
    apply_move(db, plant_id=plant_id, entity_type=kind, entity=entity, location=back, actor=_actor(current_user),
               source="SCAN_MOVE_UNDO", ref=undo_ref, extra={"undo_of": payload.client_ref})
    db.commit()
    return {"undone": True, "message": f"Put back {'to ' + back.code if back else 'as not in any location'}."}
