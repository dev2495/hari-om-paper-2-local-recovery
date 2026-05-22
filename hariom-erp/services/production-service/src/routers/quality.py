from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AuditEvent, JobCard, PackingRecord, PLANT_A_UUID, PLANT_B_UUID, QualityHold, QualityInspection
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/quality", tags=["quality"])
settings = get_settings()

STAGES = {"SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC"}
FINAL_SPEC_QC_FIELDS = [
    ("ID", "id", "id_min_mm", "id_max_mm"),
    ("OD", "od", "od_min_mm", "od_max_mm"),
    ("Length", "length", "length_min_mm", "length_max_mm"),
    ("Weight", "weight", "weight_min_g", "weight_max_g"),
    ("CS", "cs", "cs_min_n", "cs_max_n"),
]


def _to_uuid(value: str, field: str = "id") -> uuid.UUID:
    normalized = str(value or "").strip().upper()
    if normalized in {"PLANT_A", "PLANT-1", "PLANT_1", "PLANT1"}:
        return PLANT_A_UUID
    if normalized in {"PLANT_B", "PLANT-2", "PLANT_2", "PLANT2"}:
        return PLANT_B_UUID
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value}") from exc


def _normalize_stage(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in STAGES:
        raise HTTPException(status_code=400, detail="stage_type must be one of SLITTING, WINDER, OVEN, PROCESS, PACKING, QC")
    return normalized


def _current_actor_role(current_user: dict) -> Optional[str]:
    user_roles = set(current_user.get("roles", []))
    if user_roles:
        return str(list(user_roles)[0])
    return None


def _json_hash(value: Any) -> Optional[str]:
    if value is None:
        return None
    import hashlib
    import json

    blob = json.dumps(value, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _record_audit_event(
    *,
    db: Session,
    plant_id: uuid.UUID,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    current_user: dict,
    job_card_id: Optional[uuid.UUID],
    payload: dict[str, Any],
    before_payload: Optional[dict[str, Any]] = None,
    after_payload: Optional[dict[str, Any]] = None,
) -> None:
    db.add(
        AuditEvent(
            plant_id=plant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor_id=current_user.get("sub"),
            actor_role=_current_actor_role(current_user),
            job_card_id=job_card_id,
            before_hash=_json_hash(before_payload),
            after_hash=_json_hash(after_payload),
            payload=payload,
        )
    )


def _check_failures(stage_type: str, spec_snapshot: dict[str, Any], readings: dict[str, Any]) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []

    def _number(value: Any) -> Optional[float]:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _check_range(label: str, reading_key: str, min_key: str, max_key: str) -> None:
        value = _number(readings.get(reading_key))
        minimum = _number(spec_snapshot.get(min_key))
        maximum = _number(spec_snapshot.get(max_key))
        if value is None or minimum is None or maximum is None:
            return
        if value < minimum or value > maximum:
            failures.append({"label": label, "value": value, "min": minimum, "max": maximum})

    if stage_type in {"WINDER", "PROCESS", "PACKING", "QC"}:
        _check_range("ID", "id", "id_min_mm", "id_max_mm")
        _check_range("OD", "od", "od_min_mm", "od_max_mm")
        _check_range("Length", "length", "length_min_mm", "length_max_mm")
        _check_range("Weight", "weight", "weight_min_g", "weight_max_g")
        _check_range("CS", "cs", "cs_min_n", "cs_max_n")
    if stage_type == "OVEN":
        _check_range("Moisture", "moisture_after", "moisture_min_pct", "moisture_max_pct")

    return failures


def _missing_final_spec_qc_fields(spec_snapshot: dict[str, Any], readings: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for label, reading_key, min_key, max_key in FINAL_SPEC_QC_FIELDS:
        spec_has_field = spec_snapshot.get(min_key) is not None or spec_snapshot.get(max_key) is not None
        if spec_has_field and readings.get(reading_key) is None:
            missing.append(label)
    return missing


class InspectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_card_id: uuid.UUID
    stage_type: str
    readings: dict[str, Any] = Field(default_factory=dict)
    create_hold_on_fail: bool = True

    @field_validator("stage_type")
    @classmethod
    def validate_stage_type(cls, value: str) -> str:
        return _normalize_stage(value)


class InspectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    job_card_id: uuid.UUID
    stage_type: str
    status: str
    readings: dict[str, Any]
    failures: list[dict[str, Any]]
    created_at: datetime
    hold_id: Optional[uuid.UUID] = None


class HoldCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_card_id: uuid.UUID
    stage_type: str
    reason: str = Field(min_length=1)
    batch_id: Optional[str] = None
    source_inspection_id: Optional[uuid.UUID] = None

    @field_validator("stage_type")
    @classmethod
    def validate_hold_stage(cls, value: str) -> str:
        return _normalize_stage(value)


class HoldResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    job_card_id: uuid.UUID
    stage_type: str
    batch_id: Optional[str] = None
    reason: str
    status: str
    source_inspection_id: Optional[uuid.UUID] = None
    created_by: Optional[str] = None
    released_by: Optional[str] = None
    created_at: datetime
    released_at: Optional[datetime] = None


class HoldReleaseResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hold_id: uuid.UUID
    status: str
    released_at: datetime


@router.post("/inspections", response_model=InspectionResponse)
def create_inspection(
    payload: InspectionCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "PlantManager", "QC", "SupervisorEntry", "Production"])),
):
    plant_uuid = _to_uuid(plant_id, field="plant_id")
    job_card = (
        db.query(JobCard)
        .filter(JobCard.id == payload.job_card_id, JobCard.plant_id == plant_uuid)
        .first()
    )
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")
    if payload.stage_type == "QC":
        missing = _missing_final_spec_qc_fields(job_card.spec_snapshot or {}, payload.readings or {})
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Final QC requires full spec readings: {', '.join(missing)}",
            )

    failures = _check_failures(payload.stage_type, job_card.spec_snapshot or {}, payload.readings or {})
    inspection = QualityInspection(
        plant_id=plant_uuid,
        job_card_id=job_card.id,
        stage_type=payload.stage_type,
        status="FAIL" if failures else "PASS",
        readings=payload.readings or {},
        failures=failures,
        created_by=current_user.get("sub"),
    )
    db.add(inspection)
    db.flush()

    hold: Optional[QualityHold] = None
    if failures and payload.create_hold_on_fail:
        hold = QualityHold(
            plant_id=plant_uuid,
            job_card_id=job_card.id,
            stage_type=payload.stage_type,
            reason="; ".join(
                f"{item['label']} out of range ({item['value']} not in {item['min']}..{item['max']})" for item in failures
            ),
            status="HOLD",
            source_inspection_id=inspection.id,
            created_by=current_user.get("sub"),
        )
        db.add(hold)
        db.flush()

    _record_audit_event(
        db=db,
        plant_id=plant_uuid,
        entity_type="quality_inspection",
        entity_id=inspection.id,
        action="created",
        current_user=current_user,
        job_card_id=job_card.id,
        payload={
            "stage_type": payload.stage_type,
            "status": inspection.status,
            "hold_id": str(hold.id) if hold else None,
        },
        after_payload={
            "status": inspection.status,
            "readings": payload.readings or {},
            "failures": failures,
        },
    )
    db.commit()
    db.refresh(inspection)
    return InspectionResponse(
        id=inspection.id,
        job_card_id=inspection.job_card_id,
        stage_type=inspection.stage_type,
        status=inspection.status,
        readings=inspection.readings or {},
        failures=inspection.failures or [],
        created_at=inspection.created_at,
        hold_id=hold.id if hold else None,
    )


@router.get("/inspections", response_model=list[InspectionResponse])
def list_inspections(
    job_card_id: Optional[uuid.UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "SupervisorEntry", "Dispatch", "Store", "Production", "SOApprover", "Sales"])),
):
    query = db.query(QualityInspection)
    if plant_scope.get("scope_all"):
        allowed = [_to_uuid(value, field="plant_id") for value in (plant_scope.get("allowed_plants") or [])]
        if allowed:
            query = query.filter(QualityInspection.plant_id.in_(allowed))
    else:
        query = query.filter(QualityInspection.plant_id == _to_uuid(plant_scope["selected_plant_id"], field="plant_id"))
    if job_card_id:
        query = query.filter(QualityInspection.job_card_id == job_card_id)
    if status:
        query = query.filter(QualityInspection.status == status.strip().upper())
    rows = query.order_by(QualityInspection.created_at.desc()).offset(offset).limit(limit).all()
    return [
        InspectionResponse(
            id=row.id,
            job_card_id=row.job_card_id,
            stage_type=row.stage_type,
            status=row.status,
            readings=row.readings or {},
            failures=row.failures or [],
            created_at=row.created_at,
            hold_id=None,
        )
        for row in rows
    ]


@router.post("/holds", response_model=HoldResponse)
def create_hold(
    payload: HoldCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "PlantManager", "QC"])),
):
    plant_uuid = _to_uuid(plant_id, field="plant_id")
    job_card = (
        db.query(JobCard)
        .filter(JobCard.id == payload.job_card_id, JobCard.plant_id == plant_uuid)
        .first()
    )
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")

    hold = QualityHold(
        plant_id=plant_uuid,
        job_card_id=job_card.id,
        stage_type=payload.stage_type,
        batch_id=payload.batch_id,
        reason=payload.reason,
        status="HOLD",
        source_inspection_id=payload.source_inspection_id,
        created_by=current_user.get("sub"),
    )
    db.add(hold)
    db.flush()
    _record_audit_event(
        db=db,
        plant_id=plant_uuid,
        entity_type="quality_hold",
        entity_id=hold.id,
        action="created",
        current_user=current_user,
        job_card_id=job_card.id,
        payload={"reason": payload.reason, "stage_type": payload.stage_type},
        after_payload={"status": hold.status},
    )
    db.commit()
    db.refresh(hold)
    return HoldResponse(
        id=hold.id,
        job_card_id=hold.job_card_id,
        stage_type=hold.stage_type,
        batch_id=hold.batch_id,
        reason=hold.reason,
        status=hold.status,
        source_inspection_id=hold.source_inspection_id,
        created_by=hold.created_by,
        released_by=hold.released_by,
        created_at=hold.created_at,
        released_at=hold.released_at,
    )


@router.get("/holds", response_model=list[HoldResponse])
def list_holds(
    job_card_id: Optional[uuid.UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "SupervisorEntry", "Dispatch", "Store", "Production", "SOApprover", "Sales"])),
):
    query = db.query(QualityHold)
    if plant_scope.get("scope_all"):
        allowed = [_to_uuid(value, field="plant_id") for value in (plant_scope.get("allowed_plants") or [])]
        if allowed:
            query = query.filter(QualityHold.plant_id.in_(allowed))
    else:
        query = query.filter(QualityHold.plant_id == _to_uuid(plant_scope["selected_plant_id"], field="plant_id"))
    if job_card_id:
        query = query.filter(QualityHold.job_card_id == job_card_id)
    if status:
        query = query.filter(QualityHold.status == status.strip().upper())
    rows = query.order_by(QualityHold.created_at.desc()).offset(offset).limit(limit).all()
    return [
        HoldResponse(
            id=row.id,
            job_card_id=row.job_card_id,
            stage_type=row.stage_type,
            batch_id=row.batch_id,
            reason=row.reason,
            status=row.status,
            source_inspection_id=row.source_inspection_id,
            created_by=row.created_by,
            released_by=row.released_by,
            created_at=row.created_at,
            released_at=row.released_at,
        )
        for row in rows
    ]


@router.post("/holds/{hold_id}/release", response_model=HoldReleaseResponse)
def release_hold(
    hold_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "PlantManager", "QC"])),
):
    plant_uuid = _to_uuid(plant_id, field="plant_id")
    hold = (
        db.query(QualityHold)
        .filter(QualityHold.id == hold_id, QualityHold.plant_id == plant_uuid)
        .first()
    )
    if not hold:
        raise HTTPException(status_code=404, detail="Quality hold not found")
    if hold.status != "HOLD":
        raise HTTPException(status_code=400, detail="Only active holds can be released")

    before_payload = {"status": hold.status, "released_at": str(hold.released_at) if hold.released_at else None}
    hold.status = "RELEASED"
    hold.released_by = current_user.get("sub")
    hold.released_at = datetime.utcnow()
    remaining_holds = (
        db.query(QualityHold)
        .filter(
            QualityHold.job_card_id == hold.job_card_id,
            QualityHold.status == "HOLD",
            QualityHold.id != hold.id,
        )
        .count()
    )
    if remaining_holds == 0:
        packing_record = db.query(PackingRecord).filter(PackingRecord.job_card_id == hold.job_card_id).first()
        if packing_record and packing_record.stock_status == "QC_HOLD":
            packing_record.stock_status = "UNRESTRICTED"
            inventory_batch_id = (packing_record.snapshot or {}).get("inventory_batch_id")
            if inventory_batch_id:
                with httpx.Client(timeout=10.0) as client:
                    response = client.post(
                        f"{settings.INVENTORY_SERVICE_URL}/inventory/stock-moves",
                        json={
                            "entity_type": "BATCH",
                            "entity_id": str(inventory_batch_id),
                            "to_location_id": str(packing_record.location_id) if packing_record.location_id else None,
                            "stock_status": "UNRESTRICTED",
                            "reason": f"QC hold released for job card {hold.job_card_id}",
                            "external_ref": f"QC-REL-{hold.id}",
                        },
                        headers={
                            "Authorization": f"Bearer {current_user.get('token', '')}",
                            "X-Plant-ID": plant_id,
                        },
                    )
                if response.status_code not in (200, 201):
                    raise HTTPException(status_code=502, detail="Failed to release FG stock status in inventory")
    _record_audit_event(
        db=db,
        plant_id=plant_uuid,
        entity_type="quality_hold",
        entity_id=hold.id,
        action="released",
        current_user=current_user,
        job_card_id=hold.job_card_id,
        payload={},
        before_payload=before_payload,
        after_payload={"status": hold.status, "released_at": hold.released_at.isoformat()},
    )
    db.commit()
    return HoldReleaseResponse(
        hold_id=hold.id,
        status=hold.status,
        released_at=hold.released_at,
    )
