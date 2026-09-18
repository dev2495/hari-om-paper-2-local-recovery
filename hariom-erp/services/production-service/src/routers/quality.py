from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AuditEvent, JobCard, JobCardStage, PackingRecord, PLANT_A_UUID, PLANT_B_UUID, QualityHold, QualityInspection
from ..quality_eval import evaluate_job_stage, evaluate_stage_quality, submission_error
from ..quality_metrics import quality_pass_rate
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/quality", tags=["quality"])
settings = get_settings()

STAGES = {"SLITTING", "WINDER", "OVEN", "PROCESS", "PACKING", "QC"}
CARD_QC_STAGES = ("WINDER", "OVEN", "PROCESS")
ISSUE_VERDICTS = {"FAIL", "INCOMPLETE", "INVALID"}
FINAL_SPEC_QC_FIELDS = [
    ("ID", "id", "id_min_mm", "id_max_mm"),
    ("OD", "od", "od_min_mm", "od_max_mm"),
    ("Length", "length", "length_min_mm", "length_max_mm"),
    ("Weight", "weight", "weight_min_g", "weight_max_g"),
    ("CS", "cs", "cs_min_n", "cs_max_n"),
]


def _oven_checkpoint(readings: Optional[dict[str, Any]]) -> str:
    return str((readings or {}).get("oven_checkpoint") or (readings or {}).get("checkpoint") or "").strip().upper()


def _oven_pair_id(sample_id: Optional[str], readings: Optional[dict[str, Any]]) -> str:
    payload = readings or {}
    return str(
        sample_id
        or payload.get("sample_id")
        or payload.get("pre_specimen_id")
        or payload.get("post_specimen_id")
        or payload.get("pre_pair_id")
        or payload.get("post_pair_id")
        or ""
    ).strip()


def _has_oven_pre(readings: Optional[dict[str, Any]]) -> bool:
    payload = readings or {}
    return any(payload.get(code) not in (None, "") for code in ("pre_weight", "pre_moisture"))


def _has_oven_post(readings: Optional[dict[str, Any]]) -> bool:
    payload = readings or {}
    return any(payload.get(code) not in (None, "") for code in ("post_weight", "post_moisture"))


def _latest_oven_pre_inspection(
    db: Session,
    *,
    job_card_id: uuid.UUID,
    plant_id: uuid.UUID,
    pair_id: str,
) -> Optional[QualityInspection]:
    if not pair_id:
        return None
    rows = (
        db.query(QualityInspection)
        .filter(
            QualityInspection.job_card_id == job_card_id,
            QualityInspection.plant_id == plant_id,
            QualityInspection.stage_type == "OVEN",
        )
        .order_by(QualityInspection.created_at.desc())
        .all()
    )
    for row in rows:
        readings = row.readings or {}
        checkpoint = _oven_checkpoint(readings)
        if checkpoint in {"POST", "POST_ONLY"}:
            continue
        if not _has_oven_pre(readings):
            continue
        if _has_oven_post(readings) and checkpoint not in {"PRE", "PRE_ONLY"}:
            continue
        stored_pair = _oven_pair_id(getattr(row, "sample_id", None), readings)
        if stored_pair == pair_id:
            return row
    return None


def _merge_oven_pre_context(readings: dict[str, Any], prior: QualityInspection) -> dict[str, Any]:
    merged = dict(readings or {})
    prior_readings = prior.readings or {}
    pair = _oven_pair_id(getattr(prior, "sample_id", None), prior_readings)
    if pair:
        merged.setdefault("pre_specimen_id", pair)
        merged.setdefault("sample_id", pair)
    for code in ("pre_weight", "pre_moisture"):
        if merged.get(code) in (None, "") and prior_readings.get(code) not in (None, ""):
            merged[code] = prior_readings.get(code)
    return merged


def _due_card_stages(spec_snapshot: dict[str, Any]) -> list[str]:
    profile = spec_snapshot.get("qc_profile") if isinstance(spec_snapshot.get("qc_profile"), dict) else {}
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    due: list[str] = []
    for key in CARD_QC_STAGES:
        block = stages.get(key)
        if not isinstance(block, dict):
            continue
        params = block.get("parameters") or []
        if any(isinstance(row, dict) and row.get("applicable", True) is not False for row in params):
            due.append(key)
    return due


def _merge_filled(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base or {})
    for key, value in (overlay or {}).items():
        if value in (None, ""):
            continue
        merged[key] = value
    return merged


def _stage_sample_id(stage_type: str, sample_id: Optional[str], readings: dict[str, Any]) -> str:
    if str(stage_type or "").upper() == "OVEN":
        return _oven_pair_id(sample_id, readings)
    return str(sample_id or "").strip()


def _card_issue_actions(outcome: str, missing_reason: bool) -> list[str]:
    actions: list[str] = []
    if outcome == "INCOMPLETE":
        actions.append("Enter the due reading on that stage. A hidden tab does not skip it.")
    if outcome == "INVALID":
        actions.append("Correct the malformed reading. It is not PASS.")
    if outcome == "FAIL":
        actions.append("Measured FAIL stays FAIL. Review or disposition is required for release.")
    if missing_reason:
        actions.append("Add a linked reason; a reason never creates PASS.")
    return actions


def _normalize_card_row(row: dict[str, Any]) -> dict[str, Any]:
    readings = dict(row.get("readings") or {})
    reasons = dict(row.get("reasons") or {})
    if "reasons" in readings and isinstance(readings.get("reasons"), dict) and not reasons:
        reasons = dict(readings.get("reasons") or {})
    stage_type = str(row.get("stage_type") or "").strip().upper()
    sample_id = row.get("sample_id")
    return {
        "stage_type": stage_type,
        "readings": readings,
        "reasons": reasons,
        "sample_id": _stage_sample_id(stage_type, sample_id, readings),
    }


def collect_complete_card_issues(
    *,
    spec_snapshot: dict[str, Any],
    submitted_stages: list[dict[str, Any]],
    stored_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Validate every due stage/sample, including stages omitted from the visible tab."""
    snapshot = spec_snapshot or {}
    due_stages = _due_card_stages(snapshot)
    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    for raw in list(stored_rows or []) + list(submitted_stages or []):
        row = _normalize_card_row(raw if isinstance(raw, dict) else {})
        stage_type = row["stage_type"]
        if stage_type not in due_stages:
            continue
        key = (stage_type, row["sample_id"])
        prior = buckets.get(key) or {"stage_type": stage_type, "sample_id": row["sample_id"], "readings": {}, "reasons": {}}
        buckets[key] = {
            "stage_type": stage_type,
            "sample_id": row["sample_id"] or prior.get("sample_id") or "",
            "readings": _merge_filled(prior.get("readings") or {}, row["readings"]),
            "reasons": _merge_filled(prior.get("reasons") or {}, row["reasons"]),
        }
    for stage_type in due_stages:
        if not any(key[0] == stage_type for key in buckets):
            buckets[(stage_type, "")] = {"stage_type": stage_type, "sample_id": "", "readings": {}, "reasons": {}}

    issues: list[dict[str, Any]] = []
    for stage_type, sample_id in sorted(buckets, key=lambda item: (CARD_QC_STAGES.index(item[0]) if item[0] in CARD_QC_STAGES else 99, item[1])):
        bucket = buckets[(stage_type, sample_id)]
        readings = dict(bucket.get("readings") or {})
        if stage_type == "OVEN":
            readings["oven_checkpoint"] = "POST"
            if sample_id:
                readings.setdefault("sample_id", sample_id)
                readings.setdefault("post_specimen_id", sample_id)
                readings.setdefault("pre_specimen_id", sample_id)
        evaluation = evaluate_job_stage(
            stage=stage_type,
            spec_snapshot=snapshot,
            readings=readings,
            reasons=bucket.get("reasons") or {},
            sample_id=sample_id or None,
            require_reasons_on_fail=True,
        )
        missing_reasons = set(evaluation.missing_reasons or [])
        for result in evaluation.parameter_results:
            if result.verdict not in ISSUE_VERDICTS:
                continue
            missing_reason = result.code in missing_reasons
            issues.append(
                {
                    "stage": stage_type,
                    "parameter": result.code,
                    "sample": sample_id or None,
                    "actual": result.submitted if result.submitted not in (None, "") else readings.get(result.code),
                    "approved_rule": result.rule.allowed_display() if result.rule else result.message,
                    "outcome": result.verdict,
                    "missing_reason": missing_reason,
                    "next_actions": _card_issue_actions(result.verdict, missing_reason),
                }
            )
    return issues


def _stored_card_rows(db: Session, job_card: JobCard) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    inspections = (
        db.query(QualityInspection)
        .filter(QualityInspection.job_card_id == job_card.id)
        .order_by(QualityInspection.created_at.asc())
        .all()
    )
    for inspection in inspections:
        rows.append(
            {
                "stage_type": inspection.stage_type,
                "readings": inspection.readings or {},
                "reasons": getattr(inspection, "reasons", None) or {},
                "sample_id": getattr(inspection, "sample_id", None),
            }
        )
    stages = db.query(JobCardStage).filter(JobCardStage.job_card_id == job_card.id).all()
    for stage in stages:
        payload = dict(stage.quality_checks or {})
        if not payload:
            continue
        samples = payload.get("samples") if isinstance(payload.get("samples"), list) else None
        if samples:
            for sample in samples:
                if not isinstance(sample, dict):
                    continue
                rows.append(
                    {
                        "stage_type": stage.stage_type,
                        "readings": sample.get("readings") or sample,
                        "reasons": sample.get("reasons") or payload.get("reasons") or {},
                        "sample_id": sample.get("sample_id") or payload.get("sample_id"),
                    }
                )
            continue
        readings = {
            key: value
            for key, value in payload.items()
            if key not in {"reasons", "sample_id", "samples", "unit_conflicts", "checkpoint"}
        }
        rows.append(
            {
                "stage_type": stage.stage_type,
                "readings": readings,
                "reasons": payload.get("reasons") or {},
                "sample_id": payload.get("sample_id"),
            }
        )
    return rows


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


CONCESSION_PERMISSION = "qc:disposition:approve"
CONCESSION_ROLES = {"Owner", "Admin"}


def _current_actor_role(current_user: dict) -> Optional[str]:
    user_roles = set(current_user.get("roles", []))
    if user_roles:
        return str(list(user_roles)[0])
    return None


def _require_concession_authority(current_user: dict, *, inspector_id: Optional[str]) -> None:
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
        detail="Releasing a FAIL result requires the qc:disposition:approve capability.",
    )


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
    """Backward-compatible failures list; routed through the shared evaluator."""
    evaluation = evaluate_job_stage(
        stage=stage_type,
        spec_snapshot=spec_snapshot or {},
        readings=readings or {},
        require_reasons_on_fail=False,
    )
    if evaluation.failures:
        return list(evaluation.failures)
    # Spec-snapshot typed validator (p0) when the frozen profile produced no rows.
    return evaluate_stage_quality(stage_type, spec_snapshot or {}, readings or {}).failures


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
    reasons: dict[str, Any] = Field(default_factory=dict)
    sample_id: Optional[str] = None
    create_hold_on_fail: bool = True
    parent_inspection_id: Optional[uuid.UUID] = None
    final_submission: bool = False

    @field_validator("stage_type")
    @classmethod
    def validate_stage_type(cls, value: str) -> str:
        return _normalize_stage(value)

    @field_validator("sample_id")
    @classmethod
    def validate_sample_id(cls, value: Optional[str]) -> Optional[str]:
        text = str(value or "").strip()
        return text or None


class CompleteCardStageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_type: str
    readings: dict[str, Any] = Field(default_factory=dict)
    reasons: dict[str, Any] = Field(default_factory=dict)
    sample_id: Optional[str] = None

    @field_validator("stage_type")
    @classmethod
    def validate_stage_type(cls, value: str) -> str:
        return _normalize_stage(value)

    @field_validator("sample_id")
    @classmethod
    def validate_sample_id(cls, value: Optional[str]) -> Optional[str]:
        text = str(value or "").strip()
        return text or None


class CompleteCardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visible_stage: Optional[str] = None
    stages: list[CompleteCardStageInput] = Field(default_factory=list)

    @field_validator("visible_stage")
    @classmethod
    def validate_visible_stage(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        return _normalize_stage(value)


class CompleteCardIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    parameter: str
    sample: Optional[str] = None
    actual: Any = None
    approved_rule: Optional[str] = None
    outcome: str
    missing_reason: bool = False
    next_actions: list[str] = Field(default_factory=list)


class CompleteCardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    job_card_id: uuid.UUID
    visible_stage: Optional[str] = None
    form_retained: bool = True
    issues: list[CompleteCardIssue] = Field(default_factory=list)
    inspection_count: int = 0


class InspectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    job_card_id: uuid.UUID
    stage_type: str
    status: str
    readings: dict[str, Any]
    failures: list[dict[str, Any]]
    reasons: dict[str, Any] = Field(default_factory=dict)
    evaluation: dict[str, Any] = Field(default_factory=dict)
    frozen_rules: list[dict[str, Any]] = Field(default_factory=list)
    sample_id: Optional[str] = None
    created_at: datetime
    hold_id: Optional[uuid.UUID] = None
    reason_pending: bool = False
    workflow_status: Optional[str] = None
    parent_inspection_id: Optional[uuid.UUID] = None
    exposure_after_dispatch: bool = False


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


class QualitySummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inspection_count: int
    passed_count: int
    failed_count: int
    measured_count: int = 0
    incomplete_count: int = 0
    invalid_count: int = 0
    first_pass_count: int = 0
    retest_count: int = 0
    pass_rate: Optional[float] = None
    first_pass_rate: Optional[float] = None
    active_holds: int
    released_holds: int


def _apply_quality_plant_scope(query, column, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = [_to_uuid(value, field="plant_id") for value in (plant_scope.get("allowed_plants") or [])]
        if not allowed:
            return query.filter(column.in_([]))
        return query.filter(column.in_(allowed))
    selected = plant_scope.get("selected_plant_id")
    if not selected:
        raise HTTPException(status_code=400, detail="Select one concrete plant. Unresolved plant is not defaulted to Plant A")
    return query.filter(column == _to_uuid(selected, field="plant_id"))


class HoldReleaseResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hold_id: uuid.UUID
    status: str
    released_at: datetime


@router.get("/summary", response_model=QualitySummaryResponse)
def get_quality_summary(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "SupervisorEntry", "Dispatch", "Store", "Production", "SOApprover", "Sales"])),
):
    del current_user
    inspections = _apply_quality_plant_scope(db.query(QualityInspection), QualityInspection.plant_id, plant_scope).all()
    holds = _apply_quality_plant_scope(db.query(QualityHold), QualityHold.plant_id, plant_scope).all()
    statuses = [str(row.status or "").upper() for row in inspections]
    passed = sum(1 for status in statuses if status == "PASS")
    failed = sum(1 for status in statuses if status == "FAIL")
    incomplete = sum(1 for status in statuses if status == "INCOMPLETE")
    invalid = sum(1 for status in statuses if status == "INVALID")
    measured = passed + failed
    retest = sum(1 for row in inspections if getattr(row, "parent_inspection_id", None))
    first_pass = sum(
        1
        for row in inspections
        if str(row.status or "").upper() == "PASS" and not getattr(row, "parent_inspection_id", None)
    )
    return QualitySummaryResponse(
        inspection_count=len(inspections),
        passed_count=passed,
        failed_count=failed,
        measured_count=measured,
        incomplete_count=incomplete,
        invalid_count=invalid,
        first_pass_count=first_pass,
        retest_count=retest,
        pass_rate=quality_pass_rate(passed, measured),
        first_pass_rate=quality_pass_rate(first_pass, measured),
        active_holds=sum(1 for row in holds if str(row.status or "").upper() == "HOLD"),
        released_holds=sum(1 for row in holds if str(row.status or "").upper() == "RELEASED"),
    )


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
    readings = dict(payload.readings or {})
    sample_id = payload.sample_id
    parent_id = payload.parent_inspection_id
    if payload.stage_type == "OVEN" and _oven_checkpoint(readings) in {"POST", "POST_ONLY"}:
        pair_id = _oven_pair_id(sample_id, readings)
        prior = _latest_oven_pre_inspection(
            db,
            job_card_id=job_card.id,
            plant_id=plant_uuid,
            pair_id=pair_id,
        )
        if prior is not None:
            readings = _merge_oven_pre_context(readings, prior)
            if parent_id is None:
                parent_id = prior.id
            if not sample_id:
                sample_id = _oven_pair_id(getattr(prior, "sample_id", None), prior.readings or {})
        elif pair_id:
            readings.setdefault("post_specimen_id", pair_id)
    evaluation = evaluate_job_stage(
        stage=payload.stage_type,
        spec_snapshot=job_card.spec_snapshot or {},
        readings=readings,
        reasons=payload.reasons or {},
        sample_id=sample_id,
        require_reasons_on_fail=True,
    )
    reason_pending = bool(evaluation.missing_reasons)
    if payload.final_submission:
        error = submission_error(evaluation)
        if error:
            raise HTTPException(status_code=400, detail=error)
    if payload.stage_type == "QC" and evaluation.verdict == "INCOMPLETE":
        missing = [
            row.label
            for row in evaluation.parameter_results
            if row.verdict == "INCOMPLETE"
        ]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Final QC requires full spec readings: {', '.join(missing)}",
            )

    job_status = str(job_card.status or "").upper()
    exposure_after_dispatch = job_status in {"COMPLETED", "DISPATCHED"} or str(job_card.current_stage or "").upper() in {
        "DISPATCH",
        "DONE",
    }
    evaluation_payload = evaluation.as_dict()
    if reason_pending:
        evaluation_payload["workflow_status"] = "REASON_PENDING"
        evaluation_payload["reason_pending"] = True
    if exposure_after_dispatch:
        evaluation_payload["exposure_after_dispatch"] = True
    if payload.parent_inspection_id:
        evaluation_payload["parent_inspection_id"] = str(payload.parent_inspection_id)
    elif parent_id:
        evaluation_payload["parent_inspection_id"] = str(parent_id)

    failures = list(evaluation.failures)
    inspection = QualityInspection(
        plant_id=plant_uuid,
        job_card_id=job_card.id,
        stage_type=payload.stage_type,
        status=evaluation.verdict,
        readings=payload.readings or {},
        failures=failures,
        reasons=payload.reasons or {},
        evaluation=evaluation_payload,
        sample_id=sample_id,
        parent_inspection_id=parent_id or payload.parent_inspection_id,
        created_by=current_user.get("sub"),
    )
    db.add(inspection)
    db.flush()

    # Containment is a server policy. The client create_hold_on_fail flag is ignored.
    hold: Optional[QualityHold] = None
    if evaluation.status in {"FAIL", "INVALID"}:
        hold = QualityHold(
            plant_id=plant_uuid,
            job_card_id=job_card.id,
            stage_type=payload.stage_type,
            reason=evaluation.issue_summary() or f"{payload.stage_type} inspection {evaluation.verdict}",
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
            "evaluation": evaluation.as_dict(),
        },
    )
    db.commit()
    db.refresh(inspection)
    evaluation_blob = inspection.evaluation or evaluation.as_dict()
    return InspectionResponse(
        id=inspection.id,
        job_card_id=inspection.job_card_id,
        stage_type=inspection.stage_type,
        status=inspection.status,
        readings=inspection.readings or {},
        failures=inspection.failures or [],
        reasons=inspection.reasons or {},
        evaluation=evaluation_blob,
        frozen_rules=evaluation.frozen_rules,
        sample_id=inspection.sample_id,
        created_at=inspection.created_at,
        hold_id=hold.id if hold else None,
        reason_pending=bool(evaluation_blob.get("reason_pending")),
        workflow_status=evaluation_blob.get("workflow_status"),
        parent_inspection_id=inspection.parent_inspection_id,
        exposure_after_dispatch=bool(evaluation_blob.get("exposure_after_dispatch")),
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
        if not allowed:
            query = query.filter(QualityInspection.plant_id.in_([]))
        else:
            query = query.filter(QualityInspection.plant_id.in_(allowed))
    else:
        selected = plant_scope.get("selected_plant_id")
        if not selected:
            raise HTTPException(status_code=400, detail="Select one concrete plant. Unresolved plant is not defaulted to Plant A")
        query = query.filter(QualityInspection.plant_id == _to_uuid(selected, field="plant_id"))
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
            reasons=getattr(row, "reasons", None) or {},
            evaluation=getattr(row, "evaluation", None) or {},
            frozen_rules=((getattr(row, "evaluation", None) or {}).get("frozen_rules") or []),
            sample_id=getattr(row, "sample_id", None),
            created_at=row.created_at,
            hold_id=None,
            reason_pending=bool((getattr(row, "evaluation", None) or {}).get("reason_pending")),
            workflow_status=(getattr(row, "evaluation", None) or {}).get("workflow_status"),
            parent_inspection_id=getattr(row, "parent_inspection_id", None),
            exposure_after_dispatch=bool((getattr(row, "evaluation", None) or {}).get("exposure_after_dispatch")),
        )
        for row in rows
    ]


@router.get("/job-cards/{job_card_id}/template")
def get_frozen_qc_template(
    job_card_id: uuid.UUID,
    stage_type: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "QC", "SupervisorEntry", "Production"])),
):
    query = db.query(JobCard).filter(JobCard.id == job_card_id)
    if plant_scope.get("scope_all"):
        allowed = [_to_uuid(value, field="plant_id") for value in (plant_scope.get("allowed_plants") or [])]
        if allowed:
            query = query.filter(JobCard.plant_id.in_(allowed))
        else:
            query = query.filter(JobCard.plant_id.in_([]))
    else:
        selected = plant_scope.get("selected_plant_id")
        if not selected:
            raise HTTPException(status_code=400, detail="Select one concrete plant. Unresolved plant is not defaulted to Plant A")
        query = query.filter(JobCard.plant_id == _to_uuid(selected, field="plant_id"))
    job_card = query.first()
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")
    snapshot = job_card.spec_snapshot or {}
    profile = snapshot.get("qc_profile") if isinstance(snapshot.get("qc_profile"), dict) else {}
    requested = _normalize_stage(stage_type) if stage_type else None
    stages: dict[str, Any] = {}
    for stage in ("WINDER", "OVEN", "PROCESS", "QC"):
        if requested and requested != stage:
            continue
        evaluation = evaluate_job_stage(
            stage=stage,
            spec_snapshot=snapshot,
            readings={},
            require_reasons_on_fail=False,
        )
        stages[stage] = {
            "parameters": evaluation.frozen_rules,
            "verdict_if_blank": evaluation.verdict,
        }
    return {
        "job_card_id": str(job_card.id),
        "qc_profile": profile,
        "profile_revision": profile.get("revision"),
        "notching_applicable": bool(snapshot.get("notch_capability_required")),
        "stages": stages,
    }


@router.post("/job-cards/{job_card_id}/complete", response_model=CompleteCardResponse)
def complete_job_card_qc(
    job_card_id: uuid.UUID,
    payload: CompleteCardRequest,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "PlantManager", "QC", "SupervisorEntry", "Production"])),
):
    plant_uuid = _to_uuid(plant_id, field="plant_id")
    job_card = (
        db.query(JobCard)
        .filter(JobCard.id == job_card_id, JobCard.plant_id == plant_uuid)
        .first()
    )
    if not job_card:
        raise HTTPException(status_code=404, detail="Job card not found")
    inspection_count = (
        db.query(QualityInspection)
        .filter(QualityInspection.job_card_id == job_card.id)
        .count()
    )
    submitted = [
        {
            "stage_type": row.stage_type,
            "readings": row.readings or {},
            "reasons": row.reasons or {},
            "sample_id": row.sample_id,
        }
        for row in (payload.stages or [])
    ]
    issues = collect_complete_card_issues(
        spec_snapshot=job_card.spec_snapshot or {},
        submitted_stages=submitted,
        stored_rows=_stored_card_rows(db, job_card),
    )
    accepted = not issues
    after_count = (
        db.query(QualityInspection)
        .filter(QualityInspection.job_card_id == job_card.id)
        .count()
    )
    return CompleteCardResponse(
        accepted=accepted,
        job_card_id=job_card.id,
        visible_stage=payload.visible_stage,
        form_retained=after_count == inspection_count,
        issues=[CompleteCardIssue(**issue) for issue in issues],
        inspection_count=after_count,
    )


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
        if not allowed:
            query = query.filter(QualityHold.plant_id.in_([]))
        else:
            query = query.filter(QualityHold.plant_id.in_(allowed))
    else:
        selected = plant_scope.get("selected_plant_id")
        if not selected:
            raise HTTPException(status_code=400, detail="Select one concrete plant. Unresolved plant is not defaulted to Plant A")
        query = query.filter(QualityHold.plant_id == _to_uuid(selected, field="plant_id"))
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

    source_inspection = None
    if hold.source_inspection_id:
        source_inspection = db.query(QualityInspection).filter(QualityInspection.id == hold.source_inspection_id).first()
    if source_inspection is not None and str(source_inspection.status or "").upper() == "FAIL":
        _require_concession_authority(
            current_user,
            inspector_id=source_inspection.created_by or hold.created_by,
        )

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
