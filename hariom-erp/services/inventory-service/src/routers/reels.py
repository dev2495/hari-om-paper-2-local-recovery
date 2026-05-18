from datetime import date, datetime
from typing import Any, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    CostSource,
    InventoryLocation,
    ItemMaster,
    ItemType,
    PaperReel,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReelStatus,
    TrackingMode,
)
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_role

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
    paper_id: uuid.UUID
    gsm: Optional[float] = Field(default=None, ge=0)
    bf: Optional[float] = Field(default=None, ge=0)
    supplier_name: str = Field(min_length=1, max_length=200)
    inward_weight_kg: float = Field(gt=0)
    inward_date: date
    unit_cost: Optional[float] = Field(default=None, ge=0)
    cost_source: Optional[str] = None
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "UNRESTRICTED"

    @field_validator("reel_code")
    @classmethod
    def normalize_reel_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().upper()
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
    supplier_name: Optional[str]
    inward_weight_kg: float
    current_weight_kg: float
    unit_cost: Optional[float]
    cost_source: Optional[str]
    status: str
    stock_status: str
    location_id: Optional[uuid.UUID] = None
    parent_reel_id: Optional[uuid.UUID] = None
    genealogy_metadata: Optional[dict[str, Any]] = None
    inward_date: date
    created_at: datetime
    qr_payload: Optional[dict[str, Any]] = None

    class Config:
        from_attributes = True


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

    reel_code: Optional[str] = Field(default=None, min_length=1, max_length=100)
    weight_kg: float = Field(gt=0)
    location_id: Optional[uuid.UUID] = None
    stock_status: Optional[str] = None

    @field_validator("reel_code")
    @classmethod
    def normalize_child_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().upper()
        return cleaned or None

    @field_validator("stock_status")
    @classmethod
    def normalize_child_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip().upper()
        if normalized not in VALID_STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized


class ReelSlitCreate(BaseModel):
    model_config = {"extra": "forbid"}

    parent_reel_id: uuid.UUID
    children: list[SlitChildCreate] = Field(min_length=1)


class ReelSlitResponse(BaseModel):
    model_config = {"extra": "forbid"}

    parent_reel_id: uuid.UUID
    remaining_weight_kg: float
    child_reel_ids: list[uuid.UUID]


@router.post("/inward", response_model=ReelResponse)
def create_reel_inward(
    payload: ReelInwardCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager"])),
):
    plant_uuid = _to_uuid(plant_id)
    location = None
    if payload.location_id:
        location = db.query(InventoryLocation).filter(
            InventoryLocation.id == payload.location_id,
            InventoryLocation.plant_id == plant_uuid,
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
        ItemMaster.plant_id == plant_uuid,
    ).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper item not found in this plant")
    if paper.type != ItemType.RAW_PAPER:
        raise HTTPException(status_code=400, detail="paper_id must reference a RAW_PAPER item")
    if paper.tracking_mode != TrackingMode.REEL:
        raise HTTPException(status_code=400, detail="paper_id must reference a REEL-tracked RAW_PAPER item")

    generated = payload.reel_code is None
    attempts = 5 if generated else 1
    for _ in range(attempts):
        code = payload.reel_code or _generate_reel_code()
        reel = PaperReel(
            plant_id=plant_uuid,
            reel_code=code,
            paper_id=payload.paper_id,
            gsm=payload.gsm,
            bf=payload.bf,
            supplier_name=payload.supplier_name,
            inward_weight_kg=payload.inward_weight_kg,
            current_weight_kg=payload.inward_weight_kg,
            unit_cost=payload.unit_cost,
            cost_source=CostSource(payload.cost_source) if payload.cost_source else None,
            status=ReelStatus.IN_STOCK,
            stock_status=payload.stock_status,
            location_id=location.id if location else None,
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
                    "supplier_name": reel.supplier_name,
                    "inward_weight_kg": reel.inward_weight_kg,
                    "generated_code": generated,
                    "location_id": str(reel.location_id) if reel.location_id else None,
                    "stock_status": reel.stock_status,
                },
            )
            db.add(event)
            db.commit()
            db.refresh(reel)
            response = ReelResponse.model_validate(reel)
            response.qr_payload = {
                "entity": "reel",
                "reel_id": str(reel.id),
                "reel_code": reel.reel_code,
                "plant_id": str(reel.plant_id),
                "paper_id": str(reel.paper_id),
            }
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
    plant_uuid = _to_uuid(plant_id)
    parent = db.query(PaperReel).filter(
        PaperReel.id == payload.parent_reel_id,
        PaperReel.plant_id == plant_uuid,
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent reel not found")

    total_child_weight = round(sum(float(child.weight_kg or 0.0) for child in payload.children), 4)
    if total_child_weight <= 0:
        raise HTTPException(status_code=400, detail="Child slit weight must be positive")
    if total_child_weight > float(parent.current_weight_kg or 0.0) + 1e-9:
        raise HTTPException(status_code=400, detail="Child slit weight exceeds available parent reel balance")

    child_ids: list[uuid.UUID] = []
    for index, child in enumerate(payload.children, start=1):
        location = None
        if child.location_id:
            location = db.query(InventoryLocation).filter(
                InventoryLocation.id == child.location_id,
                InventoryLocation.plant_id == plant_uuid,
            ).first()
            if not location:
                raise HTTPException(status_code=404, detail="Child reel location not found")
        child_code = child.reel_code or f"{parent.reel_code}-S{index}"
        db_child = PaperReel(
            plant_id=plant_uuid,
            reel_code=child_code,
            paper_id=parent.paper_id,
            gsm=parent.gsm,
            bf=parent.bf,
            supplier_name=parent.supplier_name,
            inward_weight_kg=child.weight_kg,
            current_weight_kg=child.weight_kg,
            unit_cost=parent.unit_cost,
            cost_source=parent.cost_source,
            status=ReelStatus.IN_STOCK,
            stock_status=child.stock_status or parent.stock_status,
            location_id=(location.id if location else parent.location_id),
            parent_reel_id=parent.id,
            genealogy_metadata={
                "source": "slit",
                "parent_reel_id": str(parent.id),
                "parent_reel_code": parent.reel_code,
                "slit_weight_kg": child.weight_kg,
            },
            inward_date=parent.inward_date,
        )
        db.add(db_child)
        db.flush()
        child_ids.append(db_child.id)
        db.add(
            ReelScanEvent(
                plant_id=plant_uuid,
                reel_id=db_child.id,
                event_type=ReelScanEventType.SLIT_SCAN,
                source=ReelScanSource.PRODUCTION,
                operator_id=None,
                event_metadata={"parent_reel_id": str(parent.id), "parent_reel_code": parent.reel_code},
            )
        )

    parent.current_weight_kg = round(float(parent.current_weight_kg or 0.0) - total_child_weight, 4)
    if parent.current_weight_kg <= 1e-9:
        parent.current_weight_kg = 0.0
        parent.status = ReelStatus.CONSUMED
    db.add(
        ReelScanEvent(
            plant_id=plant_uuid,
            reel_id=parent.id,
            event_type=ReelScanEventType.SLIT_SCAN,
            source=ReelScanSource.PRODUCTION,
            operator_id=None,
            event_metadata={
                "child_reel_ids": [str(value) for value in child_ids],
                "total_child_weight_kg": total_child_weight,
                "remaining_weight_kg": parent.current_weight_kg,
            },
        )
    )
    db.commit()
    return ReelSlitResponse(
        parent_reel_id=parent.id,
        remaining_weight_kg=float(parent.current_weight_kg or 0.0),
        child_reel_ids=child_ids,
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
