from __future__ import annotations
import hashlib
import json

import logging
from datetime import date, datetime
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..models import (
    InventoryLocation,
    ItemMaster,
    PurchaseLineSchedule,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReceipt,
    PurchaseReceiptLine,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TransactionType,
)
from ..quality_eval import exemption_scope_applies
from ..quality_task_queue import enqueue_incoming_qc_task, retry_incoming_qc_task_deliveries
from ..quality_pin import pin_quality_profile_metadata
from ..services.po_qualifier import parse_po_qualifier, qualifier_conflicts_item
from ..services.purchase_workbook import (
    commit_workbook,
    preview_workbook,
    resolve_po_issuer,
)
from ..services.supplier_schedule import (
    active_scheduled_qty,
    allocate_receipt_to_schedule,
    serialize_schedule,
)
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_plant, get_current_user, require_role

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory/purchase", tags=["inventory-purchase"])


def _actor(current_user: dict) -> str:
    return str(
        current_user.get("actor_identity")
        or current_user.get("actual_sub")
        or current_user.get("sub")
        or "system"
    )


def _line_status(qty_ordered: float, qty_received: float, qty_rejected: float = 0.0) -> str:
    ordered = float(qty_ordered or 0.0)
    received = float(qty_received or 0.0)
    rejected = float(qty_rejected or 0.0)
    if received <= 0 and rejected <= 0:
        return "OPEN"
    accounted = received + rejected
    if rejected > 0 and received <= 0 and accounted + 1e-9 >= ordered:
        return "REJECTED"
    if accounted + 1e-9 >= ordered:
        return "CLOSED"
    return "PARTIAL"


def _po_status(line_statuses: list[str]) -> str:
    if line_statuses and all(status == "CLOSED" for status in line_statuses):
        return "RECEIVED"
    if any(status in {"PARTIAL", "CLOSED", "REJECTED"} for status in line_statuses):
        return "PARTIALLY_RECEIVED"
    return "APPROVED"


def _receipt_status(qc_statuses: list[str]) -> str:
    statuses = [status.upper() for status in qc_statuses]
    if any(status == "HOLD" for status in statuses):
        return "QC_HOLD"
    if any(status == "PENDING" for status in statuses):
        return "QC_PENDING"
    if statuses and all(status in {"PASS", "NOT_REQUIRED"} for status in statuses):
        return "QC_CLEARED"
    return "POSTED"


def _next_doc_no(db: Session, model, plant_id: str, field_name: str, prefix: str) -> str:
    # Transaction-scoped lock avoids count/check races across orders in a plant.
    from sqlalchemy import text
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"document:{plant_id}:{prefix}"})
    date_part = datetime.utcnow().strftime("%y%m%d")
    base = f"{prefix}-{date_part}"
    for seq in range(1, 10000):
        candidate = f"{base}-{seq:03d}"
        exists = db.query(model).filter(
            model.plant_id == plant_id,
            getattr(model, field_name) == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail=f"Unable to generate {prefix} number")


class PurchaseOrderLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    item_id: uuid.UUID
    qty_ordered: float = Field(gt=0)
    unit_cost: float = Field(ge=0)
    incoming_qc_required: bool = True
    notes: Optional[str] = Field(default=None, max_length=500)
    description: Optional[str] = Field(default=None, max_length=500)
    width_mm: Optional[float] = Field(default=None, ge=0)
    gsm: Optional[float] = Field(default=None, ge=0)
    plybond: Optional[float] = Field(default=None, ge=0)
    bulk: Optional[float] = Field(default=None, ge=0)
    cobb: Optional[str] = Field(default=None, max_length=120)
    qualifiers: Optional[list[str]] = None
    metadata_json: Optional[dict[str, Any]] = None


class PurchaseOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    po_no: Optional[str] = Field(default=None, max_length=80)
    po_date: Optional[date] = None
    supplier_id: uuid.UUID
    supplier_name: str = Field(min_length=1, max_length=200)
    supplier_contact: Optional[str] = Field(default=None, max_length=200)
    supplier_address: Optional[str] = Field(default=None, max_length=500)
    supplier_gst_no: Optional[str] = Field(default=None, max_length=40)
    expected_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    freight_terms: Optional[str] = Field(default=None, max_length=300)
    tax_terms: Optional[str] = Field(default=None, max_length=300)
    payment_terms: Optional[str] = Field(default=None, max_length=300)
    delivery_terms: Optional[str] = Field(default=None, max_length=300)
    test_report_terms: Optional[str] = Field(default=None, max_length=500)
    special_instruction: Optional[str] = Field(default=None, max_length=500)
    legal_entity: Optional[str] = Field(default=None, max_length=200)
    metadata_json: Optional[dict[str, Any]] = None
    lines: list[PurchaseOrderLineCreate] = Field(min_length=1)

    @field_validator("supplier_name")
    @classmethod
    def normalize_supplier_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("vendor is required")
        return cleaned


class PurchaseOrderResponse(BaseModel):
    id: uuid.UUID
    po_no: str
    po_date: Optional[str] = None
    supplier_id: uuid.UUID
    supplier_name: str
    supplier_contact: Optional[str] = None
    supplier_address: Optional[str] = None
    supplier_gst_no: Optional[str] = None
    expected_date: Optional[date]
    status: str
    notes: Optional[str]
    freight_terms: Optional[str] = None
    tax_terms: Optional[str] = None
    payment_terms: Optional[str] = None
    delivery_terms: Optional[str] = None
    test_report_terms: Optional[str] = None
    special_instruction: Optional[str] = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    lines: list[dict[str, Any]]


class GrnLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    po_line_id: uuid.UUID
    qty_received: float = Field(gt=0)
    batch_no: Optional[str] = Field(default=None, max_length=100)
    location_id: Optional[uuid.UUID] = None
    schedule_id: Optional[uuid.UUID] = None
    sample_count: Optional[int] = Field(default=None, ge=0)


class GrnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    grn_no: Optional[str] = Field(default=None, max_length=80)
    request_id: Optional[uuid.UUID] = None
    received_date: date
    lines: list[GrnLineCreate] = Field(min_length=1)


class ReceiptQcPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    status: str = "PASS"
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"PASS", "HOLD"}:
            raise ValueError("status must be PASS or HOLD")
        return normalized


class SupplierScheduleRowIn(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    purchase_order_line_id: uuid.UUID
    scheduled_qty: float = Field(gt=0)
    promised_date: date
    current_date: Optional[date] = None
    confirmation_status: str = "TENTATIVE"
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("confirmation_status")
    @classmethod
    def validate_confirmation(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"TENTATIVE", "CONFIRMED"}:
            raise ValueError("confirmation_status must be TENTATIVE or CONFIRMED")
        return normalized


class SupplierScheduleCommit(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    rows: list[SupplierScheduleRowIn] = Field(min_length=1)


class ReceiptScheduleAllocate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    schedule_id: uuid.UUID
    allocated_qty: Optional[float] = Field(default=None, gt=0)


class WorkbookImportPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    source_name: str = Field(default="SEP 2026", min_length=1, max_length=120)
    sheet_name: str = Field(default="SEP 2026", min_length=1, max_length=120)
    rows: list[dict[str, Any]] = Field(default_factory=list)


class ReceiptEvidenceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=40)
    filename: str = Field(min_length=1, max_length=200)
    sha256: str = Field(min_length=16, max_length=128)
    content_type: Optional[str] = Field(default=None, max_length=120)
    batch_id: uuid.UUID


class RejectRemainderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    qty_rejected: float = Field(gt=0)
    disposition: str = "REJECT"
    replacement_qty: Optional[float] = Field(default=None, gt=0)

    @field_validator("disposition")
    @classmethod
    def validate_disposition(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"REJECT", "REPLACE"}:
            raise ValueError("disposition must be REJECT or REPLACE")
        return normalized


def _order_for_plant(db: Session, po_id: uuid.UUID, plant_id: str) -> PurchaseOrder:
    order = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.id == po_id, PurchaseOrder.plant_id == plant_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return order


def _serialize_order(order: PurchaseOrder) -> dict[str, Any]:
    metadata = order.metadata_json or {}
    return {
        "id": order.id,
        "po_no": order.po_no,
        "po_date": metadata.get("po_date"),
        "supplier_id": order.supplier_id,
        "supplier_name": order.supplier_name_snapshot,
        "supplier_contact": metadata.get("supplier_contact"),
        "supplier_address": metadata.get("supplier_address"),
        "supplier_gst_no": metadata.get("supplier_gst_no"),
        "expected_date": order.expected_date,
        "status": order.status,
        "notes": order.notes,
        "freight_terms": metadata.get("freight_terms"),
        "tax_terms": metadata.get("tax_terms"),
        "payment_terms": metadata.get("payment_terms"),
        "delivery_terms": metadata.get("delivery_terms"),
        "test_report_terms": metadata.get("test_report_terms"),
        "special_instruction": metadata.get("special_instruction"),
        "legal_entity": metadata.get("legal_entity") or metadata.get("legal_name"),
        "metadata_json": metadata,
        "lines": [
            {
                "id": str(line.id),
                "item_id": str(line.item_id),
                "item_code": line.item.item_code if line.item else None,
                "item_name": line.item.name if line.item else None,
                "item_type": (line.item.type.value if line.item and hasattr(line.item.type, "value") else (str(line.item.type) if line.item else None)),
                "uom": (line.item.uom.value if line.item and hasattr(line.item.uom, "value") else (str(line.item.uom) if line.item else None)),
                "qty_ordered": float(line.qty_ordered or 0.0),
                "qty_received": float(line.qty_received or 0.0),
                "qty_rejected": float(getattr(line, "qty_rejected", 0.0) or 0.0),
                "qty_open": round(
                    max(
                        0.0,
                        float(line.qty_ordered or 0.0)
                        - float(line.qty_received or 0.0)
                        - float(getattr(line, "qty_rejected", 0.0) or 0.0),
                    ),
                    6,
                ),
                "unit_cost": float(line.unit_cost or 0.0),
                "incoming_qc_required": bool(line.incoming_qc_required),
                "line_status": line.line_status,
                "notes": line.notes,
                "description": (line.metadata_json or {}).get("description"),
                "width_mm": (line.metadata_json or {}).get("width_mm"),
                "gsm": (line.metadata_json or {}).get("gsm"),
                "plybond": (line.metadata_json or {}).get("plybond"),
                "bulk": (line.metadata_json or {}).get("bulk"),
                "cobb": (line.metadata_json or {}).get("cobb"),
                "qualifiers": (line.metadata_json or {}).get("qualifiers"),
                "qualifier_conflicts": (line.metadata_json or {}).get("qualifier_conflicts") or [],
                "requires_review": bool((line.metadata_json or {}).get("requires_review")),
                "amount": round(float(line.qty_ordered or 0.0) * float(line.unit_cost or 0.0), 2),
                "metadata_json": line.metadata_json or {},
                "schedules": [
                    {
                        "id": str(schedule.id),
                        "scheduled_qty": float(schedule.scheduled_qty or 0.0),
                        "allocated_qty": round(sum(float(row.allocated_qty or 0.0) for row in (schedule.allocations or [])), 6),
                        "promised_date": schedule.promised_date.isoformat() if schedule.promised_date else None,
                        "current_date": schedule.current_date.isoformat() if schedule.current_date else None,
                        "confirmation_status": schedule.confirmation_status,
                    }
                    for schedule in (line.schedules or [])
                    if schedule.confirmation_status != "CANCELLED"
                ],
            }
            for line in (order.lines or [])
        ],
    }


@router.get("/orders")
def list_purchase_orders(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == plant_id)
    if status:
        query = query.filter(PurchaseOrder.status == status.strip().upper())
    rows = query.order_by(PurchaseOrder.created_at.desc()).offset(offset).limit(limit).all()
    return {"items": [_serialize_order(row) for row in rows], "limit": limit, "offset": offset}


@router.post("/orders", response_model=PurchaseOrderResponse)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Owner"])),
):
    po_no = (payload.po_no or "").strip().upper() or _next_doc_no(db, PurchaseOrder, plant_id, "po_no", "PO")
    existing = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == plant_id, PurchaseOrder.po_no == po_no).first()
    if existing:
        raise HTTPException(status_code=400, detail="Purchase order number already exists")

    order = PurchaseOrder(
        plant_id=plant_id,
        po_no=po_no,
        supplier_id=payload.supplier_id,
        supplier_name_snapshot=payload.supplier_name,
        expected_date=payload.expected_date,
        notes=payload.notes,
        metadata_json={
            **dict(payload.metadata_json or {}),
            "po_date": (payload.po_date or date.today()).isoformat(),
            "supplier_contact": payload.supplier_contact,
            "supplier_address": payload.supplier_address,
            "supplier_gst_no": payload.supplier_gst_no,
            "freight_terms": payload.freight_terms,
            "tax_terms": payload.tax_terms,
            "payment_terms": payload.payment_terms,
            "delivery_terms": payload.delivery_terms,
            "test_report_terms": payload.test_report_terms,
            "special_instruction": payload.special_instruction,
            "legal_entity": (payload.legal_entity or "").strip() or (payload.metadata_json or {}).get("legal_entity"),
        },
        created_by=_actor(current_user),
    )
    db.add(order)
    db.flush()

    for idx, line in enumerate(payload.lines, start=1):
        item = db.query(ItemMaster).filter(ItemMaster.id == line.item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item not found for PO line {idx}")
        live_profile = dict(item.quality_profile) if isinstance(item.quality_profile, dict) else None
        raw_qualifiers = [str(value).strip() for value in (line.qualifiers or []) if str(value).strip()]
        if line.cobb and str(line.cobb).strip() not in raw_qualifiers:
            raw_qualifiers.append(str(line.cobb).strip())
        parsed_qualifiers = [parse_po_qualifier(value) for value in raw_qualifiers]
        conflicts = []
        for parsed in parsed_qualifiers:
            conflict = qualifier_conflicts_item(parsed, live_profile)
            if conflict:
                conflicts.append(conflict)
        db.add(
            PurchaseOrderLine(
                purchase_order_id=order.id,
                item_id=item.id,
                qty_ordered=line.qty_ordered,
                unit_cost=line.unit_cost,
                incoming_qc_required=line.incoming_qc_required,
                line_status="OPEN",
                notes=line.notes,
                metadata_json={
                    **dict(line.metadata_json or {}),
                    "description": line.description,
                    "width_mm": line.width_mm,
                    "gsm": line.gsm,
                    "plybond": line.plybond,
                    "bulk": line.bulk,
                    "cobb": line.cobb,
                    "qualifiers_raw": raw_qualifiers,
                    "qualifiers": parsed_qualifiers,
                    "qualifier_conflicts": conflicts,
                    "requires_review": bool(conflicts),
                    "item_profile_untouched": True,
                },
            )
        )
    db.commit()
    db.refresh(order)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="purchase_order_created",
            entity_type="purchase_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Purchase order {order.po_no} created with {len(payload.lines)} line(s) for {payload.supplier_name}",
            payload={
                "po_no": order.po_no,
                "supplier_id": str(payload.supplier_id),
                "supplier_name": payload.supplier_name,
                "line_count": len(payload.lines),
                "expected_date": payload.expected_date.isoformat() if payload.expected_date else None,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for purchase_order_created %s: %s", order.id, exc)
    return _serialize_order(order)


@router.post("/orders/{po_id}/approve", response_model=PurchaseOrderResponse)
def approve_purchase_order(
    po_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "PlantManager", "Owner"])),
):
    order = db.query(PurchaseOrder).filter(
        PurchaseOrder.id == po_id,
        PurchaseOrder.plant_id == plant_id,
    ).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status == "APPROVED":
        return _serialize_order(order)
    if order.status not in {"DRAFT", "SUBMITTED"}:
        raise HTTPException(status_code=409, detail="Only draft/submitted purchase orders can be approved")
    if str(order.created_by or "").strip().lower() == _actor(current_user).strip().lower():
        raise HTTPException(status_code=403, detail="A different authorized person must approve this purchase order")
    order.status = "APPROVED"
    order.approved_by = _actor(current_user)
    order.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="purchase_order_approved",
            entity_type="purchase_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Purchase order {order.po_no} approved",
            payload={
                "po_no": order.po_no,
                "supplier_id": str(order.supplier_id),
                "supplier_name": order.supplier_name_snapshot,
                "approved_by": _actor(current_user),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for purchase_order_approved %s: %s", order.id, exc)
    return _serialize_order(order)


@router.post("/orders/{po_id}/grn")
def post_grn(
    po_id: uuid.UUID,
    payload: GrnCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store", "PlantManager"])),
):
    order = db.query(PurchaseOrder).filter(
        PurchaseOrder.id == po_id,
        PurchaseOrder.plant_id == plant_id,
    ).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    grn_no = (payload.grn_no or "").strip().upper() or (f"GRN-{payload.request_id.hex}" if payload.request_id else "")
    if not grn_no:
        raise HTTPException(status_code=422, detail="A stable request_id or GRN number is required; refresh the purchasing page")
    fingerprint = hashlib.sha256(json.dumps(payload.model_dump(mode="json", exclude={"request_id", "grn_no"}), sort_keys=True).encode()).hexdigest()
    from sqlalchemy import text
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"receipt:{plant_id}:{grn_no}"})
    existing = db.query(PurchaseReceipt).filter(PurchaseReceipt.plant_id == plant_id, PurchaseReceipt.grn_no == grn_no).first()
    if existing:
        movement = db.query(StockTransaction).filter(StockTransaction.external_ref == f"GRN:{existing.id}:1").first()
        if existing.purchase_order_id != order.id or not movement or (movement.movement_metadata or {}).get("request_fingerprint") != fingerprint:
            raise HTTPException(status_code=409, detail="This receipt reference already exists with different details. Review GRNs before retrying.")
        return {
            "id": str(existing.id),
            "purchase_order_id": str(order.id),
            "po_no": order.po_no,
            "grn_no": existing.grn_no,
            "received_date": existing.received_date.isoformat(),
            "status": existing.status,
            "order_status": order.status,
            "idempotent": True,
            "lines": [
                {
                    "po_line_id": str(line.purchase_order_line_id),
                    "receipt_line_id": str(line.id),
                    "batch_id": str(line.batch_id),
                    "batch_no": line.batch.batch_no if line.batch else None,
                    "qty_received": line.qty_received,
                    "qc_status": line.qc_status,
                    "schedule_allocation": (
                        {
                            "id": str(line.schedule_allocations[0].id),
                            "schedule_id": str(line.schedule_allocations[0].schedule_id),
                            "allocated_qty": float(line.schedule_allocations[0].allocated_qty),
                            "idempotent": True,
                        }
                        if line.schedule_allocations
                        else None
                    ),
                }
                for line in existing.lines
            ],
        }
    if order.status not in {"APPROVED", "PARTIALLY_RECEIVED"}:
        raise HTTPException(status_code=400, detail="Only approved purchase orders can receive GRN")

    receipt = PurchaseReceipt(
        plant_id=plant_id,
        purchase_order_id=order.id,
        grn_no=grn_no,
        received_date=payload.received_date,
        created_by=_actor(current_user),
    )
    db.add(receipt)
    db.flush()

    lines_by_id = {line.id: line for line in order.lines or []}
    response_lines: list[dict[str, Any]] = []
    for idx, line_payload in enumerate(payload.lines, start=1):
        po_line = lines_by_id.get(line_payload.po_line_id)
        if not po_line:
            raise HTTPException(status_code=404, detail=f"PO line not found for GRN line {idx}")
        remaining = (
            float(po_line.qty_ordered or 0.0)
            - float(po_line.qty_received or 0.0)
            - float(getattr(po_line, "qty_rejected", 0.0) or 0.0)
        )
        if line_payload.qty_received > remaining + 1e-9:
            raise HTTPException(status_code=400, detail=f"GRN quantity exceeds PO balance for line {idx}")

        location = None
        if line_payload.location_id:
            location = db.query(InventoryLocation).filter(
                InventoryLocation.id == line_payload.location_id,
                InventoryLocation.plant_id == plant_id,
            ).first()
            if not location:
                raise HTTPException(status_code=404, detail=f"Location not found for GRN line {idx}")

        batch_no = (line_payload.batch_no or f"{grn_no}-B{idx:03d}").strip().upper()
        inward_metadata = pin_quality_profile_metadata(
            {},
            getattr(po_line.item, "quality_profile", None) if po_line.item is not None else None,
        )
        if line_payload.sample_count is not None:
            inward_metadata["sample_count"] = line_payload.sample_count
        pinned_profile = inward_metadata.get("quality_profile") if isinstance(inward_metadata, dict) else None
        exemption = exemption_scope_applies(
            pinned_profile,
            plant_id=plant_id,
            as_of=payload.received_date,
            item_id=po_line.item_id,
        )
        if exemption:
            stock_status = "UNRESTRICTED"
            qc_status = "NOT_REQUIRED"
        elif po_line.incoming_qc_required:
            stock_status = "QC_HOLD"
            qc_status = "PENDING"
        else:
            stock_status = "UNRESTRICTED"
            qc_status = "PASS"
        inward_metadata["incoming_qc_task"] = {
            "status": qc_status,
            "notification_status": "PENDING" if qc_status == "PENDING" else qc_status,
            "delivery_status": "PENDING" if qc_status == "PENDING" else qc_status,
        }
        if qc_status == "PENDING":
            inward_metadata["incoming_qc_task"]["outbox_event_id"] = None
        batch = StockBatch(
            item_id=po_line.item_id,
            batch_no=batch_no,
            received_qty=line_payload.qty_received,
            location=location.code if location else None,
            location_id=line_payload.location_id,
            stock_status=stock_status,
            unit_cost=po_line.unit_cost,
            cost_source="SUPPLIER",
            supplier_id=order.supplier_id,
            supplier_name_snapshot=order.supplier_name_snapshot,
            plant_id=plant_id,
            inward_metadata=inward_metadata,
        )
        db.add(batch)
        db.flush()

        db.add(
            StockTransaction(
                item_id=po_line.item_id,
                batch_id=batch.id,
                transaction_type=TransactionType.INWARD,
                effective_date=payload.received_date,
                qty_change=line_payload.qty_received,
                reference_type=ReferenceType.PURCHASE,
                reference_id=order.id,
                plant_id=plant_id,
                location_id=line_payload.location_id,
                stock_status=stock_status,
                movement_metadata={
                    "source_document_type": "GRN",
                    "request_fingerprint": fingerprint,
                    "purchase_order_id": str(order.id),
                    "purchase_order_no": order.po_no,
                    "purchase_order_line_id": str(po_line.id),
                    "grn_no": grn_no,
                    "supplier_id": str(order.supplier_id),
                    "supplier_name": order.supplier_name_snapshot,
                    "incoming_qc_required": bool(po_line.incoming_qc_required),
                    "qc_status": qc_status,
                    "sample_count": line_payload.sample_count,
                    "po_line_metadata": po_line.metadata_json or {},
                },
                external_ref=f"GRN:{receipt.id}:{idx}",
            )
        )
        receipt_line = PurchaseReceiptLine(
            receipt_id=receipt.id,
            purchase_order_line_id=po_line.id,
            item_id=po_line.item_id,
            batch_id=batch.id,
            qty_received=line_payload.qty_received,
            unit_cost=po_line.unit_cost,
            qc_status=qc_status,
        )
        db.add(receipt_line)
        db.flush()
        if qc_status == "PENDING":
            event_id = enqueue_incoming_qc_task(
                db,
                plant_id=plant_id,
                receipt_id=str(receipt.id),
                batch_id=str(batch.id),
                grn_no=grn_no,
                po_no=order.po_no,
            )
            inward_metadata["incoming_qc_task"]["outbox_event_id"] = event_id
            batch.inward_metadata = dict(inward_metadata)
            flag_modified(batch, "inward_metadata")
        allocation_payload = None
        if line_payload.schedule_id:
            schedule = db.query(PurchaseLineSchedule).filter(
                PurchaseLineSchedule.id == line_payload.schedule_id,
                PurchaseLineSchedule.plant_id == plant_id,
            ).first()
            if not schedule:
                raise HTTPException(status_code=404, detail=f"Supplier schedule not found for GRN line {idx}")
            allocation, replayed = allocate_receipt_to_schedule(
                db,
                plant_id=plant_id,
                receipt_line=receipt_line,
                schedule=schedule,
                qty=float(line_payload.qty_received),
            )
            allocation_payload = {
                "id": str(allocation.id),
                "schedule_id": str(schedule.id),
                "allocated_qty": float(allocation.allocated_qty),
                "idempotent": replayed,
            }
        po_line.qty_received = float(po_line.qty_received or 0.0) + float(line_payload.qty_received)
        po_line.line_status = _line_status(
            po_line.qty_ordered, po_line.qty_received, getattr(po_line, "qty_rejected", 0.0)
        )
        response_lines.append(
            {
                "po_line_id": str(po_line.id),
                "receipt_line_id": str(receipt_line.id),
                "batch_id": str(batch.id),
                "batch_no": batch.batch_no,
                "qty_received": line_payload.qty_received,
                "stock_status": stock_status,
                "qc_status": qc_status,
                "schedule_allocation": allocation_payload,
            }
        )

    order.status = _po_status([line.line_status for line in order.lines or []])
    receipt.status = _receipt_status([line["qc_status"] for line in response_lines])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="GRN could not be posted; check duplicate references") from exc
    db.refresh(receipt)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_received",
            entity_type="purchase_receipt",
            entity_id=str(receipt.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"GRN {receipt.grn_no} posted against PO {order.po_no} ({len(response_lines)} line(s))",
            payload={
                "grn_no": receipt.grn_no,
                "purchase_order_id": str(order.id),
                "po_no": order.po_no,
                "receipt_status": receipt.status,
                "order_status": order.status,
                "received_date": receipt.received_date.isoformat(),
                "line_count": len(response_lines),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_received (GRN) %s: %s", receipt.id, exc)
    return {
        "id": str(receipt.id),
        "purchase_order_id": str(order.id),
        "po_no": order.po_no,
        "grn_no": receipt.grn_no,
        "received_date": receipt.received_date.isoformat(),
        "status": receipt.status,
        "order_status": order.status,
        "lines": response_lines,
    }


@router.post("/orders/{po_id}/lines/{line_id}/reject-remainder")
def reject_purchase_remainder(
    po_id: uuid.UUID,
    line_id: uuid.UUID,
    payload: RejectRemainderPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store", "PlantManager"])),
):
    order = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.id == po_id, PurchaseOrder.plant_id == plant_id)
        .with_for_update()
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status not in {"APPROVED", "PARTIALLY_RECEIVED"}:
        raise HTTPException(status_code=400, detail="Only approved purchase orders can record a rejected remainder")
    po_line = next((line for line in (order.lines or []) if line.id == line_id), None)
    if po_line is None:
        raise HTTPException(status_code=404, detail="Purchase order line not found")
    remaining = (
        float(po_line.qty_ordered or 0.0)
        - float(po_line.qty_received or 0.0)
        - float(getattr(po_line, "qty_rejected", 0.0) or 0.0)
    )
    if payload.qty_rejected - remaining > 1e-9:
        raise HTTPException(status_code=400, detail="Rejected quantity exceeds open PO remainder")
    if payload.disposition == "REPLACE" and not payload.replacement_qty:
        raise HTTPException(status_code=400, detail="Replacement disposition requires replacement_qty")
    usable_before = None
    try:
        from ..services.stock_calc import get_usable_item_qty

        usable_before = get_usable_item_qty(str(po_line.item_id), db)
    except Exception:
        usable_before = None
    po_line.qty_rejected = float(getattr(po_line, "qty_rejected", 0.0) or 0.0) + float(payload.qty_rejected)
    po_line.line_status = _line_status(po_line.qty_ordered, po_line.qty_received, po_line.qty_rejected)
    metadata = dict(po_line.metadata_json or {})
    metadata["rejected_remainder"] = {
        "qty": float(po_line.qty_rejected or 0.0),
        "disposition": payload.disposition,
        "actor": _actor(current_user),
    }
    po_line.metadata_json = metadata
    flag_modified(po_line, "metadata_json")
    open_after = (
        float(po_line.qty_ordered or 0.0)
        - float(po_line.qty_received or 0.0)
        - float(po_line.qty_rejected or 0.0)
    )
    for schedule in list(po_line.schedules or []):
        if str(schedule.confirmation_status or "").upper() == "CANCELLED":
            continue
        allocated = round(sum(float(row.allocated_qty or 0.0) for row in (schedule.allocations or [])), 6)
        leftover = max(0.0, float(schedule.scheduled_qty or 0.0) - allocated)
        if leftover > 1e-9 and open_after <= 1e-9:
            schedule.confirmation_status = "CANCELLED"
            schedule.cancelled_at = datetime.utcnow()
            schedule.notes = (schedule.notes or "") + " | remainder rejected"
    replacement_line_id = None
    if payload.disposition == "REPLACE":
        replacement = PurchaseOrderLine(
            purchase_order_id=order.id,
            item_id=po_line.item_id,
            qty_ordered=float(payload.replacement_qty),
            qty_received=0.0,
            qty_rejected=0.0,
            unit_cost=po_line.unit_cost,
            incoming_qc_required=po_line.incoming_qc_required,
            line_status="OPEN",
            notes=f"Replacement for rejected remainder of line {po_line.id}",
            metadata_json={"replacement_of_line_id": str(po_line.id), "not_stock": True},
        )
        db.add(replacement)
        db.flush()
        replacement_line_id = str(replacement.id)
    order.status = _po_status([line.line_status for line in order.lines or []])
    db.commit()
    db.refresh(order)
    usable_after = usable_before
    try:
        from ..services.stock_calc import get_usable_item_qty

        usable_after = get_usable_item_qty(str(po_line.item_id), db)
    except Exception:
        pass
    return {
        **_serialize_order(order),
        "rejected_line_id": str(po_line.id),
        "qty_rejected": float(po_line.qty_rejected or 0.0),
        "qty_received": float(po_line.qty_received or 0.0),
        "qty_open": round(max(0.0, open_after), 6),
        "replacement_line_id": replacement_line_id,
        "usable_stock_unchanged": usable_before is None or abs(float(usable_before) - float(usable_after or 0.0)) < 1e-9,
    }


@router.post("/qc-tasks/retry")
def retry_incoming_qc_tasks(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store", "PlantManager", "QC"])),
):
    del plant_id

    def _deliver(body: dict) -> None:
        payload = body.get("payload") or {}
        batch_id = payload.get("batch_id")
        if not batch_id:
            return
        batch = db.query(StockBatch).filter(StockBatch.id == uuid.UUID(str(batch_id))).first()
        if batch is None:
            return
        metadata = dict(batch.inward_metadata or {})
        task = dict(metadata.get("incoming_qc_task") or {})
        task["notification_status"] = "DELIVERED"
        task["delivery_status"] = "DELIVERED"
        task["delivered_by"] = _actor(current_user)
        metadata["incoming_qc_task"] = task
        batch.inward_metadata = metadata
        flag_modified(batch, "inward_metadata")

    result = retry_incoming_qc_task_deliveries(db, deliver=_deliver)
    db.commit()
    return result


@router.get("/receipts")
def list_purchase_receipts(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    rows = (
        db.query(PurchaseReceipt)
        .filter(PurchaseReceipt.plant_id == plant_id)
        .order_by(PurchaseReceipt.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "id": str(receipt.id),
                "purchase_order_id": str(receipt.purchase_order_id),
                "po_no": receipt.order.po_no if receipt.order else None,
                "grn_no": receipt.grn_no,
                "received_date": receipt.received_date.isoformat(),
                "status": receipt.status,
                "lines": [
                    {
                        "id": str(line.id),
                        "po_line_id": str(line.purchase_order_line_id),
                        "item_id": str(line.item_id),
                        "item_code": line.item.item_code if line.item else None,
                        "item_name": line.item.name if line.item else None,
                        "batch_id": str(line.batch_id) if line.batch_id else None,
                        "batch_no": line.batch.batch_no if line.batch else None,
                        "qty_received": float(line.qty_received or 0.0),
                        "unit_cost": float(line.unit_cost or 0.0),
                        "qc_status": line.qc_status,
                        "schedule_allocation": (
                            {
                                "id": str(line.schedule_allocations[0].id),
                                "schedule_id": str(line.schedule_allocations[0].schedule_id),
                                "allocated_qty": float(line.schedule_allocations[0].allocated_qty),
                            }
                            if line.schedule_allocations
                            else None
                        ),
                    }
                    for line in (receipt.lines or [])
                ],
            }
            for receipt in rows
        ]
    }


@router.post("/receipt-lines/{line_id}/qc")
def update_receipt_line_qc(
    line_id: uuid.UUID,
    payload: ReceiptQcPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store", "PlantManager", "QC"])),
):
    line = (
        db.query(PurchaseReceiptLine)
        .join(PurchaseReceipt, PurchaseReceiptLine.receipt_id == PurchaseReceipt.id)
        .filter(PurchaseReceiptLine.id == line_id, PurchaseReceipt.plant_id == plant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Receipt line not found")
    raise HTTPException(
        status_code=403,
        detail=(
            "Incoming QC PASS/UNRESTRICTED verdicts belong to QC/inventory, not the purchase desk. "
            "This purchase path does not set receipt QC status."
        ),
    )


@router.get("/schedules")
def list_supplier_schedules(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    rows = (
        db.query(PurchaseLineSchedule)
        .filter(PurchaseLineSchedule.plant_id == plant_id)
        .order_by(PurchaseLineSchedule.current_date.asc(), PurchaseLineSchedule.created_at.asc())
        .all()
    )
    return {
        "ledger": False,
        "items": [serialize_schedule(row, db) for row in rows],
    }


@router.post("/orders/{po_id}/schedules")
def commit_supplier_schedules(
    po_id: uuid.UUID,
    payload: SupplierScheduleCommit,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Owner", "Planner"])),
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id, PurchaseOrder.plant_id == plant_id).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    lines_by_id = {line.id: line for line in order.lines or []}
    created = []
    for idx, row in enumerate(payload.rows, start=1):
        po_line = lines_by_id.get(row.purchase_order_line_id)
        if not po_line:
            raise HTTPException(status_code=404, detail=f"Purchase line not found for schedule row {idx}")
        next_total = active_scheduled_qty(db, po_line.id) + float(row.scheduled_qty)
        if next_total > float(po_line.qty_ordered or 0.0) + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=f"Scheduled quantity for line {idx} exceeds unordered remainder of the PO line",
            )
        current_date = row.current_date or row.promised_date
        schedule = PurchaseLineSchedule(
            plant_id=plant_id,
            purchase_order_line_id=po_line.id,
            scheduled_qty=row.scheduled_qty,
            promised_date=row.promised_date,
            current_date=current_date,
            confirmation_status=row.confirmation_status,
            notes=row.notes,
            created_by=_actor(current_user),
        )
        db.add(schedule)
        db.flush()
        created.append(serialize_schedule(schedule, db))
    db.commit()
    return {"purchase_order_id": str(order.id), "po_no": order.po_no, "ledger": False, "items": created}


@router.post("/receipt-lines/{line_id}/allocate-schedule")
def allocate_receipt_line_schedule(
    line_id: uuid.UUID,
    payload: ReceiptScheduleAllocate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store", "PlantManager"])),
):
    receipt_line = (
        db.query(PurchaseReceiptLine)
        .join(PurchaseReceipt, PurchaseReceiptLine.receipt_id == PurchaseReceipt.id)
        .filter(PurchaseReceiptLine.id == line_id, PurchaseReceipt.plant_id == plant_id)
        .with_for_update()
        .first()
    )
    if not receipt_line:
        raise HTTPException(status_code=404, detail="Receipt line not found")
    schedule = db.query(PurchaseLineSchedule).filter(
        PurchaseLineSchedule.id == payload.schedule_id,
        PurchaseLineSchedule.plant_id == plant_id,
    ).with_for_update().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Supplier schedule not found")
    qty = float(payload.allocated_qty if payload.allocated_qty is not None else receipt_line.qty_received)
    allocation, replayed = allocate_receipt_to_schedule(
        db,
        plant_id=plant_id,
        receipt_line=receipt_line,
        schedule=schedule,
        qty=qty,
    )
    db.commit()
    return {
        "id": str(allocation.id),
        "receipt_line_id": str(receipt_line.id),
        "schedule_id": str(schedule.id),
        "allocated_qty": float(allocation.allocated_qty),
        "idempotent": replayed,
        "ledger": False,
        "schedule": serialize_schedule(schedule, db),
    }


@router.post("/workbook/preview")
def preview_purchase_workbook(
    payload: WorkbookImportPayload,
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Owner"])),
):
    del current_user
    return preview_workbook(sheet_name=payload.sheet_name, rows=payload.rows)


@router.post("/workbook/commit")
def commit_purchase_workbook(
    payload: WorkbookImportPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Owner"])),
):
    return commit_workbook(
        db,
        plant_id=plant_id,
        source_name=payload.source_name,
        sheet_name=payload.sheet_name,
        rows=payload.rows,
        current_user=current_user,
        create_purchase_order=create_purchase_order,
        purchase_order_create_cls=PurchaseOrderCreate,
        purchase_order_line_create_cls=PurchaseOrderLineCreate,
    )


@router.get("/orders/{po_id}/print")
def print_purchase_order(
    po_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    del current_user
    order = _order_for_plant(db, po_id, plant_id)
    serialized = _serialize_order(order)
    issuer = resolve_po_issuer(order.metadata_json or {})
    return {
        **serialized,
        **issuer,
        "letterhead": {
            "issuer_name": issuer.get("issuer_name"),
            "issuer_status": issuer.get("issuer_status"),
            "tax_terms": serialized.get("tax_terms"),
            "payment_terms": serialized.get("payment_terms"),
            "freight_terms": serialized.get("freight_terms"),
            "delivery_terms": serialized.get("delivery_terms"),
            "test_report_terms": serialized.get("test_report_terms"),
            "special_instruction": serialized.get("special_instruction"),
        },
    }


@router.post("/receipts/{receipt_id}/evidence")
def attach_receipt_evidence(
    receipt_id: uuid.UUID,
    payload: ReceiptEvidenceCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "Owner", "QC"])),
):
    kind = payload.kind.strip().upper()
    if kind not in {"TEST_REPORT", "CHALLAN"}:
        raise HTTPException(status_code=400, detail="Evidence kind must be TEST_REPORT or CHALLAN")
    receipt = (
        db.query(PurchaseReceipt)
        .filter(PurchaseReceipt.id == receipt_id, PurchaseReceipt.plant_id == plant_id)
        .first()
    )
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    line = next((row for row in (receipt.lines or []) if row.batch_id == payload.batch_id), None)
    if line is None:
        raise HTTPException(status_code=409, detail="Evidence batch is not on this receipt")
    batch = (
        db.query(StockBatch)
        .filter(StockBatch.id == payload.batch_id, StockBatch.plant_id == plant_id)
        .first()
    )
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    metadata = dict(batch.inward_metadata or {})
    evidence = list(metadata.get("receipt_evidence") or [])
    entry = {
        "kind": kind,
        "filename": payload.filename,
        "sha256": payload.sha256,
        "content_type": payload.content_type,
        "receipt_id": str(receipt.id),
        "receipt_line_id": str(line.id),
        "batch_id": str(batch.id),
        "grn_no": receipt.grn_no,
        "attached_by": _actor(current_user),
        "attached_at": datetime.utcnow().isoformat(),
    }
    evidence.append(entry)
    metadata["receipt_evidence"] = evidence
    batch.inward_metadata = metadata
    flag_modified(batch, "inward_metadata")
    db.commit()
    db.refresh(batch)
    return {
        "receipt_id": str(receipt.id),
        "batch_id": str(batch.id),
        "linked": True,
        "evidence": evidence,
    }
