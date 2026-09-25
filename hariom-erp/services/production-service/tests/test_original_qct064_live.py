"""QCT-064: declared advisory vs mandatory blocking checkpoints in separate fixtures."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from datetime import datetime as _dt, timedelta as _td, timezone as _tz

# Stage completion requires the Start (A)/End (B) written on the job card.
CARD_TIMES = {"start_time": _dt.now(_tz.utc) - _td(hours=2), "end_time": _dt.now(_tz.utc) - _td(hours=1)}

from src.database import Base, engine
from src.models import JobCard, QualityHold, QualityInspection
from src.routers.planning import (
    _build_spec_snapshot,
    _ensure_job_card_stages,
    _routing_stages_from_snapshot,
    capture_stage_output,
)
from src.routers.quality import InspectionCreate, create_inspection
from src.schemas.planning import StageOutputPayload
from tests.test_original_qct043_live import (
    PLANT,
    QC,
    Session,
    _admin_headers,
    _complete_profile,
    _create_approved_spec,
    _issue_job,
)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _reports() -> Path:
    path = Path(__file__).resolve().parents[4] / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


FAIL_READINGS = {"id": 77, "od": 91, "height": 90, "weight": 250, "cs": 100}
FAIL_REASONS = {"height": "measured short on winding"}
PM = {"sub": "nverify-qct064-pm", "roles": ["PlantManager"], "role": "PlantManager"}
CLIENT_SHORTCUT = {
    "gating": "advisory",
    "gate": "advisory",
    "movement_gate": "allow",
    "advisory": True,
    "blocking": False,
}


def _profile_with_winder_gating(gating: str | None) -> dict:
    profile = _complete_profile()
    if not gating:
        return profile
    stages = dict(profile["stages"])
    winder = dict(stages["WINDER"])
    winder["gating"] = gating
    stages["WINDER"] = winder
    profile["stages"] = stages
    return profile


def _ensure_stages(db, job: JobCard, first_stage: str | None = None) -> None:
    routing = _routing_stages_from_snapshot(job.spec_snapshot or {})
    _ensure_job_card_stages(
        db=db,
        job_card=job,
        routing_stages=routing,
        first_stage=first_stage or job.current_stage or "WINDER",
    )
    db.flush()


def _fail_height(db, job, sample_id: str, *, extra_readings: dict | None = None):
    readings = dict(FAIL_READINGS)
    if extra_readings:
        readings.update(extra_readings)
    return create_inspection(
        InspectionCreate(
            job_card_id=job.id,
            stage_type="WINDER",
            readings=readings,
            reasons=dict(FAIL_REASONS),
            sample_id=sample_id,
        ),
        db=db,
        plant_id=PLANT,
        current_user=QC,
    )


def _record_winder(db, job):
    return capture_stage_output(
        job.id,
        StageOutputPayload(
            stage="WINDER",
            output_qty=8,
            scrap_qty=1,
            save_mode="complete", **CARD_TIMES,
            actuals={"stock_status": "UNRESTRICTED", "disposition": "RELEASED"},
            quality_checks={"overall": "PASS", "status": "PASS", "stock_status": "UNRESTRICTED"},
        ),
        db=db,
        plant_id=PLANT,
        current_user=PM,
    )


def _try_oven(db, job):
    return capture_stage_output(
        job.id,
        StageOutputPayload(stage="OVEN", output_qty=8, save_mode="complete", **CARD_TIMES),
        db=db,
        plant_id=PLANT,
        current_user=PM,
    )


def _assert_fail_case(recorded, *, gating: str, movement_gate: str):
    assert recorded.status == "FAIL"
    assert recorded.hold_id is not None
    assert recorded.reasons.get("height") == FAIL_REASONS["height"]
    fail_codes = {str(row.get("code") or row.get("parameter") or "") for row in (recorded.failures or [])}
    assert "height" in fail_codes
    evaluation = recorded.evaluation or {}
    assert evaluation.get("gating") == gating
    assert evaluation.get("movement_gate") == movement_gate
    assert evaluation.get("gating_source") == "approved_profile"
    assert "gating" not in (recorded.readings or {})
    assert "movement_gate" not in (recorded.readings or {})


def test_qct064_advisory_and_blocking_checkpoints_separate_fixtures():
    headers = _admin_headers()
    advisory_spec = _create_approved_spec(
        headers, f"QCT064A-{uuid.uuid4()}", _profile_with_winder_gating("advisory")
    )
    blocking_spec = _create_approved_spec(
        headers, f"QCT064B-{uuid.uuid4()}", _profile_with_winder_gating(None)
    )
    advisory_snapshot = _build_spec_snapshot(advisory_spec, "NORMAL")
    blocking_snapshot = _build_spec_snapshot(blocking_spec, "NORMAL")
    winder_profile = ((advisory_snapshot.get("qc_profile") or {}).get("stages") or {}).get("WINDER") or {}
    assert winder_profile.get("gating") == "advisory"
    blocking_winder = ((blocking_snapshot.get("qc_profile") or {}).get("stages") or {}).get("WINDER") or {}
    assert blocking_winder.get("gating") in (None, "", "blocking")

    db = Session()
    try:
        advisory_job = _issue_job(db, advisory_spec, advisory_snapshot, "ADV", status="IN_PROGRESS")
        blocking_job = _issue_job(db, blocking_spec, blocking_snapshot, "BLK", status="IN_PROGRESS")
        _ensure_stages(db, advisory_job, "WINDER")
        _ensure_stages(db, blocking_job, "WINDER")
        db.commit()

        advisory_fail = _fail_height(db, advisory_job, "QCT064-A")
        _assert_fail_case(advisory_fail, gating="advisory", movement_gate="allow")
        advisory_hold = db.query(QualityHold).filter(QualityHold.id == advisory_fail.hold_id).one()
        assert advisory_hold.status == "HOLD"
        assert advisory_hold.source_inspection_id == advisory_fail.id

        blocking_fail = _fail_height(db, blocking_job, "QCT064-B", extra_readings=CLIENT_SHORTCUT)
        _assert_fail_case(blocking_fail, gating="blocking", movement_gate="block")
        blocking_hold = db.query(QualityHold).filter(QualityHold.id == blocking_fail.hold_id).one()
        assert blocking_hold.status == "HOLD"
        assert blocking_hold.source_inspection_id == blocking_fail.id
        stored_blocking = db.query(QualityInspection).filter(QualityInspection.id == blocking_fail.id).one()
        assert stored_blocking.status == "FAIL"
        assert (stored_blocking.evaluation or {}).get("gating") == "blocking"

        advisory_winder = _record_winder(db, advisory_job)
        assert advisory_winder.entry_saved is True
        assert str(advisory_fail.hold_id) in advisory_winder.quality_hold_ids

        advisory_oven = _try_oven(db, advisory_job)
        assert advisory_oven.entry_saved is True
        assert advisory_oven.job_card_status == "IN_PROGRESS"

        blocking_winder = _record_winder(db, blocking_job)
        assert blocking_winder.entry_saved is True
        assert blocking_winder.stage_status != "COMPLETED"
        assert str(blocking_fail.hold_id) in blocking_winder.quality_hold_ids

        with pytest.raises(HTTPException) as blocked:
            _try_oven(db, blocking_job)
        assert blocked.value.status_code == 409
        assert blocked.value.detail["code"] == "JOB_HAS_ACTIVE_QC_HOLD"

        db.expire_all()
        assert db.query(QualityHold).filter(QualityHold.id == advisory_fail.hold_id).one().status == "HOLD"
        assert db.query(QualityHold).filter(QualityHold.id == blocking_fail.hold_id).one().status == "HOLD"

        _reports().joinpath("qct064-jobs.json").write_text(
            json.dumps(
                {
                    "advisory_job_id": str(advisory_job.id),
                    "blocking_job_id": str(blocking_job.id),
                    "advisory_hold_id": str(advisory_fail.hold_id),
                    "blocking_hold_id": str(blocking_fail.hold_id),
                    "advisory_gating": (advisory_fail.evaluation or {}).get("gating"),
                    "blocking_gating": (blocking_fail.evaluation or {}).get("gating"),
                }
            )
        )
    finally:
        db.close()


def test_qct064_ui_job_seed():
    headers = _admin_headers()
    advisory_spec = _create_approved_spec(
        headers, f"QCT064UIA-{uuid.uuid4()}", _profile_with_winder_gating("advisory")
    )
    blocking_spec = _create_approved_spec(
        headers, f"QCT064UIB-{uuid.uuid4()}", _profile_with_winder_gating(None)
    )
    db = Session()
    try:
        advisory_job = _issue_job(
            db, advisory_spec, _build_spec_snapshot(advisory_spec, "NORMAL"), "ADV-UI", status="IN_PROGRESS"
        )
        blocking_job = _issue_job(
            db, blocking_spec, _build_spec_snapshot(blocking_spec, "NORMAL"), "BLK-UI", status="IN_PROGRESS"
        )
        _ensure_stages(db, advisory_job, "WINDER")
        _ensure_stages(db, blocking_job, "WINDER")
        db.commit()
        _reports().joinpath("qct064-ui-jobs.json").write_text(
            json.dumps(
                {
                    "advisory_job_id": str(advisory_job.id),
                    "blocking_job_id": str(blocking_job.id),
                }
            )
        )
    finally:
        db.close()
