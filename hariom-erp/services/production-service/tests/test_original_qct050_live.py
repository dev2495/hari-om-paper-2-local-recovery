"""QCT-050: complete job card returns every hidden-stage/sample issue."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import QualityInspection
from src.routers.planning import _build_spec_snapshot
from src.routers.quality import (
    CompleteCardRequest,
    CompleteCardStageInput,
    InspectionCreate,
    complete_job_card_qc,
    create_inspection,
)
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


WINDER_PASS = {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100}
PROCESS_FAIL = {"height": 90, "weight": 250, "cs": 100, "moisture": 5}


def test_qct050_hidden_stage_issues_returned_and_form_data_stays():
    headers = _admin_headers()
    marker = f"QCT050-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "CARD", status="IN_PROGRESS")
        db.commit()
        visible = create_inspection(
            InspectionCreate(job_card_id=job.id, stage_type="WINDER", readings=WINDER_PASS, sample_id="W1"),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert visible.status == "PASS"
        hidden_fail = create_inspection(
            InspectionCreate(job_card_id=job.id, stage_type="PROCESS", readings=PROCESS_FAIL, sample_id="P1"),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert hidden_fail.status == "FAIL"
        before = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).count()
        omitted = complete_job_card_qc(
            job.id,
            CompleteCardRequest(
                visible_stage="WINDER",
                stages=[CompleteCardStageInput(stage_type="WINDER", readings=WINDER_PASS, sample_id="W1")],
            ),
            db=db,
            plant_id=PLANT,
            current_user=QC,
        )
        assert omitted.accepted is False
        assert omitted.form_retained is True
        stages = {row.stage for row in omitted.issues}
        assert "OVEN" in stages
        assert "PROCESS" in stages
        assert any(row.stage == "OVEN" and row.outcome == "INCOMPLETE" for row in omitted.issues)
        assert any(row.stage == "PROCESS" and row.parameter == "height" and row.outcome == "FAIL" for row in omitted.issues)
        assert not any(row.stage == "WINDER" and row.parameter == "height" for row in omitted.issues)
        after = db.query(QualityInspection).filter(QualityInspection.job_card_id == job.id).count()
        assert after == before
        stored_winder = db.query(QualityInspection).filter(QualityInspection.id == visible.id).one()
        assert stored_winder.readings.get("height") == 120
        assert stored_winder.status == "PASS"
        _reports().joinpath("qct050-job.json").write_text(
            json.dumps(
                {
                    "job_id": str(job.id),
                    "issue_count": len(omitted.issues),
                    "stages": sorted(stages),
                }
            )
        )
    finally:
        db.close()


def test_qct050_ui_job_seed():
    headers = _admin_headers()
    marker = f"QCT050UI-{uuid.uuid4()}"
    spec = _create_approved_spec(headers, marker, _complete_profile())
    snapshot = _build_spec_snapshot(spec, "NORMAL")
    db = Session()
    try:
        job = _issue_job(db, spec, snapshot, "CARD-UI", status="IN_PROGRESS")
        db.commit()
        _reports().joinpath("qct050-ui-job.json").write_text(json.dumps({"job_id": str(job.id)}))
    finally:
        db.close()
