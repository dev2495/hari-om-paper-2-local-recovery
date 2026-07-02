from datetime import date, datetime
import logging
import re
from typing import Any, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation, ItemMaster, PaperReel, ReferenceType, StockBatch, StockTransaction, TrackingMode, TransactionType
from ..services import get_batch_balance, get_item_balance
from ..services.labels import batch_label_payload
from ..utils.audit_client import emit_audit_event
from ..utils.auth import require_role, get_current_plant, get_current_plant_scope, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inward", tags=["inward"])


def _clean_batch_token(value: Optional[str]) -> str:
    token = re.sub(r"[^A-Z0-9]+", "-", (value or "").strip().upper()).strip("-")
    return token[:32] or "ITEM"


def _next_system_batch_no(db: Session, item: ItemMaster, plant_id: str) -> str:
    date_part = datetime.utcnow().strftime("%y%m%d")
    item_token = _clean_batch_token(item.item_code or item.name)
    prefix = f"RM-{item_token}-{date_part}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        exists = db.query(StockBatch.id).filter(
            StockBatch.plant_id == plant_id,
            StockBatch.batch_no == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate batch number")


def _ensure_unique_batch_no(db: Session, plant_id: str, batch_no: str) -> None:
    existing_batch = db.query(StockBatch.id).filter(
        StockBatch.plant_id == plant_id,
        StockBatch.batch_no == batch_no,
    ).first()
    if existing_batch:
        raise HTTPException(status_code=409, detail="Amigo/batch number already exists in this plant")


class InwardCreate(BaseModel):
    item_id: uuid.UUID
    batch_no: Optional[str] = Field(default=None, max_length=100)
    amigo_no: Optional[str] = Field(default=None, max_length=100)
    qty: float = Field(gt=0)
    supplier_id: uuid.UUID
    supplier_name: str = Field(min_length=1, max_length=200)
    unit_cost: Optional[float] = Field(default=None, ge=0)
    cost_source: Optional[str] = None
    location: Optional[str] = None
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "QC_HOLD"
    reference_type: str = "PURCHASE"
    reference_id: Optional[uuid.UUID] = None
    spec_id: Optional[uuid.UUID] = None
    external_ref: Optional[str] = None
    effective_date: Optional[date] = None
    material_form: Optional[str] = Field(default=None, max_length=40)
    product: Optional[str] = Field(default=None, max_length=120)
    item_name_snapshot: Optional[str] = Field(default=None, max_length=200)
    tank_no: Optional[str] = Field(default=None, max_length=80)
    po_no: Optional[str] = Field(default=None, max_length=80)
    bill_no: Optional[str] = Field(default=None, max_length=120)
    bill_date: Optional[date] = None
    rate: Optional[float] = Field(default=None, ge=0)
    weight_out: Optional[float] = Field(default=None, ge=0)
    wastage: Optional[float] = Field(default=None, ge=0)
    color: Optional[str] = Field(default=None, max_length=120)
    thickness: Optional[str] = Field(default=None, max_length=80)
    pattern_code: Optional[str] = Field(default=None, max_length=120)
    inward_metadata: Optional[dict[str, Any]] = None

    @field_validator("supplier_name")
    @classmethod
    def normalize_supplier_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("vendor is required")
        return cleaned

    @field_validator("cost_source")
    @classmethod
    def normalize_cost_source(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().upper()
        if normalized not in {"MANUAL", "SUPPLIER", "AVG_BATCH"}:
            raise ValueError("cost_source must be MANUAL, SUPPLIER, or AVG_BATCH")
        return normalized

    @field_validator("amigo_no", "batch_no", "material_form", "product", "item_name_snapshot", "tank_no", "po_no", "bill_no", "color", "thickness", "pattern_code")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None


class InwardResponse(BaseModel):
    batch_id: uuid.UUID
    transaction_id: uuid.UUID
    item_id: uuid.UUID
    batch_no: str
    qty_received: float
    item_balance: float
    batch_balance: float
    message: str
    label: Optional[dict[str, Any]] = None


def _plant_filters(plant_scope: dict) -> tuple[list[str], list[uuid.UUID]]:
    if plant_scope.get("scope_all"):
        plant_strings = [str(value) for value in (plant_scope.get("allowed_plants") or [])]
    else:
        plant_strings = [str(plant_scope.get("selected_plant_id") or "PLANT_A")]
    plant_uuids: list[uuid.UUID] = []
    for value in plant_strings:
        try:
            plant_uuids.append(uuid.UUID(str(value)))
        except ValueError:
            continue
    return plant_strings, plant_uuids


def _issued_date_for_reel(reel: PaperReel) -> str | None:
    dates = [issue.issue_date for issue in (reel.issues or []) if getattr(issue, "issue_date", None)]
    if not dates:
        return None
    return max(dates).isoformat()


def _stock_row_from_batch(batch: StockBatch, balance_qty: float) -> dict[str, Any]:
    item = batch.item
    metadata = batch.inward_metadata or {}
    location = batch.inventory_location
    return {
        "entity_type": "BATCH",
        "entity_id": str(batch.id),
        "sr_no": batch.batch_no,
        "date": batch.created_at.date().isoformat() if batch.created_at else None,
        "party_name": batch.supplier_name_snapshot,
        "product": metadata.get("product") or (item.type.value if item and hasattr(item.type, "value") else str(item.type) if item else None),
        "item_name": metadata.get("item_name_snapshot") or (item.name if item else None),
        "tank_no": metadata.get("tank_no"),
        "tank_weight": round(float(batch.received_qty or 0.0), 3),
        "amigo_no": metadata.get("amigo_no") or batch.batch_no,
        "issued": "ISSUED" if balance_qty < float(batch.received_qty or 0.0) - 1e-9 else "",
        "issued_date": None,
        "po": metadata.get("po_no"),
        "bill": metadata.get("bill_no"),
        "bill_date": metadata.get("bill_date"),
        "rate": metadata.get("rate") if metadata.get("rate") is not None else batch.unit_cost,
        "weight_out": metadata.get("weight_out"),
        "wastage": metadata.get("wastage"),
        "color": metadata.get("color"),
        "thickness": metadata.get("thickness"),
        "pattern_code": metadata.get("pattern_code"),
        "location": metadata.get("location_code") or (location.code if location else batch.location),
        "stock_status": batch.stock_status,
        "current_qty": round(float(balance_qty or 0.0), 3),
        "metadata": metadata,
    }


def _stock_row_from_reel(reel: PaperReel) -> dict[str, Any]:
    metadata = reel.inward_metadata or {}
    quality = metadata.get("paper_master_snapshot") or {}
    location = reel.inventory_location
    return {
        "entity_type": "REEL",
        "entity_id": str(reel.id),
        "sr_no": reel.reel_code,
        "date": reel.inward_date.isoformat() if reel.inward_date else None,
        "mill": metadata.get("mill") or reel.supplier_name_snapshot or reel.supplier_name,
        "plybond": metadata.get("plybond") or quality.get("ply_bond"),
        "variety": metadata.get("variety") or quality.get("variety"),
        "gsm": reel.gsm or quality.get("gsm"),
        "bf": reel.bf or quality.get("bf"),
        "reel_no": metadata.get("source_reel_no"),
        "reel_weight": round(float(reel.inward_weight_kg or 0.0), 3),
        "amigo_no": metadata.get("amigo_no") or reel.reel_code,
        "slitted_regular": metadata.get("slitting_status") or "REGULAR",
        "issued": "ISSUED" if str(reel.status.value if hasattr(reel.status, "value") else reel.status).upper() != "IN_STOCK" else "",
        "issued_date": _issued_date_for_reel(reel),
        "po": metadata.get("po_no"),
        "bill": metadata.get("bill_no"),
        "bill_date": metadata.get("bill_date"),
        "rate": metadata.get("rate") if metadata.get("rate") is not None else reel.unit_cost,
        "location": metadata.get("location_code") or (location.code if location else None),
        "stock_status": reel.stock_status,
        "current_qty": round(float(reel.current_weight_kg or 0.0), 3),
        "metadata": metadata,
    }


@router.get("/stock-as-on")
def stock_as_on_report(
    material: Optional[str] = Query(default=None, description="REEL, ADHESIVE, PARCHMENT, BULK, or ALL"),
    include_zero: bool = Query(default=False),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    del current_user
    material_filter = (material or "ALL").strip().upper()
    plant_strings, plant_uuids = _plant_filters(plant_scope)
    rows: list[dict[str, Any]] = []

    if material_filter in {"ALL", "REEL", "RAW_PAPER"} and plant_uuids:
        reel_query = db.query(PaperReel).filter(PaperReel.plant_id.in_(plant_uuids))
        for reel in reel_query.order_by(PaperReel.created_at.desc()).limit(limit).all():
            if not include_zero and float(reel.current_weight_kg or 0.0) <= 1e-9:
                continue
            rows.append(_stock_row_from_reel(reel))

    if material_filter in {"ALL", "ADHESIVE", "PARCHMENT", "BULK", "RAW_MATERIAL"}:
        batch_query = db.query(StockBatch).join(ItemMaster, StockBatch.item_id == ItemMaster.id).filter(StockBatch.plant_id.in_(plant_strings))
        if material_filter in {"ADHESIVE", "PARCHMENT"}:
            batch_query = batch_query.filter(ItemMaster.type == material_filter)
        elif material_filter == "BULK":
            batch_query = batch_query.filter(ItemMaster.tracking_mode == TrackingMode.BULK)
        for batch in batch_query.order_by(StockBatch.created_at.desc()).limit(limit).all():
            balance_qty = float(get_batch_balance(str(batch.id), db) or 0.0)
            if not include_zero and balance_qty <= 1e-9:
                continue
            rows.append(_stock_row_from_batch(batch, balance_qty))

    rows = sorted(rows, key=lambda row: str(row.get("date") or ""), reverse=True)[:limit]
    return {
        "items": rows,
        "rows": rows,
        "totals": {
            "rows": len(rows),
            "current_qty": round(sum(float(row.get("current_qty") or 0.0) for row in rows), 3),
        },
    }


@router.post("/", response_model=InwardResponse)
def create_inward(
    inward: InwardCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "Admin"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == inward.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.tracking_mode != TrackingMode.BULK:
        raise HTTPException(status_code=400, detail="Use reel inward for reel-tracked raw paper")

    location = None
    if inward.location_id:
        location = db.query(InventoryLocation).filter(
            InventoryLocation.id == inward.location_id,
            InventoryLocation.plant_id == plant_id,
        ).first()
        if not location:
            raise HTTPException(status_code=404, detail="Inventory location not found")
    stock_status = inward.stock_status.strip().upper()
    if stock_status not in {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}:
        raise HTTPException(status_code=400, detail="Invalid stock_status")
    # Client policy: fresh inward material must clear QC before floor issue.
    if stock_status == "UNRESTRICTED":
        stock_status = "QC_HOLD"

    amigo_no = (inward.amigo_no or inward.batch_no or "").strip().upper()
    batch_no = amigo_no or _next_system_batch_no(db, item, plant_id)
    _ensure_unique_batch_no(db, plant_id, batch_no)
    metadata = {
        **dict(inward.inward_metadata or {}),
        "amigo_no": batch_no,
        "material_form": (inward.material_form or item.type.value if hasattr(item.type, "value") else inward.material_form or str(item.type)),
        "product": inward.product,
        "item_name_snapshot": inward.item_name_snapshot or item.name,
        "tank_no": inward.tank_no,
        "po_no": inward.po_no,
        "bill_no": inward.bill_no,
        "bill_date": inward.bill_date.isoformat() if inward.bill_date else None,
        "rate": inward.rate if inward.rate is not None else inward.unit_cost,
        "weight_out": inward.weight_out,
        "wastage": inward.wastage,
        "color": inward.color,
        "thickness": inward.thickness,
        "pattern_code": inward.pattern_code,
        "supplier_id": str(inward.supplier_id),
        "supplier_name": inward.supplier_name,
        "location_id": str(location.id) if location else None,
        "location_code": location.code if location else inward.location,
    }

    batch = StockBatch(
        item_id=inward.item_id,
        batch_no=batch_no,
        received_qty=inward.qty,
        unit_cost=inward.unit_cost,
        cost_source=inward.cost_source or ("SUPPLIER" if inward.unit_cost is not None else None),
        supplier_id=inward.supplier_id,
        supplier_name_snapshot=inward.supplier_name,
        location=inward.location or (location.code if location else None),
        location_id=inward.location_id,
        stock_status=stock_status,
        spec_id=inward.spec_id,
        plant_id=plant_id,
        inward_metadata=metadata,
    )
    db.add(batch)
    db.flush()

    try:
        ref_type = ReferenceType(inward.reference_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid reference_type")

    effective_date_value = inward.effective_date or date.today()

    transaction = StockTransaction(
        item_id=inward.item_id,
        batch_id=batch.id,
        transaction_type=TransactionType.INWARD,
        qty_change=inward.qty,
        reference_type=ref_type,
        reference_id=inward.reference_id or batch.id,
        plant_id=plant_id,
        location_id=batch.location_id,
        stock_status=batch.stock_status,
        movement_metadata={
            "batch_no": batch_no,
            "amigo_no": batch_no,
            "supplier_id": str(inward.supplier_id),
            "supplier_name": inward.supplier_name,
            "unit_cost": inward.unit_cost,
            "cost_source": inward.cost_source or ("SUPPLIER" if inward.unit_cost is not None else None),
            "inward_metadata": metadata,
        },
        external_ref=inward.external_ref,
        effective_date=effective_date_value,
    )
    db.add(transaction)
    db.commit()

    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_received",
            entity_type="stock_transaction",
            entity_id=str(transaction.id),
            plant_id=str(plant_id),
            actor_role=current_user.get("role"),
            actor_email=current_user.get("sub"),
            summary=f"Inward {batch_no}: {inward.qty} {item.uom.value} of {item.name} from {inward.supplier_name}",
            payload={
                "item_id": str(inward.item_id),
                "batch_id": str(batch.id),
                "batch_no": batch_no,
                "qty": float(inward.qty),
                "supplier_id": str(inward.supplier_id),
                "supplier_name": inward.supplier_name,
                "reference_type": ref_type.value,
                "effective_date": effective_date_value.isoformat(),
                "stock_status": batch.stock_status,
            },
        )
    except Exception as exc:
        logger.warning("audit emit failed for stock_received (%s): %s", transaction.id, exc)

    return InwardResponse(
        batch_id=batch.id,
        transaction_id=transaction.id,
        item_id=inward.item_id,
        batch_no=batch_no,
        qty_received=inward.qty,
        item_balance=get_item_balance(str(inward.item_id), db),
        batch_balance=get_batch_balance(str(batch.id), db),
        message=f"Inward recorded: {inward.qty} {item.uom.value} of {item.name}",
        label=batch_label_payload(batch, item, inward_date=effective_date_value),
    )
