from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..quality_pin import approved_profile_payload, is_missing_profile_pin, pin_quality_profile_metadata
from ..concession_partition import (
    CONCESSION_STOCK_STATUS,
    ConcessionPartitionError,
    ConcessionScopeError,
    concession_release_stock_status,
    lot_quantity,
    normalize_expires_at,
    remaining_hold_quantity,
    split_batch_identity,
    split_reel_code,
    validate_concession_quantity,
)
from ..models import (
    CustomerRejection,
    InventoryLocation,
    InventoryQualityConcession,
    InventoryQualityHold,
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
from ..quality_eval import evaluate_incoming, evaluate_incoming_quality, submission_error, non_waivable_release_detail
from ..quality_templates import ALLOWED_MATERIAL_TYPES
from ..services import get_batch_balance
from ..utils.auth import authorized_plant_ids, get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/inventory/quality", tags=["inventory-quality"])


VALID_ENTITY_TYPES = {"BATCH", "REEL", "CUSTOMER_REJECTION"}
VALID_SOURCES = {"INWARD", "CUSTOMER_REJECTION", "PROCESS_STAGE"}
VALID_INSPECTION_STATUS = {"PASS", "FAIL", "SKIPPED"}
VALID_DISPOSITIONS = {"ACCEPT", "REWORK", "REHEAT", "SEGREGATE", "SCRAP", "BLOCK"}
CONCESSION_PERMISSION = "qc:disposition:approve"
CONCESSION_ROLES = {"Owner", "Admin"}
CONCESSION_ELIGIBILITY = "RELEASED_BY_CONCESSION"
HELD_STOCK_STATUSES = {"QC_HOLD", "BLOCKED", "SCRAP", CONCESSION_STOCK_STATUS}


def _hold_reason_text(
    evaluation_payload: dict[str, Any],
    computed_failures: list[dict[str, Any]],
    status: str,
) -> str:
    """Hold.reason is NOT NULL. Never persist a blank explanation."""
    summary = evaluation_payload.get("issue_summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    for failure in computed_failures or []:
        if not isinstance(failure, dict):
            continue
        for key in ("message", "label", "detail", "code"):
            value = failure.get(key)
            if value:
                return str(value)
    for row in evaluation_payload.get("parameter_results") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("verdict") or "").upper() in {"FAIL", "INVALID", "INCOMPLETE"}:
            text = row.get("message") or row.get("label")
            if text:
                return str(text)
    return f"{status} incoming inspection"


def _pin_quality_profile(item: Optional[ItemMaster], entity: Any) -> Optional[dict[str, Any]]:
    """Freeze the approved profile onto the receipt/lot. Later master edits are not retroactive."""
    live = getattr(item, "quality_profile", None) if item is not None else None
    if entity is not None and hasattr(entity, "inward_metadata"):
        metadata = pin_quality_profile_metadata(getattr(entity, "inward_metadata", None), live)
        entity.inward_metadata = metadata
        pinned = metadata.get("quality_profile")
        return pinned if isinstance(pinned, dict) else None
    return approved_profile_payload(live)


def _open_entity_holds(db: Session, *, plant_id: str, entity_type: str, entity_id) -> list[InventoryQualityHold]:
    return (
        db.query(InventoryQualityHold)
        .filter(
            InventoryQualityHold.plant_id == plant_id,
            InventoryQualityHold.entity_type == entity_type,
            InventoryQualityHold.entity_id == entity_id,
            InventoryQualityHold.status == "HOLD",
        )
        .all()
    )


def require_concession_authority(current_user: dict, *, inspector_id: Optional[str]) -> None:
    actor = str(
        current_user.get("sub")
        or current_user.get("actor_identity")
        or current_user.get("user_id")
        or ""
    ).strip()
    inspector = str(inspector_id or "").strip()
    if actor and inspector and actor == inspector:
        raise HTTPException(
            status_code=403,
            detail="Concession approval requires a second person; the inspector cannot authorize their own FAIL.",
        )
    roles = set(current_user.get("roles") or [])
    permissions = set(current_user.get("permissions") or [])
    if CONCESSION_PERMISSION in permissions or roles.intersection(CONCESSION_ROLES):
        return
    raise HTTPException(
        status_code=403,
        detail="FAIL release requires the qc:disposition:approve capability.",
    )


def measured_inspection_status(*, supplied_status: Optional[str], failures: list[dict[str, Any]]) -> str:
    del supplied_status
    if failures:
        return "FAIL"
    return "PASS"


def reject_fail_accept_shortcut(status: str, disposition: Optional[str]) -> None:
    if status == "FAIL" and str(disposition or "").strip().upper() == "ACCEPT":
        raise HTTPException(
            status_code=403,
            detail="FAIL inspections cannot be unrestricted by disposition=ACCEPT. Use a permissioned concession approval.",
        )


def normalize_material_type(value: str) -> str:
    normalized = str(value or "").strip().upper()
    aliases = {
        "PAPER": "RAW_PAPER",
        "REEL": "RAW_PAPER",
        "FG": "FINISHED_GOOD",
        "FINISHED": "FINISHED_GOOD",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized == "PACKING":
        normalized = "PACKAGING"
    if normalized not in ALLOWED_MATERIAL_TYPES:
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
    reasons: dict[str, Any] = Field(default_factory=dict)
    supplier_certificate: Optional[dict[str, Any]] = None
    sample_count: Optional[int] = Field(default=None, ge=0)
    sample_ids: Optional[list[str]] = None
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
    eligibility_status: Optional[str] = None
    concession_reason: Optional[str] = None
    concession_approved_by: Optional[str] = None
    concession_approved_at: Optional[datetime] = None
    stock_status: Optional[str] = None
    notes: Optional[str] = None
    reasons: dict[str, Any] = Field(default_factory=dict)
    evaluation: dict[str, Any] = Field(default_factory=dict)
    ignored_client_status: Optional[str] = None
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
    item_id: Optional[uuid.UUID] = None
    quality_profile: Optional[dict[str, Any]] = None


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
        eligibility_status=getattr(row, "eligibility_status", None),
        concession_reason=getattr(row, "concession_reason", None),
        concession_approved_by=getattr(row, "concession_approved_by", None),
        concession_approved_at=getattr(row, "concession_approved_at", None),
        stock_status=stock_status,
        notes=row.notes,
        reasons=dict(getattr(row, "reasons", None) or {}),
        evaluation=dict(getattr(row, "evaluation", None) or {}),
        ignored_client_status=None,
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
    plant_id = authorized_plant_ids(plant_scope)[0] if not plant_scope.get("scope_all") else authorized_plant_ids(plant_scope)[0]
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
    plant_filter = authorized_plant_ids(plant_scope)
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
                item_id=item.id if item else None,
                quality_profile=(batch.inward_metadata or {}).get("quality_profile"),
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
            paper = getattr(reel, "paper", None)
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
                    item_id=paper.id if paper else getattr(reel, "paper_id", None),
                    quality_profile=(reel.inward_metadata or {}).get("quality_profile"),
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
        item = getattr(rejection, "item", None)
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
                item_id=rejection.item_id,
                quality_profile=getattr(item, "quality_profile", None) if item else None,
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
    batch: Optional[StockBatch] = None
    reel: Optional[PaperReel] = None
    rejection: Optional[CustomerRejection] = None

    # The material type — and therefore which frozen template rules apply — is
    # derived from the owned lot, never trusted from the request body. This closes
    # the trust shortcut where a caller could select a permissive template.
    if payload.entity_type == "BATCH":
        batch = db.query(StockBatch).filter(StockBatch.id == payload.entity_id, StockBatch.plant_id == plant_id).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        material_type = _material_type_for_item(batch.item)
    elif payload.entity_type == "REEL":
        reel = _paper_reel_for_plant(db, plant_id, payload.entity_id)
        material_type = "RAW_PAPER"
    else:
        rejection = db.query(CustomerRejection).filter(CustomerRejection.id == payload.entity_id, CustomerRejection.plant_id == plant_id).first()
        if not rejection:
            raise HTTPException(status_code=404, detail="Customer rejection not found")
        material_type = "FINISHED_GOOD"

    material_type = normalize_material_type(material_type or "OTHER")

    item: Optional[ItemMaster] = None
    if batch is not None:
        item = batch.item
    elif reel is not None:
        item = db.query(ItemMaster).filter(ItemMaster.id == reel.paper_id, ItemMaster.plant_id == plant_id).first()
    elif rejection is not None:
        item = rejection.item

    pin_entity = batch or reel or rejection
    profile = _pin_quality_profile(item, pin_entity)
    evaluation_payload: dict[str, Any] = {}
    computed_failures: list[dict[str, Any]] = []
    reasons = payload.reasons or {}
    reason_pending = False
    received_on = None
    if batch is not None:
        inward_txn = (
            db.query(StockTransaction)
            .filter(
                StockTransaction.batch_id == batch.id,
                StockTransaction.transaction_type == TransactionType.INWARD,
            )
            .order_by(StockTransaction.created_at.asc())
            .first()
        )
        received_on = inward_txn.effective_date if inward_txn is not None else None

    if profile:
        # Pinned receipt/item-profile ranges. Client status is ignored.
        # Persist the observation even when the explanation is still pending.
        # Supplier certificate values stay separate from local readings.
        evaluation = evaluate_incoming(
            profile=profile,
            readings=payload.readings or {},
            reasons=reasons,
            require_reasons_on_fail=True,
            plant_id=plant_id,
            as_of=received_on,
            item_id=item.id if item is not None else None,
        )
        status = evaluation.verdict
        computed_failures = list(evaluation.failures)
        evaluation_payload = evaluation.as_dict()
        if evaluation.missing_reasons:
            reason_pending = True
            evaluation_payload["workflow_status"] = "REASON_PENDING"
            evaluation_payload["reason_pending"] = True
        evaluation_payload["profile_revision"] = (profile or {}).get("revision")
        evaluation_payload["profile_pinned"] = True
        if payload.supplier_certificate:
            evaluation_payload["supplier_certificate"] = dict(payload.supplier_certificate)
            evaluation_payload["evidence_sources"] = {
                "local_readings": dict(payload.readings or {}),
                "supplier_certificate": dict(payload.supplier_certificate),
            }
        if payload.sample_count is not None:
            evaluation_payload["sample_count"] = payload.sample_count
        if payload.sample_ids:
            evaluation_payload["sample_ids"] = list(payload.sample_ids)
    else:
        # Fallback: template-based incoming verdict (p0 Q04). Client status is
        # ignored except that missing/invalid evidence cannot unlock stock.
        template_rows = _template_rows(db, plant_id, material_type)
        incoming = evaluate_incoming_quality(template_rows, payload.readings or {})
        status = incoming.status
        computed_failures = incoming.failures
        evaluation_payload = {"status": status, "failures": computed_failures, "evaluator": "incoming_template"}
        if payload.supplier_certificate:
            evaluation_payload["supplier_certificate"] = dict(payload.supplier_certificate)
            evaluation_payload["evidence_sources"] = {
                "local_readings": dict(payload.readings or {}),
                "supplier_certificate": dict(payload.supplier_certificate),
            }
        if payload.sample_count is not None:
            evaluation_payload["sample_count"] = payload.sample_count

    # Concession gate: FAIL/INVALID/INCOMPLETE + ACCEPT cannot unrestrict on
    # the inspection write path. A second-person Owner/Admin concession is required.
    if str(payload.disposition or "").strip().upper() == "ACCEPT" and is_missing_profile_pin(profile):
        item_label = getattr(item, "item_code", None) or "this material"
        raise HTTPException(
            status_code=409,
            detail=(
                f"No approved incoming QC profile for {item_label}. Approve it in the item's quality profile; "
                "lots already received pick it up on their next inspection."
            ),
        )
    reject_fail_accept_shortcut("FAIL" if status in {"FAIL", "INVALID", "INCOMPLETE"} else status, payload.disposition)

    inspection = InventoryQualityInspection(
        plant_id=plant_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        material_type=material_type,
        source=payload.source,
        status=status,
        readings=payload.readings or {},
        failures=computed_failures,
        reasons=reasons,
        evaluation=evaluation_payload,
        disposition=payload.disposition,
        notes=payload.notes,
        created_by=current_user.get("sub"),
    )
    db.add(inspection)
    db.flush()

    protected_stock_status = (batch or reel).stock_status if (batch or reel) else None
    held_statuses = {"FAIL", "INVALID", "INCOMPLETE"}
    if batch and protected_stock_status in {"UNRESTRICTED", "QC_HOLD", "BLOCKED"}:
        if status == "NOT_REQUIRED":
            batch.stock_status = "UNRESTRICTED"
            for txn in (
                db.query(StockTransaction)
                .filter(
                    StockTransaction.batch_id == batch.id,
                    StockTransaction.stock_status == "QC_HOLD",
                    StockTransaction.transaction_type == TransactionType.INWARD,
                )
                .all()
            ):
                txn.stock_status = batch.stock_status
        elif status == "PASS":
            batch.stock_status = stock_status_for_disposition(payload.disposition or "ACCEPT")
            for txn in (
                db.query(StockTransaction)
                .filter(
                    StockTransaction.batch_id == batch.id,
                    StockTransaction.stock_status == "QC_HOLD",
                    StockTransaction.transaction_type == TransactionType.INWARD,
                )
                .all()
            ):
                txn.stock_status = batch.stock_status
        elif status in held_statuses:
            batch.stock_status = (
                stock_status_for_disposition(payload.disposition)
                if payload.disposition
                else "QC_HOLD"
            )
        stock_status = batch.stock_status
    elif reel and protected_stock_status in {"UNRESTRICTED", "QC_HOLD", "BLOCKED"}:
        if status == "NOT_REQUIRED":
            reel.stock_status = "UNRESTRICTED"
        elif status == "PASS":
            reel.stock_status = stock_status_for_disposition(payload.disposition or "ACCEPT")
        elif status in held_statuses:
            reel.stock_status = (
                stock_status_for_disposition(payload.disposition)
                if payload.disposition
                else "QC_HOLD"
            )
        stock_status = reel.stock_status
    elif rejection:
        rejection.qc_inspection_id = inspection.id
        if status == "PASS":
            rejection.status = stock_status_for_disposition(payload.disposition or "ACCEPT")
        elif status in held_statuses:
            rejection.status = (
                stock_status_for_disposition(payload.disposition)
                if payload.disposition
                else "QC_HOLD"
            )
        stock_status = rejection.status

    if status in held_statuses:
        hold_qty = lot_quantity(batch=batch, reel=reel, rejection=rejection)
        db.add(
            InventoryQualityHold(
                plant_id=plant_id,
                entity_type=payload.entity_type,
                entity_id=payload.entity_id,
                source_inspection_id=inspection.id,
                quantity=hold_qty,
                reason=_hold_reason_text(evaluation_payload, computed_failures, status),
                status="HOLD",
                hold_kind="INSPECTION",
                created_by=current_user.get("sub"),
            )
        )
        if reason_pending:
            evaluation_payload["workflow_status"] = "REASON_PENDING"

    # Apply independent lot holds and commercial approval after the verdict.
    if batch or reel:
        from ..models import ReceiptStockAllocation, PurchaseReceiptLine
        from ..services.receipt_quality import refresh_receipt_stock
        db.flush()
        owner = db.query(ReceiptStockAllocation).filter(
            ReceiptStockAllocation.batch_id == batch.id if batch else ReceiptStockAllocation.reel_id == reel.id
        ).first()
        entity = batch or reel
        if owner:
            line = db.query(PurchaseReceiptLine).filter_by(id=owner.receipt_line_id).one()
            refresh_receipt_stock(db, line)
        elif status in {"PASS", "NOT_REQUIRED"} and _open_entity_holds(db, plant_id=plant_id, entity_type=payload.entity_type, entity_id=payload.entity_id):
            entity.stock_status = "QC_HOLD"
            if batch:
                for txn in db.query(StockTransaction).filter_by(batch_id=batch.id, transaction_type=TransactionType.INWARD).all():
                    if txn.stock_status == "UNRESTRICTED":
                        txn.stock_status = "QC_HOLD"
        stock_status = entity.stock_status
    db.commit()
    db.refresh(inspection)
    response = _inspection_response(inspection, stock_status=stock_status)
    response.ignored_client_status = payload.status
    return response


class QualityConcessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inspection_id: uuid.UUID
    reason: str = Field(min_length=1, max_length=2000)
    quantity: Optional[float] = Field(default=None, ge=0)
    release_stock: bool = False
    operation_id: Optional[str] = Field(default=None, max_length=120)
    permitted_customer_id: Optional[uuid.UUID] = None
    permitted_sales_order_id: Optional[uuid.UUID] = None
    expires_at: Optional[datetime] = None

    @field_validator("expires_at")
    @classmethod
    def _naive_expires_at(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is not None:
            return value.replace(tzinfo=None)
        return value


class QualityConcessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inspection_id: uuid.UUID
    measured_status: str
    eligibility_status: str
    disposition: str
    stock_status: Optional[str] = None
    hold_released: bool
    approved_by: Optional[str] = None
    inspector_id: Optional[str] = None
    reason: str
    quantity: Optional[float] = None
    residual_qty: Optional[float] = None
    released_entity_id: Optional[uuid.UUID] = None
    independent_holds_remaining: float = 0
    replayed: bool = False
    concession_id: Optional[uuid.UUID] = None
    permitted_customer_id: Optional[uuid.UUID] = None
    permitted_sales_order_id: Optional[uuid.UUID] = None
    expires_at: Optional[datetime] = None
    released_stock_status: Optional[str] = None
    visibly_separate: bool = True


class QualityConcessionRecord(QualityConcessionResponse):
    approved_at: Optional[datetime] = None


def _concession_scope_metadata(payload: QualityConcessionCreate, expires_at: Optional[datetime]) -> dict[str, Any]:
    return {
        "permitted_customer_id": str(payload.permitted_customer_id) if payload.permitted_customer_id else None,
        "permitted_sales_order_id": str(payload.permitted_sales_order_id) if payload.permitted_sales_order_id else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
    }


def _set_inward_txn_status(db: Session, *, batch: StockBatch, status: str) -> None:
    for txn in (
        db.query(StockTransaction)
        .filter(
            StockTransaction.batch_id == batch.id,
            StockTransaction.stock_status == "QC_HOLD",
            StockTransaction.transaction_type == TransactionType.INWARD,
        )
        .all()
    ):
        txn.stock_status = status


def _post_batch_partition_ledger(
    db: Session,
    *,
    parent: StockBatch,
    child: StockBatch,
    qty: float,
    child_status: str,
    plant_id: str,
    inspection_id: uuid.UUID,
) -> None:
    db.add(
        StockTransaction(
            item_id=parent.item_id,
            batch_id=parent.id,
            transaction_type=TransactionType.MOVE,
            qty_change=-qty,
            reference_type=ReferenceType.INTERNAL,
            reference_id=inspection_id,
            plant_id=plant_id,
            location_id=parent.location_id,
            stock_status=parent.stock_status or "QC_HOLD",
            movement_metadata={"concession_partition": True, "child_batch_id": str(child.id)},
            effective_date=date.today(),
        )
    )
    db.add(
        StockTransaction(
            item_id=child.item_id,
            batch_id=child.id,
            transaction_type=TransactionType.INWARD,
            qty_change=qty,
            reference_type=ReferenceType.INTERNAL,
            reference_id=inspection_id,
            plant_id=plant_id,
            location_id=child.location_id,
            stock_status=child_status,
            movement_metadata={"concession_partition": True, "parent_batch_id": str(parent.id)},
            effective_date=date.today(),
        )
    )


def _released_entity_stock_status(db: Session, concession: InventoryQualityConcession) -> Optional[str]:
    if concession.released_entity_id is None:
        return None
    entity_type = str(concession.entity_type or "").upper()
    if entity_type == "BATCH" or entity_type == "CUSTOMER_REJECTION":
        batch = db.query(StockBatch).filter(StockBatch.id == concession.released_entity_id).first()
        if batch is not None:
            return batch.stock_status
    if entity_type == "REEL":
        reel = db.query(PaperReel).filter(PaperReel.id == concession.released_entity_id).first()
        if reel is not None:
            return reel.stock_status
    return concession.stock_status_after


def _concession_response(
    *,
    inspection: InventoryQualityInspection,
    concession: InventoryQualityConcession,
    stock_status: Optional[str],
    residual_qty: Optional[float],
    independent_holds_remaining: float,
    replayed: bool,
    released_stock_status: Optional[str],
) -> QualityConcessionResponse:
    return QualityConcessionResponse(
        inspection_id=inspection.id,
        measured_status="FAIL",
        eligibility_status=CONCESSION_ELIGIBILITY,
        disposition=inspection.disposition or "ACCEPT",
        stock_status=stock_status,
        hold_released=bool(concession.hold_released),
        approved_by=concession.approved_by,
        inspector_id=concession.inspector_id,
        reason=concession.reason,
        quantity=concession.quantity,
        residual_qty=residual_qty,
        released_entity_id=concession.released_entity_id,
        independent_holds_remaining=independent_holds_remaining,
        replayed=replayed,
        concession_id=concession.id,
        permitted_customer_id=getattr(concession, "permitted_customer_id", None),
        permitted_sales_order_id=getattr(concession, "permitted_sales_order_id", None),
        expires_at=getattr(concession, "expires_at", None),
        released_stock_status=released_stock_status,
        visibly_separate=True,
    )


@router.post("/concessions", response_model=QualityConcessionResponse)
def create_quality_concession(
    payload: QualityConcessionCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "QC", "PlantManager"])),
):
    inspection = (
        db.query(InventoryQualityInspection)
        .filter(InventoryQualityInspection.id == payload.inspection_id, InventoryQualityInspection.plant_id == plant_id)
        .first()
    )
    if not inspection:
        raise HTTPException(status_code=404, detail="Quality inspection not found")
    if str(inspection.status or "").upper() != "FAIL":
        raise HTTPException(status_code=400, detail="Concession applies only to measured FAIL inspections")
    require_concession_authority(current_user, inspector_id=inspection.created_by)
    critical_detail = non_waivable_release_detail(inspection.evaluation)
    if critical_detail:
        raise HTTPException(status_code=409, detail=critical_detail)

    replay_query = db.query(InventoryQualityConcession).filter(
        InventoryQualityConcession.inspection_id == inspection.id,
        InventoryQualityConcession.plant_id == plant_id,
    )
    if payload.operation_id:
        replay_query = replay_query.filter(InventoryQualityConcession.operation_id == payload.operation_id)
    existing = replay_query.order_by(InventoryQualityConcession.created_at.desc()).first()
    if existing and (
        payload.operation_id
        or (
            existing.quantity is not None
            and payload.quantity is not None
            and abs(float(existing.quantity) - float(payload.quantity)) < 1e-9
        )
    ):
        return _concession_response(
            inspection=inspection,
            concession=existing,
            stock_status=existing.stock_status_after,
            residual_qty=None,
            independent_holds_remaining=remaining_hold_quantity(
                _open_entity_holds(db, plant_id=plant_id, entity_type=inspection.entity_type, entity_id=inspection.entity_id)
            ),
            replayed=True,
            released_stock_status=_released_entity_stock_status(db, existing),
        )

    try:
        expires_at = normalize_expires_at(payload.expires_at)
    except ConcessionScopeError as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    released_status = concession_release_stock_status(
        permitted_customer_id=payload.permitted_customer_id,
        permitted_sales_order_id=payload.permitted_sales_order_id,
        expires_at=expires_at,
    )
    scope_meta = _concession_scope_metadata(payload, expires_at)

    stock_status: Optional[str] = None
    stock_status_before: Optional[str] = None
    hold_released = False
    released_entity_id = None
    residual_qty = None
    released_stock_status: Optional[str] = None
    batch = None
    reel = None
    rejection = None
    if inspection.entity_type == "BATCH":
        batch = (
            db.query(StockBatch)
            .filter(StockBatch.id == inspection.entity_id, StockBatch.plant_id == plant_id)
            .with_for_update()
            .first()
        )
        stock_status_before = batch.stock_status if batch else None
        stock_status = stock_status_before
    elif inspection.entity_type == "REEL":
        reel = _paper_reel_for_plant(db, plant_id, inspection.entity_id)
        if reel is not None:
            reel = (
                db.query(PaperReel)
                .filter(PaperReel.id == reel.id)
                .with_for_update()
                .first()
            )
        stock_status_before = reel.stock_status if reel else None
        stock_status = stock_status_before
    elif inspection.entity_type == "CUSTOMER_REJECTION":
        rejection = (
            db.query(CustomerRejection)
            .filter(CustomerRejection.id == inspection.entity_id, CustomerRejection.plant_id == plant_id)
            .with_for_update()
            .first()
        )
        stock_status_before = rejection.status if rejection else None
        stock_status = stock_status_before

    if payload.release_stock and (batch or reel):
        from ..models import ReceiptStockAllocation, PurchaseReceiptLine
        from ..services.receipt_quality import CLEAR_COMMERCIAL
        allocation = db.query(ReceiptStockAllocation).filter(
            ReceiptStockAllocation.batch_id == batch.id if batch else ReceiptStockAllocation.reel_id == reel.id
        ).first()
        if allocation:
            line = db.query(PurchaseReceiptLine).filter_by(id=allocation.receipt_line_id).one()
            if line.commercial_status not in CLEAR_COMMERCIAL:
                raise HTTPException(status_code=409, detail="Resolve the receipt's commercial hold before releasing concession stock")

    open_holds = _open_entity_holds(
        db, plant_id=plant_id, entity_type=inspection.entity_type, entity_id=inspection.entity_id
    )
    independent_qty = remaining_hold_quantity(open_holds, excluding_inspection_id=str(inspection.id))
    lot_qty = lot_quantity(batch=batch, reel=reel, rejection=rejection)
    try:
        release_qty, residual_qty = validate_concession_quantity(
            payload.quantity,
            lot_qty,
            independent_hold_qty=independent_qty,
        )
    except ConcessionPartitionError as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc

    inspection.status = "FAIL"
    inspection.disposition = inspection.disposition or "ACCEPT"
    inspection.eligibility_status = CONCESSION_ELIGIBILITY
    inspection.concession_reason = payload.reason
    inspection.concession_approved_by = current_user.get("sub")
    inspection.concession_approved_at = datetime.utcnow()
    evaluation = dict(inspection.evaluation or {})
    evaluation["concession"] = {
        "visibly_separate": True,
        "measured_status": "FAIL",
        "released_stock_status": released_status if payload.release_stock else None,
        **scope_meta,
        "quantity": release_qty,
    }
    inspection.evaluation = evaluation
    flag_modified(inspection, "evaluation")

    if payload.release_stock:
        suffix = str(uuid.uuid4())[:8]
        if batch:
            if residual_qty <= 1e-9 and independent_qty <= 1e-9:
                batch.stock_status = released_status
                _set_inward_txn_status(db, batch=batch, status=released_status)
                stock_status = batch.stock_status
                released_stock_status = released_status
                hold_released = True
                released_entity_id = batch.id
            else:
                child = StockBatch(
                    item_id=batch.item_id,
                    batch_no=split_batch_identity(batch.batch_no, suffix),
                    received_qty=release_qty,
                    location=batch.location,
                    location_id=batch.location_id,
                    stock_status=released_status,
                    unit_cost=batch.unit_cost,
                    cost_source=batch.cost_source,
                    supplier_id=batch.supplier_id,
                    supplier_name_snapshot=batch.supplier_name_snapshot,
                    plant_id=batch.plant_id,
                    spec_id=batch.spec_id,
                    inward_metadata={
                        **(batch.inward_metadata or {}),
                        "parent_batch_id": str(batch.id),
                        "concession_partition": True,
                        "concession_inspection_id": str(inspection.id),
                        "concession_scope": scope_meta,
                    },
                )
                db.add(child)
                db.flush()
                batch.received_qty = residual_qty
                batch.stock_status = "QC_HOLD" if residual_qty > 1e-9 or independent_qty > 1e-9 else released_status
                _post_batch_partition_ledger(
                    db,
                    parent=batch,
                    child=child,
                    qty=release_qty,
                    child_status=released_status,
                    plant_id=plant_id,
                    inspection_id=inspection.id,
                )
                stock_status = batch.stock_status
                released_stock_status = released_status
                hold_released = True
                released_entity_id = child.id
        elif reel:
            if residual_qty <= 1e-9 and independent_qty <= 1e-9:
                reel.stock_status = released_status
                stock_status = reel.stock_status
                released_stock_status = released_status
                hold_released = True
                released_entity_id = reel.id
            else:
                child = PaperReel(
                    plant_id=reel.plant_id,
                    reel_code=split_reel_code(reel.reel_code, suffix),
                    paper_id=reel.paper_id,
                    gsm=reel.gsm,
                    bf=reel.bf,
                    supplier_name=reel.supplier_name,
                    supplier_id=reel.supplier_id,
                    supplier_name_snapshot=reel.supplier_name_snapshot,
                    inward_weight_kg=release_qty,
                    current_weight_kg=release_qty,
                    unit_cost=reel.unit_cost,
                    cost_source=reel.cost_source,
                    status=reel.status,
                    stock_status=released_status,
                    location_id=reel.location_id,
                    parent_reel_id=reel.id,
                    genealogy_metadata={"concession_partition": True, "parent_reel_id": str(reel.id)},
                    inward_metadata={
                        **(reel.inward_metadata or {}),
                        "concession_inspection_id": str(inspection.id),
                        "concession_scope": scope_meta,
                    },
                    inward_date=reel.inward_date,
                )
                db.add(child)
                db.flush()
                reel.current_weight_kg = residual_qty
                reel.inward_weight_kg = max(float(reel.inward_weight_kg or 0.0), residual_qty)
                reel.stock_status = "QC_HOLD" if residual_qty > 1e-9 or independent_qty > 1e-9 else released_status
                stock_status = reel.stock_status
                released_stock_status = released_status
                hold_released = True
                released_entity_id = child.id
        elif rejection:
            if residual_qty <= 1e-9 and independent_qty <= 1e-9:
                rejection.status = "UNRESTRICTED"
                stock_status = rejection.status
                released_stock_status = rejection.status
                hold_released = True
                released_entity_id = rejection.id
                if rejection.batch_id:
                    linked = (
                        db.query(StockBatch)
                        .filter(StockBatch.id == rejection.batch_id, StockBatch.plant_id == plant_id)
                        .with_for_update()
                        .first()
                    )
                    if linked and independent_qty <= 1e-9:
                        linked.stock_status = "UNRESTRICTED"
            else:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "PARTIAL_REJECTION_UNSUPPORTED",
                        "message": "Partial concession of a customer-rejection lot requires an identified batch/reel partition.",
                    },
                )

        for hold in open_holds:
            if str(hold.source_inspection_id or "") == str(inspection.id):
                remaining = round(float(hold.quantity or 0.0) - release_qty, 6)
                if remaining <= 1e-9:
                    hold.status = "RELEASED"
                    hold.released_by = current_user.get("sub")
                    hold.released_at = datetime.utcnow()
                    hold.quantity = 0
                else:
                    hold.quantity = remaining

    concession = InventoryQualityConcession(
        plant_id=plant_id,
        inspection_id=inspection.id,
        entity_type=inspection.entity_type,
        entity_id=inspection.entity_id,
        measured_status="FAIL",
        eligibility_status=CONCESSION_ELIGIBILITY,
        disposition=inspection.disposition,
        stock_status_before=stock_status_before,
        stock_status_after=stock_status,
        hold_released=hold_released,
        reason=payload.reason,
        quantity=release_qty,
        inspector_id=inspection.created_by,
        approved_by=current_user.get("sub"),
        released_entity_id=released_entity_id,
        residual_entity_id=inspection.entity_id if residual_qty and residual_qty > 1e-9 else None,
        operation_id=payload.operation_id,
        permitted_customer_id=payload.permitted_customer_id,
        permitted_sales_order_id=payload.permitted_sales_order_id,
        expires_at=expires_at,
    )
    db.add(concession)
    db.commit()
    db.refresh(inspection)
    db.refresh(concession)
    return _concession_response(
        inspection=inspection,
        concession=concession,
        stock_status=stock_status,
        residual_qty=residual_qty,
        independent_holds_remaining=remaining_hold_quantity(
            _open_entity_holds(db, plant_id=plant_id, entity_type=inspection.entity_type, entity_id=inspection.entity_id)
        ),
        replayed=False,
        released_stock_status=released_stock_status or _released_entity_stock_status(db, concession),
    )


@router.get("/concessions", response_model=list[QualityConcessionRecord])
def list_quality_concessions(
    inspection_id: Optional[uuid.UUID] = Query(default=None),
    entity_id: Optional[uuid.UUID] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "Store", "Production", "Dispatch", "Sales"])),
):
    plant_filter = authorized_plant_ids(plant_scope)
    query = db.query(InventoryQualityConcession).filter(InventoryQualityConcession.plant_id.in_(plant_filter))
    if inspection_id:
        query = query.filter(InventoryQualityConcession.inspection_id == inspection_id)
    if entity_id:
        query = query.filter(
            (InventoryQualityConcession.entity_id == entity_id)
            | (InventoryQualityConcession.released_entity_id == entity_id)
        )
    rows = query.order_by(InventoryQualityConcession.created_at.desc()).offset(offset).limit(limit).all()
    records: list[QualityConcessionRecord] = []
    for row in rows:
        inspection = db.query(InventoryQualityInspection).filter(InventoryQualityInspection.id == row.inspection_id).first()
        if inspection is None:
            continue
        base = _concession_response(
            inspection=inspection,
            concession=row,
            stock_status=row.stock_status_after,
            residual_qty=None,
            independent_holds_remaining=0,
            replayed=False,
            released_stock_status=_released_entity_stock_status(db, row),
        )
        records.append(
            QualityConcessionRecord(
                **base.model_dump(),
                approved_at=row.created_at,
            )
        )
    return records


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
    plant_filter = authorized_plant_ids(plant_scope)
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


class DestructiveSampleConsume(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    qty: float = Field(gt=0)


@router.post("/inspections/{inspection_id}/consume-sample")
def consume_destructive_sample(
    inspection_id: uuid.UUID,
    payload: DestructiveSampleConsume,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC"])),
):
    from ..services.stock_calc import get_batch_balance, get_usable_item_qty

    inspection = (
        db.query(InventoryQualityInspection)
        .filter(InventoryQualityInspection.id == inspection_id, InventoryQualityInspection.plant_id == plant_id)
        .first()
    )
    if inspection is None:
        raise HTTPException(status_code=404, detail="Quality inspection not found")
    if str(inspection.entity_type or "").upper() != "BATCH":
        raise HTTPException(status_code=400, detail="Destructive sample consumption applies to batch inspections")
    batch = db.query(StockBatch).filter(StockBatch.id == inspection.entity_id, StockBatch.plant_id == plant_id).first()
    if batch is None:
        raise HTTPException(status_code=404, detail="Inspected batch not found")
    item = db.query(ItemMaster).filter(ItemMaster.id == batch.item_id).first()
    profile = (item.quality_profile if item is not None else None) or {}
    policy = profile.get("destructive_sample") if isinstance(profile, dict) else None
    if not isinstance(policy, dict) or not policy.get("enabled"):
        raise HTTPException(status_code=400, detail="No approved destructive sample policy on this item")
    approved_qty = float(policy.get("qty") or 0.0)
    if approved_qty <= 0:
        raise HTTPException(status_code=400, detail="Destructive sample policy quantity must be positive")
    if abs(float(payload.qty) - approved_qty) > 1e-9:
        raise HTTPException(status_code=400, detail="Consumption quantity must match the approved destructive sample policy")
    coverage = (inspection.evaluation or {}).get("sample_count")
    if coverage is None:
        coverage = (batch.inward_metadata or {}).get("sample_count")
    external_ref = f"SAMPLE:{inspection.id}"
    existing = (
        db.query(StockTransaction)
        .filter(StockTransaction.external_ref == external_ref, StockTransaction.plant_id == plant_id)
        .first()
    )
    if existing:
        return {
            "inspection_id": str(inspection.id),
            "transaction_id": str(existing.id),
            "sample_coverage": coverage,
            "consumed_qty": abs(float(existing.qty_change or 0.0)),
            "idempotent": True,
            "usable_qty": get_usable_item_qty(str(batch.item_id), db),
        }
    balance = get_batch_balance(str(batch.id), db)
    if float(payload.qty) - balance > 1e-9:
        raise HTTPException(status_code=400, detail="Destructive sample exceeds remaining batch quantity")
    txn = StockTransaction(
        item_id=batch.item_id,
        batch_id=batch.id,
        transaction_type=TransactionType.ADJUSTMENT,
        effective_date=date.today(),
        qty_change=-float(payload.qty),
        reference_type=ReferenceType.ADJUSTMENT,
        reference_id=inspection.id,
        plant_id=plant_id,
        location_id=batch.location_id,
        stock_status=batch.stock_status,
        movement_metadata={
            "kind": "DESTRUCTIVE_SAMPLE",
            "sample_coverage": coverage,
            "consumed_qty": float(payload.qty),
            "policy_qty": approved_qty,
        },
        external_ref=external_ref,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return {
        "inspection_id": str(inspection.id),
        "transaction_id": str(txn.id),
        "sample_coverage": coverage,
        "consumed_qty": float(payload.qty),
        "idempotent": False,
        "usable_qty": get_usable_item_qty(str(batch.item_id), db),
        "sample_coverage_field": "evaluation.sample_count",
        "consumed_field": "stock_transaction.qty_change",
    }


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
    plant_filter = authorized_plant_ids(plant_scope)
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
    held_rejection = str(rejection.status or "").upper() in {"QC_HOLD", "BLOCKED"}
    if payload.disposition == "ACCEPT" and held_rejection:
        require_concession_authority(current_user, inspector_id=rejection.created_by)
        target_stock_status = rejection.status
    else:
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
        status=(
            "FAIL"
            if payload.disposition in {"SCRAP", "BLOCK"} or (held_rejection and payload.disposition == "ACCEPT")
            else "PASS"
        ),
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
