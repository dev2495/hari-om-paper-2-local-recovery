from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    InventoryLocation,
    ItemMaster,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReceipt,
    PurchaseReceiptLine,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TransactionType,
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


def _line_status(qty_ordered: float, qty_received: float) -> str:
    ordered = float(qty_ordered or 0.0)
    received = float(qty_received or 0.0)
    if received <= 0:
        return "OPEN"
    if received + 1e-9 >= ordered:
        return "CLOSED"
    return "PARTIAL"


def _po_status(line_statuses: list[str]) -> str:
    if line_statuses and all(status == "CLOSED" for status in line_statuses):
        return "RECEIVED"
    if any(status in {"PARTIAL", "CLOSED"} for status in line_statuses):
        return "PARTIALLY_RECEIVED"
    return "APPROVED"


def _receipt_status(qc_statuses: list[str]) -> str:
    statuses = [status.upper() for status in qc_statuses]
    if any(status == "HOLD" for status in statuses):
        return "QC_HOLD"
    if any(status == "PENDING" for status in statuses):
        return "QC_PENDING"
    if statuses and all(status == "PASS" for status in statuses):
        return "QC_CLEARED"
    return "POSTED"


def _next_doc_no(db: Session, model, plant_id: str, field_name: str, prefix: str) -> str:
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
    model_config = ConfigDict(extra="forbid")

    item_id: uuid.UUID
    qty_ordered: float = Field(gt=0)
    unit_cost: float = Field(ge=0)
    incoming_qc_required: bool = True
    notes: Optional[str] = Field(default=None, max_length=500)


class PurchaseOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    po_no: Optional[str] = Field(default=None, max_length=80)
    supplier_id: uuid.UUID
    supplier_name: str = Field(min_length=1, max_length=200)
    expected_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=500)
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
    supplier_id: uuid.UUID
    supplier_name: str
    expected_date: Optional[date]
    status: str
    notes: Optional[str]
    lines: list[dict[str, Any]]


class GrnLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    po_line_id: uuid.UUID
    qty_received: float = Field(gt=0)
    batch_no: Optional[str] = Field(default=None, max_length=100)
    location_id: Optional[uuid.UUID] = None


class GrnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grn_no: Optional[str] = Field(default=None, max_length=80)
    received_date: date
    lines: list[GrnLineCreate] = Field(min_length=1)


class ReceiptQcPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = "PASS"
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"PASS", "HOLD"}:
            raise ValueError("status must be PASS or HOLD")
        return normalized


def _serialize_order(order: PurchaseOrder) -> dict[str, Any]:
    return {
        "id": order.id,
        "po_no": order.po_no,
        "supplier_id": order.supplier_id,
        "supplier_name": order.supplier_name_snapshot,
        "expected_date": order.expected_date,
        "status": order.status,
        "notes": order.notes,
        "lines": [
            {
                "id": str(line.id),
                "item_id": str(line.item_id),
                "item_code": line.item.item_code if line.item else None,
                "item_name": line.item.name if line.item else None,
                "qty_ordered": float(line.qty_ordered or 0.0),
                "qty_received": float(line.qty_received or 0.0),
                "unit_cost": float(line.unit_cost or 0.0),
                "incoming_qc_required": bool(line.incoming_qc_required),
                "line_status": line.line_status,
                "notes": line.notes,
            }
            for line in (order.lines or [])
        ],
    }


@router.get("/orders")
def list_purchase_orders(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == plant_id)
    if status:
        query = query.filter(PurchaseOrder.status == status.strip().upper())
    rows = query.order_by(PurchaseOrder.created_at.desc()).limit(limit).all()
    return {"items": [_serialize_order(row) for row in rows]}


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
        created_by=_actor(current_user),
    )
    db.add(order)
    db.flush()

    for idx, line in enumerate(payload.lines, start=1):
        item = db.query(ItemMaster).filter(ItemMaster.id == line.item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item not found for PO line {idx}")
        db.add(
            PurchaseOrderLine(
                purchase_order_id=order.id,
                item_id=item.id,
                qty_ordered=line.qty_ordered,
                unit_cost=line.unit_cost,
                incoming_qc_required=line.incoming_qc_required,
                line_status="OPEN",
                notes=line.notes,
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
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id, PurchaseOrder.plant_id == plant_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cancelled purchase order cannot be approved")
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
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager"])),
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id, PurchaseOrder.plant_id == plant_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status not in {"APPROVED", "PARTIALLY_RECEIVED"}:
        raise HTTPException(status_code=400, detail="Only approved purchase orders can receive GRN")

    grn_no = (payload.grn_no or "").strip().upper() or _next_doc_no(db, PurchaseReceipt, plant_id, "grn_no", "GRN")
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
        remaining = float(po_line.qty_ordered or 0.0) - float(po_line.qty_received or 0.0)
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
        stock_status = "QC_HOLD" if po_line.incoming_qc_required else "UNRESTRICTED"
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
        )
        db.add(batch)
        db.flush()

        db.add(
            StockTransaction(
                item_id=po_line.item_id,
                batch_id=batch.id,
                transaction_type=TransactionType.INWARD,
                qty_change=line_payload.qty_received,
                reference_type=ReferenceType.PURCHASE,
                reference_id=order.id,
                plant_id=plant_id,
                location_id=line_payload.location_id,
                stock_status=stock_status,
                movement_metadata={
                    "source_document_type": "GRN",
                    "purchase_order_id": str(order.id),
                    "purchase_order_no": order.po_no,
                    "purchase_order_line_id": str(po_line.id),
                    "grn_no": grn_no,
                    "supplier_id": str(order.supplier_id),
                    "supplier_name": order.supplier_name_snapshot,
                    "incoming_qc_required": bool(po_line.incoming_qc_required),
                    "qc_status": "PENDING" if po_line.incoming_qc_required else "PASS",
                },
                external_ref=f"GRN:{grn_no}:{idx}",
            )
        )
        qc_status = "PENDING" if po_line.incoming_qc_required else "PASS"
        db.add(
            PurchaseReceiptLine(
                receipt_id=receipt.id,
                purchase_order_line_id=po_line.id,
                item_id=po_line.item_id,
                batch_id=batch.id,
                qty_received=line_payload.qty_received,
                unit_cost=po_line.unit_cost,
                qc_status=qc_status,
            )
        )
        po_line.qty_received = float(po_line.qty_received or 0.0) + float(line_payload.qty_received)
        po_line.line_status = _line_status(po_line.qty_ordered, po_line.qty_received)
        response_lines.append(
            {
                "po_line_id": str(po_line.id),
                "batch_id": str(batch.id),
                "batch_no": batch.batch_no,
                "qty_received": line_payload.qty_received,
                "stock_status": stock_status,
                "qc_status": qc_status,
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
    current_user: dict = Depends(require_role(["Admin", "Store", "PlantManager", "QC"])),
):
    line = (
        db.query(PurchaseReceiptLine)
        .join(PurchaseReceipt, PurchaseReceiptLine.receipt_id == PurchaseReceipt.id)
        .filter(PurchaseReceiptLine.id == line_id, PurchaseReceipt.plant_id == plant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Receipt line not found")
    line.qc_status = payload.status
    if line.batch:
        line.batch.stock_status = "UNRESTRICTED" if payload.status == "PASS" else "QC_HOLD"
    if line.receipt:
        line.receipt.status = _receipt_status([receipt_line.qc_status for receipt_line in line.receipt.lines or []])
    db.commit()
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="purchase_receipt_qc_updated",
            entity_type="purchase_receipt_line",
            entity_id=str(line.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"QC status for receipt line set to {payload.status}",
            payload={
                "qc_status": payload.status,
                "batch_id": str(line.batch_id) if line.batch_id else None,
                "batch_stock_status": line.batch.stock_status if line.batch else None,
                "receipt_id": str(line.receipt_id) if line.receipt_id else None,
                "notes": payload.notes,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for purchase_receipt_qc_updated %s: %s", line.id, exc)
    return {
        "id": str(line.id),
        "qc_status": line.qc_status,
        "batch_id": str(line.batch_id) if line.batch_id else None,
        "batch_stock_status": line.batch.stock_status if line.batch else None,
        "notes": payload.notes,
    }
