import logging
from datetime import date, datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session, joinedload

from ..concession_use import guard_concession_stock
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
# Incoming reels must be slit into production-ready coils before winding.
SECTION_FOR_FORM = {"REEL": "SLITTING_SECTION", "COIL": "WINDER_SECTION"}


def _reel_form(reel: PaperReel) -> str:
    return str(getattr(reel, "physical_form", None) or "REEL").strip().upper()


def _require_section_for_form(reel: PaperReel, section: str) -> None:
    form = _reel_form(reel)
    expected = SECTION_FOR_FORM.get(form, "WINDER_SECTION")
    if section == expected:
        return
    if form == "REEL":
        raise HTTPException(
            status_code=400,
            detail=f"{reel.reel_code} is a reel. Issue it to slitting; the output coils are then issued to production.",
        )
    raise HTTPException(
        status_code=400,
        detail=f"{reel.reel_code} is a coil. Issue it directly to production; reels must go through slitting.",
    )


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
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    reel_id: uuid.UUID
    issue_section: Optional[str] = None
    machine_id: Optional[uuid.UUID] = None
    # Older screens sent the winder under this name; it was silently dropped.
    winder_machine_id: Optional[uuid.UUID] = None
    shift: str
    issue_date: date
    # The whole reel / coil goes to the floor and is consumed in full (client rule 2026-10-18);
    # when given, it must equal the reel's current weight.
    issued_weight_kg: Optional[float] = Field(default=None, gt=0)
    customer_id: Optional[uuid.UUID] = None
    sales_order_id: Optional[uuid.UUID] = None

    @field_validator("shift")
    @classmethod
    def validate_shift(cls, value: str) -> str:
        return _normalize_shift(value)

    @field_validator("issue_section")
    @classmethod
    def validate_issue_section(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _normalize_section(value)

    @model_validator(mode="after")
    def fold_machine_alias(self) -> "ReelIssueCreate":
        if self.machine_id is None:
            self.machine_id = self.winder_machine_id
        elif self.winder_machine_id is not None and self.winder_machine_id != self.machine_id:
            raise ValueError("machine_id and winder_machine_id disagree")
        return self


class ReelIssueClosePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    consumed_weight_kg: float = Field(ge=0)


class ReelIssueResponse(BaseModel):
    id: uuid.UUID
    plant_id: uuid.UUID
    reel_id: uuid.UUID
    issue_section: str
    machine_id: Optional[uuid.UUID] = None
    sales_order_id: Optional[uuid.UUID] = None
    customer_id: Optional[uuid.UUID] = None
    shift: str
    issue_date: date
    issued_weight_kg: float
    consumed_weight_kg: float = 0.0
    remaining_weight_kg: float
    status: str
    closed_at: Optional[datetime] = None
    created_at: datetime
    reel_code: Optional[str] = None
    physical_form: Optional[str] = None
    reel_current_weight_kg: Optional[float] = None
    issue_mode: str = "LEGACY"
    slitting_card: Optional[dict] = None
    paper_code: Optional[str] = None
    paper_name: Optional[str] = None
    gsm: Optional[float] = None
    width_mm: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


def _serialize_issue(issue: ReelIssue) -> ReelIssueResponse:
    reel = getattr(issue, "reel", None)
    return ReelIssueResponse(
        id=issue.id,
        plant_id=issue.plant_id,
        reel_id=issue.reel_id,
        issue_section=str(issue.issue_section or "WINDER_SECTION"),
        machine_id=issue.winder_machine_id,
        sales_order_id=issue.sales_order_id,
        customer_id=issue.customer_id,
        shift=issue.shift,
        issue_date=issue.issue_date,
        issued_weight_kg=float(issue.issued_weight_kg or 0.0),
        consumed_weight_kg=float(getattr(issue, "consumed_weight_kg", 0.0) or 0.0),
        remaining_weight_kg=float(issue.remaining_weight_kg or 0.0),
        status=issue.status.value if isinstance(issue.status, ReelIssueStatus) else str(issue.status),
        closed_at=getattr(issue, "closed_at", None),
        created_at=issue.created_at,
        reel_code=reel.reel_code if reel is not None else None,
        physical_form=_reel_form(reel) if reel is not None else None,
        reel_current_weight_kg=float(reel.current_weight_kg or 0.0) if reel is not None else None,
        issue_mode=str(getattr(issue, "issue_mode", None) or "LEGACY"),
        slitting_card=getattr(issue, "slitting_card", None),
        paper_code=reel.paper.item_code if reel is not None and getattr(reel, "paper", None) is not None else None,
        paper_name=reel.paper.name if reel is not None and getattr(reel, "paper", None) is not None else None,
        gsm=float(reel.gsm) if reel is not None and reel.gsm is not None else None,
        width_mm=float(reel.width_mm) if reel is not None and reel.width_mm is not None else None,
    )


@router.post("", response_model=ReelIssueResponse)
def create_reel_issue(
    payload: ReelIssueCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager", "RMIssue"])),
):
    reel = db.query(PaperReel).filter(
        PaperReel.id == payload.reel_id,
        PaperReel.plant_id == _to_uuid(plant_id),
    ).with_for_update().populate_existing().first()
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found in this plant")
    if reel.status in {ReelStatus.CONSUMED, ReelStatus.SCRAP} or float(reel.current_weight_kg or 0.0) <= 0:
        raise HTTPException(status_code=400, detail="Reel is not issuable")
    # Floor issue (client rule 2026-10-18): a reel goes to the slitter, a coil straight to the
    # winders; no machine is chosen, only the shift, and the whole reel is consumed.
    section = payload.issue_section or SECTION_FOR_FORM.get(_reel_form(reel), "WINDER_SECTION")
    _require_section_for_form(reel, section)
    full_weight = round(float(reel.current_weight_kg or 0.0), 3)
    if payload.issued_weight_kg is not None and abs(float(payload.issued_weight_kg) - full_weight) > 0.0005:
        raise HTTPException(status_code=400, detail=f"{reel.reel_code} goes to the floor whole: issue its full {full_weight:g} kg")
    payload.issued_weight_kg = full_weight
    guard_concession_stock(
        db,
        plant_id=plant_id,
        entity=reel,
        customer_id=payload.customer_id,
        sales_order_id=payload.sales_order_id,
        allowed_statuses=ISSUABLE_STOCK_STATUSES,
        blocked_detail=f"Reel is not QC-approved for issue ({reel.stock_status})",
    )
    if payload.issued_weight_kg > float(reel.current_weight_kg or 0.0):
        raise HTTPException(status_code=400, detail="Issued weight exceeds available reel weight")

    existing_open_issue = db.query(ReelIssue).filter(
        ReelIssue.reel_id == reel.id,
        ReelIssue.status == ReelIssueStatus.OPEN,
    ).first()
    if existing_open_issue:
        raise HTTPException(status_code=400, detail="This reel already has an open issue")

    now = datetime.utcnow()
    is_reel = section == "SLITTING_SECTION"
    issue = ReelIssue(
        plant_id=_to_uuid(plant_id),
        reel_id=payload.reel_id,
        issue_section=section,
        winder_machine_id=payload.machine_id,
        sales_order_id=payload.sales_order_id,
        customer_id=payload.customer_id,
        shift=payload.shift,
        issue_date=payload.issue_date,
        issued_weight_kg=payload.issued_weight_kg,
        consumed_weight_kg=payload.issued_weight_kg,
        remaining_weight_kg=0.0,
        # A reel stays open until its slitting card (coils made + wastage) is written; a coil
        # is done the moment it reaches the floor.
        status=ReelIssueStatus.OPEN if is_reel else ReelIssueStatus.CLOSED,
        closed_at=None if is_reel else now,
        issue_mode="FLOOR",
    )
    reel.current_weight_kg = 0.0
    reel.status = ReelStatus.CONSUMED
    db.add(issue)
    db.flush()
    db.add(
        ReelScanEvent(
            plant_id=_to_uuid(plant_id),
            reel_id=reel.id,
            event_type=ReelScanEventType.ISSUE_SCAN,
            source=ReelScanSource.INVENTORY,
            operator_id=None,
            event_metadata={
                "issue_id": str(issue.id),
                "issue_section": section,
                "machine_id": str(payload.machine_id) if payload.machine_id else None,
                "shift": payload.shift,
                "issued_weight_kg": float(payload.issued_weight_kg),
                "physical_form": _reel_form(reel),
            },
        )
    )
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
            summary=f"{'Reel' if is_reel else 'Coil'} {reel.reel_code} issued to the floor ({payload.issued_weight_kg} kg, {'slitting' if is_reel else 'winding'}) on shift {payload.shift}",
            payload={
                "reel_id": str(payload.reel_id),
                "issue_section": section,
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

    query = db.query(ReelIssue).options(joinedload(ReelIssue.reel))
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
    current_user: dict = Depends(require_role(["Store", "PlantManager", "RMIssue"])),
):
    issue = db.query(ReelIssue).filter(
        ReelIssue.id == issue_id,
        ReelIssue.plant_id == _to_uuid(plant_id),
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Reel issue not found")
    reel = db.query(PaperReel).filter(
        PaperReel.id == issue.reel_id,
        PaperReel.plant_id == _to_uuid(plant_id),
    ).with_for_update().populate_existing().first()
    if not reel:
        raise HTTPException(status_code=404, detail="Linked reel not found")

    # Lock parent then issue, the same order used by slitting, to serialize returns.
    issue = db.query(ReelIssue).filter(ReelIssue.id == issue_id).with_for_update().populate_existing().one()
    if issue.status != ReelIssueStatus.OPEN:
        raise HTTPException(status_code=409, detail="Reel issue is already closed")
    if str(getattr(issue, "issue_mode", "") or "") == "FLOOR":
        raise HTTPException(status_code=409, detail="Material issued to the floor is consumed in full; nothing comes back. Record the slitting card instead.")

    consumed = float(payload.consumed_weight_kg)
    if str(issue.issue_section or "") == "SLITTING_SECTION" and consumed > 0:
        raise HTTPException(
            status_code=409,
            detail="Record slitting output on this reel so the output coils are created; close with 0 kg only to return the reel unslit.",
        )
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


class SlittingCardPayload(BaseModel):
    """What came out of one reel on the slitter: the floor writes it like a job card."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    coils_made: int = Field(gt=0, le=500)
    wastage_kg: float = Field(ge=0)
    coil_width_mm: Optional[float] = Field(default=None, gt=0)
    slit_date: Optional[date] = None
    shift: Optional[str] = None
    operator_name: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=500)
    correction_reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("shift")
    @classmethod
    def validate_shift(cls, value: Optional[str]) -> Optional[str]:
        return None if value in (None, "") else _normalize_shift(value)


@router.post("/{issue_id}/slitting-card", response_model=ReelIssueResponse)
def record_slitting_card(
    issue_id: uuid.UUID,
    payload: SlittingCardPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "PlantManager", "RMIssue", "Operator"])),
):
    issue = db.query(ReelIssue).filter(
        ReelIssue.id == issue_id, ReelIssue.plant_id == _to_uuid(plant_id),
    ).with_for_update().populate_existing().first()
    if not issue:
        raise HTTPException(status_code=404, detail="Reel issue not found")
    if str(getattr(issue, "issue_mode", "") or "") != "FLOOR" or str(issue.issue_section or "") != "SLITTING_SECTION":
        raise HTTPException(status_code=409, detail="A slitting card belongs to a reel issued to the floor for slitting")
    issued = float(issue.issued_weight_kg or 0.0)
    if payload.wastage_kg > issued + 1e-6:
        raise HTTPException(status_code=422, detail=f"Wastage {payload.wastage_kg:g} kg is more than the {issued:g} kg reel")
    existing = dict(issue.slitting_card or {})
    roles = set(current_user.get("roles") or [])
    if existing:
        if not roles & {"Owner", "Admin", "PlantManager"}:
            raise HTTPException(status_code=403, detail="The slitting card is already written; a plant manager corrects it")
        if len((payload.correction_reason or "").strip()) < 3:
            raise HTTPException(status_code=422, detail="Say why the slitting card is being corrected")
    good_kg = round(issued - float(payload.wastage_kg), 3)
    card = {
        "coils_made": int(payload.coils_made),
        "wastage_kg": round(float(payload.wastage_kg), 3),
        "wastage_pct": round(100.0 * float(payload.wastage_kg) / issued, 2) if issued else None,
        "good_kg": good_kg,
        "kg_per_coil": round(good_kg / int(payload.coils_made), 3) if payload.coils_made else None,
        "coil_width_mm": payload.coil_width_mm,
        "slit_date": (payload.slit_date or issue.issue_date).isoformat(),
        "shift": payload.shift or issue.shift,
        "operator_name": (payload.operator_name or "").strip() or None,
        "notes": (payload.notes or "").strip() or None,
        "recorded_by": current_user.get("sub"),
        "recorded_at": datetime.utcnow().isoformat(),
        "history": [*(existing.get("history") or []), *([{k: v for k, v in existing.items() if k != "history"} | {"corrected_because": payload.correction_reason.strip()}] if existing else [])],
    }
    issue.slitting_card = card
    issue.status = ReelIssueStatus.CLOSED
    issue.closed_at = issue.closed_at or datetime.utcnow()
    db.commit()
    db.refresh(issue)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="slitting_card_recorded",
            entity_type="reel_issue",
            entity_id=str(issue.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Slitting card: {card['coils_made']} coils, {card['wastage_kg']} kg wastage from {issued:g} kg",
            payload={"reel_id": str(issue.reel_id), **{k: v for k, v in card.items() if k != "history"}},
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for slitting_card_recorded %s: %s", issue.id, exc)
    return _serialize_issue(issue)


@router.get("/slitting-report")
def slitting_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Reels sent to the slitter in the period with their slitting cards: coils made, wastage,
    and the reels still waiting for a card."""
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="The period end is before its start")
    query = db.query(ReelIssue).options(joinedload(ReelIssue.reel)).filter(
        ReelIssue.issue_mode == "FLOOR", ReelIssue.issue_section == "SLITTING_SECTION",
        ReelIssue.issue_date >= date_from, ReelIssue.issue_date <= date_to,
    )
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(ReelIssue.plant_id.in_([_to_uuid(value) for value in allowed]))
    else:
        query = query.filter(ReelIssue.plant_id == _to_uuid(plant_scope["selected_plant_id"]))
    rows = [_serialize_issue(issue).model_dump(mode="json") for issue in query.order_by(ReelIssue.issue_date.asc(), ReelIssue.created_at.asc()).all()]
    carded = [row for row in rows if row.get("slitting_card")]
    issued_kg = sum(float(row["issued_weight_kg"] or 0) for row in carded)
    wastage_kg = sum(float(row["slitting_card"].get("wastage_kg") or 0) for row in carded)
    by_paper: dict[str, dict] = {}
    for row in carded:
        key = row.get("paper_code") or "—"
        entry = by_paper.setdefault(key, {"paper_code": key, "paper_name": row.get("paper_name"), "reels": 0, "issued_kg": 0.0, "coils_made": 0, "wastage_kg": 0.0})
        entry["reels"] += 1
        entry["issued_kg"] += float(row["issued_weight_kg"] or 0)
        entry["coils_made"] += int(row["slitting_card"].get("coils_made") or 0)
        entry["wastage_kg"] += float(row["slitting_card"].get("wastage_kg") or 0)
    for entry in by_paper.values():
        entry["wastage_pct"] = round(100.0 * entry["wastage_kg"] / entry["issued_kg"], 2) if entry["issued_kg"] else None
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "summary": {
            "reels_issued": len(rows), "cards_written": len(carded), "cards_pending": len(rows) - len(carded),
            "issued_kg": round(sum(float(row["issued_weight_kg"] or 0) for row in rows), 3),
            "carded_kg": round(issued_kg, 3), "coils_made": sum(int(row["slitting_card"].get("coils_made") or 0) for row in carded),
            "wastage_kg": round(wastage_kg, 3), "wastage_pct": round(100.0 * wastage_kg / issued_kg, 2) if issued_kg else None,
        },
        "by_paper": sorted(by_paper.values(), key=lambda entry: -entry["issued_kg"]),
        "rows": rows,
    }
