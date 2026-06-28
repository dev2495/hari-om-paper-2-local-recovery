import logging
from datetime import date, datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    PaperReel,
    ReelIssue,
    ReelIssueStatus,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReelStatus,
)
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_role

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reel-issues", tags=["reel-issues"])

VALID_SHIFTS = {"A", "B", "C", "GENERAL", "DAY", "NIGHT"}
VALID_STATUSES = {"OPEN", "CLOSED"}
VALID_SECTIONS = {"WINDER_SECTION", "SLITTING_SECTION"}
ISSUABLE_STOCK_STATUSES = {"UNRESTRICTED", "WIP"}


def _to_uuid(value: str, field: str = "plant_id") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value}") from exc


def _normalize_shift(shift: str) -> str:
    normalized = shift.strip().upper()
    if normalized not in VALID_SHIFTS:
        raise HTTPException(status_code=400, detail="Invalid shift")
    return normalized


def _normalize_status(status_value: Optional[str]) -> Optional[str]:
    if status_value is None:
        return None
    normalized = status_value.strip().upper()
    if normalized not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return normalized


def _normalize_section(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in VALID_SECTIONS:
        raise HTTPException(status_code=400, detail="issue_section must be WINDER_SECTION or SLITTING_SECTION")
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


class ReelIssueCreate(BaseModel):
    reel_id: uuid.UUID
    issue_section: str = "WINDER_SECTION"
    machine_id: Optional[uuid.UUID] = None
    shift: str
    issue_date: date
    issued_weight_kg: float = Field(gt=0)

    @field_validator("shift")
    @classmethod
    def validate_shift(cls, value: str) -> str:
        return _normalize_shift(value)

    @field_validator("issue_section")
    @classmethod
    def validate_issue_section(cls, value: str) -> str:
        return _normalize_section(value)


class ReelIssueClosePayload(BaseModel):
    consumed_weight_kg: float = Field(ge=0)


class ReelIssueResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    reel_id: uuid.UUID
    issue_section: str
    machine_id: Optional[uuid.UUID] = None
    shift: str
    issue_date: date
    issued_weight_kg: float
    consumed_weight_kg: float = 0.0
    remaining_weight_kg: float
    status: str
    closed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


def _serialize_issue(issue: ReelIssue) -> ReelIssueResponse:
    return ReelIssueResponse(
        id=issue.id,
        plant_id=issue.plant_id,
        reel_id=issue.reel_id,
        issue_section=str(issue.issue_section or "WINDER_SECTION"),
        machine_id=issue.winder_machine_id,
        shift=issue.shift,
        issue_date=issue.issue_date,
        issued_weight_kg=float(issue.issued_weight_kg or 0.0),
        consumed_weight_kg=float(getattr(issue, "consumed_weight_kg", 0.0) or 0.0),
        remaining_weight_kg=float(issue.remaining_weight_kg or 0.0),
        status=issue.status.value if isinstance(issue.status, ReelIssueStatus) else str(issue.status),
        closed_at=getattr(issue, "closed_at", None),
        created_at=issue.created_at,
    )


@router.post("", response_model=ReelIssueResponse)
def create_reel_issue(
    payload: ReelIssueCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager"])),
):
    reel = db.query(PaperReel).filter(
        PaperReel.id == payload.reel_id,
        PaperReel.plant_id == _to_uuid(plant_id),
    ).first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found in this plant")
    if reel.status in {ReelStatus.CONSUMED, ReelStatus.SCRAP} or float(reel.current_weight_kg or 0.0) <= 0:
        raise HTTPException(status_code=400, detail="Reel is not issuable")
    if str(reel.stock_status or "").upper() not in ISSUABLE_STOCK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Reel is not QC-approved for issue ({reel.stock_status})")
    if payload.issued_weight_kg > float(reel.current_weight_kg or 0.0):
        raise HTTPException(status_code=400, detail="Issued weight exceeds available reel weight")

    existing_open_issue = db.query(ReelIssue).filter(
        ReelIssue.reel_id == reel.id,
        ReelIssue.status == ReelIssueStatus.OPEN,
    ).first()
    if existing_open_issue:
        raise HTTPException(status_code=400, detail="This reel already has an open issue")

    issue = ReelIssue(
        plant_id=_to_uuid(plant_id),
        reel_id=payload.reel_id,
        issue_section=payload.issue_section,
        winder_machine_id=payload.machine_id,
        shift=payload.shift,
        issue_date=payload.issue_date,
        issued_weight_kg=payload.issued_weight_kg,
        remaining_weight_kg=payload.issued_weight_kg,
        status=ReelIssueStatus.OPEN,
    )
    reel.status = ReelStatus.ISSUED
    db.add(issue)
    db.commit()
    db.refresh(issue)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="reel_issue_created",
            entity_type="reel_issue",
            entity_id=str(issue.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Reel issued ({payload.issued_weight_kg} kg) to {payload.issue_section} on shift {payload.shift}",
            payload={
                "reel_id": str(payload.reel_id),
                "issue_section": payload.issue_section,
                "machine_id": str(payload.machine_id) if payload.machine_id else None,
                "shift": payload.shift,
                "issue_date": payload.issue_date.isoformat(),
                "issued_weight_kg": float(payload.issued_weight_kg),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for reel_issue_created %s: %s", issue.id, exc)
    return _serialize_issue(issue)


@router.get("", response_model=List[ReelIssueResponse])
def list_reel_issues(
    reel_id: Optional[uuid.UUID] = Query(default=None),
    machine_id: Optional[uuid.UUID] = Query(default=None),
    winder_machine_id: Optional[uuid.UUID] = Query(default=None),
    winder: Optional[uuid.UUID] = Query(default=None),
    issue_section: Optional[str] = Query(default=None),
    shift: Optional[str] = Query(default=None),
    issue_date: Optional[date] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    issue_ids: Optional[str] = Query(default=None, description="Comma-separated reel issue UUIDs"),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    effective_machine = machine_id or winder_machine_id or winder
    normalized_status = _normalize_status(status)
    selected_issue_ids = _parse_uuid_list(issue_ids, "issue_ids")

    query = db.query(ReelIssue)
    if plant_scope.get("scope_all"):
        allowed_plants = plant_scope.get("allowed_plants") or []
        if allowed_plants:
            query = query.filter(ReelIssue.plant_id.in_([_to_uuid(value) for value in allowed_plants]))
    else:
        query = query.filter(ReelIssue.plant_id == _to_uuid(plant_scope["selected_plant_id"]))

    if effective_machine:
        query = query.filter(ReelIssue.winder_machine_id == effective_machine)
    if reel_id:
        query = query.filter(ReelIssue.reel_id == reel_id)
    if issue_section:
        query = query.filter(ReelIssue.issue_section == _normalize_section(issue_section))
    if shift:
        query = query.filter(ReelIssue.shift == _normalize_shift(shift))
    if issue_date:
        query = query.filter(ReelIssue.issue_date == issue_date)
    if date_from:
        query = query.filter(ReelIssue.issue_date >= date_from)
    if date_to:
        query = query.filter(ReelIssue.issue_date <= date_to)
    if selected_issue_ids:
        query = query.filter(ReelIssue.id.in_(selected_issue_ids))
    if normalized_status:
        query = query.filter(ReelIssue.status == ReelIssueStatus(normalized_status))

    rows = query.order_by(ReelIssue.issue_date.desc(), ReelIssue.created_at.desc()).offset(offset).limit(limit).all()
    return [_serialize_issue(row) for row in rows]


@router.post("/{issue_id}/close", response_model=ReelIssueResponse)
def close_reel_issue(
    issue_id: uuid.UUID,
    payload: ReelIssueClosePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager"])),
):
    issue = db.query(ReelIssue).filter(
        ReelIssue.id == issue_id,
        ReelIssue.plant_id == _to_uuid(plant_id),
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Reel issue not found")
    if issue.status != ReelIssueStatus.OPEN:
        raise HTTPException(status_code=400, detail="Reel issue is already closed")

    reel = db.query(PaperReel).filter(
        PaperReel.id == issue.reel_id,
        PaperReel.plant_id == _to_uuid(plant_id),
    ).first()
    if not reel:
        raise HTTPException(status_code=404, detail="Linked reel not found")

    consumed = float(payload.consumed_weight_kg)
    if consumed > float(issue.issued_weight_kg):
        raise HTTPException(status_code=400, detail="Consumed weight cannot exceed issued weight")
    if consumed > float(reel.current_weight_kg):
        raise HTTPException(status_code=400, detail="Consumed weight cannot exceed reel current weight")

    issue.remaining_weight_kg = float(issue.issued_weight_kg) - consumed
    issue.consumed_weight_kg = consumed
    issue.status = ReelIssueStatus.CLOSED
    issue.closed_at = datetime.utcnow()

    reel.current_weight_kg = float(reel.current_weight_kg) - consumed
    if reel.current_weight_kg < 0:
        raise HTTPException(status_code=400, detail="Reel weight cannot go negative")
    if abs(reel.current_weight_kg) < 1e-9:
        reel.current_weight_kg = 0.0
    reel.status = ReelStatus.CONSUMED if reel.current_weight_kg == 0 else ReelStatus.IN_STOCK

    db.add(
        ReelScanEvent(
            plant_id=_to_uuid(plant_id),
            reel_id=reel.id,
            event_type=ReelScanEventType.CLOSE_SCAN,
            source=ReelScanSource.INVENTORY,
            operator_id=None,
            event_metadata={
                "issue_id": str(issue.id),
                "consumed_weight_kg": consumed,
                "remaining_issue_weight_kg": issue.remaining_weight_kg,
                "reel_status": reel.status.value,
            },
        )
    )

    db.commit()
    db.refresh(issue)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="reel_issue_closed",
            entity_type="reel_issue",
            entity_id=str(issue.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Reel issue closed (consumed {consumed} kg)",
            payload={
                "reel_id": str(issue.reel_id),
                "consumed_weight_kg": consumed,
                "remaining_weight_kg": float(issue.remaining_weight_kg or 0.0),
                "reel_status": reel.status.value if hasattr(reel.status, "value") else str(reel.status),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for reel_issue_closed %s: %s", issue.id, exc)
    return _serialize_issue(issue)
