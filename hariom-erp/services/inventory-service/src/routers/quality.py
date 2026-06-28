from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    CustomerRejection,
    InventoryLocation,
    InventoryQualityInspection,
    InventoryQualityTemplate,
    ItemMaster,
    ItemType,
    PaperReel,
    ReferenceType,
    StockAdjustmentLine,
    StockAdjustmentVoucher,
    StockBatch,
    StockTransaction,
    TransactionType,
)
from ..services import get_batch_balance
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/inventory/quality", tags=["inventory-quality"])

QC_TEMPLATE_PRESETS: tuple[dict[str, Any], ...] = (
    {"material_type": "ADHESIVE", "parameter_key": "viscosity", "label": "Viscosity", "input_type": "number", "required": True, "sort_order": 10},
    {"material_type": "ADHESIVE", "parameter_key": "temperature", "label": "Temperature", "input_type": "number", "required": True, "sort_order": 20},
    {"material_type": "ADHESIVE", "parameter_key": "solid_content", "label": "Solid Content", "input_type": "number", "required": True, "sort_order": 30},
    {"material_type": "ADHESIVE", "parameter_key": "color", "label": "Color", "input_type": "text", "required": True, "sort_order": 40},
    {"material_type": "ADHESIVE", "parameter_key": "ph", "label": "PH", "input_type": "number", "required": True, "sort_order": 50},
    {"material_type": "PARCHMENT", "parameter_key": "color_bleeding", "label": "Color Bleeding", "input_type": "select", "options": ["PASS", "FAIL"], "required": True, "sort_order": 10},
    {"material_type": "PARCHMENT", "parameter_key": "gsm", "label": "GSM", "input_type": "number", "required": True, "sort_order": 20},
    {"material_type": "PARCHMENT", "parameter_key": "bf", "label": "BF", "input_type": "number", "required": True, "sort_order": 30},
    {"material_type": "RAW_PAPER", "parameter_key": "gsm", "label": "GSM", "input_type": "number", "required": True, "sort_order": 10},
    {"material_type": "RAW_PAPER", "parameter_key": "bs", "label": "BS", "input_type": "number", "required": False, "sort_order": 20},
    {"material_type": "RAW_PAPER", "parameter_key": "bf", "label": "BF", "input_type": "number", "required": True, "sort_order": 30},
    {"material_type": "RAW_PAPER", "parameter_key": "caliper_mm", "label": "Caliper (mm)", "input_type": "number", "required": False, "sort_order": 40},
    {"material_type": "RAW_PAPER", "parameter_key": "bulk", "label": "Bulk", "input_type": "number", "required": False, "sort_order": 50},
    {"material_type": "RAW_PAPER", "parameter_key": "ply_bond", "label": "Ply Bond", "input_type": "number", "required": False, "sort_order": 60},
    {"material_type": "RAW_PAPER", "parameter_key": "rct", "label": "RCT", "input_type": "number", "required": False, "sort_order": 70},
    {"material_type": "RAW_PAPER", "parameter_key": "cobb", "label": "COBB", "input_type": "number", "required": False, "sort_order": 80},
    {"material_type": "RAW_PAPER", "parameter_key": "moisture_pct", "label": "Moisture %", "input_type": "number", "required": True, "sort_order": 90},
    {"material_type": "RAW_PAPER", "parameter_key": "clear_for_slitting", "label": "Clear For Slitting", "input_type": "select", "options": ["YES", "NO", "HOLD"], "required": True, "sort_order": 100},
    {"material_type": "FINISHED_GOOD", "parameter_key": "visual_defect", "label": "Visual Defect", "input_type": "text", "required": False, "sort_order": 10},
    {"material_type": "FINISHED_GOOD", "parameter_key": "reject_reason", "label": "Reject Reason", "input_type": "text", "required": True, "sort_order": 20},
    {"material_type": "FINISHED_GOOD", "parameter_key": "rework_possible", "label": "Rework Possible", "input_type": "select", "options": ["YES", "NO"], "required": True, "sort_order": 30},
)

VALID_ENTITY_TYPES = {"BATCH", "REEL", "CUSTOMER_REJECTION"}
VALID_SOURCES = {"INWARD", "CUSTOMER_REJECTION", "PROCESS_STAGE"}
VALID_INSPECTION_STATUS = {"PASS", "FAIL", "SKIPPED"}
VALID_DISPOSITIONS = {"ACCEPT", "REWORK", "REHEAT", "SEGREGATE", "SCRAP", "BLOCK"}


def normalize_material_type(value: str) -> str:
    normalized = str(value or "").strip().upper()
    aliases = {
        "PAPER": "RAW_PAPER",
        "REEL": "RAW_PAPER",
        "FG": "FINISHED_GOOD",
        "FINISHED": "FINISHED_GOOD",
    }
    normalized = aliases.get(normalized, normalized)
    allowed = {"ADHESIVE", "PARCHMENT", "RAW_PAPER", "FINISHED_GOOD", "PACKAGING", "OTHER"}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="Invalid material_type")
    return normalized


def normalize_disposition(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in VALID_DISPOSITIONS:
        raise HTTPException(status_code=400, detail=f"disposition must be one of {', '.join(sorted(VALID_DISPOSITIONS))}")
    return normalized


def stock_status_for_disposition(disposition: str) -> str:
    normalized = normalize_disposition(disposition)
    if normalized == "ACCEPT":
        return "UNRESTRICTED"
    if normalized in {"REWORK", "REHEAT", "SEGREGATE"}:
        return "WIP"
    if normalized == "SCRAP":
        return "SCRAP"
    return "BLOCKED"


def _clean_token(value: Optional[str]) -> str:
    token = re.sub(r"[^A-Z0-9]+", "-", (value or "").strip().upper()).strip("-")
    return token[:32] or "FG-RETURN"


def _next_customer_rejection_batch_no(db: Session, item: ItemMaster, plant_id: str) -> str:
    date_part = datetime.utcnow().strftime("%y%m%d")
    item_token = _clean_token(item.item_code or item.name)
    prefix = f"CR-{item_token}-{date_part}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        exists = db.query(StockBatch.id).filter(
            StockBatch.plant_id == plant_id,
            StockBatch.batch_no == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate customer rejection batch number")


def _next_customer_rejection_adjustment_no(db: Session, plant_id: str, effective_date: date) -> str:
    prefix = f"CRS-{effective_date.strftime('%Y%m%d')}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        exists = db.query(StockAdjustmentVoucher.id).filter(
            StockAdjustmentVoucher.plant_id == plant_id,
            StockAdjustmentVoucher.voucher_no == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate customer rejection scrap voucher")


def _material_type_for_item(item: ItemMaster) -> str:
    value = item.type.value if hasattr(item.type, "value") else str(item.type)
    return normalize_material_type(value)


def _template_rows(db: Session, plant_id: str, material_type: str) -> list[InventoryQualityTemplate]:
    material = normalize_material_type(material_type)
    rows = (
        db.query(InventoryQualityTemplate)
        .filter(
            InventoryQualityTemplate.material_type == material,
            InventoryQualityTemplate.plant_id.in_(["GLOBAL", plant_id]),
            InventoryQualityTemplate.active == "true",
        )
        .order_by(InventoryQualityTemplate.sort_order.asc(), InventoryQualityTemplate.label.asc())
        .all()
    )
    by_key: dict[str, InventoryQualityTemplate] = {}
    for row in rows:
        by_key[row.parameter_key] = row
    return sorted(by_key.values(), key=lambda row: (float(row.sort_order or 0), row.label))


def _missing_required_parameters(db: Session, plant_id: str, material_type: str, readings: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for row in _template_rows(db, plant_id, material_type):
        if bool(row.required) and readings.get(row.parameter_key) in (None, ""):
            missing.append(row.label)
    return missing


def _paper_reel_for_plant(db: Session, plant_id: str, reel_id: uuid.UUID) -> PaperReel:
    try:
        plant_uuid = uuid.UUID(str(plant_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid plant_id") from exc
    reel = db.query(PaperReel).filter(PaperReel.id == reel_id, PaperReel.plant_id == plant_uuid).first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")
    return reel


class QualityTemplateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    plant_id: str
    material_type: str
    parameter_key: str
    label: str
    input_type: str
    options: list[str] = Field(default_factory=list)
    required: bool
    sort_order: float


class QualityTemplateUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_type: str
    parameter_key: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=160)
    input_type: str = Field(default="number", max_length=30)
    options: list[str] = Field(default_factory=list)
    required: bool = False
    sort_order: float = 0.0
    active: bool = True

    @field_validator("material_type")
    @classmethod
    def validate_material_type(cls, value: str) -> str:
        return normalize_material_type(value)

    @field_validator("parameter_key")
    @classmethod
    def normalize_parameter_key(cls, value: str) -> str:
        return re.sub(r"[^a-z0-9_]+", "_", value.strip().lower()).strip("_")

    @field_validator("input_type")
    @classmethod
    def normalize_input_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"number", "text", "select", "boolean"}:
            raise ValueError("input_type must be number, text, select, or boolean")
        return normalized


class QualityInspectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str
    entity_id: uuid.UUID
    material_type: Optional[str] = None
    source: str = "INWARD"
    status: Optional[str] = None
    readings: dict[str, Any] = Field(default_factory=dict)
    failures: list[dict[str, Any]] = Field(default_factory=list)
    disposition: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("entity_type")
    @classmethod
    def validate_entity_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_ENTITY_TYPES:
            raise ValueError("entity_type must be BATCH, REEL, or CUSTOMER_REJECTION")
        return normalized

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_SOURCES:
            raise ValueError("source must be INWARD, CUSTOMER_REJECTION, or PROCESS_STAGE")
        return normalized

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in VALID_INSPECTION_STATUS:
            raise ValueError("status must be PASS, FAIL, or SKIPPED")
        return normalized

    @field_validator("material_type")
    @classmethod
    def validate_material_type(cls, value: Optional[str]) -> Optional[str]:
        return normalize_material_type(value) if value else value

    @field_validator("disposition")
    @classmethod
    def validate_disposition(cls, value: Optional[str]) -> Optional[str]:
        return normalize_disposition(value) if value else value


class QualityInspectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    material_type: str
    source: str
    status: str
    readings: dict[str, Any]
    failures: list[dict[str, Any]]
    disposition: Optional[str] = None
    stock_status: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


class PendingQualityItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str
    entity_id: uuid.UUID
    label: str
    material_type: str
    stock_status: str
    qty: float
    supplier_or_customer: Optional[str] = None
    created_at: Optional[datetime] = None
    source: str


class CustomerRejectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: uuid.UUID
    rejected_qty: float = Field(gt=0)
    customer_name: str = Field(min_length=1, max_length=200)
    customer_id: Optional[uuid.UUID] = None
    invoice_ref: Optional[str] = Field(default=None, max_length=120)
    dispatch_ref: Optional[str] = Field(default=None, max_length=120)
    reason_code: str = Field(min_length=1, max_length=80)
    reason_notes: Optional[str] = Field(default=None, max_length=1000)
    effective_date: Optional[date] = None
    source_batch_id: Optional[uuid.UUID] = None
    source_job_card_id: Optional[uuid.UUID] = None
    source_dispatch_id: Optional[uuid.UUID] = None
    source_spec_id: Optional[uuid.UUID] = None
    batch_no: Optional[str] = Field(default=None, max_length=120)
    location_id: Optional[uuid.UUID] = None
    trace_snapshot: dict[str, Any] = Field(default_factory=dict)
    attachment_refs: list[str] = Field(default_factory=list)


class CustomerRejectionDisposition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    disposition: str
    effective_date: Optional[date] = None
    root_cause_department: Optional[str] = Field(default=None, max_length=80)
    owner_department: Optional[str] = Field(default=None, max_length=80)
    corrective_action: Optional[str] = Field(default=None, max_length=2000)
    closure_due_date: Optional[date] = None
    closure_status: Optional[str] = Field(default=None, max_length=30)
    rework_cost: Optional[float] = Field(default=None, ge=0)
    scrap_cost: Optional[float] = Field(default=None, ge=0)
    cost_impact: Optional[float] = Field(default=None, ge=0)
    attachment_refs: list[str] = Field(default_factory=list)
    notes: Optional[str] = Field(default=None, max_length=1000)
    readings: dict[str, Any] = Field(default_factory=dict)
    failures: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("disposition")
    @classmethod
    def validate_disposition(cls, value: str) -> str:
        return normalize_disposition(value)


class CustomerRejectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID]
    rejected_qty: float
    customer_name: str
    invoice_ref: Optional[str] = None
    dispatch_ref: Optional[str] = None
    reason_code: str
    reason_notes: Optional[str] = None
    effective_date: Optional[date] = None
    source_job_card_id: Optional[uuid.UUID] = None
    source_dispatch_id: Optional[uuid.UUID] = None
    source_spec_id: Optional[uuid.UUID] = None
    status: str
    disposition: Optional[str] = None
    qc_inspection_id: Optional[uuid.UUID] = None
    trace_snapshot: dict[str, Any]
    root_cause_department: Optional[str] = None
    owner_department: Optional[str] = None
    corrective_action: Optional[str] = None
    closure_due_date: Optional[date] = None
    closure_status: str = "OPEN"
    rework_cost: float = 0.0
    scrap_cost: float = 0.0
    cost_impact: float = 0.0
    attachment_refs: list[str] = Field(default_factory=list)
    created_at: datetime
    closed_at: Optional[datetime] = None


def _template_response(row: InventoryQualityTemplate) -> QualityTemplateResponse:
    return QualityTemplateResponse(
        id=row.id,
        plant_id=row.plant_id,
        material_type=row.material_type,
        parameter_key=row.parameter_key,
        label=row.label,
        input_type=row.input_type,
        options=list(row.options or []),
        required=bool(row.required),
        sort_order=float(row.sort_order or 0),
    )


def _inspection_response(row: InventoryQualityInspection, stock_status: Optional[str] = None) -> QualityInspectionResponse:
    return QualityInspectionResponse(
        id=row.id,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        material_type=row.material_type,
        source=row.source,
        status=row.status,
        readings=dict(row.readings or {}),
        failures=list(row.failures or []),
        disposition=row.disposition,
        stock_status=stock_status,
        notes=row.notes,
        created_at=row.created_at,
    )


def _customer_rejection_response(row: CustomerRejection) -> CustomerRejectionResponse:
    return CustomerRejectionResponse(
        id=row.id,
        item_id=row.item_id,
        batch_id=row.batch_id,
        rejected_qty=float(row.rejected_qty or 0),
        customer_name=row.customer_name,
        invoice_ref=row.invoice_ref,
        dispatch_ref=row.dispatch_ref,
        reason_code=row.reason_code,
        reason_notes=row.reason_notes,
        effective_date=row.effective_date,
        source_job_card_id=row.source_job_card_id,
        source_dispatch_id=row.source_dispatch_id,
        source_spec_id=row.source_spec_id,
        status=row.status,
        disposition=row.disposition,
        qc_inspection_id=row.qc_inspection_id,
        trace_snapshot=dict(row.trace_snapshot or {}),
        root_cause_department=row.root_cause_department,
        owner_department=row.owner_department,
        corrective_action=row.corrective_action,
        closure_due_date=row.closure_due_date,
        closure_status=row.closure_status or "OPEN",
        rework_cost=float(row.rework_cost or 0.0),
        scrap_cost=float(row.scrap_cost or 0.0),
        cost_impact=float(row.cost_impact or 0.0),
        attachment_refs=list(row.attachment_refs or []),
        created_at=row.created_at,
        closed_at=row.closed_at,
    )


@router.get("/templates", response_model=list[QualityTemplateResponse])
def list_quality_templates(
    material_type: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store", "Production"])),
):
    plant_id = str(plant_scope.get("selected_plant_id") or "PLANT_A")
    if material_type:
        rows = _template_rows(db, plant_id, material_type)
    else:
        rows = (
            db.query(InventoryQualityTemplate)
            .filter(
                InventoryQualityTemplate.plant_id.in_(["GLOBAL", plant_id]),
                InventoryQualityTemplate.active == "true",
            )
            .order_by(InventoryQualityTemplate.material_type.asc(), InventoryQualityTemplate.sort_order.asc())
            .all()
        )
    return [_template_response(row) for row in rows]


@router.post("/templates", response_model=QualityTemplateResponse)
def upsert_quality_template(
    payload: QualityTemplateUpsert,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC"])),
):
    row = (
        db.query(InventoryQualityTemplate)
        .filter(
            InventoryQualityTemplate.plant_id == plant_id,
            InventoryQualityTemplate.material_type == payload.material_type,
            InventoryQualityTemplate.parameter_key == payload.parameter_key,
        )
        .first()
    )
    if not row:
        row = InventoryQualityTemplate(
            plant_id=plant_id,
            material_type=payload.material_type,
            parameter_key=payload.parameter_key,
        )
        db.add(row)
    row.label = payload.label
    row.input_type = payload.input_type
    row.options = payload.options
    row.required = payload.required
    row.sort_order = payload.sort_order
    row.active = "true" if payload.active else "false"
    db.commit()
    db.refresh(row)
    return _template_response(row)


@router.get("/pending", response_model=list[PendingQualityItem])
def list_pending_quality(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store", "Production"])),
):
    allowed_plants = [str(value) for value in (plant_scope.get("allowed_plants") or [])]
    selected_plant = str(plant_scope.get("selected_plant_id") or "PLANT_A")
    plant_filter = allowed_plants if plant_scope.get("scope_all") and allowed_plants else [selected_plant]
    rows: list[PendingQualityItem] = []

    batches = (
        db.query(StockBatch)
        .filter(StockBatch.plant_id.in_(plant_filter), StockBatch.stock_status.in_(["QC_HOLD", "BLOCKED"]))
        .order_by(StockBatch.created_at.desc())
        .limit(200)
        .all()
    )
    for batch in batches:
        item = batch.item
        rows.append(
            PendingQualityItem(
                entity_type="BATCH",
                entity_id=batch.id,
                label=f"{batch.batch_no} · {item.name if item else 'Item'}",
                material_type=_material_type_for_item(item) if item else "OTHER",
                stock_status=batch.stock_status,
                qty=float(get_batch_balance(str(batch.id), db)),
                supplier_or_customer=batch.supplier_name_snapshot,
                created_at=batch.created_at,
                source="INWARD",
            )
        )

    try:
        plant_uuids = [uuid.UUID(value) for value in plant_filter]
    except ValueError:
        plant_uuids = []
    if plant_uuids:
        reels = (
            db.query(PaperReel)
            .filter(PaperReel.plant_id.in_(plant_uuids), PaperReel.stock_status.in_(["QC_HOLD", "BLOCKED"]))
            .order_by(PaperReel.created_at.desc())
            .limit(200)
            .all()
        )
        for reel in reels:
            rows.append(
                PendingQualityItem(
                    entity_type="REEL",
                    entity_id=reel.id,
                    label=f"{reel.reel_code} · paper reel",
                    material_type="RAW_PAPER",
                    stock_status=reel.stock_status,
                    qty=float(reel.current_weight_kg or 0.0),
                    supplier_or_customer=reel.supplier_name_snapshot or reel.supplier_name,
                    created_at=reel.created_at,
                    source="INWARD",
                )
            )

    rejections = (
        db.query(CustomerRejection)
        .filter(CustomerRejection.plant_id.in_(plant_filter), CustomerRejection.status.in_(["QC_HOLD", "BLOCKED", "WIP"]))
        .order_by(CustomerRejection.created_at.desc())
        .limit(200)
        .all()
    )
    for rejection in rejections:
        rows.append(
            PendingQualityItem(
                entity_type="CUSTOMER_REJECTION",
                entity_id=rejection.id,
                label=f"{rejection.customer_name} · {rejection.reason_code}",
                material_type="FINISHED_GOOD",
                stock_status=rejection.status,
                qty=float(rejection.rejected_qty or 0.0),
                supplier_or_customer=rejection.customer_name,
                created_at=rejection.created_at,
                source="CUSTOMER_REJECTION",
            )
        )

    return sorted(rows, key=lambda row: row.created_at or datetime.min, reverse=True)


@router.post("/inspections", response_model=QualityInspectionResponse)
def create_quality_inspection(
    payload: QualityInspectionCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store"])),
):
    stock_status: Optional[str] = None
    material_type = payload.material_type
    batch: Optional[StockBatch] = None
    reel: Optional[PaperReel] = None
    rejection: Optional[CustomerRejection] = None

    if payload.entity_type == "BATCH":
        batch = db.query(StockBatch).filter(StockBatch.id == payload.entity_id, StockBatch.plant_id == plant_id).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        material_type = material_type or _material_type_for_item(batch.item)
    elif payload.entity_type == "REEL":
        reel = _paper_reel_for_plant(db, plant_id, payload.entity_id)
        material_type = material_type or "RAW_PAPER"
    else:
        rejection = db.query(CustomerRejection).filter(CustomerRejection.id == payload.entity_id, CustomerRejection.plant_id == plant_id).first()
        if not rejection:
            raise HTTPException(status_code=404, detail="Customer rejection not found")
        material_type = material_type or "FINISHED_GOOD"

    material_type = normalize_material_type(material_type or "OTHER")
    status = payload.status or ("FAIL" if payload.failures else "PASS")
    if status == "PASS":
        missing = _missing_required_parameters(db, plant_id, material_type, payload.readings or {})
        if missing:
            raise HTTPException(status_code=400, detail=f"QC pass requires readings: {', '.join(missing)}")

    inspection = InventoryQualityInspection(
        plant_id=plant_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        material_type=material_type,
        source=payload.source,
        status=status,
        readings=payload.readings or {},
        failures=payload.failures or [],
        disposition=payload.disposition,
        notes=payload.notes,
        created_by=current_user.get("sub"),
    )
    db.add(inspection)
    db.flush()

    if batch:
        if status == "PASS":
            batch.stock_status = stock_status_for_disposition(payload.disposition or "ACCEPT")
        elif status == "FAIL":
            batch.stock_status = stock_status_for_disposition(payload.disposition or "BLOCK")
        stock_status = batch.stock_status
    elif reel:
        if status == "PASS":
            reel.stock_status = stock_status_for_disposition(payload.disposition or "ACCEPT")
        elif status == "FAIL":
            reel.stock_status = stock_status_for_disposition(payload.disposition or "BLOCK")
        stock_status = reel.stock_status
    elif rejection:
        rejection.qc_inspection_id = inspection.id
        if status == "PASS":
            rejection.status = stock_status_for_disposition(payload.disposition or "ACCEPT")
        elif status == "FAIL":
            rejection.status = stock_status_for_disposition(payload.disposition or "BLOCK")
        stock_status = rejection.status

    db.commit()
    db.refresh(inspection)
    return _inspection_response(inspection, stock_status=stock_status)


@router.get("/inspections", response_model=list[QualityInspectionResponse])
def list_quality_inspections(
    entity_type: Optional[str] = Query(default=None),
    entity_id: Optional[uuid.UUID] = Query(default=None),
    source: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store", "Production", "Dispatch", "Sales"])),
):
    allowed_plants = [str(value) for value in (plant_scope.get("allowed_plants") or [])]
    selected_plant = str(plant_scope.get("selected_plant_id") or "PLANT_A")
    plant_filter = allowed_plants if plant_scope.get("scope_all") and allowed_plants else [selected_plant]
    query = db.query(InventoryQualityInspection).filter(InventoryQualityInspection.plant_id.in_(plant_filter))
    if entity_type:
        normalized_entity = entity_type.strip().upper()
        if normalized_entity not in VALID_ENTITY_TYPES:
            raise HTTPException(status_code=400, detail="Invalid entity_type")
        query = query.filter(InventoryQualityInspection.entity_type == normalized_entity)
    if entity_id:
        query = query.filter(InventoryQualityInspection.entity_id == entity_id)
    if source:
        normalized_source = source.strip().upper()
        if normalized_source not in VALID_SOURCES:
            raise HTTPException(status_code=400, detail="Invalid source")
        query = query.filter(InventoryQualityInspection.source == normalized_source)
    rows = query.order_by(InventoryQualityInspection.created_at.desc()).offset(offset).limit(limit).all()
    return [_inspection_response(row) for row in rows]


@router.post("/customer-rejections", response_model=CustomerRejectionResponse)
def create_customer_rejection(
    payload: CustomerRejectionCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store", "Dispatch", "Sales"])),
):
    item = db.query(ItemMaster).filter(ItemMaster.id == payload.item_id, ItemMaster.plant_id == plant_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.type != ItemType.FINISHED_GOOD:
        raise HTTPException(status_code=400, detail="Customer rejection inward requires a FINISHED_GOOD item")
    if payload.location_id:
        location = db.query(InventoryLocation).filter(InventoryLocation.id == payload.location_id, InventoryLocation.plant_id == plant_id).first()
        if not location:
            raise HTTPException(status_code=404, detail="Inventory location not found")

    trace_snapshot = {
        **dict(payload.trace_snapshot or {}),
        "source_batch_id": str(payload.source_batch_id) if payload.source_batch_id else None,
        "source_job_card_id": str(payload.source_job_card_id) if payload.source_job_card_id else None,
        "source_dispatch_id": str(payload.source_dispatch_id) if payload.source_dispatch_id else None,
        "source_spec_id": str(payload.source_spec_id) if payload.source_spec_id else None,
        "invoice_ref": payload.invoice_ref,
        "dispatch_ref": payload.dispatch_ref,
    }
    effective_date_value = payload.effective_date or date.today()
    rejection = CustomerRejection(
        plant_id=plant_id,
        customer_id=payload.customer_id,
        customer_name=payload.customer_name.strip(),
        item_id=payload.item_id,
        rejected_qty=payload.rejected_qty,
        invoice_ref=payload.invoice_ref,
        dispatch_ref=payload.dispatch_ref,
        reason_code=payload.reason_code.strip().upper(),
        reason_notes=payload.reason_notes,
        effective_date=effective_date_value,
        source_job_card_id=payload.source_job_card_id,
        source_dispatch_id=payload.source_dispatch_id,
        source_spec_id=payload.source_spec_id,
        status="QC_HOLD",
        trace_snapshot=trace_snapshot,
        attachment_refs=list(payload.attachment_refs or []),
        created_by=current_user.get("sub"),
    )
    db.add(rejection)
    db.flush()

    batch_no = (payload.batch_no or "").strip().upper() or _next_customer_rejection_batch_no(db, item, plant_id)
    batch = StockBatch(
        item_id=payload.item_id,
        batch_no=batch_no,
        received_qty=payload.rejected_qty,
        location_id=payload.location_id,
        stock_status="QC_HOLD",
        spec_id=payload.source_spec_id,
        plant_id=plant_id,
    )
    db.add(batch)
    db.flush()
    rejection.batch_id = batch.id

    transaction = StockTransaction(
        item_id=payload.item_id,
        batch_id=batch.id,
        transaction_type=TransactionType.FG_INWARD,
        qty_change=payload.rejected_qty,
        reference_type=ReferenceType.ADJUSTMENT,
        reference_id=rejection.id,
        plant_id=plant_id,
        location_id=payload.location_id,
        stock_status="QC_HOLD",
        movement_metadata={
            "customer_rejection_id": str(rejection.id),
            "batch_no": batch_no,
            "customer_name": payload.customer_name,
            "invoice_ref": payload.invoice_ref,
            "dispatch_ref": payload.dispatch_ref,
            "reason_code": rejection.reason_code,
        },
        external_ref=f"CUST-REJ:{rejection.id}",
        effective_date=effective_date_value,
    )
    db.add(transaction)
    db.commit()
    db.refresh(rejection)
    return _customer_rejection_response(rejection)


@router.get("/customer-rejections", response_model=list[CustomerRejectionResponse])
def list_customer_rejections(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store", "Dispatch", "Sales"])),
):
    allowed_plants = [str(value) for value in (plant_scope.get("allowed_plants") or [])]
    selected_plant = str(plant_scope.get("selected_plant_id") or "PLANT_A")
    plant_filter = allowed_plants if plant_scope.get("scope_all") and allowed_plants else [selected_plant]
    query = db.query(CustomerRejection).filter(CustomerRejection.plant_id.in_(plant_filter))
    if status:
        query = query.filter(CustomerRejection.status == status.strip().upper())
    rows = query.order_by(CustomerRejection.created_at.desc()).offset(offset).limit(limit).all()
    return [_customer_rejection_response(row) for row in rows]


@router.post("/customer-rejections/{rejection_id}/disposition", response_model=CustomerRejectionResponse)
def dispose_customer_rejection(
    rejection_id: uuid.UUID,
    payload: CustomerRejectionDisposition,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store"])),
):
    rejection = db.query(CustomerRejection).filter(CustomerRejection.id == rejection_id, CustomerRejection.plant_id == plant_id).first()
    if not rejection:
        raise HTTPException(status_code=404, detail="Customer rejection not found")
    if rejection.closed_at:
        raise HTTPException(status_code=400, detail="Customer rejection is already closed")
    target_stock_status = stock_status_for_disposition(payload.disposition)
    effective_date_value = payload.effective_date or date.today()
    computed_scrap_cost: Optional[float] = None
    if rejection.batch_id:
        batch = db.query(StockBatch).filter(StockBatch.id == rejection.batch_id, StockBatch.plant_id == plant_id).first()
        if batch:
            batch_qty_before_disposition = max(0.0, float(get_batch_balance(str(batch.id), db)))
            batch.stock_status = target_stock_status
            db.add(
                StockTransaction(
                    item_id=batch.item_id,
                    batch_id=batch.id,
                    transaction_type=TransactionType.MOVE,
                    qty_change=0.0,
                    reference_type=ReferenceType.ADJUSTMENT,
                    reference_id=rejection.id,
                    plant_id=plant_id,
                    location_id=batch.location_id,
                    stock_status=target_stock_status,
                    movement_metadata={
                        "customer_rejection_id": str(rejection.id),
                        "disposition": payload.disposition,
                        "notes": payload.notes,
                    },
                    external_ref=f"CUST-REJ-DISP:{rejection.id}:{payload.disposition}",
                    effective_date=effective_date_value,
                )
            )
            if payload.disposition == "SCRAP" and batch_qty_before_disposition > 0:
                item_cost = float(getattr(batch, "unit_cost", 0.0) or getattr(rejection.item, "unit_cost", 0.0) or 0.0)
                computed_scrap_cost = payload.scrap_cost if payload.scrap_cost is not None else round(batch_qty_before_disposition * item_cost, 2)
                voucher = StockAdjustmentVoucher(
                    plant_id=plant_id,
                    voucher_no=_next_customer_rejection_adjustment_no(db, plant_id, effective_date_value),
                    effective_date=effective_date_value,
                    reason_code="CUSTOMER_REJECTION_SCRAP",
                    reason_notes=payload.notes or rejection.reason_notes,
                    source_type="CUSTOMER_REJECTION",
                    source_id=rejection.id,
                    status="POSTED",
                    attachment_refs=list(payload.attachment_refs or rejection.attachment_refs or []),
                    created_by=current_user.get("sub") or "system",
                    approved_by=current_user.get("sub"),
                    posted_at=datetime.utcnow(),
                )
                db.add(voucher)
                db.flush()
                adjustment_line = StockAdjustmentLine(
                    adjustment_id=voucher.id,
                    item_id=batch.item_id,
                    batch_id=batch.id,
                    qty_delta=-batch_qty_before_disposition,
                    unit_cost=item_cost if item_cost > 0 else None,
                    location_id=batch.location_id,
                    stock_status="SCRAP",
                    reason_code="CUSTOMER_REJECTION_SCRAP",
                    notes=payload.notes or "Scrapped from customer rejection disposition.",
                )
                db.add(adjustment_line)
                db.flush()
                adjustment_txn = StockTransaction(
                    item_id=batch.item_id,
                    batch_id=batch.id,
                    transaction_type=TransactionType.ADJUSTMENT,
                    qty_change=-batch_qty_before_disposition,
                    reference_type=ReferenceType.ADJUSTMENT,
                    reference_id=voucher.id,
                    plant_id=plant_id,
                    location_id=batch.location_id,
                    stock_status="SCRAP",
                    movement_metadata={
                        "source_document_type": "CUSTOMER_REJECTION_SCRAP",
                        "customer_rejection_id": str(rejection.id),
                        "voucher_no": voucher.voucher_no,
                        "disposition": payload.disposition,
                        "scrap_cost": computed_scrap_cost,
                    },
                    external_ref=f"CUST-REJ-SCRAP:{rejection.id}",
                    effective_date=effective_date_value,
                )
                db.add(adjustment_txn)
                db.flush()
                adjustment_line.transaction_id = adjustment_txn.id

    inspection = InventoryQualityInspection(
        plant_id=plant_id,
        entity_type="CUSTOMER_REJECTION",
        entity_id=rejection.id,
        material_type="FINISHED_GOOD",
        source="CUSTOMER_REJECTION",
        status="FAIL" if payload.disposition in {"SCRAP", "BLOCK"} else "PASS",
        readings=payload.readings or {},
        failures=payload.failures or [],
        disposition=payload.disposition,
        notes=payload.notes,
        created_by=current_user.get("sub"),
    )
    db.add(inspection)
    db.flush()
    rework_cost = payload.rework_cost if payload.rework_cost is not None else float(rejection.rework_cost or 0.0)
    scrap_cost = (
        payload.scrap_cost
        if payload.scrap_cost is not None
        else computed_scrap_cost
        if computed_scrap_cost is not None
        else float(rejection.scrap_cost or 0.0)
    )
    rejection.status = target_stock_status
    rejection.disposition = payload.disposition
    rejection.qc_inspection_id = inspection.id
    rejection.root_cause_department = payload.root_cause_department or rejection.root_cause_department
    rejection.owner_department = payload.owner_department or rejection.owner_department
    rejection.corrective_action = payload.corrective_action or rejection.corrective_action
    rejection.closure_due_date = payload.closure_due_date or rejection.closure_due_date
    rejection.closure_status = (payload.closure_status or "CLOSED").strip().upper()
    rejection.rework_cost = rework_cost
    rejection.scrap_cost = scrap_cost
    rejection.cost_impact = payload.cost_impact if payload.cost_impact is not None else round(rework_cost + scrap_cost, 2)
    rejection.attachment_refs = list(payload.attachment_refs or rejection.attachment_refs or [])
    rejection.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(rejection)
    return _customer_rejection_response(rejection)
