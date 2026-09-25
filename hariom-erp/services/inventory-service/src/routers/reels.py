from datetime import date, datetime
from typing import Any, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import get_settings
from ..models import (
    CostSource,
    InventoryLocation,
    ItemMaster,
    ItemType,
    LotLabelRecord,
    PaperReel,
    ReelIssue,
    ReelIssueStatus,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReelStatus,
    TrackingMode,
)
from ..services.labels import reel_label_payload
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_role
from ..quality_pin import pin_quality_profile_metadata

router = APIRouter(prefix="/reels", tags=["reels"])

VALID_REEL_STATUSES = {"IN_STOCK", "ISSUED", "CONSUMED", "SCRAP"}
VALID_SCAN_EVENT_TYPES = {"INWARD_SCAN", "ISSUE_SCAN", "CLOSE_SCAN", "MOVE_SCAN", "SLIT_SCAN"}
VALID_SCAN_SOURCES = {"INVENTORY", "PRODUCTION"}
VALID_STOCK_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}


def _to_uuid(value: str, field: str = "plant_id") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value}") from exc


def _normalize_status(status_value: Optional[str]) -> Optional[str]:
    if status_value is None:
        return None
    normalized = status_value.strip().upper()
    if normalized not in VALID_REEL_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return normalized


def _parse_uuid_list(value: Optional[str], field_name: str) -> list[uuid.UUID]:
    if not value:
        return []
    parsed: list[uuid.UUID] = []
    for raw in value.split(","):
        text = raw.strip()
        if not text:
            continue
        try:
            parsed.append(uuid.UUID(text))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid {field_name}: {text}") from exc
    return parsed


class ReelInwardCreate(BaseModel):
    reel_code: Optional[str] = Field(default=None, min_length=1, max_length=100)
    amigo_no: Optional[str] = Field(default=None, min_length=1, max_length=100)
    paper_id: uuid.UUID
    gsm: Optional[float] = Field(default=None, ge=0)
    bf: Optional[float] = Field(default=None, ge=0)
    supplier_id: uuid.UUID
    supplier_name: str = Field(min_length=1, max_length=200)
    inward_weight_kg: float = Field(gt=0)
    inward_date: date
    unit_cost: Optional[float] = Field(default=None, ge=0)
    cost_source: Optional[str] = None
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "QC_HOLD"
    mill: Optional[str] = Field(default=None, max_length=200)
    plybond: Optional[float] = Field(default=None, ge=0)
    variety: Optional[str] = Field(default=None, max_length=160)
    source_reel_no: Optional[str] = Field(default=None, max_length=120)
    slitting_status: Optional[str] = Field(default=None, max_length=40)
    po_no: Optional[str] = Field(default=None, max_length=80)
    bill_no: Optional[str] = Field(default=None, max_length=120)
    bill_date: Optional[date] = None
    rate: Optional[float] = Field(default=None, ge=0)
    paper_master_snapshot: Optional[dict[str, Any]] = None
    inward_metadata: Optional[dict[str, Any]] = None

    @field_validator("reel_code", "amigo_no")
    @classmethod
    def normalize_reel_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().upper()
        return cleaned or None

    @field_validator("mill", "variety", "source_reel_no", "slitting_status", "po_no", "bill_no")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None

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
        if normalized not in {source.value for source in CostSource}:
            raise ValueError("cost_source must be MANUAL, SUPPLIER, or AVG_BATCH")
        return normalized

    @field_validator("stock_status")
    @classmethod
    def normalize_stock_status(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized


class ReelResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    reel_code: str
    paper_id: uuid.UUID
    gsm: Optional[float]
    bf: Optional[float]
    supplier_id: Optional[uuid.UUID] = None
    supplier_name: Optional[str]
    supplier_name_snapshot: Optional[str] = None
    inward_weight_kg: float
    current_weight_kg: float
    unit_cost: Optional[float]
    cost_source: Optional[str]
    status: str
    stock_status: str
    physical_form: Optional[str] = None
    width_mm: Optional[float] = None
    source_reel_no: Optional[str] = None
    commercial_status: Optional[str] = None
    location_id: Optional[uuid.UUID] = None
    parent_reel_id: Optional[uuid.UUID] = None
    genealogy_metadata: Optional[dict[str, Any]] = None
    inward_metadata: Optional[dict[str, Any]] = None
    inward_date: date
    created_at: datetime
    qr_payload: Optional[dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)


class ReelScanCreate(BaseModel):
    event_type: str
    source: str
    operator_id: Optional[uuid.UUID] = None
    metadata: Optional[dict[str, Any]] = None

    @field_validator("event_type")
    @classmethod
    def normalize_event_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_SCAN_EVENT_TYPES:
            raise ValueError("event_type must be INWARD_SCAN, ISSUE_SCAN, CLOSE_SCAN, MOVE_SCAN, or SLIT_SCAN")
        return normalized

    @field_validator("source")
    @classmethod
    def normalize_source(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_SCAN_SOURCES:
            raise ValueError("source must be INVENTORY or PRODUCTION")
        return normalized


class ReelScanResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    reel_id: uuid.UUID
    event_type: str
    source: str
    operator_id: Optional[uuid.UUID]
    timestamp: datetime
    metadata: Optional[dict[str, Any]]

    @classmethod
    def from_orm_event(cls, event: ReelScanEvent) -> "ReelScanResponse":
        return cls(
            id=event.id,
            plant_id=event.plant_id,
            reel_id=event.reel_id,
            event_type=str(event.event_type.value if hasattr(event.event_type, "value") else event.event_type),
            source=str(event.source.value if hasattr(event.source, "value") else event.source),
            operator_id=event.operator_id,
            timestamp=event.timestamp,
            metadata=event.event_metadata,
        )


class SlitChildCreate(BaseModel):
    model_config = {"extra": "forbid"}

    weight_kg: float = Field(gt=0)
    width_mm: Optional[float] = Field(default=None, gt=0)
    location_id: Optional[uuid.UUID] = None


class ReelSlitCreate(BaseModel):
    model_config = {"extra": "forbid"}

    parent_reel_id: uuid.UUID
    children: list[SlitChildCreate] = Field(min_length=1, max_length=60)
    trim_wastage_kg: float = Field(default=0.0, ge=0)
    slit_date: Optional[date] = None
    remarks: Optional[str] = Field(default=None, max_length=500)


class SlitChildResponse(BaseModel):
    id: uuid.UUID
    at_no: str
    weight_kg: float
    width_mm: Optional[float] = None
    stock_status: str
    label: Optional[dict[str, Any]] = None


class ReelSlitResponse(BaseModel):
    parent_reel_id: uuid.UUID
    parent_reel_code: str
    issue_id: uuid.UUID
    remaining_weight_kg: float
    trim_wastage_kg: float
    child_reel_ids: list[uuid.UUID]
    children: list[SlitChildResponse] = Field(default_factory=list)


@router.post("/inward", response_model=ReelResponse)
def create_reel_inward(
    payload: ReelInwardCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager"])),
):
    if get_settings().PROCUREMENT_V2_ENFORCED:
        raise HTTPException(
            status_code=409,
            detail="Paper reel and coil inward must use an approved PO line through /inventory/procurement/receipts.",
        )
    plant_uuid = _to_uuid(plant_id)
    stock_status = payload.stock_status.strip().upper()
    if stock_status == "UNRESTRICTED":
        stock_status = "QC_HOLD"
    location = None
    if payload.location_id:
        location = db.query(InventoryLocation).filter(
            InventoryLocation.id == payload.location_id,
            InventoryLocation.plant_id == plant_id,
        ).first()
        if not location:
            raise HTTPException(status_code=404, detail="Inventory location not found")

    def _generate_reel_code() -> str:
        # Plant-scoped human-readable identifier with date + short random suffix.
        plant_suffix = str(plant_id).replace("-", "")[-4:].upper()
        date_part = payload.inward_date.strftime("%y%m%d")
        rand_part = uuid.uuid4().hex[:4].upper()
        return f"REEL-{plant_suffix}-{date_part}-{rand_part}"

    paper = db.query(ItemMaster).filter(
        ItemMaster.id == payload.paper_id,
        ItemMaster.plant_id == plant_id,
    ).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper item not found in this plant")
    if paper.type != ItemType.RAW_PAPER:
        raise HTTPException(status_code=400, detail="paper_id must reference a RAW_PAPER item")
    if paper.tracking_mode != TrackingMode.REEL:
        raise HTTPException(status_code=400, detail="paper_id must reference a REEL-tracked RAW_PAPER item")

    master_snapshot = dict(payload.paper_master_snapshot or {})

    def _snapshot_number(*keys: str) -> Optional[float]:
        for key in keys:
            value = master_snapshot.get(key)
            if value in (None, ""):
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None

    locked_gsm = _snapshot_number("gsm") if master_snapshot else payload.gsm
    locked_bf = _snapshot_number("bf", "strength_value", "bf_per_ply") if master_snapshot else payload.bf
    locked_plybond = _snapshot_number("ply_bond", "plybond") if master_snapshot else payload.plybond
    locked_bulk = _snapshot_number("bulk_factor", "bulk") if master_snapshot else None
    locked_variety = str(master_snapshot.get("variety") or master_snapshot.get("category") or payload.variety or "").strip() or None

    generated = payload.reel_code is None and payload.amigo_no is None
    attempts = 5 if generated else 1
    for _ in range(attempts):
        code = payload.amigo_no or payload.reel_code or _generate_reel_code()
        metadata = {
            **dict(payload.inward_metadata or {}),
            "amigo_no": code,
            "mill": payload.mill,
            "plybond": locked_plybond,
            "bulk_factor": locked_bulk,
            "variety": locked_variety,
            "source_reel_no": payload.source_reel_no,
            "slitting_status": (payload.slitting_status or "REGULAR").upper() if payload.slitting_status else None,
            "po_no": payload.po_no,
            "bill_no": payload.bill_no,
            "bill_date": payload.bill_date.isoformat() if payload.bill_date else None,
            "rate": payload.rate if payload.rate is not None else payload.unit_cost,
            "supplier_id": str(payload.supplier_id),
            "supplier_name": payload.supplier_name,
            "location_id": str(location.id) if location else None,
            "location_code": location.code if location else None,
            "paper_master_snapshot": master_snapshot,
            "paper_quality_source": "MASTER_SNAPSHOT" if master_snapshot else "LEGACY_ITEM_INPUT",
        }
        metadata = pin_quality_profile_metadata(metadata, getattr(paper, "quality_profile", None) if paper else None)
        reel = PaperReel(
            plant_id=plant_uuid,
            reel_code=code,
            paper_id=payload.paper_id,
            gsm=locked_gsm,
            bf=locked_bf,
            supplier_id=payload.supplier_id,
            supplier_name=payload.supplier_name,
            supplier_name_snapshot=payload.supplier_name,
            inward_weight_kg=payload.inward_weight_kg,
            current_weight_kg=payload.inward_weight_kg,
            unit_cost=payload.unit_cost,
            cost_source=CostSource(payload.cost_source) if payload.cost_source else None,
            status=ReelStatus.IN_STOCK,
            stock_status=stock_status,
            location_id=location.id if location else None,
            inward_metadata=metadata,
            inward_date=payload.inward_date,
        )
        db.add(reel)
        try:
            db.commit()
            db.refresh(reel)
            event = ReelScanEvent(
                plant_id=plant_uuid,
                reel_id=reel.id,
                event_type=ReelScanEventType.INWARD_SCAN,
                source=ReelScanSource.INVENTORY,
                operator_id=None,
                event_metadata={
                    "reel_code": reel.reel_code,
                    "paper_id": str(reel.paper_id),
                    "supplier_id": str(reel.supplier_id) if reel.supplier_id else None,
                    "supplier_name": reel.supplier_name,
                    "inward_weight_kg": reel.inward_weight_kg,
                    "generated_code": generated,
                    "location_id": str(reel.location_id) if reel.location_id else None,
                    "stock_status": reel.stock_status,
                    "inward_metadata": metadata,
                },
            )
            db.add(event)
            db.commit()
            db.refresh(reel)
            response = ReelResponse.model_validate(reel)
            response.qr_payload = reel_label_payload(reel, paper)
            return response
        except IntegrityError:
            db.rollback()
            if not generated:
                raise HTTPException(status_code=409, detail="Reel code already exists in this plant")

    raise HTTPException(status_code=500, detail="Could not generate unique reel code")


@router.get("", response_model=List[ReelResponse])
def list_reels(
    status: Optional[str] = Query(default=None),
    reel_ids: Optional[str] = Query(default=None, description="Comma-separated reel UUIDs"),
    search: Optional[str] = Query(default=None, min_length=1, max_length=120),
    stock_status: Optional[str] = Query(default=None, description="Comma-separated stock statuses"),
    physical_form: Optional[str] = Query(default=None, pattern="^(REEL|COIL)$"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    normalized_status = _normalize_status(status)
    selected_reel_ids = _parse_uuid_list(reel_ids, "reel_ids")

    query = db.query(PaperReel)
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            query = query.filter(PaperReel.plant_id.in_([_to_uuid(value) for value in allowed_plants]))
    else:
        query = query.filter(PaperReel.plant_id == _to_uuid(plant_scope["selected_plant_id"]))

    if normalized_status:
        query = query.filter(PaperReel.status == ReelStatus(normalized_status))
    if selected_reel_ids:
        query = query.filter(PaperReel.id.in_(selected_reel_ids))
    if search:
        needle = f"%{search.strip()}%"
        query = query.filter(PaperReel.reel_code.ilike(needle))
    if stock_status:
        statuses = {value.strip().upper() for value in stock_status.split(",") if value.strip()}
        if not statuses <= VALID_STOCK_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid stock_status filter")
        query = query.filter(PaperReel.stock_status.in_(sorted(statuses)))
    if physical_form:
        query = query.filter(PaperReel.physical_form == physical_form)

    return query.order_by(PaperReel.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/{reel_id}", response_model=ReelResponse)
def get_reel(
    reel_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(PaperReel).filter(PaperReel.id == reel_id)
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            query = query.filter(PaperReel.plant_id.in_([_to_uuid(value) for value in allowed_plants]))
    else:
        query = query.filter(PaperReel.plant_id == _to_uuid(plant_scope["selected_plant_id"]))

    reel = query.first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")
    return reel


@router.post("/slit", response_model=ReelSlitResponse)
def slit_reel(
    payload: ReelSlitCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager"])),
):
    """Record slitting output for a coil that was issued to the slitting section.

    Every slit reel becomes its own AT identity (REEL form, label, lineage to the
    coil and its PO receipt). The coil's open slitting issue closes with
    consumed = slit reels + trim wastage; any unslit balance stays on the coil.
    """
    plant_uuid = _to_uuid(plant_id)
    parent = db.query(PaperReel).filter(
        PaperReel.id == payload.parent_reel_id,
        PaperReel.plant_id == plant_uuid,
    ).with_for_update().first()
    if not parent:
        raise HTTPException(status_code=404, detail="Coil not found in this plant")
    if str(parent.physical_form or "REEL").upper() != "COIL":
        raise HTTPException(status_code=400, detail=f"{parent.reel_code} is a reel; only coils are slit")
    issue = db.query(ReelIssue).filter(
        ReelIssue.reel_id == parent.id,
        ReelIssue.plant_id == plant_uuid,
        ReelIssue.status == ReelIssueStatus.OPEN,
    ).with_for_update().first()
    if not issue or str(issue.issue_section or "") != "SLITTING_SECTION":
        raise HTTPException(status_code=409, detail=f"Issue coil {parent.reel_code} to slitting before recording slit output")

    child_total = round(sum(float(child.weight_kg) for child in payload.children), 3)
    consumed = round(child_total + float(payload.trim_wastage_kg or 0.0), 3)
    if consumed > float(issue.issued_weight_kg) + 1e-6:
        raise HTTPException(
            status_code=400,
            detail=f"Slit reels + trim ({consumed:.3f} kg) exceed the {float(issue.issued_weight_kg):.3f} kg issued to slitting",
        )
    if consumed > float(parent.current_weight_kg or 0.0) + 1e-6:
        raise HTTPException(status_code=400, detail="Slit reels + trim exceed the coil balance")

    location_ids = {child.location_id for child in payload.children if child.location_id}
    if location_ids and db.query(InventoryLocation).filter(
        InventoryLocation.id.in_(location_ids),
        InventoryLocation.plant_id == plant_id,
    ).count() != len(location_ids):
        raise HTTPException(status_code=404, detail="Slit reel location not found in this plant")

    paper = db.query(ItemMaster).filter(ItemMaster.id == parent.paper_id).first()
    slit_date = payload.slit_date or date.today()
    existing_children = db.query(PaperReel).filter(PaperReel.parent_reel_id == parent.id).count()
    lineage = {
        key: (parent.inward_metadata or {}).get(key)
        for key in ("po_id", "po_no", "po_line_id", "receipt_id", "grn_no", "invoice_no", "receipt_kind")
        if (parent.inward_metadata or {}).get(key) is not None
    }
    children: list[SlitChildResponse] = []
    for offset, child in enumerate(payload.children, start=1):
        at_no = f"{parent.reel_code}-S{existing_children + offset}"
        metadata = {
            **lineage,
            "amigo_no": at_no,
            "physical_form": "REEL",
            "parent_reel_id": str(parent.id),
            "parent_reel_code": parent.reel_code,
            "source_document_type": "SLIT",
            "slit_issue_id": str(issue.id),
            "slit_weight_kg": float(child.weight_kg),
            "slit_date": slit_date.isoformat(),
            # Printed on the label so the floor can trace a slit reel to its coil.
            "source_reel_no": f"{parent.source_reel_no or parent.reel_code} / S{existing_children + offset}",
        }
        db_child = PaperReel(
            plant_id=plant_uuid,
            reel_code=at_no,
            paper_id=parent.paper_id,
            gsm=parent.gsm,
            bf=parent.bf,
            supplier_id=parent.supplier_id,
            supplier_name=parent.supplier_name,
            supplier_name_snapshot=parent.supplier_name_snapshot or parent.supplier_name,
            inward_weight_kg=float(child.weight_kg),
            net_weight_kg=float(child.weight_kg),
            current_weight_kg=float(child.weight_kg),
            physical_form="REEL",
            width_mm=child.width_mm,
            commercial_status=parent.commercial_status or "CLEAR",
            unit_cost=parent.unit_cost,
            cost_source=parent.cost_source,
            status=ReelStatus.IN_STOCK,
            stock_status=parent.stock_status,
            location_id=child.location_id or parent.location_id,
            parent_reel_id=parent.id,
            genealogy_metadata={
                "source": "slit",
                "parent_reel_id": str(parent.id),
                "parent_reel_code": parent.reel_code,
                "slit_issue_id": str(issue.id),
                "slit_weight_kg": float(child.weight_kg),
            },
            inward_metadata=metadata,
            inward_date=slit_date,
        )
        db.add(db_child)
        db.flush()
        label = reel_label_payload(db_child, paper)
        db.add(LotLabelRecord(plant_id=plant_id, reel_id=db_child.id, label_code=at_no, content_snapshot=label))
        db.add(
            ReelScanEvent(
                plant_id=plant_uuid,
                reel_id=db_child.id,
                event_type=ReelScanEventType.SLIT_SCAN,
                source=ReelScanSource.PRODUCTION,
                operator_id=None,
                event_metadata={"parent_reel_id": str(parent.id), "parent_reel_code": parent.reel_code, "slit_issue_id": str(issue.id)},
            )
        )
        children.append(
            SlitChildResponse(
                id=db_child.id,
                at_no=at_no,
                weight_kg=float(child.weight_kg),
                width_mm=child.width_mm,
                stock_status=str(db_child.stock_status),
                label=label,
            )
        )

    issue.consumed_weight_kg = consumed
    issue.remaining_weight_kg = round(float(issue.issued_weight_kg) - consumed, 3)
    issue.status = ReelIssueStatus.CLOSED
    issue.closed_at = datetime.utcnow()
    parent.current_weight_kg = round(float(parent.current_weight_kg or 0.0) - consumed, 3)
    if parent.current_weight_kg <= 1e-6:
        parent.current_weight_kg = 0.0
        parent.status = ReelStatus.CONSUMED
    else:
        parent.status = ReelStatus.IN_STOCK
    db.add(
        ReelScanEvent(
            plant_id=plant_uuid,
            reel_id=parent.id,
            event_type=ReelScanEventType.SLIT_SCAN,
            source=ReelScanSource.PRODUCTION,
            operator_id=None,
            event_metadata={
                "slit_issue_id": str(issue.id),
                "child_reel_ids": [str(row.id) for row in children],
                "slit_reels_kg": child_total,
                "trim_wastage_kg": float(payload.trim_wastage_kg or 0.0),
                "remaining_weight_kg": parent.current_weight_kg,
                "remarks": payload.remarks,
                "actor": current_user.get("sub"),
            },
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A slit reel number already exists; refresh and retry") from exc
    return ReelSlitResponse(
        parent_reel_id=parent.id,
        parent_reel_code=parent.reel_code,
        issue_id=issue.id,
        remaining_weight_kg=float(parent.current_weight_kg or 0.0),
        trim_wastage_kg=float(payload.trim_wastage_kg or 0.0),
        child_reel_ids=[row.id for row in children],
        children=children,
    )


@router.post("/{reel_id}/scan", response_model=ReelScanResponse)
def create_reel_scan_event(
    reel_id: uuid.UUID,
    payload: ReelScanCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager", "Operator"])),
):
    plant_uuid = _to_uuid(plant_id)
    reel = db.query(PaperReel).filter(
        PaperReel.id == reel_id,
        PaperReel.plant_id == plant_uuid,
    ).first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found in this plant")

    operator_id = payload.operator_id
    if operator_id is None:
        user_id = current_user.get("user_id")
        if user_id:
            try:
                operator_id = uuid.UUID(str(user_id))
            except ValueError:
                operator_id = None

    event = ReelScanEvent(
        plant_id=plant_uuid,
        reel_id=reel.id,
        event_type=ReelScanEventType(payload.event_type),
        source=ReelScanSource(payload.source),
        operator_id=operator_id,
        event_metadata=payload.metadata,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return ReelScanResponse.from_orm_event(event)


@router.get("/{reel_id}/scans", response_model=List[ReelScanResponse])
def list_reel_scan_events(
    reel_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    reel_query = db.query(PaperReel).filter(PaperReel.id == reel_id)
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            reel_query = reel_query.filter(PaperReel.plant_id.in_([_to_uuid(value) for value in allowed_plants]))
    else:
        reel_query = reel_query.filter(PaperReel.plant_id == _to_uuid(plant_scope["selected_plant_id"]))
    reel = reel_query.first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")

    events = (
        db.query(ReelScanEvent)
        .filter(
            ReelScanEvent.reel_id == reel.id,
            ReelScanEvent.plant_id == reel.plant_id,
        )
        .order_by(ReelScanEvent.timestamp.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [ReelScanResponse.from_orm_event(event) for event in events]
