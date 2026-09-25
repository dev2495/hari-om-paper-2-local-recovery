"""QCT-057: physically completed FAIL-QC output is retained as restricted, not hidden."""
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
from src.models import JobCard, JobCardStage, PackingRecord, QualityHold
from src.routers.planning import (
    _build_spec_snapshot,
    _ensure_job_card_stages,
    _routing_stages_from_snapshot,
    capture_stage_output,
    get_planning_job_card,
)
from src.routers.quality import InspectionCreate, create_inspection
from src.schemas.planning import StageOutputPayload
from tests.test_original_qct043_live import (
    ADMIN,
    PLANT,
    QC,
    SCOPE,
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
PM = {"sub": "nverify-qct057-pm", "roles": ["PlantManager"], "role": "PlantManager"}


def _ensure_stages(db, job: JobCard, first_stage: str | None = None) -> None:
    routing = _routing_stages_from_snapshot(job.spec_snapshot or {})
    _ensure_job_card_stages(
        db=db,
        job_card=job,
        routing_stages=routing,
        first_stage=first_stage or job.current_stage or "WINDER",
    )
    db.flush()


def test_qct057_fail_qc_output_retained_restricted_not_hidden():
    headers = _admin_headers()
    marker = f"QCT057-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "HOLD-WIP", status="IN_PROGRESS")
        packing_job = _issue_job(db, spec, snapshot, "HOLD-FG", status="IN_PROGRESS")
        packing_job.current_stage = "PACKING"
        _ensure_stages(db, job, "WINDER")
        _ensure_stages(db, packing_job, "PACKING")
        db.commit()

        failed = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id="QCT057-W1",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert failed.status == "FAIL"
        assert failed.hold_id is not None

        recorded = capture_stage_output(
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
        assert recorded.entry_saved is True
        assert recorded.job_card_status == "IN_PROGRESS"
        assert recorded.current_stage == "WINDER"
        assert recorded.stage_status != "COMPLETED"
        assert str(failed.hold_id) in recorded.quality_hold_ids
        assert any("restricted" in warning.lower() for warning in recorded.warnings)

        db.expire_all()
        winder = (
            db.query(JobCardStage)
            .filter(JobCardStage.job_card_id == job.id, JobCardStage.stage_type == "WINDER")
            .one()
        )
        stored_job = db.query(JobCard).filter(JobCard.id == job.id).one()
        hold = db.query(QualityHold).filter(QualityHold.id == failed.hold_id).one()
        actuals = winder.actuals_snapshot or {}
        assert winder.output_qty == 8
        assert winder.scrap_qty == 1
        assert winder.status != "COMPLETED"
        assert actuals.get("stock_status") == "QC_HOLD"
        assert actuals.get("eligibility") == "BLOCKED"
        assert actuals.get("failed_qty_labelled_good") is False
        assert actuals.get("client_good_label_rejected") is True
        assert stored_job.status == "IN_PROGRESS"
        assert stored_job.current_stage == "WINDER"
        assert hold.status == "HOLD"

        with pytest.raises(HTTPException) as blocked:
            capture_stage_output(
                job.id,
                StageOutputPayload(stage="OVEN", output_qty=8, save_mode="complete", **CARD_TIMES),
                db=db,
                plant_id=PLANT,
                current_user=PM,
            )
        assert blocked.value.status_code == 409
        assert blocked.value.detail["code"] == "JOB_HAS_ACTIVE_QC_HOLD"

        packing_fail = create_inspection(
            InspectionCreate(
                job_card_id=packing_job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id="QCT057-P1",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert packing_fail.status == "FAIL"
        packed = capture_stage_output(
            packing_job.id,
            StageOutputPayload(
                stage="PACKING",
                output_qty=5,
                save_mode="complete", **CARD_TIMES,
                actuals={"stock_status": "UNRESTRICTED"},
                entry_snapshot={"total_packed_qty": 5, "stock_status": "UNRESTRICTED"},
            ),
            db=db,
            plant_id=PLANT,
            current_user=PM,
        )
        assert packed.entry_saved is True
        db.expire_all()
        packing_stage = (
            db.query(JobCardStage)
            .filter(JobCardStage.job_card_id == packing_job.id, JobCardStage.stage_type == "PACKING")
            .one()
        )
        packing_row = db.query(PackingRecord).filter(PackingRecord.job_card_id == packing_job.id).one()
        packing_job_row = db.query(JobCard).filter(JobCard.id == packing_job.id).one()
        assert packing_stage.output_qty == 5
        assert (packing_stage.actuals_snapshot or {}).get("stock_status") == "QC_HOLD"
        assert packing_row.total_packed_qty == 5
        assert packing_row.stock_status == "QC_HOLD"
        assert packing_job_row.status != "COMPLETED"

        print_payload = get_planning_job_card(
            job.id,
            db=db,
            plant_scope=SCOPE,
            current_user=ADMIN,
        )
        produced = (print_payload.document_snapshot or {}).get("material_truth") or {}
        assert produced.get("produced_output_qty") == 8
        assert print_payload.status == "IN_PROGRESS"

        _reports().joinpath("qct057-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "packing_job_id": str(packing_job.id),
                    "hold_id": str(failed.hold_id),
                    "output_qty": 8,
                    "packed_qty": 5,
                }
            )
        )
    finally:
        db.close()


def test_qct057_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT057UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "HOLD-UI", status="IN_PROGRESS")
        _ensure_stages(db, job, "WINDER")
        db.commit()
        failed = create_inspection(
            InspectionCreate(
                job_card_id=job.id,
                stage_type="WINDER",
                readings=dict(FAIL_READINGS),
                reasons=dict(FAIL_REASONS),
                sample_id="QCT057-UI",
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert failed.status == "FAIL"
        db.commit()
        _reports().joinpath("qct057-ui-job.json").write_text(
            json.dumps({"job_id": str(job.id), "hold_id": str(failed.hold_id)})
        )
    finally:
        db.close()
